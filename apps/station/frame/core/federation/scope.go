package federation

import (
	"errors"
	"fmt"
	"reflect"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

const (
	// DeliveryScope authenticates the canonical domain-neutral peer delivery route.
	DeliveryScope = "federation-domain-delivery"
	// ConversationFollowerEventsScope authenticates MP-D29 follower event replay.
	ConversationFollowerEventsScope = "conversation-follower-events"
	// ActorEndpointManifestScope authenticates Actor endpoint-manifest reads.
	ActorEndpointManifestScope = "actor-endpoint-manifest-read"
	// ConversationCommandPrepareScope authenticates authority command preparation.
	ConversationCommandPrepareScope = "conversation-command-prepare"
	// ConversationLeaveIntentScope authenticates MLS leave-intent operations.
	ConversationLeaveIntentScope = "conversation-mls-leave-intent"
	// ConversationEventSyncScope authenticates authority event catch-up.
	ConversationEventSyncScope = "conversation-authority-event-sync"
	// ConversationAttachmentScope authenticates the peer attachment data plane.
	ConversationAttachmentScope = "conversation-attachment-transfer"
	// KeyExchangeDirectFetchScope authenticates destructive Direct bundle reads.
	KeyExchangeDirectFetchScope = "key-exchange-direct-bundle-fetch"
	// KeyExchangeMLSFetchScope authenticates destructive MLS KeyPackage reads.
	KeyExchangeMLSFetchScope = "key-exchange-mls-key-package-fetch"
	// KeyExchangeMLSClaimScope authenticates irreversible MLS KeyPackage claims.
	KeyExchangeMLSClaimScope = "key-exchange-mls-key-package-claim"
	// RealtimeCallResolutionScope authenticates caller readback at the callee Home Station.
	RealtimeCallResolutionScope = "realtime-call-resolution-read"

	ClaimFrameID               = "frame_id"
	ClaimIdempotencyKey        = "idempotency_key"
	ClaimSourceStationPeerID   = "source_station_peer_id"
	ClaimTargetStationPeerID   = "target_station_peer_id"
	ClaimConversationID        = "conversation_id"
	ClaimFollowerRequestSHA256 = "request_sha256"
	ClaimFederationID          = "federation_id"
	ClaimActorPTID             = "actor_ptid"
	ClaimDeviceID              = "device_id"
	ClaimIntentID              = "intent_id"
	ClaimAuthorityEpoch        = "authority_epoch"
	ClaimAttachmentAction      = "attachment_action"
	ClaimAttachmentResourceID  = "attachment_resource_id"
	ClaimTargetDeviceID        = "target_device_id"
	ClaimRequestID             = "request_id"
	ClaimRequesterPTID         = "requester_ptid"
	ClaimRequesterDeviceID     = "requester_device_id"
	ClaimAuthorityPlanID       = "authority_plan_id"
	ClaimPlanExpiresAt         = "plan_expires_at"
	ClaimCallID                = "call_id"
)

var peerScopes = []scope.Scope{
	{
		Name:        DeliveryScope,
		Description: "deliver a signed durable Federation frame to its target Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimFrameID,
				ClaimIdempotencyKey,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        ConversationFollowerEventsScope,
		Description: "read authority-signed Conversation follower events",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimConversationID,
				ClaimFollowerRequestSHA256,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        ActorEndpointManifestScope,
		Description: "read an Actor endpoint manifest from its Home Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimActorPTID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        ConversationCommandPrepareScope,
		Description: "prepare a Conversation command at its authority Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimConversationID,
				ClaimActorPTID,
				ClaimDeviceID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        ConversationLeaveIntentScope,
		Description: "forward signed MLS leave intents to the group authority",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimFederationID,
				ClaimConversationID,
				ClaimIntentID,
				ClaimDeviceID,
				ClaimAuthorityEpoch,
			},
		},
	},
	{
		Name:        ConversationEventSyncScope,
		Description: "follower pull of authority conversation events",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimFederationID,
				ClaimConversationID,
				ClaimAuthorityEpoch,
			},
		},
	},
	{
		Name:        ConversationAttachmentScope,
		Description: "proxy an authenticated attachment transfer to its authority Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimConversationID,
				ClaimActorPTID,
				ClaimDeviceID,
				ClaimAttachmentAction,
				ClaimAttachmentResourceID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        KeyExchangeDirectFetchScope,
		Description: "fetch a claim-bound Direct key bundle from its Home Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimActorPTID,
				ClaimDeviceID,
				ClaimRequestID,
				ClaimRequesterPTID,
				ClaimRequesterDeviceID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        KeyExchangeMLSFetchScope,
		Description: "fetch a claim-bound MLS KeyPackage from its Home Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimActorPTID,
				ClaimRequestID,
				ClaimRequesterPTID,
				ClaimRequesterDeviceID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        KeyExchangeMLSClaimScope,
		Description: "irreversibly claim one MLS KeyPackage from its Home Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimAuthorityPlanID,
				ClaimActorPTID,
				ClaimDeviceID,
				ClaimRequestID,
				ClaimPlanExpiresAt,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
	{
		Name:        RealtimeCallResolutionScope,
		Description: "read one call resolution from the callee Home Station",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				ClaimActorPTID,
				ClaimCallID,
				ClaimSourceStationPeerID,
				ClaimTargetStationPeerID,
			},
		},
	},
}

// RegisterPeerScopes installs the canonical peer-route authentication policies.
func RegisterPeerScopes() error {
	for _, expected := range peerScopes {
		actual, err := scope.Get(expected.Name)
		if err == nil {
			if !reflect.DeepEqual(actual, expected) {
				return fmt.Errorf(
					"federation scope %q is registered with a conflicting policy",
					expected.Name,
				)
			}
			continue
		}
		if !errors.Is(err, scope.ErrUnknownScope) {
			return fmt.Errorf("inspect federation scope %q: %w", expected.Name, err)
		}
		if err := scope.Register(expected); err != nil {
			return fmt.Errorf("register federation scope %q: %w", expected.Name, err)
		}
	}

	return nil
}
