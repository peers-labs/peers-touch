// Package secret owns at-rest encryption for Channel subsystem credentials.
//
// There is no external KMS in the deployment target. This package implements a
// self-managed envelope:
//
//   - A Key Encryption Key (KEK) is injected at process start, never stored in
//     the database or source tree (environment variable or 0600 file).
//   - Every secret gets a random per-record Data Encryption Key (DEK).
//   - The plaintext is sealed with AES-256-GCM under the DEK; the DEK is then
//     wrapped with AES-256-GCM under a key derived from the KEK.
//
// Threat model (accepted for the internal-network deployment): it protects
// against database table / backup disclosure and row-level cross-actor reads.
// It does not protect against an attacker with full control of the Station
// host, who can read the injected KEK. A KMS-backed KEKProvider can replace the
// default implementation without changing callers or the persisted envelope.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	envelopeDomain = "peers-touch/channel-secret-envelope/v1"

	// EnvKEK carries a raw base KEK. EnvKEKFile carries a path to a file that
	// contains the KEK. When both are set, EnvKEK wins.
	EnvKEK     = "PT_SECRET_KEK"
	EnvKEKFile = "PT_SECRET_KEK_FILE"

	envelopeVersion = 1
)

// Purpose scopes a secret to a product capability so a sealed value can never
// be moved between contexts by callers.
type Purpose string

const (
	// PurposeChannel covers messaging-channel credentials (e.g. Lark app secret).
	PurposeChannel Purpose = "channel"
	// PurposeChannelRequesterOAuth covers transient device-flow material for
	// requester-scoped Channel authorization. Provider access and refresh
	// tokens remain inside the isolated managed lark-cli profile.
	PurposeChannelRequesterOAuth Purpose = "channel_requester_oauth"
	// PurposeAgentRuntime covers external CLI/agent provider credentials (codex/traex).
	PurposeAgentRuntime Purpose = "agent_runtime"
)

var (
	// ErrKEKNotConfigured is returned when no KEK material is available.
	ErrKEKNotConfigured = errors.New("secret KEK is not configured")
	// ErrKEKInvalid is returned when configured KEK material is unusable.
	ErrKEKInvalid = errors.New("secret KEK is invalid")
	// ErrEnvelopeTampered means ciphertext, nonce, AAD or wrapped DEK do not verify.
	ErrEnvelopeTampered = errors.New("secret envelope failed authentication")
	// ErrKEKVersionMismatch means the record was sealed by a different KEK.
	ErrKEKVersionMismatch = errors.New("secret envelope KEK version mismatch")
)

// Envelope is the persisted, fully encrypted representation of one secret.
// None of these fields ever contain plaintext.
type Envelope struct {
	Version    int
	KEKVersion string
	WrappedDEK []byte
	Nonce      []byte
	Ciphertext []byte
}

// KEKProvider supplies the active Key Encryption Key and its stable version.
// A future KMS integration only has to implement this interface.
type KEKProvider interface {
	KEK() (material []byte, version string, err error)
}

// Seal encrypts plaintext for (actorPTID, purpose, secretID). The binding is
// authenticated via AES-GCM additional data, so a ciphertext cannot be reused
// for another actor, purpose, or record.
func Seal(p KEKProvider, actorPTID string, purpose Purpose, secretID string, plaintext []byte) (Envelope, error) {
	if len(plaintext) == 0 {
		return Envelope{}, fmt.Errorf("%w: empty plaintext", ErrKEKInvalid)
	}
	kek, kekVersion, err := p.KEK()
	if err != nil {
		return Envelope{}, err
	}

	dek := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, dek); err != nil {
		return Envelope{}, fmt.Errorf("generate DEK: %w", err)
	}

	wrappedDEK, err := gcmSeal(deriveKey(kek, "dek-wrap"), dek, []byte(envelopeDomain))
	if err != nil {
		return Envelope{}, err
	}

	dataAAD := buildAAD(actorPTID, purpose, secretID, kekVersion)
	ciphertext, err := gcmSeal(dek, plaintext, dataAAD)
	if err != nil {
		return Envelope{}, err
	}
	nonce, sealed := splitNonce(ciphertext)

	return Envelope{
		Version:    envelopeVersion,
		KEKVersion: kekVersion,
		WrappedDEK: wrappedDEK,
		Nonce:      nonce,
		Ciphertext: sealed,
	}, nil
}

// Open decrypts an envelope previously sealed for the same binding.
func Open(p KEKProvider, actorPTID string, purpose Purpose, secretID string, e Envelope) ([]byte, error) {
	if e.Version != envelopeVersion {
		return nil, fmt.Errorf("%w: unsupported version %d", ErrEnvelopeTampered, e.Version)
	}
	kek, kekVersion, err := p.KEK()
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(kekVersion), []byte(e.KEKVersion)) != 1 {
		return nil, ErrKEKVersionMismatch
	}

	dek, err := gcmOpen(deriveKey(kek, "dek-wrap"), e.WrappedDEK, []byte(envelopeDomain))
	if err != nil {
		return nil, fmt.Errorf("%w: unwrap DEK", ErrEnvelopeTampered)
	}

	dataAAD := buildAAD(actorPTID, purpose, secretID, kekVersion)
	plaintext, err := gcmOpen(dek, joinNonce(e.Nonce, e.Ciphertext), dataAAD)
	if err != nil {
		return nil, fmt.Errorf("%w: decrypt", ErrEnvelopeTampered)
	}
	return plaintext, nil
}

// KEKVersion returns a stable, non-secret identifier for the configured KEK.
func KEKVersion(material []byte) string {
	sum := sha256.Sum256(append([]byte(envelopeDomain), material...))
	return hex.EncodeToString(sum[:16])
}

// EnvKEKProvider resolves the KEK from PT_SECRET_KEK or PT_SECRET_KEK_FILE.
type EnvKEKProvider struct {
	env  func(string) string
	read func(string) ([]byte, error)
}

// NewEnvKEKProvider returns the production provider backed by the process
// environment.
func NewEnvKEKProvider() EnvKEKProvider {
	return EnvKEKProvider{env: os.Getenv, read: os.ReadFile}
}

func (p EnvKEKProvider) KEK() ([]byte, string, error) {
	getenv := p.env
	if getenv == nil {
		getenv = os.Getenv
	}
	readFile := p.read
	if readFile == nil {
		readFile = os.ReadFile
	}

	if raw := strings.TrimSpace(getenv(EnvKEK)); raw != "" {
		return validateKEK([]byte(raw))
	}
	path := strings.TrimSpace(getenv(EnvKEKFile))
	if path == "" {
		return nil, "", ErrKEKNotConfigured
	}
	raw, err := readFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("%w: read KEK file: %v", ErrKEKNotConfigured, err)
	}
	if fi, statErr := os.Stat(path); statErr == nil && fi.Mode().Perm()&0o002 != 0 {
		// The KEK file must not be world-writable. The recommended mode is 0600.
		return nil, "", fmt.Errorf("%w: KEK file is world-writable", ErrKEKInvalid)
	}
	return validateKEK(raw)
}

func validateKEK(raw []byte) ([]byte, string, error) {
	material := []byte(strings.TrimSpace(string(raw)))
	if len(material) < 16 {
		return nil, "", fmt.Errorf("%w: require at least 16 bytes", ErrKEKInvalid)
	}
	return material, KEKVersion(material), nil
}

// StaticKEKProvider is a test/helper provider holding KEK material in memory.
type StaticKEKProvider struct {
	Material []byte
}

func (p StaticKEKProvider) KEK() ([]byte, string, error) {
	return validateKEK(p.Material)
}

func deriveKey(kek []byte, info string) []byte {
	key, err := hkdf.Key(sha256.New, kek, []byte(envelopeDomain), info, 32)
	if err != nil {
		// sha256 HKDF cannot fail for these parameters.
		panic(err)
	}
	return key
}

func buildAAD(actorPTID string, purpose Purpose, secretID, kekVersion string) []byte {
	return []byte(strings.Join([]string{
		envelopeDomain,
		string(purpose),
		actorPTID,
		secretID,
		kekVersion,
	}, "|"))
}

// gcmSeal returns nonce||ciphertext in a single slice.
func gcmSeal(key, plaintext, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("nonce: %w", err)
	}
	sealed := aead.Seal(nil, nonce, plaintext, aad)
	return joinNonce(nonce, sealed), nil
}

func gcmOpen(key, blob, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := aead.NonceSize()
	if len(blob) < ns+1 {
		return nil, ErrEnvelopeTampered
	}
	return aead.Open(nil, blob[:ns], blob[ns:], aad)
}

func joinNonce(nonce, ciphertext []byte) []byte {
	out := make([]byte, 0, len(nonce)+len(ciphertext))
	out = append(out, nonce...)
	out = append(out, ciphertext...)
	return out
}

func splitNonce(blob []byte) (nonce, ciphertext []byte) {
	// GCM standard nonce size is 12; sealed blobs are always produced by gcmSeal.
	const nonceSize = 12
	if len(blob) < nonceSize {
		return nil, nil
	}
	return blob[:nonceSize], blob[nonceSize:]
}
