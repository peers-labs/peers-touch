package secret

import (
	"bytes"
	"errors"
	"testing"
)

func staticProvider(t *testing.T, raw string) StaticKEKProvider {
	t.Helper()
	return StaticKEKProvider{Material: []byte(raw)}
}

func TestSealOpenRoundTrip(t *testing.T) {
	p := staticProvider(t, "unit-test-kek-0123456789abcdef")
	plaintext := []byte("lark-app-secret-very-sensitive")

	env, err := Seal(p, "actor-a", PurposeChannel, "sec-1", plaintext)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(joinNonce(env.Nonce, env.Ciphertext), plaintext) {
		t.Fatal("ciphertext must not contain plaintext")
	}

	got, err := Open(p, "actor-a", PurposeChannel, "sec-1", env)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("plaintext mismatch: %q", string(got))
	}
}

func TestOpenRejectsBindingMismatch(t *testing.T) {
	p := staticProvider(t, "unit-test-kek-0123456789abcdef")
	env, err := Seal(p, "actor-a", PurposeChannel, "sec-1", []byte("secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	cases := []struct {
		name    string
		actor   string
		purpose Purpose
		id      string
	}{
		{"other actor", "actor-b", PurposeChannel, "sec-1"},
		{"other purpose", "actor-a", PurposeAgentRuntime, "sec-1"},
		{"other record id", "actor-a", PurposeChannel, "sec-2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Open(p, tc.actor, tc.purpose, tc.id, env); !errors.Is(err, ErrEnvelopeTampered) {
				t.Fatalf("expected ErrEnvelopeTampered, got %v", err)
			}
		})
	}
}

func TestOpenRejectsWrongKEK(t *testing.T) {
	p1 := staticProvider(t, "unit-test-kek-0123456789abcdef")
	p2 := staticProvider(t, "unit-test-kek-fedcba9876543210")
	env, err := Seal(p1, "actor-a", PurposeChannel, "sec-1", []byte("secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if _, err := Open(p2, "actor-a", PurposeChannel, "sec-1", env); !errors.Is(err, ErrKEKVersionMismatch) {
		t.Fatalf("expected ErrKEKVersionMismatch, got %v", err)
	}
}

func TestSealRequiresKEK(t *testing.T) {
	p := NewEnvKEKProvider()
	p.env = func(string) string { return "" }
	p.read = func(string) ([]byte, error) { return nil, errors.New("no file") }

	if _, _, err := p.KEK(); !errors.Is(err, ErrKEKNotConfigured) {
		t.Fatalf("expected ErrKEKNotConfigured, got %v", err)
	}
	if _, err := Seal(p, "a", PurposeChannel, "id", []byte("x")); !errors.Is(err, ErrKEKNotConfigured) {
		t.Fatalf("expected ErrKEKNotConfigured on Seal, got %v", err)
	}
}

func TestEnvKEKProviderFileAndEnv(t *testing.T) {
	raw := []byte("file-based-kek-abcdef0123456789")
	fileProvider := NewEnvKEKProvider()
	fileProvider.env = func(k string) string {
		if k == EnvKEKFile {
			return "/run/secrets/kek"
		}
		return ""
	}
	fileProvider.read = func(string) ([]byte, error) { return raw, nil }
	m, v1, err := fileProvider.KEK()
	if err != nil {
		t.Fatalf("file KEK: %v", err)
	}
	envProvider := NewEnvKEKProvider()
	envProvider.env = func(k string) string {
		if k == EnvKEK {
			return string(raw)
		}
		return ""
	}
	em, v2, err := envProvider.KEK()
	if err != nil {
		t.Fatalf("env KEK: %v", err)
	}
	_ = em
	if string(m) != string(raw) {
		t.Fatal("material mismatch")
	}
	if v1 != v2 {
		t.Fatalf("same KEK must yield same version: %s != %s", v1, v2)
	}
}

func TestRotateKEKResealsForNewProvider(t *testing.T) {
	old := staticProvider(t, "unit-test-kek-0123456789abcdef")
	new := staticProvider(t, "unit-test-kek-fedcba9876543210")

	env, err := Seal(old, "actor-a", PurposeChannel, "sec-1", []byte("secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	plaintext, err := Open(old, "actor-a", PurposeChannel, "sec-1", env)
	if err != nil {
		t.Fatalf("Open old: %v", err)
	}
	rotated, err := Seal(new, "actor-a", PurposeChannel, "sec-1", plaintext)
	if err != nil {
		t.Fatalf("re-Seal: %v", err)
	}
	if rotated.KEKVersion == env.KEKVersion {
		t.Fatal("rotated envelope must reference new KEK version")
	}
	if _, err := Open(new, "actor-a", PurposeChannel, "sec-1", rotated); err != nil {
		t.Fatalf("Open new: %v", err)
	}
}

func TestRejectsWeakKEK(t *testing.T) {
	if _, _, err := (StaticKEKProvider{Material: []byte("short")}).KEK(); !errors.Is(err, ErrKEKInvalid) {
		t.Fatalf("expected ErrKEKInvalid, got %v", err)
	}
}
