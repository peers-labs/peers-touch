package session

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

const (
	activeClientClassIndex = "uidx_actor_sessions_active_client_class"
	actorTableName         = "touch_actor"
)

var ErrInvalidDeviceType = errors.New("invalid session client class")

// ParseDeviceType returns the canonical client class persisted in actor_sessions.
func ParseDeviceType(value string) (DeviceType, error) {
	deviceType := DeviceType(strings.TrimSpace(value))
	if err := deviceType.Validate(); err != nil {
		return "", err
	}
	return deviceType, nil
}

// Validate rejects runtime labels and aliases before they reach persistence.
func (d DeviceType) Validate() error {
	switch d {
	case DeviceTypeDesktop, DeviceTypeMobile, DeviceTypeWeb:
		return nil
	default:
		return fmt.Errorf("%w %q", ErrInvalidDeviceType, d)
	}
}

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
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.AutoMigrate(&SessionRecord{}); err != nil {
			return err
		}
		return migrateCanonicalClientClasses(tx)
	})
}

// Set stores or updates a session
func (s *DBStore) Set(ctx context.Context, sessionID string, sess *Session) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	record, err := newSessionRecord(sessionID, sess)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := RevokeReplacedClientClassSessions(
			tx,
			record.UserID,
			record.DeviceType,
			record.SessionID,
			time.Now().UTC(),
		); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{
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
	})
}

func newSessionRecord(sessionID string, sess *Session) (*SessionRecord, error) {
	rawDeviceType, ok := sessionDataString(sess.Data, "device_type")
	if !ok {
		return nil, fmt.Errorf("%w: device_type is required", ErrInvalidDeviceType)
	}
	deviceType, err := ParseDeviceType(rawDeviceType)
	if err != nil {
		return nil, err
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
	}, nil
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
	if err := deviceType.Validate(); err != nil {
		return 0, err
	}
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

// RevokeByUser is the explicit account-wide revocation operation. Session
// activation must use RevokeReplacedClientClassSessions instead.
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
	if err := deviceType.Validate(); err != nil {
		return nil, err
	}
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

// CreateWithKick creates a new session in one canonical client-class slot.
func (s *DBStore) CreateWithKick(ctx context.Context, sess *Session, deviceType DeviceType) (*Session, int64, error) {
	if err := deviceType.Validate(); err != nil {
		return nil, 0, err
	}
	if sess.Data == nil {
		sess.Data = make(map[string]interface{})
	}
	sess.Data["device_type"] = string(deviceType)
	record, err := newSessionRecord(sess.ID, sess)
	if err != nil {
		return nil, 0, err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var kicked int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		kicked, err = RevokeReplacedClientClassSessions(
			tx,
			sess.UserID,
			deviceType,
			sess.ID,
			time.Now().UTC(),
		)
		if err != nil {
			return err
		}
		return tx.Create(record).Error
	})
	if err != nil {
		return nil, kicked, err
	}

	return sess, kicked, nil
}

// Takeover rotates one active session under the actor activation lock. The
// previous session must still be active when the transaction acquires the
// lock, so a stale takeover source cannot revoke a newer winner.
func (s *DBStore) Takeover(
	ctx context.Context,
	previousSessionID string,
	sess *Session,
	deviceType DeviceType,
) (*Session, int64, error) {
	if sess == nil {
		return nil, 0, errors.New("session takeover requires a replacement session")
	}
	if err := deviceType.Validate(); err != nil {
		return nil, 0, err
	}
	previousSessionID = strings.TrimSpace(previousSessionID)
	if previousSessionID == "" {
		return nil, 0, errors.New("session takeover requires a previous session id")
	}
	if sess.UserID == 0 {
		return nil, 0, errors.New("session takeover requires an actor id")
	}
	if strings.TrimSpace(sess.ID) == "" || sess.ID == previousSessionID {
		return nil, 0, errors.New("session takeover requires a distinct replacement session id")
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	now := time.Now().UTC()
	var kicked int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockActorForSessionActivation(tx, sess.UserID); err != nil {
			return err
		}

		var previous SessionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("session_id = ?", previousSessionID).
			Take(&previous).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		if previous.UserID != sess.UserID {
			return errors.New("session takeover actor binding mismatch")
		}
		if previous.Revoked {
			return ErrSessionRevoked
		}
		if !previous.ExpiresAt.After(now) {
			return ErrSessionExpired
		}
		if previous.DeviceType != deviceType {
			return errors.New("session takeover cannot change client class")
		}
		if strings.TrimSpace(previous.DeviceID) == "" {
			return errors.New("previous session has no device identity")
		}
		if previous.LifecycleGeneration == 0 {
			return errors.New("previous session has no lifecycle generation")
		}
		if strings.TrimSpace(previous.StationPeerID) == "" {
			return errors.New("previous session has no Station identity")
		}

		sess.Data = map[string]interface{}{
			"device_type":              string(previous.DeviceType),
			"oauth_candidate_id":       previous.OAuthCandidateID,
			"access_attempt_id":        previous.AccessAttemptID,
			"station_peer_id":          previous.StationPeerID,
			"access_decision_revision": previous.AccessDecisionRevision,
			"device_id":                previous.DeviceID,
			"lifecycle_generation":     previous.LifecycleGeneration,
			"auth_method":              "session_takeover",
		}
		record, err := newSessionRecord(sess.ID, sess)
		if err != nil {
			return err
		}

		if previous.OAuthCandidateID != "" || previous.AccessAttemptID != "" {
			if err := tx.Model(&SessionRecord{}).
				Where("id = ?", previous.ID).
				Updates(map[string]interface{}{
					"oauth_candidate_id": "",
					"access_attempt_id":  "",
				}).Error; err != nil {
				return err
			}
		}
		kicked, err = revokeReplacedClientClassSessionsLocked(
			tx,
			sess.UserID,
			deviceType,
			sess.ID,
			now,
		)
		if err != nil {
			return err
		}
		return tx.Create(record).Error
	})
	if err != nil {
		return nil, kicked, err
	}

	return sess, kicked, nil
}

// RevokeReplacedClientClassSessions serializes one actor's session activation
// and revokes only older active sessions in the same canonical client class.
func RevokeReplacedClientClassSessions(
	tx *gorm.DB,
	userID uint64,
	deviceType DeviceType,
	currentSessionID string,
	now time.Time,
) (int64, error) {
	if tx == nil {
		return 0, errors.New("session activation requires a database transaction")
	}
	if userID == 0 {
		return 0, errors.New("session activation requires an actor id")
	}
	if err := deviceType.Validate(); err != nil {
		return 0, err
	}
	currentSessionID = strings.TrimSpace(currentSessionID)
	if currentSessionID == "" {
		return 0, errors.New("session activation requires a session id")
	}

	if err := lockActorForSessionActivation(tx, userID); err != nil {
		return 0, err
	}
	return revokeReplacedClientClassSessionsLocked(
		tx,
		userID,
		deviceType,
		currentSessionID,
		now,
	)
}

func lockActorForSessionActivation(tx *gorm.DB, userID uint64) error {
	var actor struct {
		ID uint64
	}
	if err := tx.Table(actorTableName).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("id = ?", userID).
		Take(&actor).Error; err != nil {
		return fmt.Errorf("lock actor %d for session activation: %w", userID, err)
	}
	return nil
}

func revokeReplacedClientClassSessionsLocked(
	tx *gorm.DB,
	userID uint64,
	deviceType DeviceType,
	currentSessionID string,
	now time.Time,
) (int64, error) {
	result := tx.Model(&SessionRecord{}).
		Where(
			"user_id = ? AND device_type = ? AND session_id <> ? AND revoked = ?",
			userID,
			deviceType,
			currentSessionID,
			false,
		).
		Updates(map[string]interface{}{
			"revoked":        true,
			"revoked_at":     now,
			"revoked_reason": "kicked",
		})
	return result.RowsAffected, result.Error
}

func migrateCanonicalClientClasses(tx *gorm.DB) error {
	if err := tx.Model(&SessionRecord{}).
		Where("device_type = ?", "desktop-native").
		Update("device_type", DeviceTypeDesktop).Error; err != nil {
		return fmt.Errorf("normalize legacy desktop session class: %w", err)
	}
	if err := tx.Model(&SessionRecord{}).
		Where("device_type = ?", "desktop-browser").
		Update("device_type", DeviceTypeWeb).Error; err != nil {
		return fmt.Errorf("normalize legacy browser session class: %w", err)
	}

	var invalidCount int64
	if err := tx.Model(&SessionRecord{}).
		Where("device_type NOT IN ?", []DeviceType{
			DeviceTypeDesktop,
			DeviceTypeMobile,
			DeviceTypeWeb,
		}).
		Count(&invalidCount).Error; err != nil {
		return fmt.Errorf("count non-canonical session classes: %w", err)
	}
	if invalidCount > 0 {
		return fmt.Errorf("%w: actor_sessions contains %d non-canonical rows", ErrInvalidDeviceType, invalidCount)
	}

	var active []SessionRecord
	if err := tx.Where("revoked = ?", false).
		Order("user_id ASC, device_type ASC, created_at DESC, id DESC").
		Find(&active).Error; err != nil {
		return fmt.Errorf("load active sessions for class migration: %w", err)
	}

	seen := make(map[string]struct{}, len(active))
	duplicates := make([]uint64, 0)
	for i := range active {
		key := fmt.Sprintf("%d:%s", active[i].UserID, active[i].DeviceType)
		if _, exists := seen[key]; exists {
			duplicates = append(duplicates, active[i].ID)
			continue
		}
		seen[key] = struct{}{}
	}
	if len(duplicates) > 0 {
		now := time.Now().UTC()
		if err := tx.Model(&SessionRecord{}).
			Where("id IN ?", duplicates).
			Updates(map[string]interface{}{
				"revoked":        true,
				"revoked_at":     now,
				"revoked_reason": "kicked",
			}).Error; err != nil {
			return fmt.Errorf("revoke duplicate active client-class sessions: %w", err)
		}
	}

	if err := tx.Exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS " + activeClientClassIndex +
			" ON actor_sessions(user_id, device_type) WHERE revoked = false",
	).Error; err != nil {
		return fmt.Errorf("create active client-class session constraint: %w", err)
	}
	return nil
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
