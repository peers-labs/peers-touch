package infrastructure

import (
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/gorm"
)

type IdentityKeyModel struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	ActorDID       string    `gorm:"column:actor_did;size:255;uniqueIndex"`
	IdentityKeyPub []byte    `gorm:"column:identity_key_pub;type:bytea"`
	KeyFingerprint string    `gorm:"column:key_fingerprint;size:128"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
}

func (IdentityKeyModel) TableName() string { return "key_exchange_identity_keys" }

type SignedPreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorDID  string    `gorm:"column:actor_did;size:255;uniqueIndex"`
	SPKID     int32     `gorm:"column:spk_id"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Signature []byte    `gorm:"column:signature;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (SignedPreKeyModel) TableName() string { return "key_exchange_signed_pre_keys" }

type OneTimePreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorDID  string    `gorm:"column:actor_did;size:255;uniqueIndex:idx_ke_opk_actor_opkid;index:idx_ke_opk_actor_consumed"`
	OPKID     int32     `gorm:"column:opk_id;uniqueIndex:idx_ke_opk_actor_opkid"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Consumed  bool      `gorm:"column:consumed;default:false;index:idx_ke_opk_actor_consumed"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (OneTimePreKeyModel) TableName() string { return "key_exchange_one_time_pre_keys" }

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.AutoMigrate(&IdentityKeyModel{}, &SignedPreKeyModel{}, &OneTimePreKeyModel{})
}

func (r *GormRepo) UpsertIdentityKey(actorDID string, ikPub []byte, fingerprint string) error {
	now := time.Now()
	var existing IdentityKeyModel
	err := r.db.Where("actor_did = ?", actorDID).Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(&IdentityKeyModel{
			ActorDID:       actorDID,
			IdentityKeyPub: ikPub,
			KeyFingerprint: fingerprint,
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error
	}
	if err != nil {
		return err
	}
	existing.IdentityKeyPub = ikPub
	existing.KeyFingerprint = fingerprint
	existing.UpdatedAt = now
	return r.db.Save(&existing).Error
}

func (r *GormRepo) UpsertSignedPreKey(actorDID string, spk domain.SignedPreKey) error {
	now := time.Now()
	var existing SignedPreKeyModel
	err := r.db.Where("actor_did = ?", actorDID).Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(&SignedPreKeyModel{
			ActorDID:  actorDID,
			SPKID:     spk.ID,
			PublicKey: spk.PublicKey,
			Signature: spk.Signature,
			CreatedAt: now,
		}).Error
	}
	if err != nil {
		return err
	}
	existing.SPKID = spk.ID
	existing.PublicKey = spk.PublicKey
	existing.Signature = spk.Signature
	existing.CreatedAt = now
	return r.db.Save(&existing).Error
}

func (r *GormRepo) UploadOneTimePreKeys(actorDID string, keys []domain.OneTimePreKey) error {
	if len(keys) == 0 {
		return nil
	}
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, k := range keys {
			row := OneTimePreKeyModel{
				ActorDID:  actorDID,
				OPKID:     k.ID,
				PublicKey: k.PublicKey,
				Consumed:  false,
				CreatedAt: now,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *GormRepo) FetchKeyBundle(actorDID string) (*domain.KeyBundle, error) {
	var out *domain.KeyBundle
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var ik IdentityKeyModel
		if err := tx.Where("actor_did = ?", actorDID).First(&ik).Error; err != nil {
			return err
		}
		var spk SignedPreKeyModel
		if err := tx.Where("actor_did = ?", actorDID).Order("created_at DESC").First(&spk).Error; err != nil {
			return err
		}
		var opk OneTimePreKeyModel
		if err := tx.Where("actor_did = ? AND consumed = ?", actorDID, false).
			Order("id ASC").
			First(&opk).Error; err != nil {
			return err
		}
		if err := tx.Model(&OneTimePreKeyModel{}).
			Where("id = ?", opk.ID).
			Update("consumed", true).Error; err != nil {
			return err
		}
		out = &domain.KeyBundle{
			ActorDID:       ik.ActorDID,
			IdentityKeyPub: ik.IdentityKeyPub,
			KeyFingerprint: ik.KeyFingerprint,
			SignedPreKey: domain.SignedPreKey{
				ID:        spk.SPKID,
				PublicKey: spk.PublicKey,
				Signature: spk.Signature,
				CreatedAt: spk.CreatedAt,
			},
			OneTimePreKeys: []domain.OneTimePreKey{
				{ID: opk.OPKID, PublicKey: opk.PublicKey, Consumed: false},
			},
			CreatedAt: ik.CreatedAt,
			UpdatedAt: ik.UpdatedAt,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GormRepo) CountAvailableOPKs(actorDID string) (int64, error) {
	var n int64
	err := r.db.Model(&OneTimePreKeyModel{}).
		Where("actor_did = ? AND consumed = ?", actorDID, false).
		Count(&n).Error
	return n, err
}
