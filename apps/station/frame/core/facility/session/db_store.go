package session

import (
	"context"
	"time"

	"gorm.io/gorm"
)

// DeviceType represents the type of client device
type DeviceType string

const (
	DeviceTypeDesktop DeviceType = "desktop"
	DeviceTypeMobile  DeviceType = "mobile"
	DeviceTypeWeb     DeviceType = "web"
)

// SessionRecord is the database model for persistent sessions
type SessionRecord struct {
	ID           uint64     `gorm:"primaryKey;autoIncrement"`
	SessionID    string     `gorm:"uniqueIndex;size:100;not null"`
	UserID       uint64     `gorm:"index;not null"`
	Email        string     `gorm:"size:255"`
	DeviceType   DeviceType `gorm:"size:20;not null;index:idx_user_device"`
	TokenHash    string     `gorm:"size:100"` // Hash of the JWT token for verification
	IPAddress    string     `gorm:"size:50"`
	UserAgent    string     `gorm:"size:500"`
	CreatedAt    time.Time  `gorm:"not null"`
	ExpiresAt    time.Time  `gorm:"not null"`
	LastActiveAt time.Time  `gorm:"not null"`
	Revoked      bool       `gorm:"default:false;index:idx_user_device"`
	RevokedAt    *time.Time
	RevokedReason string    `gorm:"size:50"` // "kicked" | "logout" | "expired"
}

func (SessionRecord) TableName() string {
	return "actor_sessions"
}

// ToSession converts a database record to a Session
func (r *SessionRecord) ToSession() *Session {
	return &Session{
		ID:        r.SessionID,
		UserID:    r.UserID,
		Email:     r.Email,
		CreatedAt: r.CreatedAt,
		ExpiresAt: r.ExpiresAt,
		LastSeen:  r.LastActiveAt,
		IPAddress: r.IPAddress,
		UserAgent: r.UserAgent,
		Data: map[string]interface{}{
			"device_type":    string(r.DeviceType),
			"revoked":        r.Revoked,
			"revoked_reason": r.RevokedReason,
		},
	}
}

// DBStore implements Store interface with database persistence
type DBStore struct {
	getDB func(ctx context.Context) (*gorm.DB, error)
	ttl   time.Duration
}

// NewDBStore creates a new database-backed session store
func NewDBStore(getDB func(ctx context.Context) (*gorm.DB, error), ttl time.Duration) *DBStore {
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	return &DBStore{getDB: getDB, ttl: ttl}
}

// AutoMigrate creates the session table if it doesn't exist
func (s *DBStore) AutoMigrate(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.AutoMigrate(&SessionRecord{})
}

// Set stores or updates a session
func (s *DBStore) Set(ctx context.Context, sessionID string, sess *Session) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	deviceType := DeviceTypeDesktop
	if dt, ok := sess.Data["device_type"].(string); ok {
		deviceType = DeviceType(dt)
	}

	record := &SessionRecord{
		SessionID:    sessionID,
		UserID:       sess.UserID,
		Email:        sess.Email,
		DeviceType:   deviceType,
		IPAddress:    sess.IPAddress,
		UserAgent:    sess.UserAgent,
		CreatedAt:    sess.CreatedAt,
		ExpiresAt:    sess.ExpiresAt,
		LastActiveAt: sess.LastSeen,
		Revoked:      false,
	}

	// Use upsert logic
	return db.Save(record).Error
}

// Get retrieves a session by ID
func (s *DBStore) Get(ctx context.Context, sessionID string) (*Session, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var record SessionRecord
	if err := db.Where("session_id = ?", sessionID).First(&record).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}

	if record.Revoked {
		return nil, ErrSessionRevoked
	}

	if time.Now().After(record.ExpiresAt) {
		return nil, ErrSessionExpired
	}

	// Update last active time
	db.Model(&record).Update("last_active_at", time.Now())

	return record.ToSession(), nil
}

// Delete removes a session by ID
func (s *DBStore) Delete(ctx context.Context, sessionID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.Where("session_id = ?", sessionID).Delete(&SessionRecord{}).Error
}

// Cleanup removes expired sessions
func (s *DBStore) Cleanup(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.Where("expires_at < ?", time.Now()).Delete(&SessionRecord{}).Error
}

// RevokeByUserAndDevice revokes all sessions for a user on a specific device type
// Returns the count of revoked sessions
func (s *DBStore) RevokeByUserAndDevice(ctx context.Context, userID uint64, deviceType DeviceType, reason string) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	now := time.Now()
	result := db.Model(&SessionRecord{}).
		Where("user_id = ? AND device_type = ? AND revoked = ?", userID, deviceType, false).
		Updates(map[string]interface{}{
			"revoked":        true,
			"revoked_at":     now,
			"revoked_reason": reason,
		})

	return result.RowsAffected, result.Error
}

// GetActiveSessionByUserAndDevice returns the active session for a user on a device type
func (s *DBStore) GetActiveSessionByUserAndDevice(ctx context.Context, userID uint64, deviceType DeviceType) (*SessionRecord, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var record SessionRecord
	err = db.Where("user_id = ? AND device_type = ? AND revoked = ? AND expires_at > ?",
		userID, deviceType, false, time.Now()).
		First(&record).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	return &record, nil
}

// CreateWithKick creates a new session and revokes any existing session for the same user+device
func (s *DBStore) CreateWithKick(ctx context.Context, sess *Session, deviceType DeviceType) (*Session, int64, error) {
	// First, revoke existing sessions for this user+device
	kicked, err := s.RevokeByUserAndDevice(ctx, sess.UserID, deviceType, "kicked")
	if err != nil {
		return nil, 0, err
	}

	// Store device type in session data
	if sess.Data == nil {
		sess.Data = make(map[string]interface{})
	}
	sess.Data["device_type"] = string(deviceType)

	// Create new session
	if err := s.Set(ctx, sess.ID, sess); err != nil {
		return nil, kicked, err
	}

	return sess, kicked, nil
}

// CheckSessionValid checks if a session is valid (not revoked, not expired)
// Returns (valid, reason) where reason is empty if valid, or "kicked"/"expired" if not
func (s *DBStore) CheckSessionValid(ctx context.Context, sessionID string) (bool, string) {
	db, err := s.getDB(ctx)
	if err != nil {
		return false, "error"
	}

	var record SessionRecord
	if err := db.Where("session_id = ?", sessionID).First(&record).Error; err != nil {
		return false, "not_found"
	}

	if record.Revoked {
		return false, record.RevokedReason
	}

	if time.Now().After(record.ExpiresAt) {
		return false, "expired"
	}

	return true, ""
}
