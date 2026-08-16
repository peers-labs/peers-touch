package infrastructure

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"gorm.io/gorm"
)

// ============================================================================
// GORM Models
// ============================================================================

type NotificationModel struct {
	ID          uint   `gorm:"primaryKey"`
	NotifID     string `gorm:"column:notif_id;size:64;uniqueIndex"`
	RecipientID string `gorm:"size:255;index:idx_recipient_created"`
	ActorID     string `gorm:"size:255;index"`
	Type        int32  `gorm:"index"`
	Category    int32  `gorm:"index"`
	Status      int32  `gorm:"index"`
	TargetType  string `gorm:"size:64"`
	TargetID    string `gorm:"size:255"`
	Title       string `gorm:"size:512"`
	Body        string `gorm:"type:text"`
	Metadata    string `gorm:"type:text"`
	GroupKey    string `gorm:"size:255;index"`
	ReadAt      *time.Time
	CreatedAt   time.Time `gorm:"index:idx_recipient_created"`
	UpdatedAt   time.Time
}

func (NotificationModel) TableName() string { return "notifications" }

type UnreadCountModel struct {
	ID          uint   `gorm:"primaryKey"`
	RecipientID string `gorm:"size:255;uniqueIndex:idx_recipient_category"`
	Category    int32  `gorm:"uniqueIndex:idx_recipient_category"`
	Count       int32
	UpdatedAt   time.Time
}

func (UnreadCountModel) TableName() string { return "notification_unread_counts" }

type PreferenceModel struct {
	ID           uint   `gorm:"primaryKey"`
	ActorID      string `gorm:"size:255;uniqueIndex:idx_actor_category"`
	Category     int32  `gorm:"uniqueIndex:idx_actor_category"`
	Enabled      bool   `gorm:"default:true"`
	PushEnabled  bool   `gorm:"default:true"`
	SoundEnabled bool   `gorm:"default:true"`
	UpdatedAt    time.Time
}

func (PreferenceModel) TableName() string { return "notification_preferences" }

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
	return r.db.AutoMigrate(&NotificationModel{}, &UnreadCountModel{}, &PreferenceModel{})
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
		NotifID:     fmt.Sprintf("ntf-%d", now.UnixNano()),
		RecipientID: n.RecipientID,
		ActorID:     n.ActorID,
		Type:        n.Type,
		Category:    n.Category,
		Status:      domain.StatusUnread,
		TargetType:  n.TargetType,
		TargetID:    n.TargetID,
		Title:       n.Title,
		Body:        n.Body,
		Metadata:    metaJSON,
		GroupKey:    n.GroupKey,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		// Atomic counter increment in the same transaction
		return tx.Exec(`
			INSERT INTO notification_unread_counts (recipient_id, category, count, updated_at)
			VALUES (?, ?, 1, ?)
			ON CONFLICT (recipient_id, category) DO UPDATE
			SET count = notification_unread_counts.count + 1, updated_at = ?
		`, n.RecipientID, n.Category, now, now).Error
	})
	if err != nil {
		return domain.Notification{}, err
	}
	return toDomain(record), nil
}

func (r *GormRepo) List(recipientID string, category, status int32, cursor string, limit int) ([]domain.Notification, error) {
	query := r.db.Where("recipient_id = ?", recipientID)
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

func (r *GormRepo) CountByRecipient(recipientID string, category, status int32) (int, error) {
	query := r.db.Model(&NotificationModel{}).Where("recipient_id = ?", recipientID)
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

func (r *GormRepo) MarkRead(recipientID string, notifIDs []string) (int, error) {
	now := time.Now()
	var updated int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&NotificationModel{}).
			Where("notif_id IN ? AND recipient_id = ? AND status = ?", notifIDs, recipientID, domain.StatusUnread).
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
					WHERE recipient_id = ? AND category = ?
				`, catCount, now, recipientID, cat)
			}
		}
		return nil
	})
	return int(updated), err
}

func (r *GormRepo) MarkAllRead(recipientID string, category int32) (int, error) {
	now := time.Now()
	var updated int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&NotificationModel{}).
			Where("recipient_id = ? AND status = ?", recipientID, domain.StatusUnread)
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

		counterQuery := tx.Model(&UnreadCountModel{}).Where("recipient_id = ?", recipientID)
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

func (r *GormRepo) Delete(recipientID string, notifIDs []string) (int, error) {
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
			Where("notif_id IN ? AND recipient_id = ? AND status = ?", notifIDs, recipientID, domain.StatusUnread).
			Group("category").
			Scan(&counts)

		result := tx.Where("notif_id IN ? AND recipient_id = ?", notifIDs, recipientID).Delete(&NotificationModel{})
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected

		for _, cc := range counts {
			tx.Exec(`
				UPDATE notification_unread_counts
				SET count = GREATEST(count - ?, 0), updated_at = ?
				WHERE recipient_id = ? AND category = ?
			`, cc.Count, now, recipientID, cc.Category)
		}
		return nil
	})
	return int(deleted), err
}

func (r *GormRepo) GetUnreadCounts(recipientID string) (domain.UnreadCounts, error) {
	var items []UnreadCountModel
	if err := r.db.Where("recipient_id = ?", recipientID).Find(&items).Error; err != nil {
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

func (r *GormRepo) GetPreferences(actorID string) ([]domain.NotificationPreference, error) {
	var items []PreferenceModel
	if err := r.db.Where("actor_id = ?", actorID).Find(&items).Error; err != nil {
		return nil, err
	}
	out := make([]domain.NotificationPreference, 0, len(items))
	for _, item := range items {
		out = append(out, domain.NotificationPreference{
			ActorID:      item.ActorID,
			Category:     item.Category,
			Enabled:      item.Enabled,
			PushEnabled:  item.PushEnabled,
			SoundEnabled: item.SoundEnabled,
			UpdatedAt:    item.UpdatedAt,
		})
	}
	return out, nil
}

func (r *GormRepo) GetPreference(actorID string, category int32) (*domain.NotificationPreference, error) {
	var item PreferenceModel
	err := r.db.Where("actor_id = ? AND category = ?", actorID, category).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p := domain.NotificationPreference{
		ActorID:      item.ActorID,
		Category:     item.Category,
		Enabled:      item.Enabled,
		PushEnabled:  item.PushEnabled,
		SoundEnabled: item.SoundEnabled,
		UpdatedAt:    item.UpdatedAt,
	}
	return &p, nil
}

func (r *GormRepo) UpsertPreference(pref domain.NotificationPreference) (domain.NotificationPreference, error) {
	now := time.Now()
	err := r.db.Exec(`
		INSERT INTO notification_preferences (actor_id, category, enabled, push_enabled, sound_enabled, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (actor_id, category) DO UPDATE
		SET enabled = ?, push_enabled = ?, sound_enabled = ?, updated_at = ?
	`, pref.ActorID, pref.Category, pref.Enabled, pref.PushEnabled, pref.SoundEnabled, now,
		pref.Enabled, pref.PushEnabled, pref.SoundEnabled, now).Error
	if err != nil {
		return domain.NotificationPreference{}, err
	}
	pref.UpdatedAt = now
	return pref, nil
}

// ============================================================================
// Cleanup
// ============================================================================

func (r *GormRepo) CleanupOlderThan(cutoff time.Time) (int64, error) {
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
		ID:          m.NotifID,
		RecipientID: m.RecipientID,
		ActorID:     m.ActorID,
		Type:        m.Type,
		Category:    m.Category,
		Status:      m.Status,
		TargetType:  m.TargetType,
		TargetID:    m.TargetID,
		Title:       m.Title,
		Body:        m.Body,
		Metadata:    metadata,
		GroupKey:    m.GroupKey,
		CreatedAt:   m.CreatedAt,
		ReadAt:      m.ReadAt,
	}
	_ = strings.TrimSpace(n.ID)
	return n
}
