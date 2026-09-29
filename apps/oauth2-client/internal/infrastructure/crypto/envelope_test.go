package recordcrypto

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
)

func TestEnvelopeRoundTripAndNonceUniqueness(t *testing.T) {
	codec, err := NewCodec("v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	codec.now = func() time.Time {
		return time.Date(2026, 9, 30, 1, 2, 3, 0, time.UTC)
	}
	first, err := codec.Encrypt("credential", "oauth-data/credentials/a.json", []byte("access-secret"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := codec.Encrypt("credential", "oauth-data/credentials/a.json", []byte("access-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("envelopes reused a nonce")
	}
	plaintext, needsRotation, err := codec.Decrypt("credential", "oauth-data/credentials/a.json", first)
	if err != nil {
		t.Fatal(err)
	}
	if needsRotation || string(plaintext) != "access-secret" {
		t.Fatalf("unexpected round trip: rotation=%v plaintext=%q", needsRotation, plaintext)
	}
	if bytes.Contains(first, []byte("access-secret")) {
		t.Fatal("ciphertext contains plaintext")
	}
}

func TestEnvelopeAuthenticatesMetadataKindAndPath(t *testing.T) {
	codec, err := NewCodec("v1", map[string][]byte{
		"v1": bytes.Repeat([]byte{1}, 32),
		"v2": bytes.Repeat([]byte{2}, 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := codec.Encrypt("credential", "oauth-data/credentials/a.json", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	var original Envelope
	if err := json.Unmarshal(payload, &original); err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*Envelope){
		"version":    func(value *Envelope) { value.Version++ },
		"key id":     func(value *Envelope) { value.KeyID = "v2" },
		"algorithm":  func(value *Envelope) { value.Algorithm = "AES-128-GCM" },
		"nonce":      func(value *Envelope) { value.Nonce = mutateLast(value.Nonce) },
		"ciphertext": func(value *Envelope) { value.Ciphertext = mutateLast(value.Ciphertext) },
		"updated at": func(value *Envelope) { value.UpdatedAt = "2026-09-30T01:02:04Z" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			changed := original
			mutate(&changed)
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := codec.Decrypt("credential", "oauth-data/credentials/a.json", encoded); !errors.Is(err, repository.ErrRecordCorrupt) {
				t.Fatalf("expected corrupt record, got %v", err)
			}
		})
	}
	for name, values := range map[string][2]string{
		"record kind": {"identity", "oauth-data/credentials/a.json"},
		"record path": {"credential", "oauth-data/credentials/b.json"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := codec.Decrypt(values[0], values[1], payload); !errors.Is(err, repository.ErrRecordCorrupt) {
				t.Fatalf("expected corrupt record, got %v", err)
			}
		})
	}
}

func TestEnvelopeReportsRotation(t *testing.T) {
	oldCodec, err := NewCodec("v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := oldCodec.Encrypt("audit", "oauth-data/audits/2026/09/e.json", []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	rotatedCodec, err := NewCodec("v2", map[string][]byte{
		"v1": bytes.Repeat([]byte{1}, 32),
		"v2": bytes.Repeat([]byte{2}, 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, needsRotation, err := rotatedCodec.Decrypt("audit", "oauth-data/audits/2026/09/e.json", payload)
	if err != nil {
		t.Fatal(err)
	}
	if !needsRotation {
		t.Fatal("old key envelope did not request rotation")
	}
}

func mutateLast(value string) string {
	replacement := byte('A')
	if value[len(value)-1] == replacement {
		replacement = 'B'
	}
	return value[:len(value)-1] + string(replacement)
}
