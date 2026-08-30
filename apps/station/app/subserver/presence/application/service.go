package application

import (
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
)

const DefaultLeaseTTL = 90 * time.Second

type Repository interface {
	AutoMigrate() error
	Heartbeat(actorPTID, sessionID string, now, expiresAt time.Time) (bool, domain.Status, error)
	Offline(actorPTID, sessionID string, now time.Time) (bool, domain.Status, error)
	Expire(now time.Time) ([]string, error)
	IsOnline(actorPTID string, now time.Time) (bool, error)
	ListAudience(actorPTID string) ([]string, error)
	Query(actorPTIDs []string, now time.Time) ([]domain.Status, error)
}

type Publisher interface {
	PublishPresence(actorPTID string, online bool, recipients []string)
}

type Service struct {
	repo      Repository
	publisher Publisher
	leaseTTL  time.Duration
	now       func() time.Time
}

func NewService(repo Repository, publisher Publisher) *Service {
	return &Service{
		repo:      repo,
		publisher: publisher,
		leaseTTL:  DefaultLeaseTTL,
		now:       time.Now,
	}
}

func (s *Service) Heartbeat(actorPTID, sessionID string) (domain.Status, error) {
	now := s.now().UTC()
	changed, status, err := s.repo.Heartbeat(actorPTID, sessionID, now, now.Add(s.leaseTTL))
	if err != nil {
		return domain.Status{}, err
	}
	if changed {
		s.publish(actorPTID, true)
	}
	return status, nil
}

func (s *Service) Offline(actorPTID, sessionID string) (domain.Status, error) {
	now := s.now().UTC()
	changed, status, err := s.repo.Offline(actorPTID, sessionID, now)
	if err != nil {
		return domain.Status{}, err
	}
	if changed {
		s.publish(actorPTID, false)
	}
	return status, nil
}

func (s *Service) Expire() error {
	actorPTIDs, err := s.repo.Expire(s.now().UTC())
	if err != nil {
		return err
	}
	for _, actorPTID := range actorPTIDs {
		s.publish(actorPTID, false)
	}
	return nil
}

func (s *Service) IsOnline(actorPTID string) bool {
	online, err := s.repo.IsOnline(actorPTID, s.now().UTC())
	return err == nil && online
}

func (s *Service) Query(actorPTIDs []string) ([]domain.Status, error) {
	return s.repo.Query(actorPTIDs, s.now().UTC())
}

func (s *Service) publish(actorPTID string, online bool) {
	if s.publisher == nil {
		return
	}
	recipients, err := s.repo.ListAudience(actorPTID)
	if err != nil {
		return
	}
	s.publisher.PublishPresence(actorPTID, online, recipients)
}
