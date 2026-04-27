package application

import (
	"errors"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
)

type Repository interface {
	GetSession(sessionID string) (*domain.Session, error)
	GetOrCreateSession(actorDID, participantDID string) (*domain.Session, bool, error)
	ListSessions(actorDID string, limit, offset int) ([]domain.Session, int, error)
	AppendMessage(message domain.Message) (domain.Message, error)
	ListMessages(sessionID, beforeUlid string, limit int) ([]domain.Message, error)
	SearchMessages(actorDID, query, sessionUlid string, limit, offset int) ([]domain.Message, int, error)
	LoadAttachments(messageULID string) ([]domain.Attachment, error)
	MarkRead(actorDID string, messageIDs []string, status int32) ([]domain.AckedMessage, error)
	RecallMessage(actorDID, sessionULID, messageULID string, recallWindow time.Duration) (domain.MutationOutcome, error)
	EditMessage(actorDID, sessionULID, messageULID, newContent string, newCiphertext []byte, editWindow time.Duration) (domain.MutationOutcome, error)
	DeleteMessage(actorDID, sessionULID, messageULID string) (domain.MutationOutcome, error)
	CreateFriendRequest(senderDID, receiverDID, message string) (domain.FriendRequest, error)
	GetFriendRequest(requestID string) (*domain.FriendRequest, error)
	AcceptFriendRequest(requestID string) (*domain.FriendRequest, *domain.Session, error)
	RejectFriendRequest(requestID string) (*domain.FriendRequest, error)
	ListFriendRequests(actorDID string, status int32, limit, offset int) ([]domain.FriendRequest, int, error)
}

type Service struct {
	repo           Repository
	notifier       NotificationProducer
	mutationWindow time.Duration
}

var (
	ErrSessionNotFound       = errors.New("session not found")
	ErrNotParticipant        = errors.New("actor not in session")
	ErrInvalidReceiver       = errors.New("invalid receiver")
	ErrPermissionDenied      = errors.New("permission denied")
	ErrMessageNotFound       = errors.New("message not found")
	ErrMutationWindowClosed  = errors.New("mutation window closed")
	ErrAlreadyRecalled       = errors.New("message already recalled")
	ErrEmptyEdit             = errors.New("edit must include new_content or new_encrypted_payload")
	ErrAlreadyFriends        = errors.New("already friends")
	ErrRequestNotFound       = errors.New("friend request not found")
	ErrNotRequestTarget      = errors.New("only the receiver can accept or reject a friend request")
)

// MutationWindow is the operator-tunable maximum age (since
// `sent_at`) at which a friend message is still recall- / edit-able.
// We keep it in the application layer rather than the infrastructure
// layer because this is a product-policy knob, not a storage knob,
// and the handler / service decide whether to enforce it (e.g.
// future "moderation override" paths might bypass it). 5 minutes
// matches WeChat / Telegram-style "recall within a few minutes"
// semantics; if your product wants longer or shorter, set it via
// `(*Service).SetMutationWindow` at boot.
const DefaultMutationWindow = 5 * time.Minute

// NotificationProducer decouples notification creation from the notification SubServer.
// Avoids import cycle: friend_chat → notification.
type NotificationProducer interface {
	Produce(recipientID, actorID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, notifier: nil, mutationWindow: DefaultMutationWindow}
}

func (s *Service) SetNotifier(n NotificationProducer) {
	s.notifier = n
}

// SetMutationWindow lets the bootstrap layer override the default
// recall / edit window. A zero or negative value disables the
// window check entirely (only sender-ownership applies).
func (s *Service) SetMutationWindow(window time.Duration) {
	s.mutationWindow = window
}

func (s *Service) GetOrCreateSession(actorDID, participantDID string) (*domain.Session, bool, error) {
	return s.repo.GetOrCreateSession(actorDID, participantDID)
}

func (s *Service) ListSessions(actorDID string, limit, offset int) ([]domain.Session, int, error) {
	return s.repo.ListSessions(actorDID, limit, offset)
}

func (s *Service) SendMessage(sessionID, senderDID, receiverDID string, messageType int32, content, replyToID string, attachments []domain.Attachment, encryptedPayload []byte, clientULID string) (domain.Message, error) {
	return s.repo.AppendMessage(domain.Message{
		ID:               clientULID,
		SessionID:        sessionID,
		SenderDID:        senderDID,
		ReceiverDID:      receiverDID,
		Type:             messageType,
		Content:          content,
		EncryptedPayload: append([]byte(nil), encryptedPayload...),
		ReplyToID:        replyToID,
		Status:           2,
		Attachments:      attachments,
	})
}

func (s *Service) ListMessages(sessionID, beforeUlid string, limit int) ([]domain.Message, error) {
	return s.repo.ListMessages(sessionID, beforeUlid, limit)
}

// AckMessages flips the status flag on a batch of messages owned by
// actorDID and returns the per-message metadata the handler uses to
// fan out realtime MessageReceipt events.
//
// The slice is exactly the rows the receiver legitimately owned and
// whose status was strictly forward-progressed (see repo.MarkRead);
// the handler can publish without re-validating ownership.
func (s *Service) AckMessages(actorDID string, messageIDs []string, status int32) ([]domain.AckedMessage, error) {
	return s.repo.MarkRead(actorDID, messageIDs, status)
}

// RecallMessageByActor enforces the session-membership gate (the
// repo enforces the per-message sender-ownership gate) and then
// delegates to the repository. Errors are translated from the repo's
// sentinel set into the service-level sentinels so the HTTP handler
// has a stable error contract.
func (s *Service) RecallMessageByActor(actorDID, sessionID, messageULID string) (domain.MutationOutcome, error) {
	session, err := s.repo.GetSession(sessionID)
	if err != nil || session == nil {
		return domain.MutationOutcome{}, ErrSessionNotFound
	}
	if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
		return domain.MutationOutcome{}, ErrNotParticipant
	}
	out, err := s.repo.RecallMessage(actorDID, sessionID, messageULID, s.mutationWindow)
	if err != nil {
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// EditMessageByActor accepts both the plaintext replacement and the
// encrypted payload — the repo persists whichever is provided, and
// the realtime fan-out forwards both, since Station can't know which
// one the receiver will need (the chat may not yet be E2EE-keyed).
//
// At least one of `newContent` or `newCiphertext` MUST be non-empty;
// an "edit to nothing" path must use Recall instead.
func (s *Service) EditMessageByActor(actorDID, sessionID, messageULID, newContent string, newCiphertext []byte) (domain.MutationOutcome, error) {
	session, err := s.repo.GetSession(sessionID)
	if err != nil || session == nil {
		return domain.MutationOutcome{}, ErrSessionNotFound
	}
	if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
		return domain.MutationOutcome{}, ErrNotParticipant
	}
	if strings.TrimSpace(newContent) == "" && len(newCiphertext) == 0 {
		return domain.MutationOutcome{}, ErrEmptyEdit
	}
	out, err := s.repo.EditMessage(actorDID, sessionID, messageULID, newContent, newCiphertext, s.mutationWindow)
	if err != nil {
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// DeleteMessageByActor enforces the same membership + ownership gate
// as recall; the repo also clears the parent session's
// last_message_* pointer when the deleted ulid was the head.
func (s *Service) DeleteMessageByActor(actorDID, sessionID, messageULID string) (domain.MutationOutcome, error) {
	session, err := s.repo.GetSession(sessionID)
	if err != nil || session == nil {
		return domain.MutationOutcome{}, ErrSessionNotFound
	}
	if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
		return domain.MutationOutcome{}, ErrNotParticipant
	}
	out, err := s.repo.DeleteMessage(actorDID, sessionID, messageULID)
	if err != nil {
		return domain.MutationOutcome{}, mapMutationError(err)
	}
	return out, nil
}

// mapMutationError translates the repo's exported error sentinels
// onto the service-level sentinels. We keep the indirection so the
// repo can grow new internal errors (e.g. transient DB failures)
// without leaking them through the service contract.
func mapMutationError(err error) error {
	switch err.Error() {
	case "friend message not found":
		return ErrMessageNotFound
	case "not message owner":
		// Map to NotFound at the boundary — see the repo's
		// ErrPermissionDenied doc-comment for the rationale.
		return ErrMessageNotFound
	case "mutation window closed":
		return ErrMutationWindowClosed
	case "message already recalled":
		return ErrAlreadyRecalled
	default:
		return err
	}
}

func (s *Service) SendMessageByActor(actorDID, sessionID, receiverDID string, messageType int32, content, replyToID string, attachments []domain.Attachment, encryptedPayload []byte, clientULID string) (domain.Message, error) {
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
	return s.SendMessage(sessionID, actorDID, receiverDID, messageType, content, replyToID, attachments, encryptedPayload, clientULID)
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

func (s *Service) SearchMessagesByActor(actorDID, query, sessionUlid string, limit, offset int) ([]domain.Message, int, error) {
	if strings.TrimSpace(query) == "" {
		return []domain.Message{}, 0, nil
	}
	if sessionUlid != "" {
		session, err := s.repo.GetSession(sessionUlid)
		if err != nil || session == nil {
			return nil, 0, ErrSessionNotFound
		}
		if actorDID != session.ParticipantADID && actorDID != session.ParticipantBDID {
			return nil, 0, ErrNotParticipant
		}
	}
	return s.repo.SearchMessages(actorDID, query, sessionUlid, limit, offset)
}

func (s *Service) SyncMessagesByActor(actorDID string, messages []domain.Message) (int32, []string) {
	synced := int32(0)
	failed := make([]string, 0)
	for _, item := range messages {
		_, err := s.SendMessageByActor(actorDID, item.SessionID, item.ReceiverDID, item.Type, item.Content, item.ReplyToID, item.Attachments, item.EncryptedPayload, item.ID)
		if err != nil {
			failed = append(failed, item.ID)
			continue
		}
		synced++
	}
	return synced, failed
}

// ============================================================================
// Friend Request Lifecycle
// ============================================================================

func (s *Service) SendFriendRequest(senderDID, receiverDID, message string) (domain.FriendRequest, error) {
	if senderDID == receiverDID {
		return domain.FriendRequest{}, errors.New("cannot send friend request to yourself")
	}

	fr, err := s.repo.CreateFriendRequest(senderDID, receiverDID, message)
	if err != nil {
		if err.Error() == "already friends" {
			return domain.FriendRequest{}, ErrAlreadyFriends
		}
		return domain.FriendRequest{}, err
	}

	// Produce notification: FRIEND_REQUEST (type=200, category=CHAT=2)
	if s.notifier != nil {
		_ = s.notifier.Produce(
			receiverDID, senderDID,
			200, 2,
			"friend_request", fr.ID,
			"Friend Request", message,
			"friend_request:"+senderDID,
			map[string]string{"request_id": fr.ID},
		)
	}

	return fr, nil
}

func (s *Service) AcceptFriendRequest(actorDID, requestID string) (*domain.FriendRequest, *domain.Session, error) {
	existing, err := s.repo.GetFriendRequest(requestID)
	if err != nil {
		return nil, nil, ErrRequestNotFound
	}
	if existing.ReceiverDID != actorDID {
		return nil, nil, ErrNotRequestTarget
	}

	fr, session, err := s.repo.AcceptFriendRequest(requestID)
	if err != nil {
		return nil, nil, err
	}

	// Produce notification: FRIEND_ACCEPTED (type=201, category=CHAT=2)
	if s.notifier != nil {
		_ = s.notifier.Produce(
			fr.SenderDID, actorDID,
			201, 2,
			"friend_request", fr.ID,
			"Friend Request Accepted", actorDID+" accepted your friend request",
			"friend_accepted:"+actorDID,
			map[string]string{"request_id": fr.ID, "session_id": session.ID},
		)
	}

	return fr, session, nil
}

func (s *Service) RejectFriendRequest(actorDID, requestID string) (*domain.FriendRequest, error) {
	existing, err := s.repo.GetFriendRequest(requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if existing.ReceiverDID != actorDID {
		return nil, ErrNotRequestTarget
	}
	return s.repo.RejectFriendRequest(requestID)
}

func (s *Service) ListFriendRequests(actorDID string, status int32, limit, offset int) ([]domain.FriendRequest, int, error) {
	return s.repo.ListFriendRequests(actorDID, status, limit, offset)
}
