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

func getOptions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options)
}
