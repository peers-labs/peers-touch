package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const followerProjectionTTL = 5 * time.Minute

func authorityMembersFromManifests(
	actorPTIDs []string,
	ownerPTID string,
	manifests []*chat.FederatedEndpointManifest,
) ([]messaging.AuthorityMember, error) {
	if len(actorPTIDs) == 0 || len(actorPTIDs) != len(manifests) || ownerPTID == "" {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	manifestByActor := make(map[string]*chat.FederatedEndpointManifest, len(manifests))
	for _, manifest := range manifests {
		if manifest == nil ||
			manifest.ActorPtid == "" ||
			manifest.HomeStationId == "" ||
			manifestByActor[manifest.ActorPtid] != nil {
			return nil, messaging.ErrEndpointManifestConflict
		}
		manifestByActor[manifest.ActorPtid] = manifest
	}
	members := make([]messaging.AuthorityMember, 0, len(actorPTIDs))
	for _, actorPTID := range actorPTIDs {
		manifest := manifestByActor[actorPTID]
		if manifest == nil {
			return nil, messaging.ErrEndpointManifestInvalid
		}
		role := "member"
		if actorPTID == ownerPTID {
			role = "owner"
		}
		members = append(members, messaging.AuthorityMember{
			PTID:          actorPTID,
			HomeStationID: manifest.HomeStationId,
			Role:          role,
			Active:        true,
		})
	}
	sort.Slice(members, func(i, j int) bool {
		return members[i].PTID < members[j].PTID
	})
	return members, nil
}

func authorityMemberHomeStation(
	members []messaging.AuthorityMember,
	ptid string,
) string {
	for _, member := range members {
		if member.PTID == ptid {
			return member.HomeStationID
		}
	}
	return ""
}

func actorHomeStationFromManifests(
	manifests []*chat.FederatedEndpointManifest,
	ptid string,
) (string, error) {
	var homeStationID string
	for _, manifest := range manifests {
		if manifest == nil || manifest.ActorPtid != ptid {
			continue
		}
		if manifest.HomeStationId == "" || homeStationID != "" {
			return "", messaging.ErrEndpointManifestConflict
		}
		homeStationID = manifest.HomeStationId
	}
	if homeStationID == "" {
		return "", messaging.ErrEndpointManifestInvalid
	}
	return homeStationID, nil
}

func conversationAuthorityMembers(
	members []messaging.AuthorityMember,
) ([]*chat.ConversationAuthorityMember, error) {
	sorted := append([]messaging.AuthorityMember(nil), members...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].PTID < sorted[j].PTID
	})
	result := make([]*chat.ConversationAuthorityMember, 0, len(sorted))
	previousPTID := ""
	for _, member := range sorted {
		if !member.Active ||
			member.PTID == "" ||
			member.HomeStationID == "" ||
			member.Role == "" ||
			member.PTID == previousPTID {
			return nil, messaging.ErrConversationState
		}
		result = append(result, &chat.ConversationAuthorityMember{
			Ptid:          member.PTID,
			Role:          member.Role,
			HomeStationId: member.HomeStationID,
		})
		previousPTID = member.PTID
	}
	if len(result) == 0 {
		return nil, messaging.ErrConversationState
	}
	return result, nil
}

func buildCommittedMembershipChanges(
	changes []*chat.MessagingMembershipChangeIntent,
	preMembers []messaging.AuthorityMember,
	postMembers []messaging.AuthorityMember,
) ([]*chat.MessagingMembershipChangeCommitted, error) {
	preByActor := activeAuthorityMembersByPTID(preMembers)
	postByActor := activeAuthorityMembersByPTID(postMembers)
	committed := make([]*chat.MessagingMembershipChangeCommitted, 0, len(changes))
	for _, change := range changes {
		if change == nil {
			return nil, messaging.ErrDeliverySet
		}
		member, ok := postByActor[change.Ptid]
		if !ok {
			member, ok = preByActor[change.Ptid]
		}
		if !ok || member.HomeStationID == "" || member.Role == "" {
			return nil, messaging.ErrConversationState
		}
		committed = append(committed, &chat.MessagingMembershipChangeCommitted{
			Action:        change.Action,
			Ptid:          change.Ptid,
			DeviceId:      change.DeviceId,
			HomeStationId: member.HomeStationID,
			Role:          member.Role,
		})
	}
	return committed, nil
}

func enqueueFollowerProjections(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	event *chat.ConversationEvent,
	preMembers []messaging.AuthorityMember,
	postMembers []messaging.AuthorityMember,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	now time.Time,
) error {
	if event == nil ||
		event.EventId == "" ||
		event.ConversationId == "" ||
		event.AuthorityStationId != localStationID ||
		repositories.ProjectionGrants == nil ||
		repositories.Federation == nil ||
		frameSigner == nil {
		return messaging.ErrFederationFrameInvalid
	}
	grants, err := followerProjectionGrants(event, preMembers, postMembers, localStationID)
	if err != nil {
		return err
	}
	if err := repositories.ProjectionGrants.AppendEventProjectionGrants(ctx, grants); err != nil {
		return err
	}
	for _, grant := range grants {
		projectionBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			&chat.MessagingFollowerProjection{
				FormatVersion:       MessagingFollowerProjectionFormatVersion,
				AuthorityStationId:  localStationID,
				TargetHomeStationId: grant.TargetHomeStationID,
				ConversationEvent:   event,
			},
		)
		if err != nil {
			return err
		}
		payloadHash := sha256.Sum256(projectionBytes)
		idempotencyKey := followerProjectionIdempotencyKey(
			localStationID,
			grant.TargetHomeStationID,
			event.ConversationId,
			event.EventId,
		)
		frame := &chat.MessagingFederationFrame{
			FrameId: uuid.NewSHA1(
				uuid.NameSpaceOID,
				[]byte(localStationID+"\x00"+idempotencyKey),
			).String(),
			SourceStationId:   localStationID,
			TargetStationId:   grant.TargetHomeStationID,
			IdempotencyKey:    idempotencyKey,
			PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION,
			ConversationId:    event.ConversationId,
			EventId:           event.EventId,
			AuthoritySequence: event.Sequence,
			OpaquePayload:     projectionBytes,
			PayloadSha256:     payloadHash[:],
			IssuedAt:          timestamppb.New(now),
			ExpiresAt:         timestamppb.New(now.Add(followerProjectionTTL)),
		}
		if err := frameSigner.SignFederationFrame(ctx, frame); err != nil {
			return err
		}
		if err := repositories.Federation.EnqueueFederationFrame(ctx, frame, now); err != nil {
			return err
		}
	}
	return nil
}

func followerProjectionGrants(
	event *chat.ConversationEvent,
	preMembers []messaging.AuthorityMember,
	postMembers []messaging.AuthorityMember,
	localStationID string,
) ([]messaging.EventProjectionGrant, error) {
	type membershipPresence struct {
		pre  bool
		post bool
	}
	targets := make(map[string]membershipPresence)
	addMembers := func(members []messaging.AuthorityMember, pre bool) error {
		for _, member := range members {
			if !member.Active || member.PTID == "" || member.HomeStationID == "" {
				return messaging.ErrConversationState
			}
			if member.HomeStationID == localStationID {
				continue
			}
			presence := targets[member.HomeStationID]
			if pre {
				presence.pre = true
			} else {
				presence.post = true
			}
			targets[member.HomeStationID] = presence
		}
		return nil
	}
	isCreation := event.GetConversationCreated() != nil
	isTransition := event.GetMembershipTransitionCommitted() != nil
	switch {
	case isCreation:
		if err := addMembers(postMembers, false); err != nil {
			return nil, err
		}
	case isTransition:
		if err := addMembers(preMembers, true); err != nil {
			return nil, err
		}
		if err := addMembers(postMembers, false); err != nil {
			return nil, err
		}
	default:
		if err := addMembers(postMembers, false); err != nil {
			return nil, err
		}
	}
	stationIDs := make([]string, 0, len(targets))
	for stationID := range targets {
		stationIDs = append(stationIDs, stationID)
	}
	sort.Strings(stationIDs)
	grants := make([]messaging.EventProjectionGrant, 0, len(stationIDs))
	for _, stationID := range stationIDs {
		presence := targets[stationID]
		reason := projectionEntitlementActiveMember
		switch {
		case isCreation:
			reason = projectionEntitlementInitialMember
		case isTransition && presence.pre && presence.post:
			reason = projectionEntitlementPreAndPost
		case isTransition && presence.pre:
			reason = projectionEntitlementPreState
		case isTransition && presence.post:
			reason = projectionEntitlementPostState
		}
		grants = append(grants, messaging.EventProjectionGrant{
			ConversationID:      event.ConversationId,
			EventID:             event.EventId,
			TargetHomeStationID: stationID,
			EntitlementReason:   reason,
		})
	}
	return grants, nil
}

func activeAuthorityMembersByPTID(
	members []messaging.AuthorityMember,
) map[string]messaging.AuthorityMember {
	result := make(map[string]messaging.AuthorityMember, len(members))
	for _, member := range members {
		if member.Active {
			result[member.PTID] = member
		}
	}
	return result
}

func followerProjectionIdempotencyKey(
	sourceStationID string,
	targetStationID string,
	conversationID string,
	eventID string,
) string {
	var input bytes.Buffer
	input.WriteString(followerProjectionIdentityDomain)
	input.WriteByte(0)
	writeUint32(&input, MessagingFollowerProjectionFormatVersion)
	writeString(&input, sourceStationID)
	writeString(&input, targetStationID)
	writeString(&input, conversationID)
	writeString(&input, eventID)
	digest := sha256.Sum256(input.Bytes())
	return "follower-projection:" + hex.EncodeToString(digest[:])
}
