package infrastructure

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ============================================================================
// GORM Models
// ============================================================================

type NotificationModel struct {
	ID            uint   `gorm:"primaryKey"`
	NotifID       string `gorm:"column:notif_id;size:64;uniqueIndex"`
	RecipientPTID string `gorm:"column:recipient_ptid;size:255;index:idx_recipient_ptid_created"`
	ActorPTID     string `gorm:"column:actor_ptid;size:255;index"`
	Type          int32  `gorm:"index"`
	Category      int32  `gorm:"index"`
	Status        int32  `gorm:"index"`
	TargetType    string `gorm:"size:64"`
	TargetID      string `gorm:"size:255"`
	Title         string `gorm:"size:512"`
	Body          string `gorm:"type:text"`
	Metadata      string `gorm:"type:text"`
	GroupKey      string `gorm:"size:255;index"`
	ReadAt        *time.Time
	CreatedAt     time.Time `gorm:"index:idx_recipient_ptid_created"`
	UpdatedAt     time.Time
}

func (NotificationModel) TableName() string { return "notifications" }

type UnreadCountModel struct {
	ID            uint   `gorm:"primaryKey"`
	RecipientPTID string `gorm:"column:recipient_ptid;size:255;uniqueIndex:idx_recipient_ptid_category"`
	Category      int32  `gorm:"uniqueIndex:idx_recipient_ptid_category"`
	Count         int32
	UpdatedAt     time.Time
}

func (UnreadCountModel) TableName() string { return "notification_unread_counts" }

type PreferenceModel struct {
	ID           uint   `gorm:"primaryKey"`
	ActorPTID    string `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_actor_ptid_category"`
	Category     int32  `gorm:"uniqueIndex:idx_actor_ptid_category"`
	Enabled      bool   `gorm:"default:true"`
	PushEnabled  bool   `gorm:"default:true"`
	SoundEnabled bool   `gorm:"default:true"`
	UpdatedAt    time.Time
}

func (PreferenceModel) TableName() string { return "notification_preferences" }

type PreferenceRevisionModel struct {
	ActorPTID string `gorm:"column:actor_ptid;size:255;primaryKey"`
	Revision  uint64 `gorm:"column:revision;default:1;not null"`
	UpdatedAt time.Time
}

func (PreferenceRevisionModel) TableName() string {
	return "notification_preference_revisions"
}

type PushRegistrationModel struct {
	RegistrationID        string `gorm:"column:registration_id;size:64;primaryKey"`
	ActorPTID             string `gorm:"column:actor_ptid;size:255;not null;index:idx_push_registration_actor;uniqueIndex:uidx_push_registration_owner,priority:1"`
	DeviceID              string `gorm:"column:device_id;size:128;not null;uniqueIndex:uidx_push_registration_owner,priority:2"`
	Channel               int32  `gorm:"column:channel;not null;uniqueIndex:uidx_push_registration_owner,priority:3"`
	Environment           int32  `gorm:"column:environment;not null;uniqueIndex:uidx_push_registration_owner,priority:4"`
	AppInstallEpochSHA256 []byte `gorm:"column:app_install_epoch_sha256;not null"`
	ProviderBindingHMAC   []byte `gorm:"column:provider_binding_hmac;not null;uniqueIndex:uidx_push_registration_binding"`
	ProviderCiphertext    []byte `gorm:"column:provider_binding_ciphertext;not null"`
	ProviderNonce         []byte `gorm:"column:provider_binding_nonce;not null"`
	CredentialKeyVersion  uint32 `gorm:"column:credential_key_version;not null"`
	CreatedAt             time.Time
	UpdatedAt             time.Time
	LastSuccessAt         *time.Time
}

func (PushRegistrationModel) TableName() string {
	return "notification_push_registrations"
}

type PushMutationReceiptModel struct {
	ActorPTID     string `gorm:"column:actor_ptid;size:255;primaryKey"`
	DeviceID      string `gorm:"column:device_id;size:128;primaryKey"`
	RequestID     string `gorm:"column:request_id;size:64;primaryKey"`
	Operation     string `gorm:"column:operation;size:32;not null"`
	RequestSHA256 []byte `gorm:"column:request_sha256;not null"`
	ResponseBytes []byte `gorm:"column:response_bytes;not null"`
	ExpiresAt     time.Time
	CreatedAt     time.Time
}

func (PushMutationReceiptModel) TableName() string {
	return "notification_push_mutation_receipts"
}

type PushCredentialKeyModel struct {
	SingletonID uint8  `gorm:"column:singleton_id;primaryKey"`
	KeyVersion  uint32 `gorm:"column:key_version;not null"`
	KeyIdentity []byte `gorm:"column:key_identity;not null"`
	UpdatedAt   time.Time
}

func (PushCredentialKeyModel) TableName() string {
	return "notification_push_credential_key"
}

// ============================================================================
// Repository
// ============================================================================

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	if err := migrateNotificationPTIDColumns(r.db); err != nil {
		return err
	}
	return r.db.AutoMigrate(
		&NotificationModel{},
		&UnreadCountModel{},
		&PreferenceModel{},
		&PreferenceRevisionModel{},
		&PushRegistrationModel{},
		&PushMutationReceiptModel{},
		&PushCredentialKeyModel{},
	)
}

func (r *GormRepo) ActivatePushCredentialKey(
	keyVersion uint32,
	keyIdentity []byte,
) error {
	if keyVersion == 0 || len(keyIdentity) == 0 {
		return ErrPushCredentialKeyUnavailable
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current PushCredentialKeyModel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("singleton_id = ?", 1).
			First(&current).Error
		now := time.Now().UTC()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&PushCredentialKeyModel{
				SingletonID: 1,
				KeyVersion:  keyVersion,
				KeyIdentity: append([]byte(nil), keyIdentity...),
				UpdatedAt:   now,
			}).Error
		}
		if err != nil {
			return err
		}
		if current.KeyVersion == keyVersion &&
			bytes.Equal(current.KeyIdentity, keyIdentity) {
			return nil
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).
			Delete(&PushRegistrationModel{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).
			Delete(&PushMutationReceiptModel{}).Error; err != nil {
			return err
		}
		return tx.Model(&current).Updates(map[string]interface{}{
			"key_version":  keyVersion,
			"key_identity": append([]byte(nil), keyIdentity...),
			"updated_at":   now,
		}).Error
	})
}

// ============================================================================
// Notification CRUD — transactional insert + counter increment
// ============================================================================

func (r *GormRepo) Create(n domain.Notification) (domain.Notification, error) {
	now := time.Now()
	metaJSON := "{}"
	if len(n.Metadata) > 0 {
		b, _ := json.Marshal(n.Metadata)
		metaJSON = string(b)
	}
	record := NotificationModel{
		NotifID:       fmt.Sprintf("ntf-%d", now.UnixNano()),
		RecipientPTID: n.RecipientPTID,
		ActorPTID:     n.ActorPTID,
		Type:          n.Type,
		Category:      n.Category,
		Status:        domain.StatusUnread,
		TargetType:    n.TargetType,
		TargetID:      n.TargetID,
		Title:         n.Title,
		Body:          n.Body,
		Metadata:      metaJSON,
		GroupKey:      n.GroupKey,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		// Atomic counter increment in the same transaction
		return tx.Exec(`
			INSERT INTO notification_unread_counts (recipient_ptid, category, count, updated_at)
			VALUES (?, ?, 1, ?)
			ON CONFLICT (recipient_ptid, category) DO UPDATE
			SET count = notification_unread_counts.count + 1, updated_at = ?
		`, n.RecipientPTID, n.Category, now, now).Error
	})
	if err != nil {
		return domain.Notification{}, err
	}
	return toDomain(record), nil
}

func (r *GormRepo) List(recipientPTID string, category, status int32, cursor string, limit int) ([]domain.Notification, error) {
	query := r.db.Where("recipient_ptid = ?", recipientPTID)
	if category > 0 {
		query = query.Where("category = ?", category)
	}
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	if cursor != "" {
		query = query.Where("notif_id < ?", cursor)
	}
	var items []NotificationModel
	if err := query.Order("created_at DESC").Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Notification, 0, len(items))
	for _, item := range items {
		out = append(out, toDomain(item))
	}
	return out, nil
}

func (r *GormRepo) CountByRecipient(recipientPTID string, category, status int32) (int, error) {
	query := r.db.Model(&NotificationModel{}).Where("recipient_ptid = ?", recipientPTID)
	if category > 0 {
		query = query.Where("category = ?", category)
	}
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return int(count), nil
}

func (r *GormRepo) MarkRead(recipientPTID string, notifIDs []string) (int, error) {
	now := time.Now()
	var updated int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&NotificationModel{}).
			Where("notif_id IN ? AND recipient_ptid = ? AND status = ?", notifIDs, recipientPTID, domain.StatusUnread).
			Updates(map[string]interface{}{
				"status":     domain.StatusRead,
				"read_at":    now,
				"updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		updated = result.RowsAffected
		if updated == 0 {
			return nil
		}

		// Group by category and decrement counters
		var categories []int32
		tx.Model(&NotificationModel{}).
			Where("notif_id IN ?", notifIDs).
			Distinct("category").
			Pluck("category", &categories)

		for _, cat := range categories {
			var catCount int64
			tx.Model(&NotificationModel{}).
				Where("notif_id IN ? AND category = ?", notifIDs, cat).
				Count(&catCount)
			if catCount > 0 {
				tx.Exec(`
					UPDATE notification_unread_counts
					SET count = GREATEST(count - ?, 0), updated_at = ?
					WHERE recipient_ptid = ? AND category = ?
				`, catCount, now, recipientPTID, cat)
			}
		}
		return nil
	})
	return int(updated), err
}

func (r *GormRepo) MarkAllRead(recipientPTID string, category int32) (int, error) {
	now := time.Now()
	var updated int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&NotificationModel{}).
			Where("recipient_ptid = ? AND status = ?", recipientPTID, domain.StatusUnread)
		if category > 0 {
			query = query.Where("category = ?", category)
		}
		result := query.Updates(map[string]interface{}{
			"status":     domain.StatusRead,
			"read_at":    now,
			"updated_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		updated = result.RowsAffected
		if updated == 0 {
			return nil
		}

		counterQuery := tx.Model(&UnreadCountModel{}).Where("recipient_ptid = ?", recipientPTID)
		if category > 0 {
			counterQuery = counterQuery.Where("category = ?", category)
		}
		return counterQuery.Updates(map[string]interface{}{
			"count":      0,
			"updated_at": now,
		}).Error
	})
	return int(updated), err
}

func (r *GormRepo) Delete(recipientPTID string, notifIDs []string) (int, error) {
	now := time.Now()
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Collect unread counts per category before delete
		type catCount struct {
			Category int32
			Count    int64
		}
		var counts []catCount
		tx.Model(&NotificationModel{}).
			Select("category, count(*) as count").
			Where("notif_id IN ? AND recipient_ptid = ? AND status = ?", notifIDs, recipientPTID, domain.StatusUnread).
			Group("category").
			Scan(&counts)

		result := tx.Where("notif_id IN ? AND recipient_ptid = ?", notifIDs, recipientPTID).Delete(&NotificationModel{})
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected

		for _, cc := range counts {
			tx.Exec(`
				UPDATE notification_unread_counts
				SET count = GREATEST(count - ?, 0), updated_at = ?
				WHERE recipient_ptid = ? AND category = ?
			`, cc.Count, now, recipientPTID, cc.Category)
		}
		return nil
	})
	return int(deleted), err
}

func (r *GormRepo) GetUnreadCounts(recipientPTID string) (domain.UnreadCounts, error) {
	var items []UnreadCountModel
	if err := r.db.Where("recipient_ptid = ?", recipientPTID).Find(&items).Error; err != nil {
		return domain.UnreadCounts{}, err
	}
	result := domain.UnreadCounts{
		ByCategory: make(map[int32]int32),
	}
	for _, item := range items {
		result.ByCategory[item.Category] = item.Count
		result.Total += item.Count
	}
	return result, nil
}

// ============================================================================
// Preferences
// ============================================================================

const initialPreferenceRevision uint64 = 1

var preferenceCategories = [...]int32{
	domain.CategorySocial,
	domain.CategoryChat,
	domain.CategorySystem,
	domain.CategoryTask,
}

func (r *GormRepo) GetPreferencesSnapshot(actorPTID string) (domain.NotificationPreferencesSnapshot, error) {
	var items []PreferenceModel
	if err := r.db.Where("actor_ptid = ?", actorPTID).Order("category ASC").Find(&items).Error; err != nil {
		return domain.NotificationPreferencesSnapshot{}, err
	}

	var revision PreferenceRevisionModel
	err := r.db.Where("actor_ptid = ?", actorPTID).First(&revision).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.NotificationPreferencesSnapshot{}, err
	}
	return preferenceSnapshot(actorPTID, items, canonicalPreferenceRevision(revision.Revision)), nil
}

func (r *GormRepo) GetPreference(actorPTID string, category int32) (*domain.NotificationPreference, error) {
	var item PreferenceModel
	err := r.db.Where("actor_ptid = ? AND category = ?", actorPTID, category).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p := domain.NotificationPreference{
		ActorPTID:    item.ActorPTID,
		Category:     item.Category,
		Enabled:      item.Enabled,
		PushEnabled:  item.PushEnabled,
		SoundEnabled: item.SoundEnabled,
		UpdatedAt:    item.UpdatedAt,
	}
	return &p, nil
}

func (r *GormRepo) UpdatePreferences(
	actorPTID string,
	observedRevision uint64,
	updates []domain.NotificationPreferencePatch,
) (domain.NotificationPreferencesUpdateResult, error) {
	var result domain.NotificationPreferencesUpdateResult
	err := r.db.Transaction(func(tx *gorm.DB) error {
		revision, err := lockPreferenceRevision(tx, actorPTID)
		if err != nil {
			return err
		}
		items, err := loadPreferenceModels(tx, actorPTID)
		if err != nil {
			return err
		}
		current := preferenceSnapshot(actorPTID, items, revision.Revision)
		if observedRevision != revision.Revision {
			result = domain.NotificationPreferencesUpdateResult{
				Outcome:  domain.NotificationPreferencesUpdateOutcomeConflict,
				Snapshot: current,
			}
			return nil
		}

		byCategory := make(map[int32]domain.NotificationPreference, len(current.Preferences))
		for _, preference := range current.Preferences {
			byCategory[preference.Category] = preference
		}
		changed := make([]domain.NotificationPreferencePatch, 0, len(updates))
		for _, update := range updates {
			existing := byCategory[update.Category]
			if existing.Enabled == update.Enabled &&
				existing.PushEnabled == update.PushEnabled &&
				existing.SoundEnabled == update.SoundEnabled {
				continue
			}
			changed = append(changed, update)
		}
		if len(changed) == 0 {
			result = domain.NotificationPreferencesUpdateResult{
				Outcome:  domain.NotificationPreferencesUpdateOutcomeUnchanged,
				Snapshot: current,
			}
			return nil
		}

		now := time.Now().UTC()
		for _, update := range changed {
			if err := tx.Exec(`
				INSERT INTO notification_preferences
					(actor_ptid, category, enabled, push_enabled, sound_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (actor_ptid, category) DO UPDATE
				SET enabled = ?, push_enabled = ?, sound_enabled = ?, updated_at = ?
			`, actorPTID, update.Category, update.Enabled, update.PushEnabled, update.SoundEnabled, now,
				update.Enabled, update.PushEnabled, update.SoundEnabled, now).Error; err != nil {
				return err
			}
		}

		nextRevision := revision.Revision + 1
		updateResult := tx.Model(&PreferenceRevisionModel{}).
			Where("actor_ptid = ? AND revision = ?", actorPTID, revision.Revision).
			Updates(map[string]interface{}{
				"revision":   nextRevision,
				"updated_at": now,
			})
		if updateResult.Error != nil {
			return updateResult.Error
		}
		if updateResult.RowsAffected != 1 {
			return fmt.Errorf("notification preference revision changed during update")
		}

		nextItems, err := loadPreferenceModels(tx, actorPTID)
		if err != nil {
			return err
		}
		result = domain.NotificationPreferencesUpdateResult{
			Outcome:  domain.NotificationPreferencesUpdateOutcomeApplied,
			Snapshot: preferenceSnapshot(actorPTID, nextItems, nextRevision),
		}
		return nil
	})
	if err != nil {
		return domain.NotificationPreferencesUpdateResult{}, err
	}
	return result, nil
}

func lockPreferenceRevision(tx *gorm.DB, actorPTID string) (PreferenceRevisionModel, error) {
	record := PreferenceRevisionModel{
		ActorPTID: actorPTID,
		Revision:  initialPreferenceRevision,
	}
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "actor_ptid"}},
		DoNothing: true,
	}).Create(&record).Error; err != nil {
		return PreferenceRevisionModel{}, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("actor_ptid = ?", actorPTID).
		First(&record).Error; err != nil {
		return PreferenceRevisionModel{}, err
	}
	record.Revision = canonicalPreferenceRevision(record.Revision)
	return record, nil
}

func loadPreferenceModels(tx *gorm.DB, actorPTID string) ([]PreferenceModel, error) {
	var items []PreferenceModel
	if err := tx.Where("actor_ptid = ?", actorPTID).Order("category ASC").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func canonicalPreferenceRevision(revision uint64) uint64 {
	if revision == 0 {
		return initialPreferenceRevision
	}
	return revision
}

func preferenceSnapshot(
	actorPTID string,
	items []PreferenceModel,
	revision uint64,
) domain.NotificationPreferencesSnapshot {
	byCategory := make(map[int32]PreferenceModel, len(items))
	for _, item := range items {
		byCategory[item.Category] = item
	}
	preferences := make([]domain.NotificationPreference, 0, len(preferenceCategories))
	for _, category := range preferenceCategories {
		item, exists := byCategory[category]
		preference := domain.NotificationPreference{
			ActorPTID:    actorPTID,
			Category:     category,
			Enabled:      true,
			PushEnabled:  true,
			SoundEnabled: true,
		}
		if exists {
			preference.Enabled = item.Enabled
			preference.PushEnabled = item.PushEnabled
			preference.SoundEnabled = item.SoundEnabled
			preference.UpdatedAt = item.UpdatedAt
		}
		preferences = append(preferences, preference)
	}
	return domain.NotificationPreferencesSnapshot{
		Preferences: preferences,
		Revision:    canonicalPreferenceRevision(revision),
	}
}

// ============================================================================
// Push registrations
// ============================================================================

const pushMutationReceiptTTL = 7 * 24 * time.Hour

func (r *GormRepo) RegisterPush(
	input domain.RegisterPushDeviceInput,
	protected domain.ProtectedPushBinding,
	requestSHA256 []byte,
) (domain.RegisterPushDeviceResult, error) {
	var result domain.RegisterPushDeviceResult
	err := r.db.Transaction(func(tx *gorm.DB) error {
		replayed, found, err := loadPushReceipt[domain.RegisterPushDeviceResult](
			tx,
			input.ActorPTID,
			input.DeviceID,
			input.RequestID,
			"register",
			requestSHA256,
		)
		if err != nil {
			return err
		}
		if found {
			result = replayed
			return nil
		}

		var conflicting int64
		if err := tx.Model(&PushRegistrationModel{}).
			Where("provider_binding_hmac = ?", protected.Fingerprint).
			Where(
				"NOT (actor_ptid = ? AND device_id = ? AND channel = ? AND environment = ?)",
				input.ActorPTID,
				input.DeviceID,
				input.Binding.Channel,
				input.Environment,
			).
			Count(&conflicting).Error; err != nil {
			return err
		}
		if conflicting > 0 {
			return domain.ErrPushProviderConflict
		}

		var record PushRegistrationModel
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"actor_ptid = ? AND device_id = ? AND channel = ? AND environment = ?",
				input.ActorPTID,
				input.DeviceID,
				input.Binding.Channel,
				input.Environment,
			).
			First(&record).Error
		now := time.Now().UTC()
		outcome := domain.RegisterPushDeviceOutcomeCreated
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			record = PushRegistrationModel{
				RegistrationID:        ulid.Make().String(),
				ActorPTID:             input.ActorPTID,
				DeviceID:              input.DeviceID,
				Channel:               int32(input.Binding.Channel),
				Environment:           int32(input.Environment),
				AppInstallEpochSHA256: append([]byte(nil), input.AppInstallEpochSHA256...),
				ProviderBindingHMAC:   append([]byte(nil), protected.Fingerprint...),
				ProviderCiphertext:    append([]byte(nil), protected.Ciphertext...),
				ProviderNonce:         append([]byte(nil), protected.Nonce...),
				CredentialKeyVersion:  protected.KeyVersion,
				CreatedAt:             now,
				UpdatedAt:             now,
			}
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		case bytes.Equal(record.ProviderBindingHMAC, protected.Fingerprint) &&
			bytes.Equal(record.AppInstallEpochSHA256, input.AppInstallEpochSHA256):
			outcome = domain.RegisterPushDeviceOutcomeUnchanged
		default:
			outcome = domain.RegisterPushDeviceOutcomeRotated
			updates := map[string]interface{}{
				"app_install_epoch_sha256":    append([]byte(nil), input.AppInstallEpochSHA256...),
				"provider_binding_hmac":       append([]byte(nil), protected.Fingerprint...),
				"provider_binding_ciphertext": append([]byte(nil), protected.Ciphertext...),
				"provider_binding_nonce":      append([]byte(nil), protected.Nonce...),
				"credential_key_version":      protected.KeyVersion,
				"updated_at":                  now,
			}
			if err := tx.Model(&record).Updates(updates).Error; err != nil {
				return err
			}
			if err := tx.First(&record, "registration_id = ?", record.RegistrationID).Error; err != nil {
				return err
			}
		}

		result = domain.RegisterPushDeviceResult{
			RequestID:    input.RequestID,
			Outcome:      outcome,
			Registration: pushRegistrationToDomain(record),
		}
		return savePushReceipt(
			tx,
			input.ActorPTID,
			input.DeviceID,
			input.RequestID,
			"register",
			requestSHA256,
			result,
		)
	})
	if err != nil {
		return domain.RegisterPushDeviceResult{}, err
	}
	return result, nil
}

func (r *GormRepo) UnregisterPush(
	input domain.UnregisterPushDeviceInput,
	requestSHA256 []byte,
) (domain.UnregisterPushDeviceResult, error) {
	var result domain.UnregisterPushDeviceResult
	err := r.db.Transaction(func(tx *gorm.DB) error {
		replayed, found, err := loadPushReceipt[domain.UnregisterPushDeviceResult](
			tx,
			input.ActorPTID,
			input.DeviceID,
			input.RequestID,
			"unregister",
			requestSHA256,
		)
		if err != nil {
			return err
		}
		if found {
			result = replayed
			return nil
		}

		result = domain.UnregisterPushDeviceResult{
			RequestID: input.RequestID,
			Outcome:   domain.UnregisterPushDeviceOutcomeAlreadyAbsent,
		}
		var record PushRegistrationModel
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"registration_id = ? AND actor_ptid = ? AND device_id = ?",
				input.RegistrationID,
				input.ActorPTID,
				input.DeviceID,
			).
			First(&record).Error
		if err == nil {
			if !bytes.Equal(record.AppInstallEpochSHA256, input.AppInstallEpochSHA256) {
				return domain.ErrPushInstallConflict
			}
			if err := tx.Delete(&record).Error; err != nil {
				return err
			}
			result.Outcome = domain.UnregisterPushDeviceOutcomeRemoved
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		return savePushReceipt(
			tx,
			input.ActorPTID,
			input.DeviceID,
			input.RequestID,
			"unregister",
			requestSHA256,
			result,
		)
	})
	if err != nil {
		return domain.UnregisterPushDeviceResult{}, err
	}
	return result, nil
}

func (r *GormRepo) ListPushRegistrations(actorPTID string) ([]domain.PushRegistration, error) {
	var records []PushRegistrationModel
	if err := r.db.
		Where("actor_ptid = ?", actorPTID).
		Order("device_id ASC, channel ASC, environment ASC").
		Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]domain.PushRegistration, 0, len(records))
	for _, record := range records {
		result = append(result, pushRegistrationToDomain(record))
	}
	return result, nil
}

func loadPushReceipt[T any](
	tx *gorm.DB,
	actorPTID string,
	deviceID string,
	requestID string,
	operation string,
	requestSHA256 []byte,
) (T, bool, error) {
	var zero T
	var receipt PushMutationReceiptModel
	err := tx.Where(
		"actor_ptid = ? AND device_id = ? AND request_id = ?",
		actorPTID,
		deviceID,
		requestID,
	).First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return zero, false, nil
	}
	if err != nil {
		return zero, false, err
	}
	if !receipt.ExpiresAt.After(time.Now().UTC()) {
		if err := tx.Delete(&receipt).Error; err != nil {
			return zero, false, err
		}
		return zero, false, nil
	}
	if receipt.Operation != operation || !bytes.Equal(receipt.RequestSHA256, requestSHA256) {
		return zero, false, domain.ErrPushIdempotencyConflict
	}
	var result T
	if err := json.Unmarshal(receipt.ResponseBytes, &result); err != nil {
		return zero, false, err
	}
	return result, true, nil
}

func savePushReceipt(
	tx *gorm.DB,
	actorPTID string,
	deviceID string,
	requestID string,
	operation string,
	requestSHA256 []byte,
	response interface{},
) error {
	responseBytes, err := json.Marshal(response)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return tx.Create(&PushMutationReceiptModel{
		ActorPTID:     actorPTID,
		DeviceID:      deviceID,
		RequestID:     requestID,
		Operation:     operation,
		RequestSHA256: append([]byte(nil), requestSHA256...),
		ResponseBytes: responseBytes,
		ExpiresAt:     now.Add(pushMutationReceiptTTL),
		CreatedAt:     now,
	}).Error
}

func pushRegistrationToDomain(record PushRegistrationModel) domain.PushRegistration {
	return domain.PushRegistration{
		RegistrationID:        record.RegistrationID,
		ActorPTID:             record.ActorPTID,
		DeviceID:              record.DeviceID,
		Channel:               domain.PushChannel(record.Channel),
		Environment:           domain.PushEnvironment(record.Environment),
		AppInstallEpochSHA256: append([]byte(nil), record.AppInstallEpochSHA256...),
		ProviderBindingSHA256: append([]byte(nil), record.ProviderBindingHMAC...),
		CreatedAt:             record.CreatedAt,
		UpdatedAt:             record.UpdatedAt,
		LastSuccessAt:         record.LastSuccessAt,
	}
}

// ============================================================================
// Cleanup
// ============================================================================

func (r *GormRepo) CleanupOlderThan(cutoff time.Time) (int64, error) {
	if err := r.db.Where("expires_at < ?", time.Now().UTC()).Delete(&PushMutationReceiptModel{}).Error; err != nil {
		return 0, err
	}
	result := r.db.Where("status = ? AND created_at < ?", domain.StatusRead, cutoff).Delete(&NotificationModel{})
	return result.RowsAffected, result.Error
}

// ============================================================================
// Helpers
// ============================================================================

func toDomain(m NotificationModel) domain.Notification {
	metadata := make(map[string]string)
	if m.Metadata != "" && m.Metadata != "{}" {
		_ = json.Unmarshal([]byte(m.Metadata), &metadata)
	}
	n := domain.Notification{
		ID:            m.NotifID,
		RecipientPTID: m.RecipientPTID,
		ActorPTID:     m.ActorPTID,
		Type:          m.Type,
		Category:      m.Category,
		Status:        m.Status,
		TargetType:    m.TargetType,
		TargetID:      m.TargetID,
		Title:         m.Title,
		Body:          m.Body,
		Metadata:      metadata,
		GroupKey:      m.GroupKey,
		CreatedAt:     m.CreatedAt,
		ReadAt:        m.ReadAt,
	}
	_ = strings.TrimSpace(n.ID)
	return n
}

type notificationPTIDColumnMigration struct {
	table         string
	legacy        string
	canonical     string
	legacyIndexes []string
}

var notificationPTIDColumnMigrations = []notificationPTIDColumnMigration{
	{table: "notifications", legacy: "actor_id", canonical: "actor_ptid", legacyIndexes: []string{"idx_notifications_actor_id"}},
	{table: "notification_preferences", legacy: "actor_id", canonical: "actor_ptid", legacyIndexes: []string{"idx_actor_category"}},
	{table: "notifications", legacy: "recipient_id", canonical: "recipient_ptid", legacyIndexes: []string{"idx_recipient_created"}},
	{table: "notification_unread_counts", legacy: "recipient_id", canonical: "recipient_ptid", legacyIndexes: []string{"idx_recipient_category"}},
}

func migrateNotificationPTIDColumns(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("notification PTID migration requires database")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, migration := range notificationPTIDColumnMigrations {
			if !tx.Migrator().HasTable(migration.table) {
				continue
			}
			if tx.Migrator().HasColumn(migration.table, migration.legacy) &&
				tx.Migrator().HasColumn(migration.table, migration.canonical) {
				return fmt.Errorf(
					"notification: %s contains both %s and %s",
					migration.table,
					migration.legacy,
					migration.canonical,
				)
			}
		}

		for _, migration := range notificationPTIDColumnMigrations {
			if !tx.Migrator().HasTable(migration.table) {
				continue
			}
			hasLegacy := tx.Migrator().HasColumn(migration.table, migration.legacy)
			if hasLegacy {
				if err := tx.Migrator().RenameColumn(migration.table, migration.legacy, migration.canonical); err != nil {
					return fmt.Errorf(
						"notification: rename %s.%s to %s: %w",
						migration.table,
						migration.legacy,
						migration.canonical,
						err,
					)
				}
			}
			for _, legacyIndex := range migration.legacyIndexes {
				if tx.Migrator().HasIndex(migration.table, legacyIndex) {
					if err := tx.Migrator().DropIndex(migration.table, legacyIndex); err != nil {
						return fmt.Errorf("notification: drop legacy index %s on %s: %w", legacyIndex, migration.table, err)
					}
				}
			}
		}
		return nil
	})
}
