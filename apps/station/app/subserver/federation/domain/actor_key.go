package domain

import (
	"context"
	"crypto/ed25519"
	"errors"
)

var ErrActorKeyNotFound = errors.New("actor signing key not found")

type ActorSigningKeyRecord struct {
	ActorPTID           string
	PublicKey           ed25519.PublicKey
	EncryptedPrivateKey []byte
}

type ActorSigningKeyRepository interface {
	Get(ctx context.Context, actorPTID string) (*ActorSigningKeyRecord, error)
	Store(ctx context.Context, record *ActorSigningKeyRecord) error
}

type ActorKeyService struct {
	repo ActorSigningKeyRepository
}

func NewActorKeyService(repo ActorSigningKeyRepository) *ActorKeyService {
	return &ActorKeyService{repo: repo}
}

func (s *ActorKeyService) GenerateKeyPair(ctx context.Context, actorPTID string) (ed25519.PublicKey, ed25519.PrivateKey, error) {
	existing, err := s.repo.Get(ctx, actorPTID)
	if err != nil {
		return nil, nil, err
	}
	if existing != nil {
		return keyPairFromRecord(existing)
	}

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		return nil, nil, err
	}

	record := &ActorSigningKeyRecord{
		ActorPTID:           actorPTID,
		PublicKey:           pub,
		EncryptedPrivateKey: priv.Seed(),
	}
	if err := s.repo.Store(ctx, record); err != nil {
		return nil, nil, err
	}
	stored, err := s.repo.Get(ctx, actorPTID)
	if err != nil {
		return nil, nil, err
	}
	if stored == nil {
		return nil, nil, ErrActorKeyNotFound
	}
	return keyPairFromRecord(stored)
}

func (s *ActorKeyService) GetPublicKey(ctx context.Context, actorPTID string) (ed25519.PublicKey, error) {
	record, err := s.repo.Get(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, ErrActorKeyNotFound
	}
	return record.PublicKey, nil
}

func (s *ActorKeyService) GetPrivateKey(ctx context.Context, actorPTID string) (ed25519.PrivateKey, error) {
	record, err := s.repo.Get(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, ErrActorKeyNotFound
	}
	return ed25519.NewKeyFromSeed(record.EncryptedPrivateKey), nil
}

func keyPairFromRecord(
	record *ActorSigningKeyRecord,
) (ed25519.PublicKey, ed25519.PrivateKey, error) {
	if record == nil ||
		len(record.PublicKey) != ed25519.PublicKeySize ||
		len(record.EncryptedPrivateKey) != ed25519.SeedSize {
		return nil, nil, ErrActorKeyNotFound
	}
	return append(ed25519.PublicKey(nil), record.PublicKey...),
		ed25519.NewKeyFromSeed(record.EncryptedPrivateKey),
		nil
}
