package infrastructure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"golang.org/x/crypto/hkdf"
)

const pushCredentialKeyVersion uint32 = 1

var ErrPushCredentialKeyUnavailable = errors.New("push credential key is unavailable")

type PushCredentialProtector struct {
	aead           cipher.AEAD
	fingerprintKey [sha256.Size]byte
	keyIdentity    [sha256.Size]byte
}

func NewPushCredentialProtector(rootSecret string) (*PushCredentialProtector, error) {
	if rootSecret == "" {
		return nil, ErrPushCredentialKeyUnavailable
	}
	keyMaterial := make([]byte, sha256.Size*2)
	reader := hkdf.New(
		sha256.New,
		[]byte(rootSecret),
		nil,
		[]byte("peers-touch/notification/push-credential/v1"),
	)
	if _, err := io.ReadFull(reader, keyMaterial); err != nil {
		return nil, ErrPushCredentialKeyUnavailable
	}
	block, err := aes.NewCipher(keyMaterial[:sha256.Size])
	if err != nil {
		return nil, ErrPushCredentialKeyUnavailable
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrPushCredentialKeyUnavailable
	}
	protector := &PushCredentialProtector{aead: aead}
	copy(protector.fingerprintKey[:], keyMaterial[sha256.Size:])
	identityMAC := hmac.New(sha256.New, protector.fingerprintKey[:])
	identityMAC.Write([]byte("peers-touch/notification/push-credential-key-identity/v1"))
	copy(protector.keyIdentity[:], identityMAC.Sum(nil))
	clear(keyMaterial)
	return protector, nil
}

func (p *PushCredentialProtector) KeyVersion() uint32 {
	return pushCredentialKeyVersion
}

func (p *PushCredentialProtector) KeyIdentity() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.keyIdentity[:]...)
}

func (p *PushCredentialProtector) Protect(
	actorPTID string,
	deviceID string,
	channel domain.PushChannel,
	environment domain.PushEnvironment,
	appInstallEpochSHA256 []byte,
	plaintext []byte,
) (domain.ProtectedPushBinding, error) {
	if p == nil || p.aead == nil || len(plaintext) == 0 {
		return domain.ProtectedPushBinding{}, ErrPushCredentialKeyUnavailable
	}

	mac := hmac.New(sha256.New, p.fingerprintKey[:])
	mac.Write(plaintext)
	fingerprint := mac.Sum(nil)
	aad := pushCredentialAAD(
		actorPTID,
		deviceID,
		channel,
		environment,
		appInstallEpochSHA256,
		fingerprint,
	)
	nonce := make([]byte, p.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return domain.ProtectedPushBinding{}, err
	}
	ciphertext := p.aead.Seal(nil, nonce, plaintext, aad)
	return domain.ProtectedPushBinding{
		Fingerprint: fingerprint,
		Ciphertext:  ciphertext,
		Nonce:       nonce,
		KeyVersion:  pushCredentialKeyVersion,
	}, nil
}

func (p *PushCredentialProtector) Open(
	registration domain.PushRegistration,
	protected domain.ProtectedPushBinding,
) ([]byte, error) {
	if p == nil ||
		p.aead == nil ||
		protected.KeyVersion != pushCredentialKeyVersion ||
		len(protected.Nonce) != p.aead.NonceSize() {
		return nil, ErrPushCredentialKeyUnavailable
	}
	aad := pushCredentialAAD(
		registration.ActorPTID,
		registration.DeviceID,
		registration.Channel,
		registration.Environment,
		registration.AppInstallEpochSHA256,
		protected.Fingerprint,
	)
	return p.aead.Open(nil, protected.Nonce, protected.Ciphertext, aad)
}

func pushCredentialAAD(
	actorPTID string,
	deviceID string,
	channel domain.PushChannel,
	environment domain.PushEnvironment,
	appInstallEpochSHA256 []byte,
	fingerprint []byte,
) []byte {
	fields := [][]byte{
		[]byte("peers-touch/notification/push-registration/v1"),
		[]byte(actorPTID),
		[]byte(deviceID),
		appInstallEpochSHA256,
		fingerprint,
	}
	size := 8
	for _, field := range fields {
		size += 4 + len(field)
	}
	out := make([]byte, 0, size)
	var numeric [8]byte
	binary.BigEndian.PutUint32(numeric[:4], uint32(channel))
	out = append(out, numeric[:4]...)
	binary.BigEndian.PutUint32(numeric[:4], uint32(environment))
	out = append(out, numeric[:4]...)
	for _, field := range fields {
		binary.BigEndian.PutUint32(numeric[:4], uint32(len(field)))
		out = append(out, numeric[:4]...)
		out = append(out, field...)
	}
	return out
}
