package application

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type Repository interface {
	Create(n domain.Notification) (domain.Notification, error)
	List(recipientID string, category, status int32, cursor string, limit int) ([]domain.Notification, error)
	CountByRecipient(recipientID string, category, status int32) (int, error)
	MarkRead(recipientID string, notifIDs []string) (int, error)
	MarkAllRead(recipientID string, category int32) (int, error)
	Delete(recipientID string, notifIDs []string) (int, error)
	GetUnreadCounts(recipientID string) (domain.UnreadCounts, error)
	GetPreferences(actorID string) ([]domain.NotificationPreference, error)
	GetPreference(actorID string, category int32) (*domain.NotificationPreference, error)
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
func (s *Service) Produce(recipientID, actorID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) (*domain.Notification, error) {
	if recipientID == actorID {
		return nil, nil
	}

	pref, err := s.repo.GetPreference(recipientID, category)
	if err != nil {
		logger.Error(nil, "notification: failed to check preference", "recipientID", recipientID, "error", err)
	}
	if pref != nil && !pref.Enabled {
		return nil, nil
	}

	n := domain.Notification{
		RecipientID: recipientID,
		ActorID:     actorID,
		Type:        notifType,
		Category:    category,
		Status:      domain.StatusUnread,
		TargetType:  targetType,
		TargetID:    targetID,
		Title:       title,
		Body:        body,
		GroupKey:     groupKey,
		Metadata:    metadata,
	}

	created, err := s.repo.Create(n)
	if err != nil {
		return nil, err
	}

	logger.Info(nil, "notification: produced",
		"id", created.ID,
		"recipient", recipientID,
		"type", notifType,
		"category", category,
	)

	return &created, nil
}

func (s *Service) List(recipientID string, category, status int32, cursor string, limit int) ([]domain.Notification, int, int, error) {
	items, err := s.repo.List(recipientID, category, status, cursor, limit)
	if err != nil {
		return nil, 0, 0, err
	}
	totalCount, err := s.repo.CountByRecipient(recipientID, category, 0)
	if err != nil {
		return nil, 0, 0, err
	}
	unreadCount, err := s.repo.CountByRecipient(recipientID, category, domain.StatusUnread)
	if err != nil {
		return nil, 0, 0, err
	}
	return items, totalCount, unreadCount, nil
}

func (s *Service) MarkRead(recipientID string, notifIDs []string) (int, error) {
	return s.repo.MarkRead(recipientID, notifIDs)
}

func (s *Service) MarkAllRead(recipientID string, category int32) (int, error) {
	return s.repo.MarkAllRead(recipientID, category)
}

func (s *Service) Delete(recipientID string, notifIDs []string) (int, error) {
	return s.repo.Delete(recipientID, notifIDs)
}

func (s *Service) GetUnreadCounts(recipientID string) (domain.UnreadCounts, error) {
	return s.repo.GetUnreadCounts(recipientID)
}

func (s *Service) GetPreferences(actorID string) ([]domain.NotificationPreference, error) {
	return s.repo.GetPreferences(actorID)
}

func (s *Service) UpsertPreference(pref domain.NotificationPreference) (domain.NotificationPreference, error) {
	return s.repo.UpsertPreference(pref)
}
