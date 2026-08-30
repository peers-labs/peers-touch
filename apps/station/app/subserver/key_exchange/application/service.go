package application

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
)

type Repository interface {
	AutoMigrate() error
	UpsertIdentityKey(actorPTID, deviceID string, ikPub []byte, fingerprint string, publishedAtUnixMs int64, supportedVersions []uint32) error
	UpsertSignedPreKey(actorPTID, deviceID string, spk domain.SignedPreKey) error
	UploadOneTimePreKeys(actorPTID, deviceID string, keys []domain.OneTimePreKey) error
	FetchKeyBundles(actorPTID, filterDeviceID string) ([]domain.KeyBundle, error)
	CountAvailableOPKs(actorPTID, deviceID string) (int64, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) UploadKeyBundle(actorPTID, deviceID string, ikPub []byte, spkID int32, spkPub, spkSig []byte, opks []domain.OneTimePreKey, supportedVersions []uint32) error {
	fingerprint := computeFingerprint(ikPub)
	publishedAt := time.Now().UnixMilli()
	if err := s.repo.UpsertIdentityKey(actorPTID, deviceID, ikPub, fingerprint, publishedAt, normalizeSupportedVersions(supportedVersions)); err != nil {
		return err
	}
	spk := domain.SignedPreKey{ID: spkID, PublicKey: spkPub, Signature: spkSig}
	if err := s.repo.UpsertSignedPreKey(actorPTID, deviceID, spk); err != nil {
		return err
	}
	if len(opks) > 0 {
		return s.repo.UploadOneTimePreKeys(actorPTID, deviceID, opks)
	}
	return nil
}

func normalizeSupportedVersions(input []uint32) []uint32 {
	if len(input) == 0 {
		return []uint32{0}
	}
	seen := make(map[uint32]struct{}, len(input))
	out := make([]uint32, 0, len(input))
	for _, version := range input {
		if version > 1 {
			continue
		}
		if _, ok := seen[version]; ok {
			continue
		}
		seen[version] = struct{}{}
		out = append(out, version)
	}
	if len(out) == 0 {
		return []uint32{0}
	}
	return out
}

func (s *Service) FetchKeyBundles(actorPTID, filterDeviceID string) ([]domain.KeyBundle, error) {
	return s.repo.FetchKeyBundles(actorPTID, filterDeviceID)
}

func (s *Service) ReplenishOPKs(actorPTID, deviceID string, keys []domain.OneTimePreKey) error {
	return s.repo.UploadOneTimePreKeys(actorPTID, deviceID, keys)
}

func (s *Service) CountOPKs(actorPTID, deviceID string) (int64, error) {
	return s.repo.CountAvailableOPKs(actorPTID, deviceID)
}

func computeFingerprint(ikPub []byte) string {
	h := sha256.Sum256(ikPub)
	return hex.EncodeToString(h[:])
}
