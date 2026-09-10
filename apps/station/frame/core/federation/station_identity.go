package federation

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
)

type stationSigner struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func newStationSigner(
	ctx context.Context,
	keys *authfed.KeyCache,
) (*stationSigner, error) {
	if keys == nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Station signer",
			errors.New("key cache is required"),
		)
	}

	key, err := keys.Get(ctx)
	if err != nil {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"load local Station signing key",
			err,
		)
	}
	if key == nil ||
		key.Kid == "" ||
		len(key.Priv) != ed25519.PrivateKeySize ||
		len(key.Pub) != ed25519.PublicKeySize {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"load local Station signing key",
			errors.New("local Station signing key is incomplete"),
		)
	}

	return &stationSigner{
		keyID:      key.Kid,
		privateKey: append(ed25519.PrivateKey(nil), key.Priv...),
	}, nil
}

func (s *stationSigner) KeyID() string {
	if s == nil {
		return ""
	}

	return s.keyID
}

func (s *stationSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	if s == nil || len(s.privateKey) != ed25519.PrivateKeySize {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"sign Federation frame",
			errors.New("local Station signing key is unavailable"),
		)
	}

	return ed25519.Sign(s.privateKey, canonical), nil
}

type stationVerifier struct {
	localStationPeerID string
	localSigningKeyID  string
	localPublicKey     ed25519.PublicKey
	peerKeys           authfed.PeerKeyStore
}

func newStationVerifier(
	ctx context.Context,
	localStationPeerID string,
	keys *authfed.KeyCache,
	peerKeys authfed.PeerKeyStore,
) (*stationVerifier, error) {
	if localStationPeerID == "" || keys == nil || peerKeys == nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Station verifier",
			errors.New("local Station, key cache, and peer key store are required"),
		)
	}

	key, err := keys.Get(ctx)
	if err != nil {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"load local Station verification key",
			err,
		)
	}
	if key == nil ||
		key.Kid == "" ||
		len(key.Pub) != ed25519.PublicKeySize {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"load local Station verification key",
			errors.New("local Station verification key is incomplete"),
		)
	}

	return &stationVerifier{
		localStationPeerID: localStationPeerID,
		localSigningKeyID:  key.Kid,
		localPublicKey:     append(ed25519.PublicKey(nil), key.Pub...),
		peerKeys:           peerKeys,
	}, nil
}

func (v *stationVerifier) Verify(
	ctx context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	publicKey, err := v.publicKey(ctx, sourceStationPeerID, signingKeyID)
	if err != nil {
		return err
	}
	if len(signature) != ed25519.SignatureSize ||
		!ed25519.Verify(publicKey, canonical, signature) {
		return fmt.Errorf(
			"verify Federation frame from Station %q: signature is invalid",
			sourceStationPeerID,
		)
	}

	return nil
}

func (v *stationVerifier) publicKey(
	ctx context.Context,
	sourceStationPeerID string,
	signingKeyID string,
) (ed25519.PublicKey, error) {
	if sourceStationPeerID == v.localStationPeerID {
		if signingKeyID != v.localSigningKeyID {
			return nil, fmt.Errorf(
				"verify local Federation frame: signing key %q is not active",
				signingKeyID,
			)
		}

		return append(ed25519.PublicKey(nil), v.localPublicKey...), nil
	}

	peer, err := v.peerKeys.Get(ctx, sourceStationPeerID)
	if err != nil {
		return nil, fmt.Errorf(
			"load Federation peer key for Station %q: %w",
			sourceStationPeerID,
			err,
		)
	}
	if peer == nil || peer.Kid != signingKeyID {
		return nil, fmt.Errorf(
			"verify Federation frame from Station %q: signing key is not trusted",
			sourceStationPeerID,
		)
	}
	publicKey, derivedKeyID, err := authfed.ParsePeerJWKPEM(peer.PubPEM)
	if err != nil {
		return nil, fmt.Errorf(
			"parse Federation peer key for Station %q: %w",
			sourceStationPeerID,
			err,
		)
	}
	if derivedKeyID != peer.Kid {
		return nil, fmt.Errorf(
			"verify Federation peer key for Station %q: key fingerprint mismatch",
			sourceStationPeerID,
		)
	}

	return publicKey, nil
}

var (
	_ delivery.Signer   = (*stationSigner)(nil)
	_ delivery.Verifier = (*stationVerifier)(nil)
)
