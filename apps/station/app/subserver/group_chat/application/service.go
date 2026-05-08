package application

import (
	"errors"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
)

type Repository interface {
	CreateGroup(ownerDID, name, description string) domain.Group
	ListGroups() []domain.Group
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
	RemoveMember(groupID, actorDID string) bool
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
	UpdateSettings(groupID, actorDID string, muted, pinned, showNickname *bool)
	GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage
	AckOffline(ulids []string)
	Stats() (int32, int32, int64, int32)
}

type Service struct {
	repo           Repository
	mutationWindow time.Duration
}

var (
	ErrGroupNotFound        = errors.New("group not found")
	ErrMemberNotFound       = errors.New("member not found")
	ErrNotMember            = errors.New("not a member")
	ErrPermissionDenied     = errors.New("permission denied")
	ErrInvalidInvitation    = errors.New("invalid invitation")
	ErrOwnerCannotLeave     = errors.New("owner cannot leave group")
	ErrCannotRemoveOwner    = errors.New("cannot remove owner")
	ErrMessageNotFound      = errors.New("message not found")
	ErrMutationWindowClosed = errors.New("mutation window closed")
	ErrAlreadyRecalled      = errors.New("message already recalled")
	ErrEmptyEdit            = errors.New("edit must include new_content or new_encrypted_payload")
)

// DefaultMutationWindow mirrors friend_chat's. Same default 5m
// recall / edit window. Operator-tunable via SetMutationWindow.
const DefaultMutationWindow = 5 * time.Minute

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

func (s *Service) ListGroups() []domain.Group {
	return s.repo.ListGroups()
}

func (s *Service) SendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message {
	return s.repo.SendMessage(groupID, senderDID, messageType, content, replyToID, threadRootID, attachments, encryptedPayload)
}

func (s *Service) ListMessages(groupID, beforeUlid string, limit int) ([]domain.Message, error) {
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

func (s *Service) RemoveMember(groupID, actorDID string) bool {
	return s.repo.RemoveMember(groupID, actorDID)
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

func (s *Service) UpdateSettings(groupID, actorDID string, muted, pinned, showNickname *bool) {
	s.repo.UpdateSettings(groupID, actorDID, muted, pinned, showNickname)
}

func (s *Service) GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage {
	return s.repo.GetOfflineMessages(actorDID, limit)
}

func (s *Service) AckOffline(ulids []string) {
	s.repo.AckOffline(ulids)
}

func (s *Service) Stats() (int32, int32, int64, int32) {
	return s.repo.Stats()
}

func (s *Service) UpdateGroupByActor(actorDID, groupID string, name, description *string, muted *bool) (*domain.Group, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return nil, ErrNotMember
	}
	if member.Role != 1 && member.Role != 2 {
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
	out := make([]domain.Invitation, 0, len(inviteeDIDs))
	for _, invitee := range inviteeDIDs {
		out = append(out, s.repo.CreateInvitation(groupID, actorDID, invitee))
	}
	return out, nil
}

func (s *Service) JoinByActor(actorDID, groupID, invitationULID string) (*domain.Member, error) {
	if invitationULID != "" {
		invGroupID, ok := s.repo.AcceptInvitation(invitationULID, actorDID)
		if !ok || invGroupID != groupID {
			return nil, ErrInvalidInvitation
		}
	}
	member, ok := s.repo.AddMember(groupID, actorDID, "")
	if !ok {
		return nil, ErrGroupNotFound
	}
	return member, nil
}

func (s *Service) LeaveByActor(actorDID, groupID string) error {
	if member, ok := s.repo.GetMember(groupID, actorDID); ok && member.Role == 1 {
		return ErrOwnerCannotLeave
	}
	if !s.repo.RemoveMember(groupID, actorDID) {
		return ErrNotMember
	}
	return nil
}

func (s *Service) RemoveMemberByActor(actorDID, groupID, targetDID string) error {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok || (member.Role != 1 && member.Role != 2) {
		return ErrPermissionDenied
	}
	if target, ok := s.repo.GetMember(groupID, targetDID); ok && target.Role == 1 {
		return ErrCannotRemoveOwner
	}
	if !s.repo.RemoveMember(groupID, targetDID) {
		return ErrMemberNotFound
	}
	return nil
}

// RecallMessageByActor enforces the membership gate; the repo
// enforces the per-message sender-ownership + window gates.
// Returns the MutationOutcome so the handler can fan out a
// realtime MessageMutation event to every other group member.
func (s *Service) RecallMessageByActor(actorDID, groupID, messageID string) (domain.MutationOutcome, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return domain.MutationOutcome{}, ErrNotMember
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
// admin / owner (Role ∈ {1,2} per `groupModel`) to hard-delete
// the row. The repo currently enforces sender-ownership; admin
// override happens here at the application layer.
func (s *Service) DeleteMessageByActor(actorDID, groupID, messageID string) (domain.MutationOutcome, error) {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok {
		return domain.MutationOutcome{}, ErrNotMember
	}
	isAdmin := member.Role == 1 || member.Role == 2
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
