package session

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	ID                     uint64     `gorm:"primaryKey;autoIncrement"`
	SessionID              string     `gorm:"uniqueIndex;size:100;not null"`
	UserID                 uint64     `gorm:"index;not null"`
	Email                  string     `gorm:"size:255"`
	DeviceType             DeviceType `gorm:"size:20;not null;index:idx_user_device"`
	TokenHash              string     `gorm:"size:100"` // Hash of the JWT token for verification
	IPAddress              string     `gorm:"size:50"`
	UserAgent              string     `gorm:"size:500"`
	OAuthCandidateID       string     `gorm:"column:oauth_candidate_id;size:64;uniqueIndex:uidx_actor_sessions_oauth_candidate,where:oauth_candidate_id <> ''"`
	AccessAttemptID        string     `gorm:"column:access_attempt_id;size:64;index;uniqueIndex:uidx_actor_sessions_access_attempt,where:access_attempt_id <> ''"`
	StationPeerID          string     `gorm:"column:station_peer_id;size:255;index"`
	AccessDecisionRevision uint64     `gorm:"column:access_decision_revision;not null;default:0"`
	DeviceID               string     `gorm:"column:device_id;size:128"`
	LifecycleGeneration    uint64     `gorm:"column:lifecycle_generation;not null;default:0"`
	AuthMethod             string     `gorm:"column:auth_method;size:32"`
	CreatedAt              time.Time  `gorm:"not null"`
	ExpiresAt              time.Time  `gorm:"not null"`
	LastActiveAt           time.Time  `gorm:"not null"`
	Revoked                bool       `gorm:"default:false;index:idx_user_device"`
	RevokedAt              *time.Time
	RevokedReason          string `gorm:"size:50"` // "kicked" | "logout" | "expired"
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
			"device_type":              string(r.DeviceType),
			"oauth_candidate_id":       r.OAuthCandidateID,
			"access_attempt_id":        r.AccessAttemptID,
			"station_peer_id":          r.StationPeerID,
			"access_decision_revision": r.AccessDecisionRevision,
			"device_id":                r.DeviceID,
			"lifecycle_generation":     r.LifecycleGeneration,
			"auth_method":              r.AuthMethod,
			"revoked":                  r.Revoked,
			"revoked_reason":           r.RevokedReason,
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

	record := newSessionRecord(sessionID, sess)

	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "session_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"user_id",
			"email",
			"device_type",
			"token_hash",
			"ip_address",
			"user_agent",
			"oauth_candidate_id",
			"access_attempt_id",
			"station_peer_id",
			"access_decision_revision",
			"device_id",
			"lifecycle_generation",
			"auth_method",
			"created_at",
			"expires_at",
			"last_active_at",
			"revoked",
			"revoked_at",
			"revoked_reason",
		}),
	}).Create(record).Error
}

func newSessionRecord(sessionID string, sess *Session) *SessionRecord {
	deviceType := DeviceTypeDesktop
	if dt, ok := sessionDataString(sess.Data, "device_type"); ok {
		deviceType = DeviceType(dt)
	}

	return &SessionRecord{
		SessionID:              sessionID,
		UserID:                 sess.UserID,
		Email:                  sess.Email,
		DeviceType:             deviceType,
		IPAddress:              sess.IPAddress,
		UserAgent:              sess.UserAgent,
		OAuthCandidateID:       sessionDataStringOrZero(sess.Data, "oauth_candidate_id"),
		AccessAttemptID:        sessionDataStringOrZero(sess.Data, "access_attempt_id"),
		StationPeerID:          sessionDataStringOrZero(sess.Data, "station_peer_id"),
		AccessDecisionRevision: sessionDataUint64OrZero(sess.Data, "access_decision_revision"),
		DeviceID:               sessionDataStringOrZero(sess.Data, "device_id"),
		LifecycleGeneration:    sessionDataUint64OrZero(sess.Data, "lifecycle_generation"),
		AuthMethod:             sessionDataStringOrZero(sess.Data, "auth_method"),
		CreatedAt:              sess.CreatedAt,
		ExpiresAt:              sess.ExpiresAt,
		LastActiveAt:           sess.LastSeen,
		Revoked:                false,
	}
}

func sessionDataString(data map[string]interface{}, key string) (string, bool) {
	if data == nil {
		return "", false
	}
	value, ok := data[key].(string)
	return value, ok
}

func sessionDataStringOrZero(data map[string]interface{}, key string) string {
	value, _ := sessionDataString(data, key)
	return value
}

func sessionDataUint64OrZero(data map[string]interface{}, key string) uint64 {
	if data == nil {
		return 0
	}

	switch value := data[key].(type) {
	case uint64:
		return value
	case uint:
		return uint64(value)
	case uint32:
		return uint64(value)
	case int:
		if value >= 0 {
			return uint64(value)
		}
	case int64:
		if value >= 0 {
			return uint64(value)
		}
	case int32:
		if value >= 0 {
			return uint64(value)
		}
	case float64:
		if value >= 0 && value == float64(uint64(value)) {
			return uint64(value)
		}
	}

	return 0
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

// RevokeByUser revokes every active session for a user on this Station.
// A Station owns its own actor_sessions table, so user_id is the correct
// boundary for the "one account, one active login per Station" invariant.
func (s *DBStore) RevokeByUser(ctx context.Context, userID uint64, reason string) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	now := time.Now()
	result := db.WithContext(ctx).Model(&SessionRecord{}).
		Where("user_id = ? AND revoked = ?", userID, false).
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

// CreateWithKick creates a new session and revokes existing sessions that
// conflict with it. The revocation scope depends on the provided deviceType:
//
//   - If deviceType is non-empty, only sessions for the same user_id AND
//     device_type are revoked. This allows parallel sessions across different
//     device types (e.g. Desktop native + Browser), as required by MCA-D19.
//   - If deviceType is empty (backward-compat / legacy callers), ALL active
//     sessions for the user are revoked (original "one active login" behavior).
func (s *DBStore) CreateWithKick(ctx context.Context, sess *Session, deviceType DeviceType) (*Session, int64, error) {
	if sess.Data == nil {
		sess.Data = make(map[string]interface{})
	}
	sess.Data["device_type"] = string(deviceType)

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var kicked int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		// Scope revocation: same device_type if provided, otherwise all.
		var result *gorm.DB
		if deviceType != "" {
			result = tx.Model(&SessionRecord{}).
				Where("user_id = ? AND device_type = ? AND revoked = ?", sess.UserID, deviceType, false).
				Updates(map[string]interface{}{
					"revoked":        true,
					"revoked_at":     now,
					"revoked_reason": "kicked",
				})
		} else {
			result = tx.Model(&SessionRecord{}).
				Where("user_id = ? AND revoked = ?", sess.UserID, false).
				Updates(map[string]interface{}{
					"revoked":        true,
					"revoked_at":     now,
					"revoked_reason": "kicked",
				})
		}
		if result.Error != nil {
			return result.Error
		}
		kicked = result.RowsAffected

		return tx.Create(newSessionRecord(sess.ID, sess)).Error
	})
	if err != nil {
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

// ResolveSessionDeviceType returns the device_type recorded on the session.
// Used by auth middleware to include device_type in 401 responses so that
// multi-device clients can filter session revocations.
func (s *DBStore) ResolveSessionDeviceType(ctx context.Context, sessionID string) string {
	db, err := s.getDB(ctx)
	if err != nil {
		return ""
	}

	var record SessionRecord
	if err := db.Select("device_type").Where("session_id = ?", sessionID).First(&record).Error; err != nil {
		return ""
	}

	return string(record.DeviceType)
}

// ResolveSessionDeviceID returns the exact device ID persisted with a session.
func (s *DBStore) ResolveSessionDeviceID(ctx context.Context, sessionID string) string {
	db, err := s.getDB(ctx)
	if err != nil {
		return ""
	}

	var record SessionRecord
	if err := db.Select("device_id").Where("session_id = ?", sessionID).First(&record).Error; err != nil {
		return ""
	}

	return record.DeviceID
}

// BindSessionDeviceID establishes the immutable device identity for a live
// session after Actor Identity has verified the corresponding enrollment.
func (s *DBStore) BindSessionDeviceID(ctx context.Context, sessionID, deviceID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record SessionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("session_id = ?", sessionID).
			First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		if record.Revoked {
			return ErrSessionRevoked
		}
		if time.Now().After(record.ExpiresAt) {
			return ErrSessionExpired
		}
		if record.DeviceID != "" && record.DeviceID != deviceID {
			return ErrSessionDeviceConflict
		}
		if record.DeviceID == deviceID {
			return nil
		}
		result := tx.Model(&SessionRecord{}).
			Where("id = ? AND device_id = ''", record.ID).
			Update("device_id", deviceID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSessionDeviceConflict
		}
		return nil
	})
}
