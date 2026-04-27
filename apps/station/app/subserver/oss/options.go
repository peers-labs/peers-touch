package oss

import (
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type serverOptionsKey struct{}

var wrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
	return &Options{Options: options}
})

// Options is the operator-supplied configuration for the OSS
// subserver. It is populated from `peers.node.server.subserver.oss.*`
// YAML keys via `plugin.go` and threaded through to `NewOSSSubServer`
// as functional options.
type Options struct {
	*option.Options
	Path         string
	DBName       string
	StorePath    string
	SignSecret   string
	AuthProvider auth.Provider

	// HostOverride, when non-empty, is the externally-reachable origin
	// (`https://files.example.com` or `https://station.example.com`) that
	// the OSS subserver advertises in capabilities and embeds in the
	// `cid` URIs it returns from `/upload`. Leave empty to derive the
	// origin from the inbound `Host` header per request — the right
	// default for home-level deployments where a single station is
	// reachable on one URL.
	//
	// Set this when:
	//   - OSS is fronted by a CDN / reverse proxy with a different
	//     external hostname than the request `Host`, or
	//   - OSS is split out into its own process / container and the
	//     main station forwards traffic to it.
	HostOverride string

	// MaxFileSize caps the per-file upload size in bytes. Zero falls
	// back to a 32 MiB default. Reflected back to clients via
	// capabilities so the UI can pre-validate.
	MaxFileSize int64

	// MaxFilesPerMessage is an advisory limit clients use to bound
	// attachments per chat message. Not enforced server-side (each
	// upload is its own request), but exposed via capabilities.
	MaxFilesPerMessage int32

	// BackendType labels the active storage driver. The accepted
	// values are documented as `storage.Driver`: today `local` (the
	// zero-config default) and `s3` (any S3-protocol store —
	// AWS S3, MinIO, R2, B2, …). The label round-trips into
	// `FileMeta.Backend` for every upload.
	BackendType string

	// KeyStrategy selects how object keys are derived from uploads.
	// `random` produces `YYYY/MM/DD/<rand>.<ext>` — used by the
	// avatar / header endpoints where dedup hurts (every upload
	// must invalidate the previous URL). `cas` is content-addressable
	// storage and deduplicates identical bytes across uploaders;
	// it is the default for chat attachments. See `service.KeyStrategy`
	// for the full rationale.
	KeyStrategy string

	// PresignedUploadThreshold is the size (bytes) at which clients
	// should switch from the multipart `/upload` endpoint to the
	// pre-signed direct-PUT path. Zero disables the presigned path
	// entirely; the threshold has no effect when the active backend
	// does not implement `storage.PresignedBackend`. Surfaced in
	// `/capabilities` so the desktop client can route per file.
	PresignedUploadThreshold int64

	// PresignedUploadTTL is the validity window of presigned PUT URLs.
	// Default (when zero) is 5 minutes — long enough for typical
	// home-bandwidth × 8 MiB transfers, short enough that a leaked
	// URL is not a long-term liability.
	PresignedUploadTTL int64

	// PresignedDownloadTTL is the validity window of presigned GET
	// URLs the OSS handler 302-redirects clients to. Default 5
	// minutes. Keep this short — every cache miss in the renderer
	// triggers a fresh 302 anyway.
	PresignedDownloadTTL int64

	// S3 is the S3-protocol driver configuration. Required when
	// `BackendType == "s3"`. Field-by-field documentation lives on
	// `storage.S3Config`.
	S3 S3BackendOptions

	// ChatResolver overrides how `chat`-visibility GETs check
	// audience membership. Default (when nil) is the SQL-backed
	// resolver against `friend_chat_sessions`; tests and federated
	// deployments can install a stub here.
	ChatResolver ChatSessionResolver

	// LocalStationID is the value this station stamps as the `iss`
	// of outbound federation tokens and expects as the `aud` on
	// inbound ones. Operators set this to the same string the node
	// registry advertises as the station's PeerID; leaving it
	// empty disables outbound minting (federation is opt-in) but
	// still allows verifying inbound tokens that target this
	// station — a *different* station ID would fail the audience
	// check anyway.
	LocalStationID string

	// MimeBlocklist is the set of MIME prefixes the upload path
	// rejects with `oss_audit.reason = mime_blocked`. Match is
	// prefix-based, so `application/x-msdownload` blocks exactly
	// that MIME while `application/` would block every
	// `application/*` payload. Empty list disables the gate.
	MimeBlocklist []string

	// SoftDeleteGraceDays is the window during which a soft-deleted
	// file can be restored via `POST /sub-oss/file/:key/restore`.
	// Zero falls back to 7. Outside the window the row is no longer
	// restorable; the BlobGC worker becomes free to physically
	// delete the underlying blob once its ref_count reaches zero.
	SoftDeleteGraceDays int

	// BlobGCGraceHours is the additional delay between a blob's
	// ref_count reaching zero and the BlobGC worker physically
	// deleting it. Stops a delete-then-immediate-reupload race
	// from churning S3 objects. Zero falls back to 24.
	BlobGCGraceHours int

	// AuditRetentionDays is the window the AuditTrim worker uses
	// to keep oss_audit rows. Zero falls back to 90.
	AuditRetentionDays int

	// WorkerTTLIntervalSeconds / WorkerBlobGCIntervalSeconds /
	// WorkerReconcileIntervalSeconds pace the lifecycle workers.
	// Zero falls back to 3600 / 3600 / 86400 respectively (the
	// doc-defined defaults). Operators tightening these for tests
	// can drop them all the way to 1 second; we do not gate on a
	// minimum.
	WorkerTTLIntervalSeconds       int64
	WorkerBlobGCIntervalSeconds    int64
	WorkerReconcileIntervalSeconds int64

	// MetricsBearerToken gates `GET /sub-oss/metrics`. Empty means
	// the endpoint is *disabled entirely* — we do not allow
	// unauthenticated metrics scraping. Operators set a long random
	// string and configure their Prometheus job with the matching
	// bearer header.
	MetricsBearerToken string

	// MultipartUploadThreshold is the size (bytes) at which the
	// client should switch from the multipart `/upload` endpoint to
	// the multipart-protocol endpoints (`/multipart/{init,part,
	// complete}`). Zero falls back to 100 MiB. No effect when the
	// active backend does not implement `MultipartBackend`.
	MultipartUploadThreshold int64
}

// S3BackendOptions mirrors `storage.S3Config` at the YAML/options
// boundary. We keep the intermediate type so the option layer does
// not have to import the storage driver to know its config shape.
type S3BackendOptions struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	UseSSL          bool
	ForcePathStyle  bool
	KeyPrefix       string
}

// WithPath sets the base path (default `/sub-oss`).
func WithPath(p string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.Path = p })
}

// WithDBName binds the GORM datasource for the file metadata table.
func WithDBName(n string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.DBName = n })
}

// WithStorePath sets the filesystem root for the local backend.
func WithStorePath(p string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.StorePath = p })
}

// WithSignSecret sets the HMAC secret used by `/file?key=…&exp=…&sig=…`.
func WithSignSecret(s string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.SignSecret = s })
}

// WithAuthProvider plugs in the JWT verifier the upload endpoint uses.
func WithAuthProvider(p auth.Provider) option.Option {
	return wrapper.Wrap(func(o *Options) { o.AuthProvider = p })
}

// WithHostOverride pins the externally-reachable origin advertised
// in capabilities and `cid` URIs.
func WithHostOverride(h string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.HostOverride = h })
}

// WithMaxFileSize caps the per-file upload size in bytes.
func WithMaxFileSize(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MaxFileSize = n })
}

// WithMaxFilesPerMessage sets the advisory client-side limit.
func WithMaxFilesPerMessage(n int32) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MaxFilesPerMessage = n })
}

// WithBackendType selects the active storage driver (`local` / `s3`).
func WithBackendType(t string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.BackendType = t })
}

// WithKeyStrategy selects the upload key derivation: `random`
// (date-prefixed random keys, used by avatar / header uploads) or
// `cas` (content-addressable, used by chat attachments).
func WithKeyStrategy(s string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.KeyStrategy = s })
}

// WithPresignedUploadThreshold sets the byte threshold at which
// clients route through the presigned PUT path.
func WithPresignedUploadThreshold(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.PresignedUploadThreshold = n })
}

// WithPresignedUploadTTL sets the validity window of presigned PUT URLs (seconds).
func WithPresignedUploadTTL(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.PresignedUploadTTL = n })
}

// WithPresignedDownloadTTL sets the validity window of presigned GET URLs (seconds).
func WithPresignedDownloadTTL(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.PresignedDownloadTTL = n })
}

// WithS3Config installs the S3-protocol driver configuration.
func WithS3Config(s S3BackendOptions) option.Option {
	return wrapper.Wrap(func(o *Options) { o.S3 = s })
}

// WithChatSessionResolver overrides how `chat`-visibility GETs check
// audience membership. Tests pass a stub; federated deployments may
// pass an HTTP-backed resolver that queries the peer station.
func WithChatSessionResolver(r ChatSessionResolver) option.Option {
	return wrapper.Wrap(func(o *Options) { o.ChatResolver = r })
}

// WithLocalStationID stamps this station's federation identity. See
// Options.LocalStationID for the rationale.
func WithLocalStationID(id string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.LocalStationID = id })
}

// WithMimeBlocklist installs the prefix list of refused upload MIMEs.
func WithMimeBlocklist(prefixes []string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MimeBlocklist = prefixes })
}

// WithSoftDeleteGraceDays sets the restore window after a soft delete.
func WithSoftDeleteGraceDays(d int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.SoftDeleteGraceDays = d })
}

// WithBlobGCGraceHours sets the delay between ref_count→0 and
// physical deletion of a blob.
func WithBlobGCGraceHours(h int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.BlobGCGraceHours = h })
}

// WithAuditRetentionDays sets the AuditTrim worker's retention window.
func WithAuditRetentionDays(d int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.AuditRetentionDays = d })
}

// WithWorkerTTLIntervalSeconds paces the TTLSweeper worker.
func WithWorkerTTLIntervalSeconds(s int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.WorkerTTLIntervalSeconds = s })
}

// WithWorkerBlobGCIntervalSeconds paces the BlobGC worker.
func WithWorkerBlobGCIntervalSeconds(s int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.WorkerBlobGCIntervalSeconds = s })
}

// WithWorkerReconcileIntervalSeconds paces the BucketReconciler worker.
func WithWorkerReconcileIntervalSeconds(s int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.WorkerReconcileIntervalSeconds = s })
}

// WithMetricsBearerToken gates `/sub-oss/metrics`. Empty disables.
func WithMetricsBearerToken(t string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MetricsBearerToken = t })
}

// WithMultipartUploadThreshold sets the size at which clients switch
// to the multipart upload protocol.
func WithMultipartUploadThreshold(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MultipartUploadThreshold = n })
}

func getOptions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options)
}
