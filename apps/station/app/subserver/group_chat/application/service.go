package application

import (
	"errors"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type Repository interface {
	CreateGroup(ownerDID, name, description string) domain.Group
	ListGroups(actorDID string) []domain.Group
	SendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message
	ListMessages(groupID, beforeUlid string, limit int) ([]domain.Message, error)
	ListThreadMessages(groupID, rootUlid, afterUlid string, limit int) ([]domain.Message, error)
	ThreadCounts(groupID, actorDID string, rootULIDs []string) ([]domain.ThreadCount, error)
	MarkThreadRead(actorDID, groupID, rootULID, lastReadULID string) error
	UnreadCount(actorDID, groupID string) int64
	MarkRead(actorDID, groupID string) (int64, int64)
	GetGroup(groupID string) (*domain.Group, bool)
	GetMember(groupID, actorDID string) (*domain.Member, bool)
	AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool)
	AddFederatedMember(groupID string, actor domain.FederatedActorRef, inviterDID string) (*domain.Member, bool)
	UpdateMember(groupID, actorDID string, role *int32, muted *bool, mutedUntil *time.Time) (*domain.Member, bool)
	RemoveMember(groupID, actorDID string) bool
	TransferOwnership(groupID, currentOwnerDID, nextOwnerDID string) (*domain.Group, bool)
	DissolveGroup(groupID string) bool
	AcceptProposal(proposal domain.GroupProposal) (domain.GroupEvent, bool, error)
	EnqueueProposalOutbox(proposal domain.GroupProposal) (domain.GroupProposalOutboxItem, bool, error)
	EnqueueGroupSkdmOutbox(envelope domain.GroupSkdmEnvelope) (domain.GroupSkdmEnvelope, bool, error)
	ApplyFederationEvent(event domain.GroupEvent) (domain.FollowerProjection, error)
	ListAuthorityEventsAfter(groupID string, afterSeq int64, limit int) ([]domain.GroupEvent, error)
	GetAuthorityEventCursor(groupID string) (int64, string, error)
	MaterializeFollowerProjection(group domain.Group, members []domain.Member, messages []domain.Message) error
	UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool)
	ListMembers(groupID string, limit, offset int) ([]domain.Member, int)
	CreateInvitation(groupID, inviterDID, inviteeDID string) domain.Invitation
	AcceptInvitation(invitationID, actorDID string) (string, bool)
	// Mutation methods. Each returns a `MutationOutcome` carrying
	// the metadata the application/handler layers need to fan out
	// a `realtime.MessageMutation` event onto every group member's
	// SSE stream. The repo is responsible for enforcing
	// sender-ownership (the caller DID must be the row's
	// SenderDID) and the operator-tunable mutation window. On any
	// of the failure modes the repo returns one of the exported
	// sentinels below.
	RecallMessage(actorDID, groupID, messageULID string, recallWindow time.Duration) (domain.MutationOutcome, error)
	EditMessage(actorDID, groupID, messageULID, newContent string, newCiphertext []byte, editWindow time.Duration) (domain.MutationOutcome, error)
	DeleteMessage(actorDID, groupID, messageULID string) (domain.MutationOutcome, error)
	SearchMessages(groupID, query string, limit int) ([]domain.Message, error)
	UpdateNickname(groupID, actorDID, nickname string) (*domain.Member, bool)
	GetSettings(groupID, actorDID string) domain.GroupSetting
	UpdateSettings(groupID, actorDID string, muted, pinned, showNickname, alertEnabled *bool, background *string, clearedAtUnixMs *int64)
	GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage
	AckOffline(actorDID string, ulids []string)
	Stats() (int32, int32, int64, int32)
}

type Service struct {
	repo           Repository
	mutationWindow time.Duration
}

type AuthorityProjection struct {
	Group             domain.Group
	Members           []domain.Member
	MemberTotal       int
	Messages          []domain.Message
	HasMoreMessages   bool
	NextMessageCursor string
	AuthorityEpoch    int64
	LastEventSeq      int64
	LastEventHash     string
}

var (
	ErrGroupNotFound         = errors.New("group not found")
	ErrMemberNotFound        = errors.New("member not found")
	ErrNotMember             = errors.New("not a member")
	ErrPermissionDenied      = errors.New("permission denied")
	ErrGroupDissolved        = errors.New("group is dissolved")
	ErrMembershipEpochStale  = errors.New("membership epoch stale")
	ErrInvalidInvitation     = errors.New("invalid invitation")
	ErrOwnerCannotLeave      = errors.New("owner cannot leave group")
	ErrCannotRemoveOwner     = errors.New("cannot remove owner")
	ErrInvalidRole           = errors.New("invalid role")
	ErrInvalidOwnerTransfer  = errors.New("invalid owner transfer")
	ErrMemberMuted           = errors.New("member is muted")
	ErrMessageNotFound       = errors.New("message not found")
	ErrMutationWindowClosed  = errors.New("mutation window closed")
	ErrAlreadyRecalled       = errors.New("message already recalled")
	ErrEmptyEdit             = errors.New("edit must include new_content or new_encrypted_payload")
	ErrInvalidProposal       = errors.New("invalid group proposal")
	ErrProposalConflict      = errors.New("group proposal conflict")
	ErrInvalidGroupEvent     = errors.New("invalid group event")
	ErrFollowerReadOnly      = errors.New("follower projection is read-only")
	ErrInvalidSkdmEnvelope   = errors.New("invalid group skdm envelope")
	ErrInvalidFederatedActor = errors.New("invalid federated actor")
)

// DefaultMutationWindow mirrors friend_chat's. Same default 5m
// recall / edit window. Operator-tunable via SetMutationWindow.
const DefaultMutationWindow = 5 * time.Minute

func canManageGroup(role int32) bool {
	return role >= domain.GroupRoleAdmin
}

func isOwner(role int32) bool {
	return role == domain.GroupRoleOwner
}

func isAssignableRole(role int32) bool {
	return role == domain.GroupRoleMember || role == domain.GroupRoleAdmin
}

func isMemberMuted(member *domain.Member, now time.Time) bool {
	if member == nil {
		return false
	}
	if member.MutedUntil.After(now) {
		return true
	}
	return member.Muted && member.MutedUntil.IsZero()
}

func (s *Service) ensureGroupWritable(groupID string) error {
	group, ok := s.repo.GetGroup(groupID)
	if !ok {
		return ErrGroupNotFound
	}
	if group.Status == domain.GroupStatusDissolved {
		return ErrGroupDissolved
	}
	return nil
}

func (s *Service) ensureMembershipEpochCurrent(groupID string, observedEpoch int64) error {
	group, ok := s.repo.GetGroup(groupID)
	if !ok {
		return ErrGroupNotFound
	}
	if observedEpoch != group.MembershipEpoch {
		return ErrMembershipEpochStale
	}
	return nil
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, mutationWindow: DefaultMutationWindow}
}

// SetMutationWindow overrides the default recall / edit window.
// A zero or negative value disables the window check entirely
// (only sender-ownership applies). Mirrors the friend_chat knob.
func (s *Service) SetMutationWindow(window time.Duration) {
	s.mutationWindow = window
}

func (s *Service) CreateGroup(ownerDID, name, description string) domain.Group {
	return s.repo.CreateGroup(ownerDID, name, description)
}

func (s *Service) ListGroups(actorDID string) []domain.Group {
	return s.repo.ListGroups(actorDID)
}

func (s *Service) SendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message {
	return s.repo.SendMessage(groupID, senderDID, messageType, content, replyToID, threadRootID, attachments, encryptedPayload)
}

func (s *Service) SendMessageByActor(actorDID, groupID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte, observedMembershipEpoch int64) (domain.Message, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return domain.Message{}, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return domain.Message{}, err
	}
	if err := s.ensureMembershipEpochCurrent(groupID, observedMembershipEpoch); err != nil {
		return domain.Message{}, err
	}
	if isMemberMuted(member, time.Now()) {
		return domain.Message{}, ErrMemberMuted
	}
	return s.repo.SendMessage(groupID, actorDID, messageType, content, replyToID, threadRootID, attachments, encryptedPayload), nil
}

func (s *Service) ListMessages(groupID, beforeUlid string, limit int) ([]domain.Message, error) {
	return s.repo.ListMessages(groupID, beforeUlid, limit)
}

func (s *Service) ListMessagesByActor(actorDID, groupID, beforeUlid string, limit int) ([]domain.Message, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}
	return s.repo.ListMessages(groupID, beforeUlid, limit)
}

func (s *Service) ListThreadMessages(groupID, rootUlid, afterUlid string, limit int) ([]domain.Message, error) {
	return s.repo.ListThreadMessages(groupID, rootUlid, afterUlid, limit)
}

func (s *Service) ThreadCountsByActor(actorDID, groupID string, rootULIDs []string) ([]domain.ThreadCount, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}

	return s.repo.ThreadCounts(groupID, actorDID, rootULIDs)
}

func (s *Service) MarkThreadReadByActor(actorDID, groupID, rootULID, lastReadULID string) error {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return ErrNotMember
	}
	if err := s.repo.MarkThreadRead(actorDID, groupID, rootULID, lastReadULID); err != nil {
		return mapMutationError(err)
	}

	return nil
}

func (s *Service) UnreadCount(actorDID, groupID string) int64 {
	return s.repo.UnreadCount(actorDID, groupID)
}

func (s *Service) MarkRead(actorDID, groupID string) (int64, int64) {
	return s.repo.MarkRead(actorDID, groupID)
}

func (s *Service) GetGroup(groupID string) (*domain.Group, bool) {
	return s.repo.GetGroup(groupID)
}

func (s *Service) GetMember(groupID, actorDID string) (*domain.Member, bool) {
	return s.repo.GetMember(groupID, actorDID)
}

func (s *Service) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	return s.repo.AddMember(groupID, actorDID, inviterDID)
}

func (s *Service) AddFederatedMember(groupID string, actor domain.FederatedActorRef, inviterDID string) (*domain.Member, bool) {
	if strings.TrimSpace(actor.ActorDID) == "" || strings.TrimSpace(actor.HomeStationPeerID) == "" {
		return nil, false
	}
	return s.repo.AddFederatedMember(groupID, actor, inviterDID)
}

func (s *Service) AddFederatedMemberByActor(actorDID, groupID string, actor domain.FederatedActorRef) (*domain.Member, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return nil, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	if !canManageGroup(member.Role) {
		return nil, ErrPermissionDenied
	}
	if strings.TrimSpace(actor.ActorDID) == "" || strings.TrimSpace(actor.HomeStationPeerID) == "" {
		return nil, ErrInvalidFederatedActor
	}
	added, ok := s.repo.AddFederatedMember(groupID, actor, actorDID)
	if !ok || added == nil {
		return nil, ErrGroupNotFound
	}
	return added, nil
}

func (s *Service) UpdateMember(groupID, actorDID string, role *int32, muted *bool, mutedUntil *time.Time) (*domain.Member, bool) {
	return s.repo.UpdateMember(groupID, actorDID, role, muted, mutedUntil)
}

func (s *Service) RemoveMember(groupID, actorDID string) bool {
	return s.repo.RemoveMember(groupID, actorDID)
}

func (s *Service) TransferOwnership(groupID, currentOwnerDID, nextOwnerDID string) (*domain.Group, bool) {
	return s.repo.TransferOwnership(groupID, currentOwnerDID, nextOwnerDID)
}

func (s *Service) DissolveGroup(groupID string) bool {
	return s.repo.DissolveGroup(groupID)
}

func (s *Service) AcceptProposal(proposal domain.GroupProposal) (domain.GroupEvent, bool, error) {
	if strings.TrimSpace(proposal.ProposalULID) == "" ||
		strings.TrimSpace(proposal.GroupID) == "" ||
		strings.TrimSpace(proposal.Actor.ActorDID) == "" ||
		strings.TrimSpace(proposal.Actor.HomeStationPeerID) == "" ||
		proposal.Command == 0 ||
		strings.TrimSpace(proposal.SigningKeyID) == "" ||
		len(proposal.Signature) == 0 {
		return domain.GroupEvent{}, false, ErrInvalidProposal
	}
	if _, ok := s.repo.GetMember(proposal.GroupID, proposal.Actor.ActorDID); !ok {
		return domain.GroupEvent{}, false, ErrNotMember
	}
	if err := s.ensureGroupWritable(proposal.GroupID); err != nil {
		return domain.GroupEvent{}, false, err
	}
	if err := s.ensureMembershipEpochCurrent(proposal.GroupID, proposal.ObservedMembershipEpoch); err != nil {
		return domain.GroupEvent{}, false, err
	}
	event, replay, err := s.repo.AcceptProposal(proposal)
	if err != nil {
		if strings.Contains(err.Error(), "idempotency conflict") {
			return domain.GroupEvent{}, false, ErrProposalConflict
		}
		return domain.GroupEvent{}, false, err
	}
	return event, replay, nil
}

func (s *Service) EnqueueProposalOutbox(proposal domain.GroupProposal) (domain.GroupProposalOutboxItem, bool, error) {
	if strings.TrimSpace(proposal.ProposalULID) == "" ||
		strings.TrimSpace(proposal.GroupID) == "" ||
		strings.TrimSpace(proposal.Actor.ActorDID) == "" ||
		strings.TrimSpace(proposal.Actor.HomeStationPeerID) == "" ||
		proposal.Command == 0 ||
		strings.TrimSpace(proposal.AuthorityStationPeerID) == "" ||
		strings.TrimSpace(proposal.SigningKeyID) == "" ||
		len(proposal.Signature) == 0 {
		return domain.GroupProposalOutboxItem{}, false, ErrInvalidProposal
	}
	item, replay, err := s.repo.EnqueueProposalOutbox(proposal)
	if err != nil {
		if strings.Contains(err.Error(), "idempotency conflict") {
			return domain.GroupProposalOutboxItem{}, false, ErrProposalConflict
		}
		return domain.GroupProposalOutboxItem{}, false, err
	}
	return item, replay, nil
}

func (s *Service) ApplyFederationEvent(event domain.GroupEvent) (domain.FollowerProjection, error) {
	if strings.TrimSpace(event.EventULID) == "" ||
		strings.TrimSpace(event.GroupID) == "" ||
		event.Seq <= 0 ||
		strings.TrimSpace(event.EventHash) == "" ||
		strings.TrimSpace(event.EventType) == "" ||
		strings.TrimSpace(event.AuthorityStationPeerID) == "" {
		return domain.FollowerProjection{}, ErrInvalidGroupEvent
	}
	projection, err := s.repo.ApplyFederationEvent(event)
	if err != nil {
		if strings.Contains(err.Error(), "follower projection fork protection") {
			return projection, ErrFollowerReadOnly
		}
		return projection, err
	}
	return projection, nil
}

func (s *Service) SyncAuthorityProjection(groupID string, appliedSeq int64, appliedEventHash, beforeMessageULID string, memberLimit, memberOffset, messageLimit int) (AuthorityProjection, error) {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return AuthorityProjection{}, ErrGroupNotFound
	}
	group, ok := s.repo.GetGroup(groupID)
	if !ok {
		return AuthorityProjection{}, ErrGroupNotFound
	}
	lastSeq, lastHash, err := s.repo.GetAuthorityEventCursor(groupID)
	if err != nil {
		return AuthorityProjection{}, err
	}
	if appliedSeq != lastSeq || strings.TrimSpace(appliedEventHash) != lastHash {
		return AuthorityProjection{}, ErrInvalidGroupEvent
	}
	if memberLimit <= 0 || memberLimit > 500 {
		memberLimit = 500
	}
	if memberOffset < 0 {
		memberOffset = 0
	}
	members, memberTotal := s.repo.ListMembers(groupID, memberLimit, memberOffset)
	if messageLimit <= 0 || messageLimit > 100 {
		messageLimit = 50
	}
	messages, err := s.repo.ListMessages(groupID, beforeMessageULID, messageLimit+1)
	if err != nil {
		return AuthorityProjection{}, err
	}
	hasMore := len(messages) > messageLimit
	if hasMore {
		if strings.HasPrefix(beforeMessageULID, "since:") {
			messages = messages[:messageLimit]
		} else {
			messages = messages[1:]
		}
	}
	nextCursor := ""
	if hasMore && len(messages) > 0 {
		if strings.HasPrefix(beforeMessageULID, "since:") {
			nextCursor = messages[len(messages)-1].ID
		} else {
			nextCursor = messages[0].ID
		}
	}
	return AuthorityProjection{
		Group:             *group,
		Members:           members,
		MemberTotal:       memberTotal,
		Messages:          messages,
		HasMoreMessages:   hasMore,
		NextMessageCursor: nextCursor,
		AuthorityEpoch:    1,
		LastEventSeq:      lastSeq,
		LastEventHash:     lastHash,
	}, nil
}

func (s *Service) MaterializeFollowerProjection(group domain.Group, members []domain.Member, messages []domain.Message) error {
	if strings.TrimSpace(group.ID) == "" {
		return ErrGroupNotFound
	}
	for i := range messages {
		messages[i].GroupID = group.ID
		messages[i].Content = ""
	}
	return s.repo.MaterializeFollowerProjection(group, members, messages)
}

func (s *Service) EnqueueGroupSkdmOutbox(envelope domain.GroupSkdmEnvelope) (domain.GroupSkdmEnvelope, bool, error) {
	if strings.TrimSpace(envelope.GroupID) == "" ||
		strings.TrimSpace(envelope.SenderDID) == "" ||
		envelope.SenderKeyID == 0 ||
		strings.TrimSpace(envelope.RecipientDID) == "" ||
		strings.TrimSpace(envelope.RecipientDeviceID) == "" ||
		strings.TrimSpace(envelope.RecipientHomeStationPeerID) == "" ||
		envelope.MembershipEpoch <= 0 ||
		len(envelope.EncryptedPayload) == 0 {
		return domain.GroupSkdmEnvelope{}, false, ErrInvalidSkdmEnvelope
	}
	if _, ok := s.repo.GetMember(envelope.GroupID, envelope.SenderDID); !ok {
		return domain.GroupSkdmEnvelope{}, false, ErrNotMember
	}
	recipient, ok := s.repo.GetMember(envelope.GroupID, envelope.RecipientDID)
	if !ok {
		return domain.GroupSkdmEnvelope{}, false, ErrNotMember
	}
	if strings.TrimSpace(recipient.Actor.HomeStationPeerID) != "" &&
		recipient.Actor.HomeStationPeerID != envelope.RecipientHomeStationPeerID {
		return domain.GroupSkdmEnvelope{}, false, ErrInvalidSkdmEnvelope
	}
	if err := s.ensureMembershipEpochCurrent(envelope.GroupID, envelope.MembershipEpoch); err != nil {
		return domain.GroupSkdmEnvelope{}, false, err
	}
	var raw chat.SenderKeyDistributionMessage
	if err := proto.Unmarshal(envelope.EncryptedPayload, &raw); err == nil &&
		raw.GetGroupUlid() == envelope.GroupID &&
		raw.GetSenderDid() == envelope.SenderDID &&
		raw.GetSenderKeyId() == envelope.SenderKeyID &&
		len(raw.GetChainKey()) > 0 {
		return domain.GroupSkdmEnvelope{}, false, ErrInvalidSkdmEnvelope
	}
	item, replay, err := s.repo.EnqueueGroupSkdmOutbox(envelope)
	if err != nil {
		if strings.Contains(err.Error(), "idempotency conflict") {
			return domain.GroupSkdmEnvelope{}, false, ErrProposalConflict
		}
		return domain.GroupSkdmEnvelope{}, false, err
	}
	return item, replay, nil
}

func (s *Service) ListAuthorityEventsAfter(groupID string, afterSeq int64, limit int) ([]domain.GroupEvent, error) {
	if strings.TrimSpace(groupID) == "" || afterSeq < 0 {
		return nil, ErrInvalidGroupEvent
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if _, ok := s.repo.GetGroup(groupID); !ok {
		return nil, ErrGroupNotFound
	}
	return s.repo.ListAuthorityEventsAfter(groupID, afterSeq, limit)
}

func (s *Service) UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool) {
	return s.repo.UpdateGroup(groupID, name, description, muted)
}

func (s *Service) ListMembers(groupID string, limit, offset int) ([]domain.Member, int) {
	return s.repo.ListMembers(groupID, limit, offset)
}

func (s *Service) CreateInvitation(groupID, inviterDID, inviteeDID string) domain.Invitation {
	return s.repo.CreateInvitation(groupID, inviterDID, inviteeDID)
}

func (s *Service) AcceptInvitation(invitationID, actorDID string) (string, bool) {
	return s.repo.AcceptInvitation(invitationID, actorDID)
}

func (s *Service) SearchMessages(groupID, query string, limit int) ([]domain.Message, error) {
	return s.repo.SearchMessages(groupID, query, limit)
}

func (s *Service) UpdateNickname(groupID, actorDID, nickname string) (*domain.Member, bool) {
	return s.repo.UpdateNickname(groupID, actorDID, nickname)
}

func (s *Service) GetSettings(groupID, actorDID string) domain.GroupSetting {
	return s.repo.GetSettings(groupID, actorDID)
}

func (s *Service) UpdateSettings(groupID, actorDID string, muted, pinned, showNickname, alertEnabled *bool, background *string, clearedAtUnixMs *int64) {
	s.repo.UpdateSettings(groupID, actorDID, muted, pinned, showNickname, alertEnabled, background, clearedAtUnixMs)
}

func (s *Service) GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage {
	return s.repo.GetOfflineMessages(actorDID, limit)
}

func (s *Service) AckOffline(actorDID string, ulids []string) {
	s.repo.AckOffline(actorDID, ulids)
}

func (s *Service) Stats() (int32, int32, int64, int32) {
	return s.repo.Stats()
}

func (s *Service) UpdateGroupByActor(actorDID, groupID string, name, description *string, muted *bool) (*domain.Group, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return nil, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	if !canManageGroup(member.Role) {
		return nil, ErrPermissionDenied
	}
	item, ok := s.repo.UpdateGroup(groupID, name, description, muted)
	if !ok {
		return nil, ErrGroupNotFound
	}
	return item, nil
}

func (s *Service) InviteByActor(actorDID, groupID string, inviteeDIDs []string) ([]domain.Invitation, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	out := make([]domain.Invitation, 0, len(inviteeDIDs))
	for _, invitee := range inviteeDIDs {
		out = append(out, s.repo.CreateInvitation(groupID, actorDID, invitee))
	}
	return out, nil
}

func (s *Service) JoinByActor(actorDID, groupID, invitationULID string) (*domain.Member, error) {
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(invitationULID) == "" {
		return nil, ErrInvalidInvitation
	}
	invGroupID, ok := s.repo.AcceptInvitation(invitationULID, actorDID)
	if !ok || invGroupID != groupID {
		return nil, ErrInvalidInvitation
	}
	member, ok := s.repo.AddMember(groupID, actorDID, "")
	if !ok {
		return nil, ErrGroupNotFound
	}
	return member, nil
}

func (s *Service) LeaveByActor(actorDID, groupID string) error {
	if err := s.ensureGroupWritable(groupID); err != nil {
		return err
	}
	if member, ok := s.repo.GetMember(groupID, actorDID); ok && isOwner(member.Role) {
		return ErrOwnerCannotLeave
	}
	if !s.repo.RemoveMember(groupID, actorDID) {
		return ErrNotMember
	}
	return nil
}

func (s *Service) TransferOwnershipByActor(actorDID, groupID, nextOwnerDID string) (*domain.Group, error) {
	operator, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return nil, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	if !isOwner(operator.Role) {
		return nil, ErrPermissionDenied
	}
	if actorDID == nextOwnerDID || strings.TrimSpace(nextOwnerDID) == "" {
		return nil, ErrInvalidOwnerTransfer
	}
	target, ok := s.repo.GetMember(groupID, nextOwnerDID)
	if !ok {
		return nil, ErrMemberNotFound
	}
	if isOwner(target.Role) {
		return nil, ErrInvalidOwnerTransfer
	}
	group, ok := s.repo.TransferOwnership(groupID, actorDID, nextOwnerDID)
	if !ok {
		return nil, ErrGroupNotFound
	}
	return group, nil
}

func (s *Service) DissolveGroupByActor(actorDID, groupID string) error {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return ErrNotMember
	}
	if !isOwner(member.Role) {
		return ErrPermissionDenied
	}
	if !s.repo.DissolveGroup(groupID) {
		return ErrGroupNotFound
	}
	return nil
}

func (s *Service) RemoveMemberByActor(actorDID, groupID, targetDID string) error {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok || !canManageGroup(member.Role) {
		return ErrPermissionDenied
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return err
	}
	target, ok := s.repo.GetMember(groupID, targetDID)
	if !ok {
		return ErrMemberNotFound
	}
	if isOwner(target.Role) {
		return ErrCannotRemoveOwner
	}
	if !isOwner(member.Role) && target.Role >= member.Role {
		return ErrPermissionDenied
	}
	if !s.repo.RemoveMember(groupID, targetDID) {
		return ErrMemberNotFound
	}
	return nil
}

func (s *Service) UpdateMemberByActor(actorDID, groupID, targetDID string, role *int32, muted *bool, mutedUntil *time.Time) (*domain.Member, error) {
	operator, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return nil, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return nil, err
	}
	if !canManageGroup(operator.Role) {
		return nil, ErrPermissionDenied
	}
	target, ok := s.repo.GetMember(groupID, targetDID)
	if !ok {
		return nil, ErrMemberNotFound
	}
	if isOwner(target.Role) {
		return nil, ErrCannotRemoveOwner
	}
	if role != nil && !isAssignableRole(*role) {
		return nil, ErrInvalidRole
	}
	if !isOwner(operator.Role) {
		if role != nil || target.Role >= operator.Role {
			return nil, ErrPermissionDenied
		}
	}
	member, ok := s.repo.UpdateMember(groupID, targetDID, role, muted, mutedUntil)
	if !ok {
		return nil, ErrMemberNotFound
	}
	return member, nil
}

// RecallMessageByActor enforces the membership gate; the repo
// enforces the per-message sender-ownership + window gates.
// Returns the MutationOutcome so the handler can fan out a
// realtime MessageMutation event to every other group member.
func (s *Service) RecallMessageByActor(actorDID, groupID, messageID string) (domain.MutationOutcome, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return domain.MutationOutcome{}, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return domain.MutationOutcome{}, err
	}
	out, err := s.repo.RecallMessage(actorDID, groupID, messageID, s.mutationWindow)
	if err != nil {
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// EditMessageByActor — same gating as recall, plus
// "at least one of new_content / new_ciphertext is non-empty".
func (s *Service) EditMessageByActor(actorDID, groupID, messageID, newContent string, newCiphertext []byte) (domain.MutationOutcome, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return domain.MutationOutcome{}, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return domain.MutationOutcome{}, err
	}
	if strings.TrimSpace(newContent) == "" && len(newCiphertext) == 0 {
		return domain.MutationOutcome{}, ErrEmptyEdit
	}
	out, err := s.repo.EditMessage(actorDID, groupID, messageID, newContent, newCiphertext, s.mutationWindow)
	if err != nil {
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// DeleteMessageByActor allows the original sender OR a group
// admin / owner to hard-delete
// the row. The repo currently enforces sender-ownership; admin
// override happens here at the application layer.
func (s *Service) DeleteMessageByActor(actorDID, groupID, messageID string) (domain.MutationOutcome, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return domain.MutationOutcome{}, ErrNotMember
	}
	if err := s.ensureGroupWritable(groupID); err != nil {
		return domain.MutationOutcome{}, err
	}
	isAdmin := canManageGroup(member.Role)
	out, err := s.repo.DeleteMessage(actorDID, groupID, messageID)
	if err != nil {
		// Admin / owner override: if the only reason the repo
		// refused was "not the sender", retry with the sender's
		// DID resolved from the row. The repo provides no
		// "force delete" today; the cleanest way to express
		// this without leaking moderation logic into the repo
		// is the application-layer fallback below. (We do
		// require the row to actually exist; ErrMessageNotFound
		// is returned verbatim regardless of role.)
		if isAdmin && err.Error() == "not message owner" {
			// Look up the row to get its real sender, then
			// re-issue under that DID. The repo will accept
			// this because it only checks "actorDID == row.SenderDID".
			outForce, ferr := s.deleteAsAdmin(groupID, messageID)
			if ferr == nil {
				return outForce, nil
			}
			return domain.MutationOutcome{}, mapMutationError(ferr)
		}
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// deleteAsAdmin walks around the repo's sender-ownership check
// for the admin / owner moderation path. Implemented here rather
// than in the repo so the repo's sender-ownership invariant stays
// uniform — moderation is a policy decision and policy lives in
// the application layer. The implementation requires the
// Repository to also expose `GetMessageSender` so we can resolve
// the original sender DID without loading the whole row.
func (s *Service) deleteAsAdmin(groupID, messageID string) (domain.MutationOutcome, error) {
	type messageSenderResolver interface {
		GetMessageSender(groupID, messageULID string) (string, bool)
	}
	resolver, ok := s.repo.(messageSenderResolver)
	if !ok {
		return domain.MutationOutcome{}, ErrPermissionDenied
	}
	senderDID, found := resolver.GetMessageSender(groupID, messageID)
	if !found {
		return domain.MutationOutcome{}, ErrMessageNotFound
	}
	return s.repo.DeleteMessage(senderDID, groupID, messageID)
}

// mapMutationError translates the repo's error sentinels onto the
// service-level sentinels. We keep the indirection so the repo can
// grow new internal errors without leaking them through the
// service contract.
func mapMutationError(err error) error {
	switch err.Error() {
	case "group message not found":
		return ErrMessageNotFound
	case "not message owner":
		// Collapse onto NotFound at the boundary — see the
		// friend_chat doc-comment for the same rationale.
		return ErrMessageNotFound
	case "mutation window closed":
		return ErrMutationWindowClosed
	case "message already recalled":
		return ErrAlreadyRecalled
	default:
		return err
	}
}

func (s *Service) SearchMessagesByActor(actorDID, groupID, query string, limit int) ([]domain.Message, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}
	return s.repo.SearchMessages(groupID, query, limit)
}

func (s *Service) ListThreadMessagesByActor(actorDID, groupID, rootUlid, afterUlid string, limit int) ([]domain.Message, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}
	return s.repo.ListThreadMessages(groupID, rootUlid, afterUlid, limit)
}
