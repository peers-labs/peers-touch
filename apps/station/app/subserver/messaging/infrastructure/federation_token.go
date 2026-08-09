package infrastructure

import (
	"context"
	"fmt"
	"sync"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var messagingFederationScopeOnce sync.Once

func RegisterMessagingFederationScope() {
	messagingFederationScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        messaging.FederationScope,
			Description: "deliver a signed durable messaging frame to its target Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimFrameID,
					messaging.FederationClaimIdempotencyKey,
					messaging.FederationClaimSourceStationID,
					messaging.FederationClaimTargetStationID,
				},
			},
		})
	})
}

type PeerJWTFederationTokenMinter struct {
	keyCache        *authfed.KeyCache
	sourceStationID string
}

func NewPeerJWTFederationTokenMinter(
	keyCache *authfed.KeyCache,
	sourceStationID string,
) (*PeerJWTFederationTokenMinter, error) {
	if keyCache == nil || sourceStationID == "" {
		return nil, fmt.Errorf("messaging: federation token minter is not configured")
	}
	return &PeerJWTFederationTokenMinter{
		keyCache:        keyCache,
		sourceStationID: sourceStationID,
	}, nil
}

func (m *PeerJWTFederationTokenMinter) Mint(
	ctx context.Context,
	targetStationID string,
	frame *chat.MessagingFederationFrame,
) (string, error) {
	if frame == nil ||
		frame.SourceStationId != m.sourceStationID ||
		frame.TargetStationId != targetStationID {
		return "", fmt.Errorf("messaging: federation token frame binding mismatch")
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.FederationScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimFrameID:         frame.FrameId,
			messaging.FederationClaimIdempotencyKey:  frame.IdempotencyKey,
			messaging.FederationClaimSourceStationID: frame.SourceStationId,
			messaging.FederationClaimTargetStationID: frame.TargetStationId,
		},
	})
}

var _ FederationTokenMinter = (*PeerJWTFederationTokenMinter)(nil)
