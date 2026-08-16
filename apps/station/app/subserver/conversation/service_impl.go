package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// DefaultService implements the conversation Service.
type DefaultService struct {
	repo           Repository
	envelope       EnvelopeSubmitter
	transitionUOW  TransitionUnitOfWork
	localStationID string
	clock          Clock
}

func NewConversationService(
	repo Repository,
	envelope EnvelopeSubmitter,
	localStationID string,
	transitionUOW ...TransitionUnitOfWork,
) *DefaultService {
	service := &DefaultService{
		repo:           repo,
		envelope:       envelope,
		localStationID: localStationID,
		clock:          time.Now,
	}
	if len(transitionUOW) > 0 {
		service.transitionUOW = transitionUOW[0]
	}
	return service
}

func (s *DefaultService) CreateDirect(ctx context.Context, actorA, actorB string, actorAStation, actorBStation string) (*chat.Conversation, error) {
	convID := DeterministicDirectID(actorA, actorB)

	existing, err := s.repo.GetConversation(ctx, convID)
	if err == nil && existing != nil {
		now := s.clock()
		if err := s.repo.UpsertMember(ctx, &chat.ConversationMember{
			ConversationId:         convID,
			Ptid:                   actorA,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			ActorHomeStationPeerId: actorAStation,
			JoinedAt:               timestamppb.New(now),
		}); err != nil {
			return nil, fmt.Errorf("conversation: ensure member A active failed: %w", err)
		}
		if err := s.repo.UpsertMember(ctx, &chat.ConversationMember{
			ConversationId:         convID,
			Ptid:                   actorB,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			ActorHomeStationPeerId: actorBStation,
			JoinedAt:               timestamppb.New(now),
		}); err != nil {
			return nil, fmt.Errorf("conversation: ensure member B active failed: %w", err)
		}
		return existing, nil
	}

	now := s.clock()
	conv := &chat.Conversation{
		ConversationId:         convID,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_DIRECT,
		AuthorityStationPeerId: s.localStationID,
		MembershipEpoch:        1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		CreatedAt:              timestamppb.New(now),
		UpdatedAt:              timestamppb.New(now),
	}

	if err := s.repo.UpsertConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("conversation: create failed: %w", err)
	}

	memberA := &chat.ConversationMember{
		ConversationId:         convID,
		Ptid:                   actorA,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		ActorHomeStationPeerId: actorAStation,
		JoinedAt:               timestamppb.New(now),
	}
	memberB := &chat.ConversationMember{
		ConversationId:         convID,
		Ptid:                   actorB,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		ActorHomeStationPeerId: actorBStation,
		JoinedAt:               timestamppb.New(now),
	}

	if err := s.repo.UpsertMember(ctx, memberA); err != nil {
		return nil, fmt.Errorf("conversation: member A create failed: %w", err)
	}
	if err := s.repo.UpsertMember(ctx, memberB); err != nil {
		return nil, fmt.Errorf("conversation: member B create failed: %w", err)
	}

	createdEvent := &chat.CommittedConversationEvent{
		EventId:                  uuid.NewString(),
		ConversationId:           convID,
		GroupSeq:                 1,
		MembershipEpoch:          1,
		CommittedByStationPeerId: s.localStationID,
		CommittedAt:              timestamppb.New(now),
		Payload: &chat.CommittedConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedEvent{
				Conversation:   conv,
				InitialMembers: []*chat.ConversationMember{memberA, memberB},
			},
		},
	}
	createdHash, err := hashCommittedEvent(createdEvent)
	if err != nil {
		return nil, err
	}
	createdEvent.EventHash = createdHash

	if err := s.repo.AppendEvent(ctx, createdEvent); err != nil {
		return nil, fmt.Errorf("conversation: append created event failed: %w", err)
	}

	members := []*chat.ConversationMember{memberA, memberB}
	if s.envelope != nil {
		_ = s.envelope.SubmitEvent(ctx, conv, members, createdEvent)
	}

	return conv, nil
}

func (s *DefaultService) CreateGroup(
	ctx context.Context,
	name string,
	ownerPtid string,
	ownerStation string,
	ownerDeviceID string,
	federationID string,
	conversationID string,
	genesis *chat.MembershipTransitionCommand,
) (*chat.Conversation, *chat.CommittedConversationEvent, error) {
	if s.transitionUOW == nil {
		return nil, nil, fmt.Errorf("conversation: transition unit of work is unavailable")
	}
	convID := conversationID
	if convID == "" {
		convID = uuid.NewString()
	}
	now := s.clock()
	command := &chat.ConversationCommand{
		ConversationId: convID,
		SenderPtid:     ownerPtid,
		SenderDeviceId: ownerDeviceID,
	}
	if err := validateMembershipTransitionInput(command, genesis); err != nil {
		return nil, nil, err
	}
	if genesis.FromMembershipEpoch != 0 ||
		genesis.FromMlsEpoch != 0 ||
		genesis.ToMlsEpoch != 1 {
		return nil, nil, transitionError(
			"EPOCH_MISMATCH",
			"group genesis must advance membership and MLS epochs from 0 to 1",
		)
	}
	if err := validateGroupGenesisChanges(ownerPtid, genesis.Changes); err != nil {
		return nil, nil, err
	}
	if err := validateWelcomeTargets(genesis, ownerPtid, ownerDeviceID); err != nil {
		return nil, nil, err
	}
	if err := validateTransitionDeliveryAdmission(nil, nil, command, genesis); err != nil {
		return nil, nil, err
	}

	conv := &chat.Conversation{
		ConversationId:         convID,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
		AuthorityStationPeerId: s.localStationID,
		FederationId:           federationID,
		AuthorityEpoch:         1,
		MembershipEpoch:        0,
		MlsEpoch:               0,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		Name:                   name,
		OwnerPtid:              ownerPtid,
		CreatedAt:              timestamppb.New(now),
		UpdatedAt:              timestamppb.New(now),
	}
	var transitionEvent *chat.CommittedConversationEvent
	var localDeliveries []*chat.DeviceInboxItem
	err := s.transitionUOW.Execute(ctx, func(repos TransitionRepositories) error {
		if err := repos.Conversation.UpsertConversation(ctx, conv); err != nil {
			return fmt.Errorf("conversation: create group failed: %w", err)
		}
		createdConversation := proto.Clone(conv).(*chat.Conversation)
		createdEvent := &chat.CommittedConversationEvent{
			EventId:                  deterministicTransitionID("created:" + convID),
			ConversationId:           convID,
			GroupSeq:                 1,
			MembershipEpoch:          0,
			CommittedByStationPeerId: s.localStationID,
			CommittedAt:              timestamppb.New(now),
			Payload: &chat.CommittedConversationEvent_ConversationCreated{
				ConversationCreated: &chat.ConversationCreatedEvent{
					Conversation: createdConversation,
				},
			},
		}
		createdHash, err := hashCommittedEvent(createdEvent)
		if err != nil {
			return err
		}
		createdEvent.EventHash = createdHash
		if err := repos.Conversation.AppendEvent(ctx, createdEvent); err != nil {
			return fmt.Errorf("conversation: append created event failed: %w", err)
		}
		if err := applyTransitionChanges(
			ctx,
			repos.Conversation,
			convID,
			ownerPtid,
			nil,
			nil,
			genesis.Changes,
			now,
		); err != nil {
			return err
		}
		if err := repos.Conversation.UpsertMemberDevice(
			ctx,
			convID,
			ownerPtid,
			ownerDeviceID,
			ownerStation,
			true,
		); err != nil {
			return fmt.Errorf("conversation: add owner device failed: %w", err)
		}
		for _, welcome := range genesis.WelcomeDeliveries {
			if err := repos.Conversation.UpsertMemberDevice(
				ctx,
				convID,
				welcome.RecipientPtid,
				welcome.RecipientDeviceId,
				welcome.RecipientHomeStationPeerId,
				true,
			); err != nil {
				return fmt.Errorf("conversation: add genesis member device failed: %w", err)
			}
		}
		if err := repos.Conversation.SetMembershipAndMlsEpoch(ctx, convID, 1, 1); err != nil {
			return fmt.Errorf("conversation: advance genesis epochs failed: %w", err)
		}
		seq, err := repos.Conversation.NextSeq(ctx, convID)
		if err != nil {
			return fmt.Errorf("conversation: allocate genesis transition sequence failed: %w", err)
		}
		transitionEvent = &chat.CommittedConversationEvent{
			EventId:                  deterministicTransitionID("event:" + genesis.TransitionId),
			ConversationId:           convID,
			GroupSeq:                 seq,
			MembershipEpoch:          1,
			CommittedByStationPeerId: s.localStationID,
			CommittedAt:              timestamppb.New(now),
			PrevEventHash:            createdEvent.EventHash,
			Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
				MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
					TransitionId:         genesis.TransitionId,
					FromMembershipEpoch:  0,
					ToMembershipEpoch:    1,
					FromMlsEpoch:         0,
					ToMlsEpoch:           1,
					Changes:              genesis.Changes,
					OpaqueMlsCommitBytes: genesis.OpaqueMlsCommitBytes,
					CommitSha256:         genesis.CommitSha256,
					WelcomeDescriptors:   welcomeDescriptors(genesis.WelcomeDeliveries),
					LeaveIntentId:        genesis.LeaveIntentId,
				},
			},
		}
		transitionHash, err := hashCommittedEvent(transitionEvent)
		if err != nil {
			return err
		}
		transitionEvent.EventHash = transitionHash
		if err := repos.Conversation.AppendEvent(ctx, transitionEvent); err != nil {
			return fmt.Errorf("conversation: append genesis transition failed: %w", err)
		}
		conv.MembershipEpoch = 1
		conv.MlsEpoch = 1
		members, err := repos.Conversation.GetMembers(ctx, convID)
		if err != nil {
			return err
		}
		if err := persistCreatedEventDeliveries(
			ctx,
			repos,
			s.localStationID,
			conv,
			createdEvent,
			members,
			&localDeliveries,
		); err != nil {
			return err
		}
		return persistTransitionDeliveries(
			ctx,
			repos,
			s.localStationID,
			command,
			conv,
			transitionEvent,
			nil,
			members,
			genesis,
			&localDeliveries,
		)
	})
	if err != nil {
		return nil, nil, err
	}
	s.notifyPersistedDeliveries(ctx, localDeliveries)
	return conv, transitionEvent, nil
}

func (s *DefaultService) SubmitCommand(ctx context.Context, cmd *chat.ConversationCommand) (*chat.CommittedConversationEvent, error) {
	if cmd.ConversationId == "" {
		return nil, fmt.Errorf("conversation: conversation_id is required")
	}
	if transition, ok := cmd.Payload.(*chat.ConversationCommand_MembershipTransition); ok {
		return s.submitMembershipTransition(ctx, cmd, transition.MembershipTransition)
	}
	if cmd.CommandId == "" {
		return nil, fmt.Errorf("conversation: command_id is required")
	}
	if s.transitionUOW == nil {
		return nil, fmt.Errorf("conversation: command unit of work is unavailable")
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("conversation: marshal command hash input: %w", err)
	}
	commandHash := sha256.Sum256(commandBytes)

	var event *chat.CommittedConversationEvent
	var localDeliveries []*chat.DeviceInboxItem
	err = s.transitionUOW.Execute(ctx, func(repos TransitionRepositories) error {
		locked, err := repos.Conversation.GetConversationForUpdate(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: not found: %w", err)
		}
		receipt, err := repos.Conversation.GetCommandReceipt(
			ctx,
			cmd.ConversationId,
			cmd.CommandId,
		)
		if err == nil {
			if !bytes.Equal(receipt.CommandSHA256, commandHash[:]) {
				return fmt.Errorf("conversation: COMMAND_CONFLICT")
			}
			replayed := &chat.CommittedConversationEvent{}
			if err := proto.Unmarshal(receipt.EventBytes, replayed); err != nil {
				return fmt.Errorf("conversation: decode command receipt: %w", err)
			}
			event = replayed
			return nil
		}
		if err != nil && err != gorm.ErrRecordNotFound {
			return fmt.Errorf("conversation: load command receipt: %w", err)
		}
		if locked.Status != chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE {
			return fmt.Errorf("conversation: not active (status=%v)", locked.Status)
		}
		member, err := repos.Conversation.GetMember(ctx, cmd.ConversationId, cmd.SenderPtid)
		if err != nil || member == nil {
			return fmt.Errorf("conversation: sender not a member")
		}
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			return fmt.Errorf("conversation: sender membership not active")
		}
		if err := validateEncryptedCommand(ctx, repos.Conversation, locked, cmd); err != nil {
			return err
		}
		committed, err := s.processCommand(ctx, repos.Conversation, locked, cmd)
		if err != nil {
			return err
		}
		if committed.GroupSeq > 1 {
			head, err := repos.Conversation.GetLastEvent(ctx, cmd.ConversationId)
			if err != nil {
				return fmt.Errorf("conversation: load authority event head failed: %w", err)
			}
			if head.GroupSeq+1 != committed.GroupSeq || len(head.EventHash) != sha256.Size {
				return fmt.Errorf("conversation: authority event head is invalid")
			}
			committed.PrevEventHash = append([]byte(nil), head.EventHash...)
		}
		hash, err := hashCommittedEvent(committed)
		if err != nil {
			return err
		}
		committed.EventHash = hash
		if err := repos.Conversation.AppendEvent(ctx, committed); err != nil {
			return fmt.Errorf("conversation: append event failed: %w", err)
		}
		members, err := repos.Conversation.GetMembers(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: load command recipients: %w", err)
		}
		if err := persistCommandEventDeliveries(
			ctx,
			repos,
			s.localStationID,
			locked,
			cmd,
			committed,
			members,
			&localDeliveries,
		); err != nil {
			return fmt.Errorf("conversation: persist command deliveries: %w", err)
		}
		eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(committed)
		if err != nil {
			return fmt.Errorf("conversation: marshal command receipt event: %w", err)
		}
		if err := repos.Conversation.CreateCommandReceipt(ctx, &CommandReceipt{
			ConversationID: cmd.ConversationId,
			CommandID:      cmd.CommandId,
			CommandSHA256:  commandHash[:],
			EventBytes:     eventBytes,
			CreatedAt:      s.clock(),
		}); err != nil {
			return fmt.Errorf("conversation: create command receipt: %w", err)
		}
		event = committed
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.notifyPersistedDeliveries(ctx, localDeliveries)
	return event, nil
}

func validateEncryptedCommand(
	ctx context.Context,
	repo Repository,
	conv *chat.Conversation,
	cmd *chat.ConversationCommand,
) error {
	var (
		devicePayloads        []*chat.DeviceEncryptedPayload
		groupEncryptedPayload []byte
	)
	switch payload := cmd.Payload.(type) {
	case *chat.ConversationCommand_SendMessage:
		if payload.SendMessage == nil {
			return invalidEncryptedCommand("send_message is required")
		}
		devicePayloads = payload.SendMessage.DevicePayloads
		groupEncryptedPayload = payload.SendMessage.GroupEncryptedPayload
	case *chat.ConversationCommand_EditMessage:
		if payload.EditMessage == nil {
			return invalidEncryptedCommand("edit_message is required")
		}
		if payload.EditMessage.TargetMessageId == "" {
			return invalidEncryptedCommand("edit_message requires target_message_id")
		}
		devicePayloads = payload.EditMessage.DevicePayloads
		groupEncryptedPayload = payload.EditMessage.GroupEncryptedPayload
	default:
		return nil
	}

	if strings.TrimSpace(cmd.SenderDeviceId) == "" {
		return invalidEncryptedCommand("sender_device_id is required for encrypted commands")
	}
	if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
		if len(groupEncryptedPayload) == 0 {
			return invalidEncryptedCommand("group_encrypted_payload is required for group commands")
		}
		if len(devicePayloads) != 0 {
			return invalidEncryptedCommand("device_payloads are not valid for group commands")
		}
		return nil
	}
	if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_DIRECT {
		return invalidEncryptedCommand("encrypted command has unsupported conversation kind")
	}
	if len(groupEncryptedPayload) != 0 {
		return invalidEncryptedCommand("group_encrypted_payload is not valid for direct commands")
	}
	if len(devicePayloads) == 0 {
		return invalidEncryptedCommand("device_payloads are required for direct commands")
	}

	members, err := repo.GetMembers(ctx, conv.ConversationId)
	if err != nil {
		return fmt.Errorf("conversation: load direct payload recipients: %w", err)
	}
	activeMembers := make(map[string]struct{}, len(members))
	for _, member := range members {
		if member.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			activeMembers[member.Ptid] = struct{}{}
		}
	}
	seen := make(map[string]struct{}, len(devicePayloads))
	for index, payload := range devicePayloads {
		if payload == nil ||
			strings.TrimSpace(payload.RecipientPtid) == "" ||
			strings.TrimSpace(payload.RecipientDeviceId) == "" ||
			strings.TrimSpace(payload.SessionId) == "" ||
			len(payload.EncryptedEnvelope) == 0 {
			return invalidEncryptedCommand(
				"device_payloads[%d] requires recipient_ptid, recipient_device_id, session_id, and encrypted_envelope",
				index,
			)
		}
		if _, ok := activeMembers[payload.RecipientPtid]; !ok {
			return invalidEncryptedCommand(
				"device_payloads[%d] recipient is not an active conversation member",
				index,
			)
		}
		if payload.RecipientPtid == cmd.SenderPtid &&
			payload.RecipientDeviceId == cmd.SenderDeviceId {
			return invalidEncryptedCommand(
				"device_payloads[%d] cannot target the sending endpoint",
				index,
			)
		}
		key := payload.RecipientPtid + "\x00" + payload.RecipientDeviceId
		if _, duplicate := seen[key]; duplicate {
			return invalidEncryptedCommand(
				"duplicate device payload target %s/%s",
				payload.RecipientPtid,
				payload.RecipientDeviceId,
			)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func invalidEncryptedCommand(format string, args ...any) error {
	return transitionError("INVALID_COMMAND", fmt.Sprintf(format, args...))
}

func cloneDevicePayloads(payloads []*chat.DeviceEncryptedPayload) []*chat.DeviceEncryptedPayload {
	if len(payloads) == 0 {
		return nil
	}
	cloned := make([]*chat.DeviceEncryptedPayload, 0, len(payloads))
	for _, payload := range payloads {
		cloned = append(cloned, proto.Clone(payload).(*chat.DeviceEncryptedPayload))
	}
	return cloned
}

func directEventDevicePayloads(
	event *chat.CommittedConversationEvent,
) ([]*chat.DeviceEncryptedPayload, bool) {
	if committed := event.GetMessageCommitted(); committed != nil {
		return committed.DevicePayloads, true
	}
	if edited := event.GetMessageEdited(); edited != nil {
		return edited.DevicePayloads, true
	}
	return nil, false
}

func persistCommandEventDeliveries(
	ctx context.Context,
	repos TransitionRepositories,
	localStationID string,
	conv *chat.Conversation,
	cmd *chat.ConversationCommand,
	event *chat.CommittedConversationEvent,
	members []*chat.ConversationMember,
	localDeliveries *[]*chat.DeviceInboxItem,
) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}
	activeMembers := make([]*chat.ConversationMember, 0, len(members))
	activeMemberSet := make(map[string]struct{}, len(members))
	for _, member := range members {
		if member.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			activeMembers = append(activeMembers, member)
			activeMemberSet[member.Ptid] = struct{}{}
		}
	}
	sort.Slice(activeMembers, func(i, j int) bool {
		return activeMembers[i].Ptid < activeMembers[j].Ptid
	})
	if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
		devices, err := repos.Conversation.ListMemberDevices(ctx, conv.ConversationId, true)
		if err != nil {
			return fmt.Errorf("conversation: list active group devices for command delivery: %w", err)
		}
		sort.Slice(devices, func(i, j int) bool {
			if devices[i].Ptid == devices[j].Ptid {
				return devices[i].DeviceID < devices[j].DeviceID
			}
			return devices[i].Ptid < devices[j].Ptid
		})
		for _, device := range devices {
			if !device.Active {
				continue
			}
			if _, active := activeMemberSet[device.Ptid]; !active {
				continue
			}
			key := "command:" + cmd.CommandId + ":event:" + device.Ptid + ":" + device.DeviceID
			env := &chat.StationEnvelope{
				EnvelopeId:                 deterministicTransitionID("envelope:" + key),
				ConversationId:             conv.ConversationId,
				SenderPtid:                 cmd.SenderPtid,
				SenderDeviceId:             cmd.SenderDeviceId,
				SenderHomeStationPeerId:    localStationID,
				RecipientPtid:              device.Ptid,
				RecipientDeviceId:          device.DeviceID,
				RecipientHomeStationPeerId: device.HomeStationPeerID,
				IdempotencyKey:             key,
				MembershipEpoch:            event.MembershipEpoch,
				PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
				PayloadBytes:               eventBytes,
				IssuedAt:                   timestamppb.New(time.Now()),
				GroupSeq:                   event.GroupSeq,
				PayloadSha256:              event.EventHash,
				AuthorityStationPeerId:     localStationID,
				FederationId:               conv.FederationId,
				AuthorityEpoch:             conv.AuthorityEpoch,
			}
			if err := enqueueTransitionEnvelope(
				ctx,
				repos,
				localStationID,
				env,
				localDeliveries,
			); err != nil {
				return err
			}
		}
		return nil
	}
	if payloads, targeted := directEventDevicePayloads(event); targeted {
		memberByPtid := make(map[string]*chat.ConversationMember, len(activeMembers))
		for _, member := range activeMembers {
			memberByPtid[member.Ptid] = member
		}
		for _, payload := range payloads {
			member := memberByPtid[payload.RecipientPtid]
			if member == nil {
				return fmt.Errorf(
					"conversation: direct payload recipient %q is not an active member",
					payload.RecipientPtid,
				)
			}
			key := "command:" + cmd.CommandId + ":event:" +
				payload.RecipientPtid + ":" + payload.RecipientDeviceId
			env := &chat.StationEnvelope{
				EnvelopeId:                 deterministicTransitionID("envelope:" + key),
				ConversationId:             conv.ConversationId,
				SenderPtid:                 cmd.SenderPtid,
				SenderDeviceId:             cmd.SenderDeviceId,
				SenderHomeStationPeerId:    localStationID,
				RecipientPtid:              payload.RecipientPtid,
				RecipientDeviceId:          payload.RecipientDeviceId,
				RecipientHomeStationPeerId: member.ActorHomeStationPeerId,
				IdempotencyKey:             key,
				MembershipEpoch:            event.MembershipEpoch,
				PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
				PayloadBytes:               eventBytes,
				IssuedAt:                   timestamppb.New(time.Now()),
				GroupSeq:                   event.GroupSeq,
				PayloadSha256:              event.EventHash,
				AuthorityStationPeerId:     localStationID,
				FederationId:               conv.FederationId,
				AuthorityEpoch:             conv.AuthorityEpoch,
			}
			if err := enqueueTransitionEnvelope(
				ctx,
				repos,
				localStationID,
				env,
				localDeliveries,
			); err != nil {
				return err
			}
		}
		return nil
	}
	for _, member := range activeMembers {
		key := "command:" + cmd.CommandId + ":event:" + member.Ptid
		env := &chat.StationEnvelope{
			EnvelopeId:                 deterministicTransitionID("envelope:" + key),
			ConversationId:             conv.ConversationId,
			SenderPtid:                 cmd.SenderPtid,
			SenderDeviceId:             cmd.SenderDeviceId,
			SenderHomeStationPeerId:    localStationID,
			RecipientPtid:              member.Ptid,
			RecipientHomeStationPeerId: member.ActorHomeStationPeerId,
			IdempotencyKey:             key,
			MembershipEpoch:            event.MembershipEpoch,
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			PayloadBytes:               eventBytes,
			IssuedAt:                   timestamppb.New(time.Now()),
			GroupSeq:                   event.GroupSeq,
			PayloadSha256:              event.EventHash,
			AuthorityStationPeerId:     localStationID,
			FederationId:               conv.FederationId,
			AuthorityEpoch:             conv.AuthorityEpoch,
		}
		if err := enqueueTransitionEnvelope(
			ctx,
			repos,
			localStationID,
			env,
			localDeliveries,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *DefaultService) GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error) {
	return s.repo.GetConversation(ctx, conversationID)
}

func (s *DefaultService) ListConversations(ctx context.Context, ptid string) ([]*chat.Conversation, error) {
	return s.repo.ListByActor(ctx, ptid)
}

func (s *DefaultService) GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	return s.repo.GetMembers(ctx, conversationID)
}

func (s *DefaultService) GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error) {
	return s.repo.GetMember(ctx, conversationID, ptid)
}

func (s *DefaultService) UpsertMember(ctx context.Context, member *chat.ConversationMember) error {
	return s.repo.UpsertMember(ctx, member)
}

func (s *DefaultService) ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.ListEvents(ctx, conversationID, afterSeq, limit)
}

func (s *DefaultService) SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt) error {
	if receipt.ConversationId == "" || receipt.MessageId == "" {
		return fmt.Errorf("conversation: receipt requires conversation_id and message_id")
	}

	members, err := s.repo.GetMembers(ctx, receipt.ConversationId)
	if err != nil {
		return fmt.Errorf("conversation: get members for receipt failed: %w", err)
	}

	for _, member := range members {
		if member.Ptid == receipt.Ptid {
			continue
		}
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		if s.envelope != nil {
			if err := s.envelope.SubmitReceipt(
				ctx,
				receipt,
				member.Ptid,
				member.ActorHomeStationPeerId,
			); err != nil {
				return fmt.Errorf("conversation: route receipt failed: %w", err)
			}
		}
	}
	return nil
}

func (s *DefaultService) processCommand(ctx context.Context, repo Repository, conv *chat.Conversation, cmd *chat.ConversationCommand) (*chat.CommittedConversationEvent, error) {
	seq, err := repo.NextSeq(ctx, conv.ConversationId)
	if err != nil {
		return nil, fmt.Errorf("conversation: next seq failed: %w", err)
	}

	now := s.clock()
	event := &chat.CommittedConversationEvent{
		EventId:                  uuid.NewString(),
		ConversationId:           conv.ConversationId,
		GroupSeq:                 seq,
		MembershipEpoch:          conv.MembershipEpoch,
		CommittedByStationPeerId: s.localStationID,
		CommittedAt:              timestamppb.New(now),
	}

	switch p := cmd.Payload.(type) {
	case *chat.ConversationCommand_SendMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageCommitted{
			MessageCommitted: &chat.MessageCommittedEvent{
				MessageId:             uuid.NewString(),
				SenderPtid:            cmd.SenderPtid,
				SenderDeviceId:        cmd.SenderDeviceId,
				DevicePayloads:        cloneDevicePayloads(p.SendMessage.DevicePayloads),
				ContentType:           p.SendMessage.ContentType,
				ReplyToMessageId:      p.SendMessage.ReplyToMessageId,
				ThreadRootMessageId:   p.SendMessage.ThreadRootMessageId,
				Attachments:           p.SendMessage.Attachments,
				ClientTs:              cmd.ClientTs,
				GroupEncryptedPayload: append([]byte(nil), p.SendMessage.GroupEncryptedPayload...),
			},
		}
	case *chat.ConversationCommand_EditMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageEdited{
			MessageEdited: &chat.MessageEditedEvent{
				MessageId:             p.EditMessage.TargetMessageId,
				EditorPtid:            cmd.SenderPtid,
				DevicePayloads:        cloneDevicePayloads(p.EditMessage.DevicePayloads),
				EditedAt:              timestamppb.New(now),
				GroupEncryptedPayload: append([]byte(nil), p.EditMessage.GroupEncryptedPayload...),
			},
		}
	case *chat.ConversationCommand_RetractMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageRetracted{
			MessageRetracted: &chat.MessageRetractedEvent{
				MessageId:     p.RetractMessage.TargetMessageId,
				RetractorPtid: cmd.SenderPtid,
				RetractedAt:   timestamppb.New(now),
			},
		}
	case *chat.ConversationCommand_Dissolve:
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return nil, fmt.Errorf("conversation: dissolve only valid for group conversations")
		}
		conv.Status = chat.ConversationStatus_CONVERSATION_STATUS_DISSOLVED
		if err := repo.UpsertConversation(ctx, conv); err != nil {
			return nil, fmt.Errorf("conversation: dissolve update failed: %w", err)
		}
		event.Payload = &chat.CommittedConversationEvent_ConversationDissolved{
			ConversationDissolved: &chat.ConversationDissolvedEvent{
				DissolvedByPtid: cmd.SenderPtid,
			},
		}

	case *chat.ConversationCommand_UpdateSettings:
		if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
			if err := requireMembership(ctx, repo, conv.ConversationId, cmd.SenderPtid); err != nil {
				return nil, err
			}
		}
		changed := false
		if p.UpdateSettings.Name != nil {
			conv.Name = *p.UpdateSettings.Name
			changed = true
		}
		if p.UpdateSettings.Description != nil {
			conv.Description = *p.UpdateSettings.Description
			changed = true
		}
		if p.UpdateSettings.AvatarCid != nil {
			conv.AvatarCid = *p.UpdateSettings.AvatarCid
			changed = true
		}
		if p.UpdateSettings.DisappearTimerSeconds != nil {
			conv.DisappearTimerSeconds = *p.UpdateSettings.DisappearTimerSeconds
			changed = true
		}
		if changed {
			conv.UpdatedAt = timestamppb.New(now)
			if err := repo.UpsertConversation(ctx, conv); err != nil {
				return nil, fmt.Errorf("conversation: update settings failed: %w", err)
			}
		}
		event.Payload = &chat.CommittedConversationEvent_SettingsChanged{
			SettingsChanged: &chat.SettingsChangedEvent{
				ChangedByPtid: cmd.SenderPtid,
				Name:          p.UpdateSettings.Name,
				Description:   p.UpdateSettings.Description,
				AvatarCid:     p.UpdateSettings.AvatarCid,
				Muted:         p.UpdateSettings.Muted,
			},
		}

	case *chat.ConversationCommand_React:
		if p.React.MessageId == "" || p.React.Emoji == "" {
			return nil, fmt.Errorf("conversation: react requires message_id and emoji")
		}
		event.Payload = &chat.CommittedConversationEvent_Reaction{
			Reaction: &chat.ReactionEvent{
				MessageId: p.React.MessageId,
				ActorPtid: cmd.SenderPtid,
				Emoji:     p.React.Emoji,
				Removed:   p.React.Remove,
				Ts:        event.CommittedAt,
			},
		}

	case *chat.ConversationCommand_PinMessage:
		if p.PinMessage.MessageId == "" {
			return nil, fmt.Errorf("conversation: pin requires message_id")
		}
		if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
			if err := requireAdminOrOwner(ctx, repo, conv.ConversationId, cmd.SenderPtid); err != nil {
				return nil, err
			}
		}
		event.Payload = &chat.CommittedConversationEvent_Pin{
			Pin: &chat.PinEvent{
				MessageId: p.PinMessage.MessageId,
				ActorPtid: cmd.SenderPtid,
				Unpinned:  p.PinMessage.Unpin,
				Ts:        event.CommittedAt,
			},
		}

	default:
		return nil, fmt.Errorf("conversation: unsupported command type")
	}

	return event, nil
}

// DeterministicDirectID generates a stable conversation ID from a sorted DID pair (DP-4).
func DeterministicDirectID(actorA, actorB string) string {
	pair := []string{actorA, actorB}
	sort.Strings(pair)
	hash := sha256.Sum256([]byte("direct:" + pair[0] + ":" + pair[1]))
	return "d-" + hex.EncodeToString(hash[:16])
}

func requireAdminOrOwner(ctx context.Context, repo Repository, conversationID, senderPtid string) error {
	member, err := repo.GetMember(ctx, conversationID, senderPtid)
	if err != nil || member == nil {
		return fmt.Errorf("conversation: sender not a member")
	}
	if member.Role != chat.MemberRole_MEMBER_ROLE_OWNER && member.Role != chat.MemberRole_MEMBER_ROLE_ADMIN {
		return fmt.Errorf("conversation: admin or owner role required")
	}
	return nil
}

func requireMembership(ctx context.Context, repo Repository, conversationID, senderPtid string) error {
	member, err := repo.GetMember(ctx, conversationID, senderPtid)
	if err != nil || member == nil {
		return fmt.Errorf("conversation: sender not a member")
	}
	return nil
}

// --- New Service methods (W1/W2: unified conversation API) ---

func (s *DefaultService) ListMessages(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	events, err := s.repo.ListEvents(ctx, conversationID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	messages := make([]*chat.CommittedConversationEvent, 0, len(events))
	for _, ev := range events {
		if ev.GetMessageCommitted() != nil ||
			ev.GetMessageEdited() != nil ||
			ev.GetMessageRetracted() != nil {
			messages = append(messages, ev)
		}
	}
	return messages, nil
}

func (s *DefaultService) ListThreadMessages(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	return s.repo.ListThreadEvents(ctx, conversationID, threadRootID, afterSeq, limit)
}

func (s *DefaultService) GetThreadCounts(ctx context.Context, conversationID string, rootIDs []string) (map[string]ThreadSummary, error) {
	return s.repo.CountThreadReplies(ctx, conversationID, rootIDs)
}
