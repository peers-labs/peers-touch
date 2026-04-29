package storage

import (
	"errors"
	"strings"
	"testing"
)

// TestFactoryAcceptsLocalConfig — the zero-config home deployment
// path. A populated `Local.Root` plus `DriverLocal` (or empty driver
// with explicit local config) yields a working `LocalBackend`.
func TestFactoryAcceptsLocalConfig(t *testing.T) {
	tmp := t.TempDir()
	cases := []struct {
		name string
		cfg  Config
	}{
		{name: "explicit_local", cfg: Config{Driver: DriverLocal, Local: &LocalConfig{Root: tmp}}},
		{name: "empty_driver_defaults_local", cfg: Config{Local: &LocalConfig{Root: tmp}}},
		{name: "uppercase_driver_normalised", cfg: Config{Driver: Driver("LOCAL"), Local: &LocalConfig{Root: tmp}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, err := New(tc.cfg)
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			if _, ok := b.(*LocalBackend); !ok {
				t.Fatalf("expected *LocalBackend, got %T", b)
			}
		})
	}
}

// TestFactoryRejectsMissingLocalRoot — an operator who selects
// `local` without a `root` is misconfigured. We refuse to silently
// pick a default because that has bitten us with `/tmp/oss` showing
// up in production-ish setups.
func TestFactoryRejectsMissingLocalRoot(t *testing.T) {
	_, err := New(Config{Driver: DriverLocal, Local: &LocalConfig{Root: "  "}})
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("err = %v, want ErrInvalidConfig", err)
	}
	if !strings.Contains(err.Error(), "local.root") {
		t.Errorf("error should mention local.root, got: %v", err)
	}
}

// TestFactoryRejectsUnknownDriver — typos must surface as fatal at
// process startup, not silently degrade to local. This is the
// difference between "operator forgot to set the value" (handled
// upstream by oss.go's empty-string default) and "operator typed the
// value but spelled it wrong" (caught here).
func TestFactoryRejectsUnknownDriver(t *testing.T) {
	_, err := New(Config{Driver: Driver("ipfs")})
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("err = %v, want ErrInvalidConfig", err)
	}
}

// TestFactoryRejectsS3WithoutCredentials — every required S3 field
// must be present. We surface the missing field name in the error
// so operators can fix their YAML without cross-referencing source.
func TestFactoryRejectsS3WithoutCredentials(t *testing.T) {
	cases := []struct {
		name string
		cfg  S3Config
		want string
	}{
		{name: "no_endpoint", cfg: S3Config{Bucket: "b", AccessKeyID: "k", SecretAccessKey: "s"}, want: "endpoint"},
		{name: "no_bucket", cfg: S3Config{Endpoint: "e", AccessKeyID: "k", SecretAccessKey: "s"}, want: "bucket"},
		{name: "no_access_key", cfg: S3Config{Endpoint: "e", Bucket: "b", SecretAccessKey: "s"}, want: "access-key"},
		{name: "no_secret_key", cfg: S3Config{Endpoint: "e", Bucket: "b", AccessKeyID: "k"}, want: "secret-access-key"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(Config{Driver: DriverS3, S3: &tc.cfg})
			if !errors.Is(err, ErrInvalidConfig) {
				t.Fatalf("err = %v, want ErrInvalidConfig", err)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error should mention %q, got: %v", tc.want, err)
			}
		})
	}
}

// TestFactoryS3HappyPath — a fully-populated S3Config builds without
// touching the network. This guards the constructor's no-I/O
// invariant: a misconfigured bucket should not block process start.
func TestFactoryS3HappyPath(t *testing.T) {
	b, err := New(Config{
		Driver: DriverS3,
		S3: &S3Config{
			Endpoint:        "minio.local:9000",
			Region:          "us-east-1",
			Bucket:          "test",
			AccessKeyID:     "minioadmin",
			SecretAccessKey: "minioadmin",
			ForcePathStyle:  true,
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := b.(*S3Backend); !ok {
		t.Fatalf("expected *S3Backend, got %T", b)
	}
	// Every S3Backend must satisfy PresignedBackend — the OSS
	// subserver feature-detects via this interface, and a regression
	// here would silently disable the entire fast-lane.
	if _, ok := b.(PresignedBackend); !ok {
		t.Fatal("S3Backend must implement PresignedBackend")
	}
}

// TestNormalizeEndpoint — explicit scheme wins over the `UseSSL`
// flag. Mismatch between the two is the most common operator
// mistake (e.g. `https://` URL with `use-ssl: false`); honoring the
// scheme makes the failure mode loud at first request.
func TestNormalizeEndpoint(t *testing.T) {
	cases := []struct {
		raw       string
		useSSL    bool
		wantHost  string
		wantHTTPS bool
	}{
		{raw: "https://s3.amazonaws.com", useSSL: false, wantHost: "s3.amazonaws.com", wantHTTPS: true},
		{raw: "http://minio.local:9000", useSSL: true, wantHost: "minio.local:9000", wantHTTPS: false},
		{raw: "minio.local:9000", useSSL: true, wantHost: "minio.local:9000", wantHTTPS: true},
		{raw: "minio.local:9000", useSSL: false, wantHost: "minio.local:9000", wantHTTPS: false},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			host, ssl := normalizeEndpoint(tc.raw, tc.useSSL)
			if host != tc.wantHost {
				t.Errorf("host = %q, want %q", host, tc.wantHost)
			}
			if ssl != tc.wantHTTPS {
				t.Errorf("ssl = %v, want %v", ssl, tc.wantHTTPS)
			}
		})
	}
}
