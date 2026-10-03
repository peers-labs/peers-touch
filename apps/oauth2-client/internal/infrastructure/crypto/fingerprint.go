package recordcrypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

type Fingerprinter struct {
	key []byte
}

func NewFingerprinter(key []byte) *Fingerprinter {
	return &Fingerprinter{key: append([]byte(nil), key...)}
}

func (f *Fingerprinter) Fingerprint(value string) string {
	mac := hmac.New(sha256.New, f.key)
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
