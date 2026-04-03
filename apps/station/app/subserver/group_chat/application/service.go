package application

import (
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
)

type Repository interface {
	CreateGroup(ownerDID, name, description string) domain.Group
	ListGroups() []domain.Group
	SendMessage(groupID, senderDID string, messageType int32, content, replyToID string) domain.Message
	ListMessages(groupID, beforeUlid string, limit int) []domain.Message
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
	RecallMessage(messageID string) bool
	DeleteMessage(messageID string) bool
	SearchMessages(groupID, query string, limit int) []domain.Message
	UpdateNickname(groupID, actorDID, nickname string) (*domain.Member, bool)
	GetSettings(groupID, actorDID string) domain.GroupSetting
	UpdateSettings(groupID, actorDID string, muted, pinned, showNickname *bool)
	GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage
	AckOffline(ulids []string)
	Stats() (int32, int32, int64, int32)
}

type Service struct {
	repo Repository
}

var (
	ErrGroupNotFound   = errors.New("group not found")
	ErrMemberNotFound  = errors.New("member not found")
	ErrNotMember       = errors.New("not a member")
	ErrPermissionDenied = errors.New("permission denied")
	ErrInvalidInvitation = errors.New("invalid invitation")
	ErrOwnerCannotLeave = errors.New("owner cannot leave group")
	ErrCannotRemoveOwner = errors.New("cannot remove owner")
	ErrMessageNotFound = errors.New("message not found")
)

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) CreateGroup(ownerDID, name, description string) domain.Group {
	return s.repo.CreateGroup(ownerDID, name, description)
}

func (s *Service) ListGroups() []domain.Group {
	return s.repo.ListGroups()
}

func (s *Service) SendMessage(groupID, senderDID string, messageType int32, content, replyToID string) domain.Message {
	return s.repo.SendMessage(groupID, senderDID, messageType, content, replyToID)
}

func (s *Service) ListMessages(groupID, beforeUlid string, limit int) []domain.Message {
	return s.repo.ListMessages(groupID, beforeUlid, limit)
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

func (s *Service) RecallMessage(messageID string) bool {
	return s.repo.RecallMessage(messageID)
}

func (s *Service) DeleteMessage(messageID string) bool {
	return s.repo.DeleteMessage(messageID)
}

func (s *Service) SearchMessages(groupID, query string, limit int) []domain.Message {
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

func (s *Service) RecallMessageByActor(actorDID, groupID, messageID string) error {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return ErrNotMember
	}
	if !s.repo.RecallMessage(messageID) {
		return ErrMessageNotFound
	}
	return nil
}

func (s *Service) DeleteMessageByActor(actorDID, groupID, messageID string) error {
	member, ok := s.repo.GetMember(groupID, actorDID)
	if !ok || (member.Role != 1 && member.Role != 2) {
		return ErrPermissionDenied
	}
	if !s.repo.DeleteMessage(messageID) {
		return ErrMessageNotFound
	}
	return nil
}

func (s *Service) SearchMessagesByActor(actorDID, groupID, query string, limit int) ([]domain.Message, error) {
	if _, ok := s.repo.GetMember(groupID, actorDID); !ok {
		return nil, ErrNotMember
	}
	return s.repo.SearchMessages(groupID, query, limit), nil
}
