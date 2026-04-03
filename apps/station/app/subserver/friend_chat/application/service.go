package application

import (
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
)

type Repository interface {
	GetSession(sessionID string) (*domain.Session, error)
	GetOrCreateSession(actorDID, participantDID string) (*domain.Session, bool, error)
	ListSessions(actorDID string, limit, offset int) ([]domain.Session, int, error)
	AppendMessage(message domain.Message) (domain.Message, error)
	ListMessages(sessionID, beforeUlid string, limit int) ([]domain.Message, error)
	MarkRead(actorDID string, messageIDs []string, status int32) error
}

type Service struct {
	repo Repository
}

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrNotParticipant   = errors.New("actor not in session")
	ErrInvalidReceiver  = errors.New("invalid receiver")
	ErrPermissionDenied = errors.New("permission denied")
)

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetOrCreateSession(actorDID, participantDID string) (*domain.Session, bool, error) {
	return s.repo.GetOrCreateSession(actorDID, participantDID)
}

func (s *Service) ListSessions(actorDID string, limit, offset int) ([]domain.Session, int, error) {
	return s.repo.ListSessions(actorDID, limit, offset)
}

func (s *Service) SendMessage(sessionID, senderDID, receiverDID string, messageType int32, content, replyToID string) (domain.Message, error) {
	return s.repo.AppendMessage(domain.Message{
		SessionID:   sessionID,
		SenderDID:   senderDID,
		ReceiverDID: receiverDID,
		Type:        messageType,
		Content:     content,
		ReplyToID:   replyToID,
		Status:      2,
	})
}

func (s *Service) ListMessages(sessionID, beforeUlid string, limit int) ([]domain.Message, error) {
	return s.repo.ListMessages(sessionID, beforeUlid, limit)
}

func (s *Service) AckMessages(actorDID string, messageIDs []string, status int32) error {
	return s.repo.MarkRead(actorDID, messageIDs, status)
}

func (s *Service) SendMessageByActor(actorDID, sessionID, receiverDID string, messageType int32, content, replyToID string) (domain.Message, error) {
	session, err := s.repo.GetSession(sessionID)
	if err != nil || session == nil {
		return domain.Message{}, ErrSessionNotFound
	}
	if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
		return domain.Message{}, ErrNotParticipant
	}
	expectedReceiver := session.ParticipantADID
	if actorDID == session.ParticipantADID {
		expectedReceiver = session.ParticipantBDID
	}
	if receiverDID != expectedReceiver {
		return domain.Message{}, ErrInvalidReceiver
	}
	return s.SendMessage(sessionID, actorDID, receiverDID, messageType, content, replyToID)
}

func (s *Service) ListMessagesByActor(actorDID, sessionID, beforeUlid string, limit int) ([]domain.Message, error) {
	session, err := s.repo.GetSession(sessionID)
	if err != nil || session == nil {
		return nil, ErrSessionNotFound
	}
	if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
		return nil, ErrNotParticipant
	}
	return s.ListMessages(sessionID, beforeUlid, limit)
}

func (s *Service) SyncMessagesByActor(actorDID string, messages []domain.Message) (int32, []string) {
	synced := int32(0)
	failed := make([]string, 0)
	for _, item := range messages {
		_, err := s.SendMessageByActor(actorDID, item.SessionID, item.ReceiverDID, item.Type, item.Content, item.ReplyToID)
		if err != nil {
			failed = append(failed, item.ID)
			continue
		}
		synced++
	}
	return synced, failed
}
