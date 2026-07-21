package domain

import (
	"context"
	"crypto/ed25519"
	"errors"
)

var ErrActorKeyNotFound = errors.New("actor signing key not found")

type ActorSigningKeyRecord struct {
	ActorID         string
	PublicKey       ed25519.PublicKey
	EncryptedPrivateKey []byte
}

type ActorSigningKeyRepository interface {
	Get(ctx context.Context, actorID string) (*ActorSigningKeyRecord, error)
	Store(ctx context.Context, record *ActorSigningKeyRecord) error
}

type ActorKeyService struct {
	repo ActorSigningKeyRepository
}

func NewActorKeyService(repo ActorSigningKeyRepository) *ActorKeyService {
	return &ActorKeyService{repo: repo}
}

func (s *ActorKeyService) GenerateKeyPair(ctx context.Context, actorID string) (ed25519.PublicKey, ed25519.PrivateKey, error) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		return nil, nil, err
	}

	record := &ActorSigningKeyRecord{
		ActorID:             actorID,
		PublicKey:           pub,
		EncryptedPrivateKey: priv.Seed(),
	}
	if err := s.repo.Store(ctx, record); err != nil {
		return nil, nil, err
	}
	return pub, priv, nil
}

func (s *ActorKeyService) GetPublicKey(ctx context.Context, actorID string) (ed25519.PublicKey, error) {
	record, err := s.repo.Get(ctx, actorID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, ErrActorKeyNotFound
	}
	return record.PublicKey, nil
}

func (s *ActorKeyService) GetPrivateKey(ctx context.Context, actorID string) (ed25519.PrivateKey, error) {
	record, err := s.repo.Get(ctx, actorID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, ErrActorKeyNotFound
	}
	return ed25519.NewKeyFromSeed(record.EncryptedPrivateKey), nil
}
