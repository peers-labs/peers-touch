package application

import (
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
)

const DefaultLeaseTTL = 90 * time.Second

type Repository interface {
	AutoMigrate() error
	Heartbeat(actorID, sessionID string, now, expiresAt time.Time) (bool, domain.Status, error)
	Offline(actorID, sessionID string, now time.Time) (bool, domain.Status, error)
	Expire(now time.Time) ([]string, error)
	IsOnline(actorID string, now time.Time) (bool, error)
	ListAudience(actorID string) ([]string, error)
	Query(actorIDs []string, now time.Time) ([]domain.Status, error)
}

type Publisher interface {
	PublishPresence(actorID string, online bool, recipients []string)
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

func (s *Service) Heartbeat(actorID, sessionID string) (domain.Status, error) {
	now := s.now().UTC()
	changed, status, err := s.repo.Heartbeat(actorID, sessionID, now, now.Add(s.leaseTTL))
	if err != nil {
		return domain.Status{}, err
	}
	if changed {
		s.publish(actorID, true)
	}
	return status, nil
}

func (s *Service) Offline(actorID, sessionID string) (domain.Status, error) {
	now := s.now().UTC()
	changed, status, err := s.repo.Offline(actorID, sessionID, now)
	if err != nil {
		return domain.Status{}, err
	}
	if changed {
		s.publish(actorID, false)
	}
	return status, nil
}

func (s *Service) Expire() error {
	actorIDs, err := s.repo.Expire(s.now().UTC())
	if err != nil {
		return err
	}
	for _, actorID := range actorIDs {
		s.publish(actorID, false)
	}
	return nil
}

func (s *Service) IsOnline(actorID string) bool {
	online, err := s.repo.IsOnline(actorID, s.now().UTC())
	return err == nil && online
}

func (s *Service) Query(actorIDs []string) ([]domain.Status, error) {
	return s.repo.Query(actorIDs, s.now().UTC())
}

func (s *Service) publish(actorID string, online bool) {
	if s.publisher == nil {
		return
	}
	recipients, err := s.repo.ListAudience(actorID)
	if err != nil {
		return
	}
	s.publisher.PublishPresence(actorID, online, recipients)
}
