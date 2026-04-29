package application

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
)

type Repository interface {
	AutoMigrate() error
	UpsertIdentityKey(actorDID, deviceID string, ikPub []byte, fingerprint string, publishedAtUnixMs int64) error
	UpsertSignedPreKey(actorDID, deviceID string, spk domain.SignedPreKey) error
	UploadOneTimePreKeys(actorDID, deviceID string, keys []domain.OneTimePreKey) error
	FetchKeyBundles(actorDID, filterDeviceID string) ([]domain.KeyBundle, error)
	CountAvailableOPKs(actorDID, deviceID string) (int64, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) UploadKeyBundle(actorDID, deviceID string, ikPub []byte, spkID int32, spkPub, spkSig []byte, opks []domain.OneTimePreKey) error {
	fingerprint := computeFingerprint(ikPub)
	publishedAt := time.Now().UnixMilli()
	if err := s.repo.UpsertIdentityKey(actorDID, deviceID, ikPub, fingerprint, publishedAt); err != nil {
		return err
	}
	spk := domain.SignedPreKey{ID: spkID, PublicKey: spkPub, Signature: spkSig}
	if err := s.repo.UpsertSignedPreKey(actorDID, deviceID, spk); err != nil {
		return err
	}
	if len(opks) > 0 {
		return s.repo.UploadOneTimePreKeys(actorDID, deviceID, opks)
	}
	return nil
}

func (s *Service) FetchKeyBundles(actorDID, filterDeviceID string) ([]domain.KeyBundle, error) {
	return s.repo.FetchKeyBundles(actorDID, filterDeviceID)
}

func (s *Service) ReplenishOPKs(actorDID, deviceID string, keys []domain.OneTimePreKey) error {
	return s.repo.UploadOneTimePreKeys(actorDID, deviceID, keys)
}

func (s *Service) CountOPKs(actorDID, deviceID string) (int64, error) {
	return s.repo.CountAvailableOPKs(actorDID, deviceID)
}

func computeFingerprint(ikPub []byte) string {
	h := sha256.Sum256(ikPub)
	return hex.EncodeToString(h[:])
}
