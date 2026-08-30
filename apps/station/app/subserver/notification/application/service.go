package application

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type Repository interface {
	Create(n domain.Notification) (domain.Notification, error)
	List(recipientPTID string, category, status int32, cursor string, limit int) ([]domain.Notification, error)
	CountByRecipient(recipientPTID string, category, status int32) (int, error)
	MarkRead(recipientPTID string, notifIDs []string) (int, error)
	MarkAllRead(recipientPTID string, category int32) (int, error)
	Delete(recipientPTID string, notifIDs []string) (int, error)
	GetUnreadCounts(recipientPTID string) (domain.UnreadCounts, error)
	GetPreferences(actorPTID string) ([]domain.NotificationPreference, error)
	GetPreference(actorPTID string, category int32) (*domain.NotificationPreference, error)
	UpsertPreference(pref domain.NotificationPreference) (domain.NotificationPreference, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Produce creates a notification from a domain event.
// Self-notification guard: actor cannot notify themselves.
// Preference check: skip if the recipient has disabled notifications for this category.
func (s *Service) Produce(recipientPTID, actorPTID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) (*domain.Notification, error) {
	if recipientPTID == actorPTID {
		return nil, nil
	}

	pref, err := s.repo.GetPreference(recipientPTID, category)
	if err != nil {
		logger.Error(nil, "notification: failed to check preference", "recipient_ptid", recipientPTID, "error", err)
	}
	if pref != nil && !pref.Enabled {
		return nil, nil
	}

	n := domain.Notification{
		RecipientPTID: recipientPTID,
		ActorPTID:     actorPTID,
		Type:          notifType,
		Category:      category,
		Status:        domain.StatusUnread,
		TargetType:    targetType,
		TargetID:      targetID,
		Title:         title,
		Body:          body,
		GroupKey:      groupKey,
		Metadata:      metadata,
	}

	created, err := s.repo.Create(n)
	if err != nil {
		return nil, err
	}

	logger.Info(nil, "notification: produced",
		"id", created.ID,
		"recipient_ptid", recipientPTID,
		"type", notifType,
		"category", category,
	)

	return &created, nil
}

func (s *Service) List(recipientPTID string, category, status int32, cursor string, limit int) ([]domain.Notification, int, int, error) {
	items, err := s.repo.List(recipientPTID, category, status, cursor, limit)
	if err != nil {
		return nil, 0, 0, err
	}
	totalCount, err := s.repo.CountByRecipient(recipientPTID, category, 0)
	if err != nil {
		return nil, 0, 0, err
	}
	unreadCount, err := s.repo.CountByRecipient(recipientPTID, category, domain.StatusUnread)
	if err != nil {
		return nil, 0, 0, err
	}
	return items, totalCount, unreadCount, nil
}

func (s *Service) MarkRead(recipientPTID string, notifIDs []string) (int, error) {
	return s.repo.MarkRead(recipientPTID, notifIDs)
}

func (s *Service) MarkAllRead(recipientPTID string, category int32) (int, error) {
	return s.repo.MarkAllRead(recipientPTID, category)
}

func (s *Service) Delete(recipientPTID string, notifIDs []string) (int, error) {
	return s.repo.Delete(recipientPTID, notifIDs)
}

func (s *Service) GetUnreadCounts(recipientPTID string) (domain.UnreadCounts, error) {
	return s.repo.GetUnreadCounts(recipientPTID)
}

func (s *Service) GetPreferences(actorPTID string) ([]domain.NotificationPreference, error) {
	return s.repo.GetPreferences(actorPTID)
}

func (s *Service) UpsertPreference(pref domain.NotificationPreference) (domain.NotificationPreference, error) {
	return s.repo.UpsertPreference(pref)
}
