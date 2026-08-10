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
		scope.MustRegister(scope.Scope{
			Name:        messaging.EndpointManifestScope,
			Description: "read a signed messaging endpoint manifest from its Home Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimActorPTID,
					messaging.FederationClaimSourceStationID,
					messaging.FederationClaimTargetStationID,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        messaging.AuthorityPrepareScope,
			Description: "prepare a messaging command at its Authority Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimConversationID,
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

func (m *PeerJWTFederationTokenMinter) MintEndpointManifestRead(
	ctx context.Context,
	targetStationID string,
	actorPTID string,
) (string, error) {
	if targetStationID == "" || actorPTID == "" || targetStationID == m.sourceStationID {
		return "", fmt.Errorf("messaging: endpoint manifest token binding is invalid")
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.EndpointManifestScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimActorPTID:       actorPTID,
			messaging.FederationClaimSourceStationID: m.sourceStationID,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	})
}

func (m *PeerJWTFederationTokenMinter) MintAuthorityPrepare(
	ctx context.Context,
	targetStationID string,
	conversationID string,
) (string, error) {
	if targetStationID == "" ||
		conversationID == "" ||
		targetStationID == m.sourceStationID {
		return "", fmt.Errorf("messaging: authority prepare token binding is invalid")
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.AuthorityPrepareScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimConversationID:  conversationID,
			messaging.FederationClaimSourceStationID: m.sourceStationID,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	})
}

var _ FederationTokenMinter = (*PeerJWTFederationTokenMinter)(nil)
