package storage

import (
	"errors"
	"fmt"
	"strings"
)

// Driver is the canonical name of a storage backend. The values are
// also what `FileMeta.Backend` records so the column round-trips
// losslessly through the database.
type Driver string

const (
	// DriverLocal is the default zero-config filesystem driver.
	DriverLocal Driver = "local"
	// DriverS3 is the S3-protocol driver. Works against AWS S3,
	// MinIO, Cloudflare R2, Backblaze B2, GCS S3-compat, etc. —
	// what the protocol speaks is what we support.
	DriverS3 Driver = "s3"
)

// LocalConfig configures the on-disk driver. `Root` is the
// filesystem prefix every key is joined under.
type LocalConfig struct {
	Root string
}

// S3Config configures the S3-protocol driver. The shape is
// vendor-neutral: any S3-compatible service can be reached by
// pointing `Endpoint` at it. `KeyPrefix` is prepended to every key
// before the request hits the bucket — useful when the same bucket
// is shared across multiple Stations.
//
// `UseSSL` defaults to `true` for any non-localhost endpoint; the
// factory normalises that. `ForcePathStyle` is required for MinIO
// and most non-AWS implementations.
type S3Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	UseSSL          bool
	ForcePathStyle  bool
	KeyPrefix       string
}

// Config picks a driver and supplies its parameters. Exactly one of
// `Local` / `S3` must be populated, matching `Driver`. The factory
// does not silently coerce mismatches — operator-supplied config
// errors should surface loudly at startup.
type Config struct {
	Driver Driver
	Local  *LocalConfig
	S3     *S3Config
}

// ErrInvalidConfig is returned when the supplied `Config` does not
// match any known driver, or required fields for the chosen driver
// are missing. Callers should treat this as fatal at process start.
var ErrInvalidConfig = errors.New("storage: invalid backend config")

// New constructs the configured `Backend`. The function deliberately
// returns the bare `Backend` interface (not a concrete type) so
// callers cannot reach around the abstraction and depend on driver
// internals. Capability discovery happens through type assertion at
// the call site, e.g. `if p, ok := b.(PresignedBackend); ok { … }`.
func New(cfg Config) (Backend, error) {
	switch normalizeDriver(cfg.Driver) {
	case DriverLocal:
		if cfg.Local == nil || strings.TrimSpace(cfg.Local.Root) == "" {
			return nil, fmt.Errorf("%w: local.root is required", ErrInvalidConfig)
		}
		return NewLocalBackend(cfg.Local.Root), nil
	case DriverS3:
		if cfg.S3 == nil {
			return nil, fmt.Errorf("%w: s3 config block is required", ErrInvalidConfig)
		}
		return NewS3Backend(*cfg.S3)
	default:
		return nil, fmt.Errorf("%w: unknown driver %q", ErrInvalidConfig, cfg.Driver)
	}
}

// normalizeDriver coerces the operator-supplied value to a known
// `Driver`. We accept empty / unknown as `local` *only* through the
// caller's own default-fill — the factory itself rejects anything it
// does not recognise so a typo never silently degrades to local.
func normalizeDriver(d Driver) Driver {
	switch Driver(strings.ToLower(strings.TrimSpace(string(d)))) {
	case "", DriverLocal:
		return DriverLocal
	case DriverS3:
		return DriverS3
	default:
		return d
	}
}
