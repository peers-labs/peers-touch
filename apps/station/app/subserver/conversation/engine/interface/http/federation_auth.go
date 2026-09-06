package httpinterface

import (
	"crypto/ed25519"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
)

func AuthenticatedFederationPeerFromClaims(
	claims *authfed.VerifiedClaims,
) (AuthenticatedFederationPeer, error) {
	if claims == nil ||
		claims.Scope != messaging.FederationScope ||
		claims.Issuer == "" ||
		claims.Subject != claims.Issuer ||
		claims.Audience == "" ||
		claims.Custom[messaging.FederationClaimSourceStationID] != claims.Issuer ||
		claims.Custom[messaging.FederationClaimTargetStationID] != claims.Audience ||
		claims.Custom[messaging.FederationClaimFrameID] == "" ||
		claims.Custom[messaging.FederationClaimIdempotencyKey] == "" ||
		claims.SigningKeyID() == "" {
		return AuthenticatedFederationPeer{}, ErrFederationBinding
	}
	publicKey := claims.SigningPublicKey()
	if len(publicKey) != ed25519.PublicKeySize {
		return AuthenticatedFederationPeer{}, ErrFederationBinding
	}
	return AuthenticatedFederationPeer{
		SourceStationID: claims.Issuer,
		TargetStationID: claims.Audience,
		FrameID:         claims.Custom[messaging.FederationClaimFrameID],
		IdempotencyKey:  claims.Custom[messaging.FederationClaimIdempotencyKey],
		SigningKeyID:    claims.SigningKeyID(),
		PublicKey:       publicKey,
	}, nil
}
