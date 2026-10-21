package operatorstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
)

type recordEnvelope struct {
	Version    int    `json:"version"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type recordCodec struct {
	aead   cipher.AEAD
	random io.Reader
}

func newRecordCodec(key []byte) (*recordCodec, error) {
	if len(key) != 32 {
		return nil, errors.New("invalid_operator_record_key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &recordCodec{aead: aead, random: rand.Reader}, nil
}

func (c *recordCodec) encrypt(path string, value any) ([]byte, error) {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(c.random, nonce); err != nil {
		return nil, err
	}
	ciphertext := c.aead.Seal(nil, nonce, plaintext, []byte(path))
	return json.Marshal(recordEnvelope{
		Version:    1,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
	})
}

func (c *recordCodec) decrypt(path string, payload []byte, output any) error {
	var envelope recordEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil ||
		envelope.Version != 1 {
		return errors.New("invalid_operator_record")
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
	if err != nil || len(nonce) != c.aead.NonceSize() {
		return errors.New("invalid_operator_record")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return errors.New("invalid_operator_record")
	}
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, []byte(path))
	if err != nil {
		return errors.New("invalid_operator_record")
	}
	if err := json.Unmarshal(plaintext, output); err != nil {
		return errors.New("invalid_operator_record")
	}
	return nil
}
