package publication

import (
	"crypto/ed25519"
	"errors"
	"strings"

	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	"google.golang.org/protobuf/proto"
)

const SnapshotSignatureDomain = "peers-touch/x-config/v1\x00"

type Signer interface {
	KeyID() string
	Sign(statementBytes []byte) ([]byte, error)
}

type Ed25519Signer struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func NewEd25519Signer(
	keyID string,
	privateKey ed25519.PrivateKey,
) (*Ed25519Signer, error) {
	keyID = strings.TrimSpace(keyID)
	if keyID == "" ||
		len(keyID) > 128 ||
		len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid_x_config_signer")
	}
	return &Ed25519Signer{
		keyID:      keyID,
		privateKey: append(ed25519.PrivateKey(nil), privateKey...),
	}, nil
}

func (s *Ed25519Signer) KeyID() string {
	return s.keyID
}

func (s *Ed25519Signer) Sign(statementBytes []byte) ([]byte, error) {
	if len(statementBytes) == 0 || len(statementBytes) > MaxCatalogBytes {
		return nil, ErrCatalogInvalid
	}
	input := make([]byte, 0, len(SnapshotSignatureDomain)+len(statementBytes))
	input = append(input, SnapshotSignatureDomain...)
	input = append(input, statementBytes...)
	return ed25519.Sign(s.privateKey, input), nil
}

func BuildSignedEnvelope(
	signer Signer,
	statementBytes []byte,
) ([]byte, error) {
	if signer == nil || strings.TrimSpace(signer.KeyID()) == "" {
		return nil, errors.New("x_config_signer_unavailable")
	}
	signature, err := signer.Sign(statementBytes)
	if err != nil {
		return nil, err
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&xconfig.SignedXConfigSnapshot{
			SigningKeyId:     signer.KeyID(),
			StatementBytes:   statementBytes,
			Ed25519Signature: signature,
		},
	)
	if err != nil || len(raw) == 0 || len(raw) > MaxCatalogBytes {
		return nil, ErrCatalogInvalid
	}
	return raw, nil
}
