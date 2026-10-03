package recordcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
)

const (
	envelopeVersion   = 1
	envelopeAlgorithm = "AES-256-GCM"
)

type Envelope struct {
	Version    int    `json:"version"`
	KeyID      string `json:"key_id"`
	Algorithm  string `json:"algorithm"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
	UpdatedAt  string `json:"updated_at"`
}

type Codec struct {
	activeKeyID string
	keys        map[string][]byte
	random      io.Reader
	now         func() time.Time
}

func NewCodec(activeKeyID string, keys map[string][]byte) (*Codec, error) {
	activeKeyID = strings.TrimSpace(activeKeyID)
	if activeKeyID == "" {
		return nil, fmt.Errorf("%w: active key id is empty", repository.ErrKeyUnavailable)
	}
	copied := make(map[string][]byte, len(keys))
	for id, key := range keys {
		if strings.TrimSpace(id) == "" || len(key) != 32 {
			return nil, fmt.Errorf("%w: invalid key ring entry", repository.ErrKeyUnavailable)
		}
		copied[id] = append([]byte(nil), key...)
	}
	if _, ok := copied[activeKeyID]; !ok {
		return nil, fmt.Errorf("%w: active key is not configured", repository.ErrKeyUnavailable)
	}
	return &Codec{
		activeKeyID: activeKeyID,
		keys:        copied,
		random:      rand.Reader,
		now:         func() time.Time { return time.Now().UTC() },
	}, nil
}

func (c *Codec) ActiveKeyID() string {
	return c.activeKeyID
}

func (c *Codec) Encrypt(recordKind, recordPath string, plaintext []byte) ([]byte, error) {
	key := c.keys[c.activeKeyID]
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: cipher initialization failed", repository.ErrKeyUnavailable)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%w: gcm initialization failed", repository.ErrKeyUnavailable)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(c.random, nonce); err != nil {
		return nil, fmt.Errorf("%w: nonce generation failed", repository.ErrStorageUnavailable)
	}
	envelope := Envelope{
		Version:   envelopeVersion,
		KeyID:     c.activeKeyID,
		Algorithm: envelopeAlgorithm,
		Nonce:     base64.RawURLEncoding.EncodeToString(nonce),
		UpdatedAt: c.now().Format(time.RFC3339Nano),
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, envelopeAAD(envelope, recordKind, recordPath))
	envelope.Ciphertext = base64.RawURLEncoding.EncodeToString(ciphertext)
	out, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("%w: envelope encoding failed", repository.ErrRecordCorrupt)
	}
	return append(out, '\n'), nil
}

func (c *Codec) Decrypt(recordKind, recordPath string, payload []byte) ([]byte, bool, error) {
	var envelope Envelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, false, fmt.Errorf("%w: envelope decoding failed", repository.ErrRecordCorrupt)
	}
	if envelope.Version != envelopeVersion || envelope.Algorithm != envelopeAlgorithm {
		return nil, false, fmt.Errorf("%w: unsupported envelope", repository.ErrRecordCorrupt)
	}
	if _, err := time.Parse(time.RFC3339Nano, envelope.UpdatedAt); err != nil {
		return nil, false, fmt.Errorf("%w: invalid envelope timestamp", repository.ErrRecordCorrupt)
	}
	key, ok := c.keys[envelope.KeyID]
	if !ok {
		return nil, false, repository.ErrKeyUnavailable
	}
	nonce, err := base64.RawURLEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return nil, false, fmt.Errorf("%w: invalid envelope nonce", repository.ErrRecordCorrupt)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return nil, false, fmt.Errorf("%w: invalid envelope ciphertext", repository.ErrRecordCorrupt)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, false, repository.ErrKeyUnavailable
	}
	aead, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != aead.NonceSize() {
		return nil, false, fmt.Errorf("%w: invalid envelope nonce", repository.ErrRecordCorrupt)
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, envelopeAAD(envelope, recordKind, recordPath))
	if err != nil {
		return nil, false, fmt.Errorf("%w: envelope authentication failed", repository.ErrRecordCorrupt)
	}
	return plaintext, envelope.KeyID != c.activeKeyID, nil
}

func envelopeAAD(envelope Envelope, recordKind, recordPath string) []byte {
	return []byte(strings.Join([]string{
		"oauth-login-broker",
		fmt.Sprintf("%d", envelope.Version),
		envelope.KeyID,
		envelope.Algorithm,
		envelope.UpdatedAt,
		recordKind,
		recordPath,
	}, "\x00"))
}

func IsEnvelope(payload []byte) bool {
	var envelope Envelope
	return json.Unmarshal(payload, &envelope) == nil &&
		envelope.Version == envelopeVersion &&
		envelope.Algorithm == envelopeAlgorithm &&
		envelope.KeyID != "" &&
		envelope.Nonce != "" &&
		envelope.Ciphertext != "" &&
		envelope.UpdatedAt != ""
}

func IsRecordError(err error) bool {
	return errors.Is(err, repository.ErrRecordCorrupt) ||
		errors.Is(err, repository.ErrKeyUnavailable)
}
