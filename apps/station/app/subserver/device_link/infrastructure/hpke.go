package infrastructure

import (
	"crypto/rand"

	"github.com/cloudflare/circl/hpke"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"golang.org/x/crypto/chacha20poly1305"
)

const hpkeInfo = "peers-touch/device-link/hpke/v1\x00"

func SealCredential(public, transcript, plaintext []byte) (*pb.DeviceLinkHpkeEnvelope, error) {
	if len(public) != 32 || len(transcript) == 0 || len(transcript) > 4096 ||
		len(plaintext) == 0 || len(plaintext) > domain.MaxProtocolBytes-4096 {
		return nil, domain.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	suite := hpke.NewSuite(hpke.KEM_X25519_HKDF_SHA256, hpke.KDF_HKDF_SHA256, hpke.AEAD_ChaCha20Poly1305)
	key, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().UnmarshalBinaryPublicKey(public)
	if err != nil {
		return nil, err
	}
	sender, err := suite.NewSender(key, []byte(hpkeInfo))
	if err != nil {
		return nil, err
	}
	enc, sealer, err := sender.Setup(rand.Reader)
	if err != nil {
		return nil, err
	}
	ciphertext, err := sealer.Seal(plaintext, transcript)
	return &pb.DeviceLinkHpkeEnvelope{
		ProtocolVersion: 1, EncapsulatedKey: enc, Ciphertext: ciphertext, TranscriptBytes: transcript,
	}, err
}

func SealOffer(key, signedOffer []byte) ([]byte, error) {
	if len(signedOffer) == 0 || len(signedOffer) > 16*1024-34 {
		return nil, domain.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED)
	}
	aead, err := chacha20poly1305.New(key)
	if err != nil {
		return nil, err
	}
	nonce, err := domain.Random(aead.NonceSize())
	if err != nil {
		return nil, err
	}
	aad := append([]byte("peers-touch/device-link/sealed-offer/v1\x00"), domain.Digest(signedOffer)...)
	return aead.Seal(append([]byte("PTSO1\x00"), nonce...), nonce, signedOffer, aad), nil
}
