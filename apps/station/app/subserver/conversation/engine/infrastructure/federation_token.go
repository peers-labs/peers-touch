package infrastructure

import (
	"context"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
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
		scope.MustRegister(scope.Scope{
			Name:        messaging.FollowerReplayScope,
			Description: "read grant-scoped signed follower events from their Authority Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimConversationID,
					messaging.FederationClaimRequestSHA256,
					messaging.FederationClaimSourceStationID,
					messaging.FederationClaimTargetStationID,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        messaging.MlsKeyPackageClaimScope,
			Description: "irreversibly claim one MLS KeyPackage from its Home Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimAuthorityPlanID,
					messaging.FederationClaimTargetPTID,
					messaging.FederationClaimTargetDeviceID,
					messaging.FederationClaimPlanExpiresAt,
					messaging.FederationClaimSourceStationID,
					messaging.FederationClaimTargetStationID,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        messaging.AttachmentTransferScope,
			Description: "proxy an authenticated attachment transfer to its Authority Station",
			Policy: scope.Policy{
				TTLMax:           time.Minute,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					messaging.FederationClaimConversationID,
					messaging.FederationClaimActorPTID,
					messaging.FederationClaimDeviceID,
					messaging.FederationClaimAttachmentAction,
					messaging.FederationClaimAttachmentResourceID,
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

func (m *PeerJWTFederationTokenMinter) MintFollowerReplayRead(
	ctx context.Context,
	targetStationID string,
	request *chat.GetMessagingFollowerEventsRequest,
) (string, error) {
	if targetStationID == "" ||
		targetStationID == m.sourceStationID ||
		request == nil ||
		request.AuthorityStationId != targetStationID ||
		request.TargetHomeStationId != m.sourceStationID ||
		request.ConversationId == "" {
		return "", fmt.Errorf("messaging: follower replay token binding is invalid")
	}
	requestHash, err := application.FollowerReplayRequestSHA256(request)
	if err != nil {
		return "", err
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.FollowerReplayScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimConversationID:  request.ConversationId,
			messaging.FederationClaimRequestSHA256:   hex.EncodeToString(requestHash),
			messaging.FederationClaimSourceStationID: m.sourceStationID,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	})
}

func (m *PeerJWTFederationTokenMinter) MintMlsKeyPackageClaim(
	ctx context.Context,
	targetStationID string,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
) (string, error) {
	if targetStationID == "" ||
		targetStationID == m.sourceStationID ||
		request == nil ||
		request.AuthorityPlanId == "" ||
		request.AuthorityStationId != m.sourceStationID ||
		request.Target == nil ||
		request.Target.Ptid == "" ||
		request.Target.DeviceId == "" ||
		request.PlanExpiresAt == nil {
		return "", fmt.Errorf("messaging: MLS KeyPackage claim token binding is invalid")
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.MlsKeyPackageClaimScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimAuthorityPlanID: request.AuthorityPlanId,
			messaging.FederationClaimTargetPTID:      request.Target.Ptid,
			messaging.FederationClaimTargetDeviceID:  request.Target.DeviceId,
			messaging.FederationClaimPlanExpiresAt: request.PlanExpiresAt.
				AsTime().
				UTC().
				Format(time.RFC3339Nano),
			messaging.FederationClaimSourceStationID: m.sourceStationID,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	})
}

func (m *PeerJWTFederationTokenMinter) MintAttachmentTransfer(
	ctx context.Context,
	targetStationID string,
	conversationID string,
	endpoint *chat.CryptoEndpoint,
	action string,
	resourceID string,
) (string, error) {
	if targetStationID == "" ||
		targetStationID == m.sourceStationID ||
		conversationID == "" ||
		endpoint == nil ||
		endpoint.Ptid == "" ||
		endpoint.DeviceId == "" ||
		action == "" ||
		resourceID == "" {
		return "", fmt.Errorf("messaging: attachment transfer token binding is invalid")
	}
	RegisterMessagingFederationScope()
	return authfed.Mint(ctx, m.keyCache, authfed.MintRequest{
		Scope:    messaging.AttachmentTransferScope,
		Issuer:   m.sourceStationID,
		Audience: targetStationID,
		Subject:  m.sourceStationID,
		TTL:      time.Minute,
		Custom: map[string]string{
			messaging.FederationClaimConversationID:       conversationID,
			messaging.FederationClaimActorPTID:            endpoint.Ptid,
			messaging.FederationClaimDeviceID:             endpoint.DeviceId,
			messaging.FederationClaimAttachmentAction:     action,
			messaging.FederationClaimAttachmentResourceID: resourceID,
			messaging.FederationClaimSourceStationID:      m.sourceStationID,
			messaging.FederationClaimTargetStationID:      targetStationID,
		},
	})
}

var _ FederationTokenMinter = (*PeerJWTFederationTokenMinter)(nil)
