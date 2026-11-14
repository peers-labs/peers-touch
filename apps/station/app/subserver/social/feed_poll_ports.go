package social

import (
	"context"
	"crypto/ed25519"
	"errors"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
)

// Retain only a key already authenticated by the original Federation owner.
func (s privateContentStationSigner) verifyFeedPollStation(ctx context.Context,
	transaction delivery.Transaction, home, keyID string, canonical, signature []byte) error {
	if s.proofKeyAuthority == nil || transaction == nil || transaction.DB() == nil ||
		home == "" || keyID == "" || len(canonical) == 0 || len(signature) != ed25519.SignatureSize {
		return errors.New("Social poll Station verification input is invalid")
	}
	key, err := s.proofKeyAuthority.ResolveContentProofVerificationKeyInTransaction(ctx, transaction.DB(), home, keyID)
	if errors.Is(err, authfed.ErrContentProofKeyUnavailable) && home != s.stationPeerID {
		peer, resolveErr := authfed.NewPeerKeyStoreGORMWithDB(transaction.DB()).Get(ctx, home)
		if resolveErr != nil {
			return resolveErr
		}
		if peer == nil || peer.Kid != keyID {
			return errors.New("Social poll Station signing key is not trusted")
		}
		trusted, derivedID, parseErr := authfed.ParsePeerJWKPEM(peer.PubPEM)
		if parseErr != nil {
			return parseErr
		}
		if derivedID != keyID || !ed25519.Verify(trusted, canonical, signature) {
			return errors.New("Social poll Station signature is invalid")
		}
		if err := s.proofKeyAuthority.TrustImportedContentProofVerificationKeyInTransaction(
			ctx, transaction.DB(), home, keyID, trusted, time.Now().UTC()); err != nil {
			return err
		}
		key, err = s.proofKeyAuthority.ResolveContentProofVerificationKeyInTransaction(ctx, transaction.DB(), home, keyID)
	}
	if err != nil {
		return err
	}
	if !ed25519.Verify(key, canonical, signature) {
		return errors.New("Social poll Station signature is invalid")
	}
	return nil
}
