package application

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
)

type Repository interface {
	AutoMigrate() error
	UpsertIdentityKey(actorDID string, ikPub []byte, fingerprint string) error
	UpsertSignedPreKey(actorDID string, spk domain.SignedPreKey) error
	UploadOneTimePreKeys(actorDID string, keys []domain.OneTimePreKey) error
	FetchKeyBundle(actorDID string) (*domain.KeyBundle, error)
	CountAvailableOPKs(actorDID string) (int64, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) UploadKeyBundle(actorDID string, ikPub []byte, spkID int32, spkPub, spkSig []byte, opks []domain.OneTimePreKey) error {
	fingerprint := computeFingerprint(ikPub)
	if err := s.repo.UpsertIdentityKey(actorDID, ikPub, fingerprint); err != nil {
		return err
	}
	spk := domain.SignedPreKey{ID: spkID, PublicKey: spkPub, Signature: spkSig}
	if err := s.repo.UpsertSignedPreKey(actorDID, spk); err != nil {
		return err
	}
	if len(opks) > 0 {
		return s.repo.UploadOneTimePreKeys(actorDID, opks)
	}
	return nil
}

func (s *Service) FetchKeyBundle(actorDID string) (*domain.KeyBundle, error) {
	return s.repo.FetchKeyBundle(actorDID)
}

func (s *Service) ReplenishOPKs(actorDID string, keys []domain.OneTimePreKey) error {
	return s.repo.UploadOneTimePreKeys(actorDID, keys)
}

func (s *Service) CountOPKs(actorDID string) (int64, error) {
	return s.repo.CountAvailableOPKs(actorDID)
}

func computeFingerprint(ikPub []byte) string {
	h := sha256.Sum256(ikPub)
	return hex.EncodeToString(h[:])
}
