package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	maxMlsCommitBytes       = 128 * 1024
	maxMlsWelcomeBytes      = 8 * 1024 * 1024
	maxTransitionDeliveries = 200
)

type TransitionError struct {
	Code    string
	Message string
}

func (e *TransitionError) Error() string {
	return e.Message
}

func transitionError(code, message string) error {
	return &TransitionError{Code: code, Message: message}
}

func (s *DefaultService) submitMembershipTransition(
	ctx context.Context,
	cmd *chat.ConversationCommand,
	transition *chat.MembershipTransitionCommand,
) (*chat.CommittedConversationEvent, error) {
	if s.transitionUOW == nil {
		return nil, fmt.Errorf("conversation: transition unit of work is unavailable")
	}
	if cmd.CommandId == "" {
		return nil, transitionError("INVALID_TRANSITION", "command_id is required")
	}
	if err := validateMembershipTransitionInput(cmd, transition); err != nil {
		return nil, err
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("conversation: marshal transition command hash input: %w", err)
	}
	commandHash := sha256.Sum256(commandBytes)

	var committed *chat.CommittedConversationEvent
	var localDeliveries []*chat.DeviceInboxItem
	err = s.transitionUOW.Execute(ctx, func(repos TransitionRepositories) error {
		conv, err := repos.Conversation.GetConversationForUpdate(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: lock authority head failed: %w", err)
		}
		receipt, err := repos.Conversation.GetCommandReceipt(
			ctx,
			cmd.ConversationId,
			cmd.CommandId,
		)
		if err == nil {
			if !bytes.Equal(receipt.CommandSHA256, commandHash[:]) {
				return transitionError("COMMAND_CONFLICT", "command_id already committed with different content")
			}
			replayed := &chat.CommittedConversationEvent{}
			if err := proto.Unmarshal(receipt.EventBytes, replayed); err != nil {
				return fmt.Errorf("conversation: decode transition command receipt: %w", err)
			}
			committed = replayed
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("conversation: load transition command receipt: %w", err)
		}
		_, found, err := resolveCommittedTransition(
			ctx,
			repos.Conversation,
			cmd.ConversationId,
			transition,
		)
		if err != nil {
			return err
		}
		if found {
			return transitionError(
				"COMMAND_CONFLICT",
				"transition_id already committed under a different command_id",
			)
		}
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return transitionError("INVALID_CONVERSATION", "membership transition requires a group conversation")
		}
		if conv.Status != chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE {
			return transitionError("GROUP_READ_ONLY", "group is not writable")
		}
		if conv.AuthorityStationPeerId != s.localStationID {
			return transitionError("NOT_AUTHORITY", "membership transition must be committed by the group authority")
		}
		if conv.MembershipEpoch != conv.MlsEpoch {
			return transitionError("GROUP_READ_ONLY", "membership and MLS authority heads have diverged")
		}
		if transition.FromMembershipEpoch != conv.MembershipEpoch ||
			transition.FromMlsEpoch != conv.MlsEpoch {
			return transitionError("EPOCH_STALE", "membership or MLS epoch is stale")
		}
		nextEpoch := conv.MembershipEpoch + 1
		if transition.ToMlsEpoch != nextEpoch {
			return transitionError("EPOCH_MISMATCH", "target MLS epoch must equal the next membership epoch")
		}

		preMembers, err := repos.Conversation.GetMembers(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: load pre-transition members failed: %w", err)
		}
		leaveTarget, hasLeave, err := delegatedLeaveTarget(transition)
		if err != nil {
			return err
		}
		var leaveIntent *chat.MlsLeaveIntent
		if hasLeave {
			if transition.LeaveIntentId == "" || repos.LeaveIntents == nil {
				return transitionError("INVALID_TRANSITION", "delegated leave requires a verified leave intent")
			}
			if cmd.SenderPtid == leaveTarget {
				return transitionError("INVALID_TRANSITION", "departing actor cannot author its own MLS removal Commit")
			}
			leaveIntent, err = repos.LeaveIntents.GetPendingForUpdate(ctx, transition.LeaveIntentId)
			if err != nil {
				if isMissingLeaveIntent(err) {
					return transitionError("INVALID_TRANSITION", "leave intent is unavailable")
				}
				return fmt.Errorf("conversation: load leave intent failed: %w", err)
			}
			if err := validateDelegatedLeaveIntent(leaveIntent, conv, transition, leaveTarget, s.clock()); err != nil {
				return err
			}
		} else if transition.LeaveIntentId != "" {
			return transitionError("INVALID_TRANSITION", "leave_intent_id is only valid for LEAVE")
		}
		sender := activeMemberByPtid(preMembers, cmd.SenderPtid)
		if sender == nil {
			return transitionError("NOT_MEMBER", "sender is not an active group member")
		}
		if err := authorizeTransitionChanges(sender, transition.Changes, leaveTarget); err != nil {
			return err
		}
		if err := validateTransitionOwnership(conv.OwnerPtid, cmd.SenderPtid, transition.Changes); err != nil {
			return err
		}
		if err := validateWelcomeTargets(transition, "", ""); err != nil {
			return err
		}
		preDevices, err := repos.Conversation.ListMemberDevices(ctx, cmd.ConversationId, true)
		if err != nil {
			return fmt.Errorf("conversation: load pre-transition member devices failed: %w", err)
		}
		if !hasActiveMemberDevice(preDevices, cmd.SenderPtid, cmd.SenderDeviceId) {
			return transitionError("PERMISSION_DENIED", "sender device is not an active MLS leaf")
		}
		if err := validateTransitionDeliveryAdmission(preMembers, preDevices, cmd, transition); err != nil {
			return err
		}

		now := s.clock()
		if leaveIntent != nil {
			if err := repos.LeaveIntents.Consume(
				ctx,
				leaveIntent.IntentId,
				transition.TransitionId,
				now,
			); err != nil {
				return err
			}
		}
		if err := applyTransitionChanges(
			ctx,
			repos.Conversation,
			cmd.ConversationId,
			cmd.SenderPtid,
			preMembers,
			preDevices,
			transition.Changes,
			now,
		); err != nil {
			return err
		}
		for _, welcome := range transition.WelcomeDeliveries {
			if err := repos.Conversation.UpsertMemberDevice(
				ctx,
				cmd.ConversationId,
				welcome.RecipientPtid,
				welcome.RecipientDeviceId,
				welcome.RecipientHomeStationPeerId,
				true,
			); err != nil {
				return fmt.Errorf("conversation: add welcomed member device failed: %w", err)
			}
		}
		if err := repos.Conversation.SetMembershipAndMlsEpoch(
			ctx,
			cmd.ConversationId,
			nextEpoch,
			transition.ToMlsEpoch,
		); err != nil {
			return fmt.Errorf("conversation: advance transition epochs failed: %w", err)
		}

		seq, err := repos.Conversation.NextSeq(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: allocate transition sequence failed: %w", err)
		}
		event := &chat.CommittedConversationEvent{
			EventId:                  deterministicTransitionID("event:" + transition.TransitionId),
			ConversationId:           cmd.ConversationId,
			GroupSeq:                 seq,
			MembershipEpoch:          nextEpoch,
			CommittedByStationPeerId: s.localStationID,
			CommittedAt:              timestamppb.New(now),
			Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
				MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
					TransitionId:         transition.TransitionId,
					FromMembershipEpoch:  transition.FromMembershipEpoch,
					ToMembershipEpoch:    nextEpoch,
					FromMlsEpoch:         transition.FromMlsEpoch,
					ToMlsEpoch:           transition.ToMlsEpoch,
					Changes:              transition.Changes,
					OpaqueMlsCommitBytes: transition.OpaqueMlsCommitBytes,
					CommitSha256:         transition.CommitSha256,
					WelcomeDescriptors:   welcomeDescriptors(transition.WelcomeDeliveries),
					LeaveIntentId:        transition.LeaveIntentId,
				},
			},
		}
		if head, headErr := repos.Conversation.GetLastEvent(ctx, cmd.ConversationId); headErr == nil {
			event.PrevEventHash = head.EventHash
		} else if !errors.Is(headErr, gorm.ErrRecordNotFound) {
			return fmt.Errorf("conversation: load authority event head failed: %w", headErr)
		}
		eventHash, err := hashCommittedEvent(event)
		if err != nil {
			return err
		}
		event.EventHash = eventHash
		if err := repos.Conversation.AppendEvent(ctx, event); err != nil {
			return fmt.Errorf("conversation: append transition event failed: %w", err)
		}

		postMembers, err := repos.Conversation.GetMembers(ctx, cmd.ConversationId)
		if err != nil {
			return fmt.Errorf("conversation: load post-transition members failed: %w", err)
		}
		if err := persistTransitionDeliveries(
			ctx,
			repos,
			s.localStationID,
			cmd,
			conv,
			event,
			preDevices,
			postMembers,
			transition,
			&localDeliveries,
		); err != nil {
			return err
		}
		eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
		if err != nil {
			return fmt.Errorf("conversation: marshal transition command receipt event: %w", err)
		}
		if err := repos.Conversation.CreateCommandReceipt(ctx, &CommandReceipt{
			ConversationID: cmd.ConversationId,
			CommandID:      cmd.CommandId,
			CommandSHA256:  commandHash[:],
			EventBytes:     eventBytes,
			CreatedAt:      now,
		}); err != nil {
			return fmt.Errorf("conversation: create transition command receipt: %w", err)
		}
		committed = event
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.notifyPersistedDeliveries(ctx, localDeliveries)
	return committed, nil
}

func (s *DefaultService) notifyPersistedDeliveries(
	ctx context.Context,
	items []*chat.DeviceInboxItem,
) {
	notifier, ok := s.envelope.(PersistedEnvelopeNotifier)
	if !ok {
		return
	}
	for _, item := range items {
		notifier.NotifyPersisted(ctx, item)
	}
}

func resolveCommittedTransition(
	ctx context.Context,
	repo Repository,
	conversationID string,
	transition *chat.MembershipTransitionCommand,
) (*chat.CommittedConversationEvent, bool, error) {
	existing, err := repo.GetEventByTransitionID(
		ctx,
		conversationID,
		transition.TransitionId,
	)
	if err == nil {
		if sameCommittedTransition(existing, transition) {
			return existing, true, nil
		}
		return nil, false, transitionError(
			"TRANSITION_CONFLICT",
			"transition_id already committed with different content",
		)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	return nil, false, fmt.Errorf("conversation: transition lookup failed: %w", err)
}

func validateMembershipTransitionInput(
	cmd *chat.ConversationCommand,
	transition *chat.MembershipTransitionCommand,
) error {
	if transition == nil {
		return transitionError("INVALID_TRANSITION", "membership transition is required")
	}
	if transition.TransitionId == "" || transition.IdempotencyKey == "" {
		return transitionError("INVALID_TRANSITION", "transition_id and idempotency_key are required")
	}
	if len(transition.Changes) == 0 {
		return transitionError("INVALID_TRANSITION", "at least one membership change is required")
	}
	if len(transition.OpaqueMlsCommitBytes) == 0 ||
		len(transition.OpaqueMlsCommitBytes) > maxMlsCommitBytes {
		return transitionError("PAYLOAD_TOO_LARGE", "MLS Commit must be between 1 byte and 128 KiB")
	}
	if len(transition.CommitSha256) != sha256.Size {
		return transitionError("INVALID_HASH", "commit_sha256 must be 32 bytes")
	}
	actualCommitHash := sha256.Sum256(transition.OpaqueMlsCommitBytes)
	if !bytes.Equal(actualCommitHash[:], transition.CommitSha256) {
		return transitionError("INVALID_HASH", "commit_sha256 does not match opaque Commit bytes")
	}
	if len(transition.WelcomeDeliveries) > maxTransitionDeliveries {
		return transitionError("TOO_MANY_RECIPIENTS", "membership transition exceeds 200 deliveries")
	}
	totalWelcomeBytes := 0
	for _, welcome := range transition.WelcomeDeliveries {
		totalWelcomeBytes += len(welcome.OpaqueWelcomeBytes)
		if len(welcome.WelcomeSha256) != sha256.Size {
			return transitionError("INVALID_HASH", "welcome_sha256 must be 32 bytes")
		}
		actualWelcomeHash := sha256.Sum256(welcome.OpaqueWelcomeBytes)
		if !bytes.Equal(actualWelcomeHash[:], welcome.WelcomeSha256) {
			return transitionError("INVALID_HASH", "welcome_sha256 does not match opaque Welcome bytes")
		}
	}
	if totalWelcomeBytes > maxMlsWelcomeBytes {
		return transitionError("PAYLOAD_TOO_LARGE", "Welcome payloads exceed 8 MiB")
	}
	if cmd.SenderPtid == "" || cmd.SenderDeviceId == "" {
		return transitionError("INVALID_TRANSITION", "sender_ptid and sender_device_id are required")
	}
	return nil
}

func sameCommittedTransition(
	event *chat.CommittedConversationEvent,
	transition *chat.MembershipTransitionCommand,
) bool {
	committed := event.GetMembershipTransitionCommitted()
	if committed == nil ||
		committed.TransitionId != transition.TransitionId ||
		committed.FromMembershipEpoch != transition.FromMembershipEpoch ||
		committed.FromMlsEpoch != transition.FromMlsEpoch ||
		committed.ToMlsEpoch != transition.ToMlsEpoch ||
		!bytes.Equal(committed.CommitSha256, transition.CommitSha256) ||
		!bytes.Equal(committed.OpaqueMlsCommitBytes, transition.OpaqueMlsCommitBytes) ||
		committed.LeaveIntentId != transition.LeaveIntentId ||
		len(committed.Changes) != len(transition.Changes) ||
		len(committed.WelcomeDescriptors) != len(transition.WelcomeDeliveries) {
		return false
	}
	for i, change := range transition.Changes {
		if !proto.Equal(committed.Changes[i], change) {
			return false
		}
	}
	for i, delivery := range transition.WelcomeDeliveries {
		descriptor := committed.WelcomeDescriptors[i]
		if descriptor.RecipientPtid != delivery.RecipientPtid ||
			descriptor.RecipientDeviceId != delivery.RecipientDeviceId ||
			descriptor.RecipientHomeStationPeerId != delivery.RecipientHomeStationPeerId ||
			!bytes.Equal(descriptor.WelcomeSha256, delivery.WelcomeSha256) {
			return false
		}
	}
	return true
}

func activeMemberByPtid(
	members []*chat.ConversationMember,
	ptid string,
) *chat.ConversationMember {
	for _, member := range members {
		if member.Ptid == ptid &&
			member.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			return member
		}
	}
	return nil
}

func authorizeTransitionChanges(
	sender *chat.ConversationMember,
	changes []*chat.MembershipTransitionChange,
	delegatedLeaveTarget string,
) error {
	isAdmin := sender.Role == chat.MemberRole_MEMBER_ROLE_OWNER ||
		sender.Role == chat.MemberRole_MEMBER_ROLE_ADMIN
	for _, change := range changes {
		if change == nil || change.Ptid == "" {
			return transitionError("INVALID_TRANSITION", "membership change requires ptid")
		}
		switch change.Action {
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE:
			if change.Ptid != delegatedLeaveTarget || change.Ptid == sender.Ptid {
				return transitionError("PERMISSION_DENIED", "leave transition requires target authorization and a non-target committer")
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE_DEVICE:
			if change.DeviceId == "" {
				return transitionError("INVALID_TRANSITION", "added or removed MLS leaf requires device_id")
			}
			if change.Ptid != sender.Ptid && !isAdmin {
				return transitionError("PERMISSION_DENIED", "admin or owner role required for another member's device")
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE:
			if !isAdmin {
				return transitionError("PERMISSION_DENIED", "admin or owner role required")
			}
		default:
			return transitionError("INVALID_TRANSITION", "unsupported membership transition action")
		}
	}
	return nil
}

func delegatedLeaveTarget(
	transition *chat.MembershipTransitionCommand,
) (string, bool, error) {
	target := ""
	for _, change := range transition.Changes {
		if change.Action != chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE {
			continue
		}
		if target != "" || len(transition.Changes) != 1 {
			return "", false, transitionError("INVALID_TRANSITION", "LEAVE must be the only transition change")
		}
		target = change.Ptid
	}
	return target, target != "", nil
}

func validateTransitionOwnership(
	ownerPtid string,
	senderPtid string,
	changes []*chat.MembershipTransitionChange,
) error {
	for _, change := range changes {
		if change.Ptid == ownerPtid &&
			(change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE ||
				change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE ||
				change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE) {
			return transitionError("PERMISSION_DENIED", "group owner must transfer ownership before leaving or changing role")
		}
		if change.Role == chat.MemberRole_MEMBER_ROLE_OWNER {
			return transitionError("PERMISSION_DENIED", "owner role changes require the ownership-transfer command")
		}
		if change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE &&
			senderPtid != ownerPtid {
			return transitionError("PERMISSION_DENIED", "only the group owner may change member roles")
		}
	}
	return nil
}

func validateWelcomeTargets(
	transition *chat.MembershipTransitionCommand,
	exemptAddedPtid string,
	exemptAddedDeviceID string,
) error {
	allowed := make(map[string]bool)
	required := make(map[string]bool)
	for _, change := range transition.Changes {
		if change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD ||
			change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE {
			allowed[change.Ptid+"\x00"+change.DeviceId] = true
			if change.Ptid != exemptAddedPtid || change.DeviceId != exemptAddedDeviceID {
				required[change.Ptid+"\x00"+change.DeviceId] = true
			}
		}
	}
	seen := make(map[string]bool, len(transition.WelcomeDeliveries))
	for _, welcome := range transition.WelcomeDeliveries {
		if welcome.RecipientPtid == "" || welcome.RecipientDeviceId == "" {
			return transitionError("INVALID_TRANSITION", "Welcome target requires ptid and device_id")
		}
		exactKey := welcome.RecipientPtid + "\x00" + welcome.RecipientDeviceId
		if !allowed[exactKey] {
			return transitionError("INVALID_TRANSITION", "Welcome target is not added by this transition")
		}
		if seen[exactKey] {
			return transitionError("INVALID_TRANSITION", "Welcome target is duplicated")
		}
		seen[exactKey] = true
		delete(required, exactKey)
	}
	if len(required) != 0 {
		return transitionError("INVALID_TRANSITION", "every added member or device requires a Welcome")
	}
	return nil
}

func validateTransitionDeliveryAdmission(
	preMembers []*chat.ConversationMember,
	preDevices []MemberDevice,
	cmd *chat.ConversationCommand,
	transition *chat.MembershipTransitionCommand,
) error {
	activePostMembers := 0
	for _, member := range preMembers {
		if member.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			activePostMembers++
		}
	}
	for _, change := range transition.Changes {
		switch change.Action {
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD:
			if change.DeviceId == "" {
				return transitionError("INVALID_TRANSITION", "genesis member addition requires device_id")
			}
			if activeMemberByPtid(preMembers, change.Ptid) == nil {
				activePostMembers++
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE:
			if activeMemberByPtid(preMembers, change.Ptid) != nil {
				activePostMembers--
			}
		}
	}
	commitDeliveries := 0
	for _, device := range preDevices {
		if device.Active &&
			(device.Ptid != cmd.SenderPtid || device.DeviceID != cmd.SenderDeviceId) {
			commitDeliveries++
		}
	}
	total := activePostMembers + commitDeliveries + len(transition.WelcomeDeliveries)
	if total > maxTransitionDeliveries {
		return transitionError("TOO_MANY_RECIPIENTS", "membership transition exceeds 200 logical deliveries")
	}
	return nil
}

func validateGroupGenesisChanges(
	ownerPtid string,
	changes []*chat.MembershipTransitionChange,
) error {
	ownerIncluded := false
	seenMembers := make(map[string]bool, len(changes))
	seenDevices := make(map[string]bool, len(changes))
	for _, change := range changes {
		if change == nil {
			return transitionError("INVALID_TRANSITION", "group genesis contains an empty change")
		}
		switch change.Action {
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD:
			if seenMembers[change.Ptid] {
				return transitionError("INVALID_TRANSITION", "group genesis contains a duplicate member")
			}
			seenMembers[change.Ptid] = true
			if change.Ptid == ownerPtid {
				if change.Role != chat.MemberRole_MEMBER_ROLE_OWNER {
					return transitionError("INVALID_TRANSITION", "group owner must have owner role")
				}
				ownerIncluded = true
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE:
			if !seenMembers[change.Ptid] || change.DeviceId == "" {
				return transitionError("INVALID_TRANSITION", "genesis device requires an earlier member addition")
			}
		default:
			return transitionError("INVALID_TRANSITION", "group genesis supports member and device additions only")
		}
		deviceKey := change.Ptid + "\x00" + change.DeviceId
		if change.DeviceId != "" && seenDevices[deviceKey] {
			return transitionError("INVALID_TRANSITION", "group genesis contains a duplicate device")
		}
		if change.DeviceId != "" {
			seenDevices[deviceKey] = true
		}
	}
	if !ownerIncluded {
		return transitionError("INVALID_TRANSITION", "group genesis must add the owner")
	}
	return nil
}

func applyTransitionChanges(
	ctx context.Context,
	repo Repository,
	conversationID string,
	senderPtid string,
	preMembers []*chat.ConversationMember,
	preDevices []MemberDevice,
	changes []*chat.MembershipTransitionChange,
	now time.Time,
) error {
	for _, change := range changes {
		existing := activeMemberByPtid(preMembers, change.Ptid)
		switch change.Action {
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD:
			role := change.Role
			if role == chat.MemberRole_MEMBER_ROLE_UNSPECIFIED {
				role = chat.MemberRole_MEMBER_ROLE_MEMBER
			}
			if err := repo.UpsertMember(ctx, &chat.ConversationMember{
				ConversationId:         conversationID,
				Ptid:                   change.Ptid,
				Role:                   role,
				MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
				ActorHomeStationPeerId: change.ActorHomeStationPeerId,
				JoinedAt:               timestamppb.New(now),
				InvitedByPtid:          senderPtid,
			}); err != nil {
				return fmt.Errorf("conversation: add member %s failed: %w", change.Ptid, err)
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE:
			if existing == nil {
				return transitionError("NOT_MEMBER", "transition target is not an active member")
			}
			if change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE {
				existing.MemberStatus = chat.MemberStatus_MEMBER_STATUS_REMOVED
			} else {
				existing.MemberStatus = chat.MemberStatus_MEMBER_STATUS_LEFT
			}
			if err := repo.UpsertMember(ctx, existing); err != nil {
				return fmt.Errorf("conversation: update member status failed: %w", err)
			}
			for _, device := range preDevices {
				if device.Active && device.Ptid == change.Ptid {
					if err := repo.UpsertMemberDevice(
						ctx,
						conversationID,
						device.Ptid,
						device.DeviceID,
						device.HomeStationPeerID,
						false,
					); err != nil {
						return fmt.Errorf("conversation: deactivate member device failed: %w", err)
					}
				}
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE:
			if existing == nil {
				return transitionError("NOT_MEMBER", "role-change target is not an active member")
			}
			existing.Role = change.Role
			if err := repo.UpsertMember(ctx, existing); err != nil {
				return fmt.Errorf("conversation: update member role failed: %w", err)
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE_DEVICE:
			if existing == nil && preMembers != nil {
				return transitionError("NOT_MEMBER", "device transition target is not an active member")
			}
			activeBefore := hasActiveMemberDevice(preDevices, change.Ptid, change.DeviceId)
			active := change.Action ==
				chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE
			if active == activeBefore {
				if active {
					return transitionError("INVALID_TRANSITION", "device is already an active MLS leaf")
				}
				return transitionError("NOT_MEMBER", "device is not an active MLS leaf")
			}
			if err := repo.UpsertMemberDevice(
				ctx,
				conversationID,
				change.Ptid,
				change.DeviceId,
				change.ActorHomeStationPeerId,
				active,
			); err != nil {
				return fmt.Errorf("conversation: update member device failed: %w", err)
			}
		}
	}
	return nil
}

func hasActiveMemberDevice(devices []MemberDevice, ptid, deviceID string) bool {
	for _, device := range devices {
		if device.Active && device.Ptid == ptid && device.DeviceID == deviceID {
			return true
		}
	}
	return false
}

func welcomeDescriptors(
	deliveries []*chat.MlsWelcomeDelivery,
) []*chat.MlsWelcomeDescriptor {
	descriptors := make([]*chat.MlsWelcomeDescriptor, 0, len(deliveries))
	for _, delivery := range deliveries {
		descriptors = append(descriptors, &chat.MlsWelcomeDescriptor{
			RecipientPtid:              delivery.RecipientPtid,
			RecipientDeviceId:          delivery.RecipientDeviceId,
			RecipientHomeStationPeerId: delivery.RecipientHomeStationPeerId,
			WelcomeSha256:              delivery.WelcomeSha256,
		})
	}
	return descriptors
}

func hashCommittedEvent(event *chat.CommittedConversationEvent) ([]byte, error) {
	clone := proto.Clone(event).(*chat.CommittedConversationEvent)
	clone.EventHash = nil
	bytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(clone)
	if err != nil {
		return nil, fmt.Errorf("conversation: marshal transition event hash input: %w", err)
	}
	hash := sha256.Sum256(bytes)
	return hash[:], nil
}

func deterministicTransitionID(value string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(value)).String()
}

func persistTransitionDeliveries(
	ctx context.Context,
	repos TransitionRepositories,
	localStationID string,
	cmd *chat.ConversationCommand,
	conv *chat.Conversation,
	event *chat.CommittedConversationEvent,
	preDevices []MemberDevice,
	postMembers []*chat.ConversationMember,
	transition *chat.MembershipTransitionCommand,
	localDeliveries *[]*chat.DeviceInboxItem,
) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}
	eventRecipients := make(map[string]string, len(postMembers)+len(preDevices))
	for _, member := range postMembers {
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		eventRecipients[member.Ptid] = member.ActorHomeStationPeerId
	}
	for _, device := range preDevices {
		if device.Active {
			eventRecipients[device.Ptid] = device.HomeStationPeerID
		}
	}
	recipientPtids := make([]string, 0, len(eventRecipients))
	for ptid := range eventRecipients {
		recipientPtids = append(recipientPtids, ptid)
	}
	sort.Strings(recipientPtids)
	for _, ptid := range recipientPtids {
		env := transitionEnvelope(
			localStationID,
			cmd,
			conv,
			event,
			ptid,
			"",
			eventRecipients[ptid],
			"event",
			event.EventHash,
			chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			eventBytes,
		)
		if err := enqueueTransitionEnvelope(ctx, repos, localStationID, env, localDeliveries); err != nil {
			return err
		}
	}

	commitPayload, err := proto.Marshal(&chat.MlsTransitionDeliveryPayload{
		ConversationId:      conv.ConversationId,
		TransitionId:        transition.TransitionId,
		GroupSeq:            event.GroupSeq,
		FromMembershipEpoch: transition.FromMembershipEpoch,
		ToMembershipEpoch:   event.MembershipEpoch,
		FromMlsEpoch:        transition.FromMlsEpoch,
		ToMlsEpoch:          transition.ToMlsEpoch,
		Kind:                chat.MlsTransitionDeliveryKind_MLS_TRANSITION_DELIVERY_KIND_COMMIT,
		OpaqueMlsBytes:      transition.OpaqueMlsCommitBytes,
		PayloadSha256:       transition.CommitSha256,
	})
	if err != nil {
		return err
	}
	for _, device := range preDevices {
		if !device.Active ||
			(device.Ptid == cmd.SenderPtid && device.DeviceID == cmd.SenderDeviceId) {
			continue
		}
		env := transitionEnvelope(
			localStationID,
			cmd,
			conv,
			event,
			device.Ptid,
			device.DeviceID,
			device.HomeStationPeerID,
			"commit",
			transition.CommitSha256,
			chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY,
			commitPayload,
		)
		if err := enqueueTransitionEnvelope(ctx, repos, localStationID, env, localDeliveries); err != nil {
			return err
		}
	}

	for _, welcome := range transition.WelcomeDeliveries {
		payload, err := proto.Marshal(&chat.MlsTransitionDeliveryPayload{
			ConversationId:      conv.ConversationId,
			TransitionId:        transition.TransitionId,
			GroupSeq:            event.GroupSeq,
			FromMembershipEpoch: transition.FromMembershipEpoch,
			ToMembershipEpoch:   event.MembershipEpoch,
			FromMlsEpoch:        transition.FromMlsEpoch,
			ToMlsEpoch:          transition.ToMlsEpoch,
			Kind:                chat.MlsTransitionDeliveryKind_MLS_TRANSITION_DELIVERY_KIND_WELCOME,
			OpaqueMlsBytes:      welcome.OpaqueWelcomeBytes,
			PayloadSha256:       welcome.WelcomeSha256,
		})
		if err != nil {
			return err
		}
		env := transitionEnvelope(
			localStationID,
			cmd,
			conv,
			event,
			welcome.RecipientPtid,
			welcome.RecipientDeviceId,
			welcome.RecipientHomeStationPeerId,
			"welcome",
			welcome.WelcomeSha256,
			chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY,
			payload,
		)
		if err := enqueueTransitionEnvelope(ctx, repos, localStationID, env, localDeliveries); err != nil {
			return err
		}
	}
	return nil
}

func persistCreatedEventDeliveries(
	ctx context.Context,
	repos TransitionRepositories,
	localStationID string,
	conv *chat.Conversation,
	event *chat.CommittedConversationEvent,
	members []*chat.ConversationMember,
	localDeliveries *[]*chat.DeviceInboxItem,
) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}
	for _, member := range members {
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		key := "created:" + conv.ConversationId + ":" + member.Ptid
		env := &chat.StationEnvelope{
			EnvelopeId:                 deterministicTransitionID("envelope:" + key),
			ConversationId:             conv.ConversationId,
			SenderPtid:                 conv.OwnerPtid,
			SenderHomeStationPeerId:    localStationID,
			RecipientPtid:              member.Ptid,
			RecipientHomeStationPeerId: member.ActorHomeStationPeerId,
			IdempotencyKey:             key,
			MembershipEpoch:            0,
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			PayloadBytes:               eventBytes,
			IssuedAt:                   timestamppb.New(time.Now()),
			GroupSeq:                   event.GroupSeq,
			PayloadSha256:              event.EventHash,
			AuthorityStationPeerId:     localStationID,
			FederationId:               conv.FederationId,
			AuthorityEpoch:             conv.AuthorityEpoch,
		}
		if err := enqueueTransitionEnvelope(ctx, repos, localStationID, env, localDeliveries); err != nil {
			return err
		}
	}
	return nil
}

func transitionEnvelope(
	localStationID string,
	cmd *chat.ConversationCommand,
	conv *chat.Conversation,
	event *chat.CommittedConversationEvent,
	recipientPtid string,
	recipientDeviceID string,
	recipientStationID string,
	kind string,
	payloadHash []byte,
	payloadType chat.EnvelopePayloadType,
	payload []byte,
) *chat.StationEnvelope {
	key := event.GetMembershipTransitionCommitted().TransitionId + ":" + kind +
		":" + recipientPtid + ":" + recipientDeviceID + ":" + hex.EncodeToString(payloadHash)
	return &chat.StationEnvelope{
		EnvelopeId:                 deterministicTransitionID("envelope:" + key),
		ConversationId:             conv.ConversationId,
		SenderPtid:                 cmd.SenderPtid,
		SenderDeviceId:             cmd.SenderDeviceId,
		SenderHomeStationPeerId:    localStationID,
		RecipientPtid:              recipientPtid,
		RecipientDeviceId:          recipientDeviceID,
		RecipientHomeStationPeerId: recipientStationID,
		IdempotencyKey:             key,
		MembershipEpoch:            event.MembershipEpoch,
		PayloadType:                payloadType,
		PayloadBytes:               payload,
		IssuedAt:                   timestamppb.New(time.Now()),
		GroupSeq:                   event.GroupSeq,
		TransitionId:               event.GetMembershipTransitionCommitted().TransitionId,
		FromMembershipEpoch:        event.GetMembershipTransitionCommitted().FromMembershipEpoch,
		ToMembershipEpoch:          event.GetMembershipTransitionCommitted().ToMembershipEpoch,
		FromMlsEpoch:               event.GetMembershipTransitionCommitted().FromMlsEpoch,
		ToMlsEpoch:                 event.GetMembershipTransitionCommitted().ToMlsEpoch,
		PayloadSha256:              payloadHash,
		AuthorityStationPeerId:     localStationID,
		FederationId:               conv.FederationId,
		AuthorityEpoch:             conv.AuthorityEpoch,
	}
}

func enqueueTransitionEnvelope(
	ctx context.Context,
	repos TransitionRepositories,
	localStationID string,
	env *chat.StationEnvelope,
	localDeliveries *[]*chat.DeviceInboxItem,
) error {
	if env.RecipientHomeStationPeerId == "" ||
		env.RecipientHomeStationPeerId == localStationID {
		item := &chat.DeviceInboxItem{
			InboxItemId:       deterministicTransitionID("inbox:" + env.IdempotencyKey),
			RecipientPtid:     env.RecipientPtid,
			RecipientDeviceId: env.RecipientDeviceId,
			Envelope:          env,
		}
		_, err := repos.Envelope.EnqueueInbox(ctx, item)
		if err == nil && localDeliveries != nil {
			*localDeliveries = append(*localDeliveries, item)
		}
		return err
	}
	_, err := repos.Envelope.EnqueueOutbox(ctx, &chat.OutboxItem{
		OutboxItemId:        deterministicTransitionID("outbox:" + env.IdempotencyKey),
		TargetStationPeerId: env.RecipientHomeStationPeerId,
		Envelope:            env,
	})
	return err
}
