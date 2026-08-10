package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const authorityPlanHashDomain = "peers-touch/messaging-authority-plan"

type AuthorityPlanPolicy struct {
	ReservationTTL time.Duration
}

type AuthorityPlanService struct {
	unitOfWork       messaging.AuthorityUnitOfWork
	localStation     string
	manifestResolver messaging.EndpointManifestResolver
	policy           AuthorityPlanPolicy
	clock            func() time.Time
}

func NewAuthorityPlanService(
	unitOfWork messaging.AuthorityUnitOfWork,
	localStation string,
	manifestResolver messaging.EndpointManifestResolver,
	policy AuthorityPlanPolicy,
	clock func() time.Time,
) (*AuthorityPlanService, error) {
	if unitOfWork == nil ||
		strings.TrimSpace(localStation) == "" ||
		manifestResolver == nil ||
		policy.ReservationTTL <= 0 ||
		clock == nil {
		return nil, fmt.Errorf("messaging: authority plan dependencies are invalid")
	}
	return &AuthorityPlanService{
		unitOfWork:       unitOfWork,
		localStation:     localStation,
		manifestResolver: manifestResolver,
		policy:           policy,
		clock:            clock,
	}, nil
}

func (s *AuthorityPlanService) PrepareGroupGenesis(
	ctx context.Context,
	request *chat.PrepareMessagingGroupGenesisRequest,
) (*chat.PrepareMessagingGroupGenesisResponse, error) {
	if request == nil ||
		strings.TrimSpace(request.ConversationId) == "" ||
		strings.TrimSpace(request.Name) == "" ||
		request.Creator == nil ||
		strings.TrimSpace(request.Creator.Ptid) == "" ||
		strings.TrimSpace(request.Creator.DeviceId) == "" {
		return nil, fmt.Errorf("messaging: group genesis plan identity is incomplete")
	}
	actorSet := map[string]struct{}{request.Creator.Ptid: {}}
	for _, memberPTID := range request.MemberPtids {
		memberPTID = strings.TrimSpace(memberPTID)
		if memberPTID == "" {
			return nil, fmt.Errorf("messaging: group genesis member is invalid")
		}
		actorSet[memberPTID] = struct{}{}
	}
	if len(actorSet) < 2 {
		return nil, fmt.Errorf("messaging: group genesis requires at least two actors")
	}
	actors := make([]string, 0, len(actorSet))
	for actor := range actorSet {
		actors = append(actors, actor)
	}
	sort.Strings(actors)
	if err := resolveEndpointManifests(ctx, s.manifestResolver, actors); err != nil {
		return nil, err
	}

	var response *chat.PrepareMessagingGroupGenesisResponse
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		if _, err := repositories.Authority.LockConversation(
			ctx,
			request.ConversationId,
		); err == nil {
			return messaging.ErrCommandConflict
		} else if !errors.Is(err, messaging.ErrNotFound) {
			return err
		}
		active, err := repositories.Devices.IsActive(ctx, request.Creator)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}

		endpoints := make([]*chat.CryptoEndpoint, 0)
		for _, actor := range actors {
			actorEndpoints, err := repositories.Devices.ListActiveEndpoints(ctx, actor)
			if err != nil {
				return err
			}
			if len(actorEndpoints) == 0 {
				return fmt.Errorf("messaging: actor %s has no active device", actor)
			}
			endpoints = append(endpoints, actorEndpoints...)
		}
		sort.Slice(endpoints, func(i, j int) bool {
			return endpointKey(endpoints[i]) < endpointKey(endpoints[j])
		})
		creatorPresent := false
		for _, endpoint := range endpoints {
			if endpointKey(endpoint) == endpointKey(request.Creator) {
				creatorPresent = true
				break
			}
		}
		if !creatorPresent {
			return messaging.ErrSenderUnauthorized
		}

		now := s.clock().UTC().Truncate(time.Microsecond)
		expiresAt := now.Add(s.policy.ReservationTTL)
		planID := uuid.NewString()
		reserved := make([]*chat.ReservedMessagingMlsKeyPackage, 0, len(endpoints)-1)
		for _, endpoint := range endpoints {
			if endpointKey(endpoint) == endpointKey(request.Creator) {
				continue
			}
			keyPackage, err := repositories.KeyPackages.Reserve(
				ctx,
				planID,
				endpoint,
				now,
				expiresAt,
			)
			if err != nil {
				return err
			}
			reserved = append(reserved, keyPackage)
		}
		response = &chat.PrepareMessagingGroupGenesisResponse{
			AuthorityPlanId:      planID,
			ExpiresAt:            timestamppb.New(expiresAt),
			AuthorityStationId:   s.localStation,
			ProspectiveEndpoints: endpoints,
			ReservedKeyPackages:  reserved,
		}
		response.EndpointManifests, err = repositories.EndpointManifests.ListVerifiedManifests(
			ctx,
			actors,
			now,
		)
		if err != nil {
			return err
		}
		planHash, err := hashAuthorityPlan(request, response)
		if err != nil {
			return err
		}
		response.AuthorityPlanSha256 = planHash
		intentBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
		if err != nil {
			return err
		}
		snapshotBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
		if err != nil {
			return err
		}
		return repositories.Plans.Create(ctx, &messaging.AuthorityPlan{
			PlanID:              planID,
			PlanKind:            messaging.AuthorityPlanKindGroupGenesis,
			ConversationID:      request.ConversationId,
			RequesterPTID:       request.Creator.Ptid,
			RequesterDeviceID:   request.Creator.DeviceId,
			IntentBytes:         intentBytes,
			SnapshotBytes:       snapshotBytes,
			AuthorityPlanSHA256: planHash,
			State:               messaging.AuthorityPlanStatePrepared,
			ExpiresAt:           expiresAt,
		})
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *AuthorityPlanService) PrepareMembershipTransition(
	ctx context.Context,
	request *chat.PrepareMessagingMembershipTransitionRequest,
) (*chat.PrepareMessagingMembershipTransitionResponse, error) {
	if request == nil ||
		strings.TrimSpace(request.ConversationId) == "" ||
		request.Sender == nil ||
		strings.TrimSpace(request.Sender.Ptid) == "" ||
		strings.TrimSpace(request.Sender.DeviceId) == "" ||
		strings.TrimSpace(request.TargetPtid) == "" {
		return nil, fmt.Errorf("messaging: membership transition plan identity is incomplete")
	}
	switch request.Action {
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		if strings.TrimSpace(request.TargetDeviceId) != "" {
			return nil, fmt.Errorf("messaging: actor transition must not select one device")
		}
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		if strings.TrimSpace(request.TargetDeviceId) == "" {
			return nil, fmt.Errorf("messaging: device transition requires target device")
		}
	default:
		return nil, messaging.ErrUnsupportedCommand
	}
	actors, err := s.activeTransitionActors(ctx, request)
	if err != nil {
		return nil, err
	}
	if err := resolveEndpointManifests(ctx, s.manifestResolver, actors); err != nil {
		return nil, err
	}

	var response *chat.PrepareMessagingMembershipTransitionResponse
	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		conversation, err := repositories.Authority.LockConversation(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		if conversation.Kind != messaging.AuthorityConversationKindGroup ||
			!conversation.Active ||
			conversation.CurrentSequence <= 0 ||
			conversation.MembershipEpoch <= 0 ||
			conversation.MlsEpoch <= 0 {
			return messaging.ErrConversationState
		}
		active, err := repositories.Devices.IsActive(ctx, request.Sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		senderMember, err := repositories.Authority.GetMember(
			ctx,
			request.ConversationId,
			request.Sender.Ptid,
		)
		if err != nil || !senderMember.Active || senderMember.Role != "owner" {
			return messaging.ErrSenderUnauthorized
		}
		if request.TargetPtid == conversation.OwnerPTID &&
			(request.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR ||
				request.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE) {
			return messaging.ErrConversationState
		}
		head, err := repositories.Authority.GetLastEvent(ctx, request.ConversationId)
		if err != nil {
			return err
		}
		if head.Sequence != conversation.CurrentSequence || len(head.EventHash) != sha256.Size {
			return fmt.Errorf("messaging: invalid membership transition authority head")
		}
		memberDevices, err := repositories.Authority.ListActiveMemberDevices(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		preEndpoints := make([]*chat.CryptoEndpoint, 0, len(memberDevices))
		for _, device := range memberDevices {
			preEndpoints = append(preEndpoints, device.Endpoint)
		}
		sort.Slice(preEndpoints, func(i, j int) bool {
			return endpointKey(preEndpoints[i]) < endpointKey(preEndpoints[j])
		})
		postEndpoints := append([]*chat.CryptoEndpoint(nil), preEndpoints...)
		var addedEndpoints []*chat.CryptoEndpoint
		var removedEndpoints []*chat.CryptoEndpoint
		targetMember, memberErr := repositories.Authority.GetMember(
			ctx,
			request.ConversationId,
			request.TargetPtid,
		)

		switch request.Action {
		case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR:
			if memberErr == nil && targetMember.Active {
				return messaging.ErrCommandConflict
			}
			if memberErr != nil && !errors.Is(memberErr, messaging.ErrNotFound) {
				return memberErr
			}
			addedEndpoints, err = repositories.Devices.ListActiveEndpoints(
				ctx,
				request.TargetPtid,
			)
			if err != nil {
				return err
			}
			if len(addedEndpoints) == 0 {
				return messaging.ErrAuthorityPlanStale
			}
			postEndpoints = append(postEndpoints, addedEndpoints...)
		case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE:
			if memberErr != nil || !targetMember.Active {
				return messaging.ErrConversationState
			}
			target := &chat.CryptoEndpoint{
				Ptid:     request.TargetPtid,
				DeviceId: request.TargetDeviceId,
			}
			targetActive, err := repositories.Devices.IsActive(ctx, target)
			if err != nil {
				return err
			}
			if !targetActive || containsEndpoint(preEndpoints, target) {
				return messaging.ErrCommandConflict
			}
			addedEndpoints = []*chat.CryptoEndpoint{target}
			postEndpoints = append(postEndpoints, target)
		case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR:
			if memberErr != nil || !targetMember.Active {
				return messaging.ErrConversationState
			}
			postEndpoints, removedEndpoints = partitionEndpoints(
				preEndpoints,
				func(endpoint *chat.CryptoEndpoint) bool {
					return endpoint.Ptid == request.TargetPtid
				},
			)
		case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
			if memberErr != nil || !targetMember.Active {
				return messaging.ErrConversationState
			}
			target := &chat.CryptoEndpoint{
				Ptid:     request.TargetPtid,
				DeviceId: request.TargetDeviceId,
			}
			postEndpoints, removedEndpoints = partitionEndpoints(
				preEndpoints,
				func(endpoint *chat.CryptoEndpoint) bool {
					return endpointKey(endpoint) == endpointKey(target)
				},
			)
			if len(removedEndpoints) != 1 {
				return messaging.ErrConversationState
			}
		}
		sort.Slice(postEndpoints, func(i, j int) bool {
			return endpointKey(postEndpoints[i]) < endpointKey(postEndpoints[j])
		})
		sort.Slice(addedEndpoints, func(i, j int) bool {
			return endpointKey(addedEndpoints[i]) < endpointKey(addedEndpoints[j])
		})
		sort.Slice(removedEndpoints, func(i, j int) bool {
			return endpointKey(removedEndpoints[i]) < endpointKey(removedEndpoints[j])
		})

		now := s.clock().UTC().Truncate(time.Microsecond)
		expiresAt := now.Add(s.policy.ReservationTTL)
		planID := uuid.NewString()
		reserved := make([]*chat.ReservedMessagingMlsKeyPackage, 0, len(addedEndpoints))
		for _, endpoint := range addedEndpoints {
			keyPackage, err := repositories.KeyPackages.Reserve(
				ctx,
				planID,
				endpoint,
				now,
				expiresAt,
			)
			if err != nil {
				return err
			}
			reserved = append(reserved, keyPackage)
		}
		response = &chat.PrepareMessagingMembershipTransitionResponse{
			AuthorityPlanId:     planID,
			ExpiresAt:           timestamppb.New(expiresAt),
			AuthorityStationId:  s.localStation,
			AuthoritySequence:   conversation.CurrentSequence,
			AuthorityHash:       append([]byte(nil), head.EventHash...),
			FromMembershipEpoch: conversation.MembershipEpoch,
			FromMlsEpoch:        conversation.MlsEpoch,
			PreEndpoints:        preEndpoints,
			PostEndpoints:       postEndpoints,
			AddedEndpoints:      addedEndpoints,
			RemovedEndpoints:    removedEndpoints,
			ReservedKeyPackages: reserved,
		}
		response.EndpointManifests, err = repositories.EndpointManifests.ListVerifiedManifests(
			ctx,
			actors,
			now,
		)
		if err != nil {
			return err
		}
		planHash, err := hashAuthorityPlan(request, response)
		if err != nil {
			return err
		}
		response.AuthorityPlanSha256 = planHash
		intentBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
		if err != nil {
			return err
		}
		snapshotBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
		if err != nil {
			return err
		}
		return repositories.Plans.Create(ctx, &messaging.AuthorityPlan{
			PlanID:              planID,
			PlanKind:            messaging.AuthorityPlanKindMembershipTransition,
			ConversationID:      request.ConversationId,
			RequesterPTID:       request.Sender.Ptid,
			RequesterDeviceID:   request.Sender.DeviceId,
			IntentBytes:         intentBytes,
			SnapshotBytes:       snapshotBytes,
			AuthorityPlanSHA256: planHash,
			State:               messaging.AuthorityPlanStatePrepared,
			ExpiresAt:           expiresAt,
		})
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *AuthorityPlanService) activeTransitionActors(
	ctx context.Context,
	request *chat.PrepareMessagingMembershipTransitionRequest,
) ([]string, error) {
	actorSet := make(map[string]struct{})
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		members, err := repositories.Authority.ListActiveMembers(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		for _, member := range members {
			if member.Active {
				actorSet[member.PTID] = struct{}{}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if request.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR ||
		request.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE {
		actorSet[request.TargetPtid] = struct{}{}
	}
	actors := make([]string, 0, len(actorSet))
	for actor := range actorSet {
		actors = append(actors, actor)
	}
	sort.Strings(actors)
	return actors, nil
}

func containsEndpoint(endpoints []*chat.CryptoEndpoint, target *chat.CryptoEndpoint) bool {
	for _, endpoint := range endpoints {
		if endpointKey(endpoint) == endpointKey(target) {
			return true
		}
	}
	return false
}

func partitionEndpoints(
	endpoints []*chat.CryptoEndpoint,
	remove func(*chat.CryptoEndpoint) bool,
) ([]*chat.CryptoEndpoint, []*chat.CryptoEndpoint) {
	remaining := make([]*chat.CryptoEndpoint, 0, len(endpoints))
	removed := make([]*chat.CryptoEndpoint, 0)
	for _, endpoint := range endpoints {
		if remove(endpoint) {
			removed = append(removed, endpoint)
		} else {
			remaining = append(remaining, endpoint)
		}
	}
	return remaining, removed
}

func hashAuthorityPlan(
	request proto.Message,
	response proto.Message,
) ([]byte, error) {
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return nil, err
	}
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return nil, err
	}
	var input bytes.Buffer
	input.WriteString(authorityPlanHashDomain)
	input.WriteByte(0)
	if err := binary.Write(&input, binary.BigEndian, uint32(1)); err != nil {
		return nil, err
	}
	if err := binary.Write(&input, binary.BigEndian, uint32(len(requestBytes))); err != nil {
		return nil, err
	}
	input.Write(requestBytes)
	if err := binary.Write(&input, binary.BigEndian, uint32(len(responseBytes))); err != nil {
		return nil, err
	}
	input.Write(responseBytes)
	hash := sha256.Sum256(input.Bytes())
	return hash[:], nil
}
