package secret

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
)

// ErrSecretNotFound is returned when no secret matches for the requesting actor.
// The same error is used for "exists but owned by another actor" so the API
// never reveals another actor's records.
var ErrSecretNotFound = errors.New("channel secret not found")

// SecretMeta is the actor-visible, non-secret projection of a stored credential.
type SecretMeta struct {
	ID        string
	Purpose   Purpose
	Name      string
	ExpiresAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Service stores and retrieves sealed credentials. It is the only component
// that binds a record to an actor; callers always supply the actor explicitly.
type Service struct {
	db  *gorm.DB
	kek KEKProvider
}

func NewService(db *gorm.DB, kek KEKProvider) *Service {
	if kek == nil {
		kek = NewEnvKEKProvider()
	}
	return &Service{db: db, kek: kek}
}

// PutInput carries a new secret value.
type PutInput struct {
	ActorPTID string
	Purpose   Purpose
	Name      string
	Plaintext []byte
	ExpiresAt *time.Time
}

// Put seals and stores a secret keyed by (actor, purpose, name). Re-putting
// the same key re-seals and updates the value.
func (s *Service) Put(_ context.Context, in PutInput) (string, error) {
	if err := validateBinding(in.ActorPTID, in.Purpose, in.Name); err != nil {
		return "", err
	}
	if len(in.Plaintext) == 0 {
		return "", fmt.Errorf("%w: empty secret value", ErrKEKInvalid)
	}

	existing := persistence.ChannelSecret{}
	lookup := s.db.Where(
		"actor_ptid = ? AND purpose = ? AND name = ?",
		in.ActorPTID, string(in.Purpose), in.Name,
	).Take(&existing)

	id := newID()
	if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
		env, err := Seal(s.kek, in.ActorPTID, in.Purpose, id, in.Plaintext)
		if err != nil {
			return "", err
		}
		now := time.Now().UTC()
		record := persistence.ChannelSecret{
			ID:         id,
			ActorPTID:  in.ActorPTID,
			Purpose:    string(in.Purpose),
			Name:       in.Name,
			WrappedDEK: env.WrappedDEK,
			Nonce:      env.Nonce,
			Ciphertext: env.Ciphertext,
			KEKVersion: env.KEKVersion,
			ExpiresAt:  in.ExpiresAt,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := s.db.Create(&record).Error; err != nil {
			return "", fmt.Errorf("persist secret: %w", err)
		}
		return id, nil
	}
	if lookup.Error != nil {
		return "", fmt.Errorf("lookup secret: %w", lookup.Error)
	}

	env, err := Seal(s.kek, in.ActorPTID, in.Purpose, existing.ID, in.Plaintext)
	if err != nil {
		return "", err
	}
	updates := map[string]interface{}{
		"wrapped_dek": env.WrappedDEK,
		"nonce":       env.Nonce,
		"ciphertext":  env.Ciphertext,
		"kek_version": env.KEKVersion,
		"expires_at":  in.ExpiresAt,
		"updated_at":  time.Now().UTC(),
	}
	if err := s.db.Model(&persistence.ChannelSecret{}).
		Where("id = ? AND actor_ptid = ?", existing.ID, in.ActorPTID).
		Updates(updates).Error; err != nil {
		return "", fmt.Errorf("update secret: %w", err)
	}
	return existing.ID, nil
}

// Get decrypts one secret owned by actorPTID.
func (s *Service) Get(_ context.Context, actorPTID string, purpose Purpose, id string) ([]byte, error) {
	if err := validateBinding(actorPTID, purpose, id); err != nil {
		return nil, err
	}
	record, err := s.load(actorPTID, string(purpose), id)
	if err != nil {
		return nil, err
	}
	plaintext, err := Open(
		s.kek, actorPTID, purpose, record.ID,
		Envelope{
			Version:    envelopeVersion,
			KEKVersion: record.KEKVersion,
			WrappedDEK: record.WrappedDEK,
			Nonce:      record.Nonce,
			Ciphertext: record.Ciphertext,
		},
	)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

// List returns non-secret metadata for one actor.
func (s *Service) List(_ context.Context, actorPTID string) ([]SecretMeta, error) {
	if strings.TrimSpace(actorPTID) == "" {
		return nil, fmt.Errorf("%w: empty actor", ErrKEKInvalid)
	}
	var records []persistence.ChannelSecret
	if err := s.db.
		Select("id", "purpose", "name", "expires_at", "created_at", "updated_at").
		Where("actor_ptid = ?", actorPTID).
		Order("created_at DESC").
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list secrets: %w", err)
	}
	metas := make([]SecretMeta, 0, len(records))
	for _, r := range records {
		metas = append(metas, SecretMeta{
			ID:        r.ID,
			Purpose:   Purpose(r.Purpose),
			Name:      r.Name,
			ExpiresAt: r.ExpiresAt,
			CreatedAt: r.CreatedAt,
			UpdatedAt: r.UpdatedAt,
		})
	}
	return metas, nil
}

// Delete removes one secret owned by actorPTID.
func (s *Service) Delete(_ context.Context, actorPTID string, purpose Purpose, id string) error {
	if err := validateBinding(actorPTID, purpose, id); err != nil {
		return err
	}
	res := s.db.
		Where("id = ? AND actor_ptid = ? AND purpose = ?", id, actorPTID, string(purpose)).
		Delete(&persistence.ChannelSecret{})
	if res.Error != nil {
		return fmt.Errorf("delete secret: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return ErrSecretNotFound
	}
	return nil
}

// RotateKEK re-wraps every secret for next. It is intended for operator-driven
// KEK rotation: each row is decrypted with the current provider and re-sealed
// with next. It processes rows in small batches and is safe to rerun; rows
// already at the target KEK version are left untouched.
func (s *Service) RotateKEK(ctx context.Context, next KEKProvider) (int, error) {
	if next == nil {
		return 0, fmt.Errorf("%w: nil target provider", ErrKEKInvalid)
	}
	_, targetVersion, err := next.KEK()
	if err != nil {
		return 0, err
	}

	const batchSize = 100
	rotated := 0
	for {
		var rows []persistence.ChannelSecret
		if err := s.db.
			Where("kek_version <> ?", targetVersion).
			Limit(batchSize).
			Find(&rows).Error; err != nil {
			return rotated, fmt.Errorf("load rotation batch: %w", err)
		}
		if len(rows) == 0 {
			return rotated, nil
		}
		for _, r := range rows {
			select {
			case <-ctx.Done():
				return rotated, ctx.Err()
			default:
			}
			purpose := Purpose(r.Purpose)
			plaintext, err := Open(
				s.kek, r.ActorPTID, purpose, r.ID,
				Envelope{
					Version:    envelopeVersion,
					KEKVersion: r.KEKVersion,
					WrappedDEK: r.WrappedDEK,
					Nonce:      r.Nonce,
					Ciphertext: r.Ciphertext,
				},
			)
			if err != nil {
				return rotated, fmt.Errorf("open secret %s during rotation: %w", r.ID, err)
			}
			env, err := Seal(next, r.ActorPTID, purpose, r.ID, plaintext)
			if err != nil {
				return rotated, fmt.Errorf("reseal secret %s: %w", r.ID, err)
			}
			err = s.db.Model(&persistence.ChannelSecret{}).
				Where("id = ?", r.ID).
				Updates(map[string]interface{}{
					"wrapped_dek": env.WrappedDEK,
					"nonce":       env.Nonce,
					"ciphertext":  env.Ciphertext,
					"kek_version": env.KEKVersion,
					"updated_at":  time.Now().UTC(),
				}).Error
			if err != nil {
				return rotated, fmt.Errorf("persist rotated secret %s: %w", r.ID, err)
			}
			rotated++
		}
		if len(rows) < batchSize {
			return rotated, nil
		}
	}
}

func (s *Service) load(actorPTID, purpose, id string) (*persistence.ChannelSecret, error) {
	record := &persistence.ChannelSecret{}
	err := s.db.
		Where("id = ? AND actor_ptid = ? AND purpose = ?", id, actorPTID, purpose).
		Take(record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSecretNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load secret: %w", err)
	}
	return record, nil
}

func validateBinding(actorPTID string, purpose Purpose, key string) error {
	if strings.TrimSpace(actorPTID) == "" {
		return fmt.Errorf("%w: empty actor", ErrKEKInvalid)
	}
	switch purpose {
	case PurposeChannel, PurposeChannelRequesterOAuth, PurposeAgentRuntime:
	default:
		return fmt.Errorf("%w: unknown purpose %q", ErrKEKInvalid, purpose)
	}
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("%w: empty key", ErrKEKInvalid)
	}
	return nil
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
