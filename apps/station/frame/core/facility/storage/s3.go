package storage

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3Backend speaks the S3 protocol over `minio-go/v7`. It satisfies
// `Backend` (Save / Open / Delete) and `PresignedBackend` (presigned
// PUT/GET + HeadObject), so the OSS subserver can offload bandwidth
// directly to the underlying object store on capable deployments.
//
// The driver is intentionally vendor-neutral. Anything that speaks the
// S3 protocol — AWS S3, MinIO, Cloudflare R2, Backblaze B2,
// Alibaba/Tencent OSS S3-compat, GCS S3-compat — works by pointing
// `S3Config.Endpoint` at it. `ForcePathStyle = true` is the right
// choice for everything except AWS itself.
type S3Backend struct {
	client    *minio.Client
	bucket    string
	keyPrefix string
	endpoint  string
	useSSL    bool
}

// NewS3Backend constructs an `S3Backend` from a validated `S3Config`.
// The constructor performs no network I/O — the first request the
// caller makes is when connectivity / auth gets exercised. This is
// deliberate: a misconfigured bucket should not break process startup
// for unrelated subservers.
func NewS3Backend(cfg S3Config) (*S3Backend, error) {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, fmt.Errorf("%w: s3.endpoint is required", ErrInvalidConfig)
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, fmt.Errorf("%w: s3.bucket is required", ErrInvalidConfig)
	}
	if strings.TrimSpace(cfg.AccessKeyID) == "" || strings.TrimSpace(cfg.SecretAccessKey) == "" {
		return nil, fmt.Errorf("%w: s3.access-key-id and s3.secret-access-key are required", ErrInvalidConfig)
	}

	endpoint, useSSL := normalizeEndpoint(cfg.Endpoint, cfg.UseSSL)
	opts := &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: useSSL,
		Region: cfg.Region,
		// minio-go uses path-style automatically for non-AWS hosts;
		// we still expose the toggle so AWS-via-IP / VPC-endpoint
		// configurations can override.
		BucketLookup: bucketLookup(cfg.ForcePathStyle),
	}
	client, err := minio.New(endpoint, opts)
	if err != nil {
		return nil, fmt.Errorf("storage.s3: client init: %w", err)
	}

	return &S3Backend{
		client:    client,
		bucket:    cfg.Bucket,
		keyPrefix: strings.Trim(cfg.KeyPrefix, "/"),
		endpoint:  endpoint,
		useSSL:    useSSL,
	}, nil
}

// Save streams `r` to the configured bucket under `key`. The returned
// path is the canonical S3 URI (`s3://bucket/key`) — it is recorded
// in `FileMeta.Path` for debuggability and is *not* meant to be
// dereferenced as a filesystem path.
func (b *S3Backend) Save(ctx context.Context, key string, r io.Reader) (string, error) {
	full := b.fullKey(key)
	// `-1` for size + `PutObject` makes minio-go fall back to its
	// streaming multipart path with a 16 MiB part size. That is
	// the right behaviour for opaque chat attachments where the
	// caller has already counted bytes upstream (header.Size) but
	// the multipart layer does not surface them here. For
	// content-type we leave it to the caller to set on the
	// multipart frame; default to octet-stream so the bucket
	// listing isn't entirely opaque.
	_, err := b.client.PutObject(ctx, b.bucket, full, r, -1, minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	if err != nil {
		return "", fmt.Errorf("storage.s3: put %q: %w", full, err)
	}
	return s3URI(b.bucket, full), nil
}

// Open issues a `GetObject` and returns the byte stream + size + mime
// triple that mirrors `LocalBackend.Open`. The HTTP request is *not*
// consumed lazily until the caller starts reading — minio-go does the
// HEAD-then-GET dance on `Stat()`, which is what we need for the
// `Content-Length` we surface back to the caller.
func (b *S3Backend) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	full := b.fullKey(key)
	obj, err := b.client.GetObject(ctx, b.bucket, full, minio.GetObjectOptions{})
	if err != nil {
		return nil, 0, "", fmt.Errorf("storage.s3: get %q: %w", full, err)
	}
	st, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, 0, "", fmt.Errorf("storage.s3: stat %q: %w", full, err)
	}
	return obj, st.Size, st.ContentType, nil
}

// Delete removes the object at `key`. minio-go returns nil (not error)
// for objects that did not exist — we surface the same semantics as
// `os.Remove` would not, but it matches S3 behaviour and is the right
// idempotent default for the OSS subserver.
func (b *S3Backend) Delete(ctx context.Context, key string) error {
	full := b.fullKey(key)
	if err := b.client.RemoveObject(ctx, b.bucket, full, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage.s3: delete %q: %w", full, err)
	}
	return nil
}

// PresignPut produces a pre-signed `PUT` URL bound to `contentLength`
// and (when supplied) `sha256Hex`. We bind the SHA-256 via the
// `x-amz-checksum-sha256` request header — the underlying store
// rejects the upload if the bytes hash to a different value, which is
// exactly the integrity contract we want for CAS.
//
// `contentType` is best-effort: most clients send their own and S3
// does not enforce the value passed at signing time, but advertising
// it makes the bucket listing self-describing.
func (b *S3Backend) PresignPut(ctx context.Context, key, contentType string, contentLength int64, sha256Hex string, ttl time.Duration) (PresignedRequest, error) {
	if ttl <= 0 {
		return PresignedRequest{}, errors.New("storage.s3: presign ttl must be positive")
	}
	if contentLength <= 0 {
		return PresignedRequest{}, errors.New("storage.s3: presign requires content length")
	}
	full := b.fullKey(key)

	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	if sha256Hex != "" {
		// AWS expects a base64-encoded raw digest, not the hex
		// form we use everywhere else. We accept hex from the
		// caller for symmetry with `FileMeta.Sha256` and convert
		// here.
		raw, err := hex.DecodeString(sha256Hex)
		if err != nil || len(raw) != sha256.Size {
			return PresignedRequest{}, fmt.Errorf("storage.s3: invalid sha256 hex: %w", err)
		}
		headers["x-amz-checksum-sha256"] = base64.StdEncoding.EncodeToString(raw)
	}

	// minio-go's PresignHeader takes a `http.Header`-shaped map; we
	// keep our return shape Go-stdlib-free for caller convenience.
	stdHeaders := mapToValues(headers)
	signed, err := b.client.PresignHeader(ctx, "PUT", b.bucket, full, ttl, url.Values{}, stdHeaders)
	if err != nil {
		return PresignedRequest{}, fmt.Errorf("storage.s3: presign put %q: %w", full, err)
	}

	return PresignedRequest{
		Method:    "PUT",
		URL:       signed.String(),
		Headers:   headers,
		MaxBytes:  contentLength,
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

// PresignGet produces a pre-signed `GET` URL the renderer can fetch
// directly. The OSS handler 302s to this URL when a `PresignedBackend`
// is the active driver, which is what restores the bandwidth-offload
// property of using S3 in the first place.
func (b *S3Backend) PresignGet(ctx context.Context, key string, ttl time.Duration) (PresignedRequest, error) {
	if ttl <= 0 {
		return PresignedRequest{}, errors.New("storage.s3: presign ttl must be positive")
	}
	full := b.fullKey(key)
	signed, err := b.client.PresignedGetObject(ctx, b.bucket, full, ttl, url.Values{})
	if err != nil {
		return PresignedRequest{}, fmt.Errorf("storage.s3: presign get %q: %w", full, err)
	}
	return PresignedRequest{
		Method:    "GET",
		URL:       signed.String(),
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

// HeadObject returns size / mime / etag for `key`. The OSS subserver
// uses this on the presigned upload completion path to validate the
// client's claimed size matches what actually landed in the bucket.
// When the client bound a SHA-256 at presign time, AWS returns it on
// HEAD via `x-amz-checksum-sha256` (base64); we surface the hex form
// for parity with `FileMeta.Sha256`.
func (b *S3Backend) HeadObject(ctx context.Context, key string) (HeadInfo, error) {
	full := b.fullKey(key)
	st, err := b.client.StatObject(ctx, b.bucket, full, minio.StatObjectOptions{
		Checksum: true,
	})
	if err != nil {
		return HeadInfo{}, fmt.Errorf("storage.s3: head %q: %w", full, err)
	}
	out := HeadInfo{
		Size: st.Size,
		Mime: st.ContentType,
		ETag: strings.Trim(st.ETag, `"`),
	}
	if st.ChecksumSHA256 != "" {
		if raw, err := base64.StdEncoding.DecodeString(st.ChecksumSHA256); err == nil {
			out.Sha256 = hex.EncodeToString(raw)
		}
	}
	return out, nil
}

// fullKey prepends the configured key prefix. We trim leading slashes
// on both sides so a prefix of `"chat/"` and a key of `"/2026/x"` join
// to the unambiguous `"chat/2026/x"`.
func (b *S3Backend) fullKey(key string) string {
	k := strings.TrimLeft(key, "/")
	if b.keyPrefix == "" {
		return k
	}
	return b.keyPrefix + "/" + k
}

// normalizeEndpoint strips an explicit scheme (minio-go expects a
// host:port). When the operator supplied a scheme, we honour it as
// the SSL signal regardless of the `UseSSL` flag, because mismatch
// between the two would break TLS negotiation in confusing ways.
func normalizeEndpoint(raw string, useSSL bool) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "https://") {
		return strings.TrimPrefix(trimmed, "https://"), true
	}
	if strings.HasPrefix(trimmed, "http://") {
		return strings.TrimPrefix(trimmed, "http://"), false
	}
	return trimmed, useSSL
}

// bucketLookup translates our boolean to minio-go's enum. Path-style
// is the safest default for non-AWS endpoints; AWS itself prefers
// virtual-hosted style for all but `*-website` buckets.
func bucketLookup(forcePathStyle bool) minio.BucketLookupType {
	if forcePathStyle {
		return minio.BucketLookupPath
	}
	return minio.BucketLookupAuto
}

func s3URI(bucket, key string) string {
	return "s3://" + bucket + "/" + key
}

// mapToValues converts our header map into the `http.Header` shape
// minio-go's PresignHeader expects.
func mapToValues(h map[string]string) map[string][]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string][]string, len(h))
	for k, v := range h {
		out[k] = []string{v}
	}
	return out
}
