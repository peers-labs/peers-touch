package oss

import (
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type serverOptionsKey struct{}

var wrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
	return &Options{Options: options}
})

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

	// BackendType labels the active storage driver. Currently only
	// `local` is implemented; other values (`s3`, `proxy`) are reserved
	// for forthcoming backend impls and surfaced via capabilities so
	// clients can decide whether features like presigned upload are
	// worth offering.
	BackendType string

	// KeyStrategy selects how object keys are derived from uploads.
	// Empty / `random` keeps the legacy `YYYY/MM/DD/<rand>.<ext>`;
	// `cas` switches to content-addressable storage which deduplicates
	// identical bytes across uploaders. See `service.KeyStrategy` for
	// the full rationale.
	KeyStrategy string
}

func WithPath(p string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.Path = p })
}
func WithDBName(n string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.DBName = n })
}
func WithStorePath(p string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.StorePath = p })
}
func WithSignSecret(s string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.SignSecret = s })
}
func WithAuthProvider(p auth.Provider) option.Option {
	return wrapper.Wrap(func(o *Options) { o.AuthProvider = p })
}
func WithHostOverride(h string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.HostOverride = h })
}
func WithMaxFileSize(n int64) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MaxFileSize = n })
}
func WithMaxFilesPerMessage(n int32) option.Option {
	return wrapper.Wrap(func(o *Options) { o.MaxFilesPerMessage = n })
}
func WithBackendType(t string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.BackendType = t })
}
func WithKeyStrategy(s string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.KeyStrategy = s })
}

func getOptions(opts ...option.Option) *Options {
    return option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options)
}

