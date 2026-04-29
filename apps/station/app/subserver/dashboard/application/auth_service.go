// Package application — AuthService orchestrates authentication, session
// management, and admin CRUD operations by composing domain logic with
// infrastructure repositories.
//
// Change History:
//   - 2026-04-10: Initial implementation — login, logout, token validation,
//     admin CRUD, super-user bootstrap, password change, session management.
//   - 2026-04-10: Refactored from flat auth.go into DDD application layer.
package application

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// dashboard-side claim attribute keys used to round-trip
// per-admin business fields through the framework jwtProvider's
// generic `attrs` claim. Lifted to constants so the marshaling
// (Login) and unmarshaling (ValidateToken) sides stay in sync —
// a typo on either side would silently produce empty fields.
const (
	attrUsername = "username"
	attrRole     = "role"
)

// AuthService handles all authentication, session, and admin CRUD operations.
//
// As of the auth-unification refactor it no longer owns its own HMAC
// JWT implementation — sign + parse delegate to the framework's
// `coreauth.Provider`. The session lifecycle (DashboardSession rows,
// revocation on password change, etc) stays here because it is a
// dashboard-specific concern: the framework's `SessionValidator`
// hook is not enough to express "rebuild a session from a 401-aware
// audit log" semantics.
type AuthService struct {
	adminRepo   infrastructure.AdminRepository
	sessionRepo infrastructure.SessionRepository
	auditRepo   infrastructure.AuditRepository
	jwtProvider coreauth.Provider
	sessionTTL  time.Duration
}

// NewAuthService constructs an AuthService bound to a framework
// `coreauth.Provider`. Callers (subserver.go) build the provider
// via `coreauth.NewJWTProvider(secret, sessionTTL)` so secret /
// TTL handling lives in one place across the binary.
//
// If sessionTTL is zero, it defaults to 24 hours.
func NewAuthService(
	adminRepo infrastructure.AdminRepository,
	sessionRepo infrastructure.SessionRepository,
	auditRepo infrastructure.AuditRepository,
	jwtProvider coreauth.Provider,
	sessionTTL time.Duration,
) *AuthService {
	if sessionTTL == 0 {
		sessionTTL = 24 * time.Hour
	}
	return &AuthService{
		adminRepo:   adminRepo,
		sessionRepo: sessionRepo,
		auditRepo:   auditRepo,
		jwtProvider: jwtProvider,
		sessionTTL:  sessionTTL,
	}
}

// ---------------------------------------------------------------------------
// Super-user bootstrap
// ---------------------------------------------------------------------------

// EnsureSuperUser creates the initial super user from config if no admins
// exist yet. Once any non-super admin is created the super user is disabled.
func (s *AuthService) EnsureSuperUser(ctx context.Context, username, password string) error {
	count, err := s.adminRepo.Count(ctx)
	if err != nil {
		return fmt.Errorf("failed to count admins: %w", err)
	}

	if count > 0 {
		log.Infof(ctx, "[dashboard] admins already exist, skip super user creation")
		return nil
	}

	hash, err := domain.HashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	admin := &domain.DashboardAdmin{
		Username:     username,
		PasswordHash: hash,
		DisplayName:  "Super Admin",
		Role:         domain.AdminRoleSuper,
		IsSuperUser:  true,
	}

	if err := s.adminRepo.Create(ctx, admin); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			log.Infof(ctx, "[dashboard] super user already exists")
			return nil
		}
		return fmt.Errorf("failed to create super user: %w", err)
	}

	log.Infof(ctx, "[dashboard] initial super user created: %s", username)
	return nil
}

// ---------------------------------------------------------------------------
// Login / Logout
// ---------------------------------------------------------------------------

// Login authenticates an admin and creates a new session.
// All previous sessions for the same admin are revoked upon success.
func (s *AuthService) Login(ctx context.Context, username, password, ip, userAgent string) (*domain.LoginResult, error) {
	admin, err := s.adminRepo.FindByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.auditRepo.Record(ctx, 0, username, "login_failed", "auth", "user not found", ip, userAgent)
			return nil, domain.ErrInvalidCredentials
		}
		return nil, fmt.Errorf("failed to query admin: %w", err)
	}

	if admin.Disabled {
		s.auditRepo.Record(ctx, admin.ID, username, "login_failed", "auth", "account disabled", ip, userAgent)
		return nil, domain.ErrAdminDisabled
	}

	// Check if the super user should be auto-retired
	if admin.IsSuperUser {
		nonSuperCount, _ := s.adminRepo.CountNonSuper(ctx)
		if nonSuperCount > 0 {
			_ = s.adminRepo.Update(ctx, admin, map[string]interface{}{"disabled": true})
			s.auditRepo.Record(ctx, admin.ID, username, "super_user_retired", "auth",
				"disabled because non-super admins exist", ip, userAgent)
			return nil, domain.ErrSuperUserExpired
		}
	}

	if !domain.CheckPassword(admin.PasswordHash, password) {
		s.auditRepo.Record(ctx, admin.ID, username, "login_failed", "auth", "wrong password", ip, userAgent)
		return nil, domain.ErrInvalidCredentials
	}

	// Revoke previous sessions
	_ = s.sessionRepo.RevokeByAdminID(ctx, admin.ID)

	// Generate cryptographically-random session ID
	sessionID, err := domain.GenerateSessionID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session id: %w", err)
	}

	// Mint the dashboard JWT through the framework provider.
	// Per-admin business fields ride in Credentials.Attributes;
	// the provider serialises them into the `attrs` claim so
	// ValidateToken can reconstruct the typed DashboardClaims
	// without re-querying the DB on every request.
	now := time.Now()
	subject, token, err := s.jwtProvider.Authenticate(ctx, coreauth.Credentials{
		SubjectID: strconv.FormatUint(admin.ID, 10),
		SessionID: sessionID,
		Attributes: map[string]string{
			attrUsername: admin.Username,
			attrRole:     string(admin.Role),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to mint dashboard jwt: %w", err)
	}
	if subject == nil || token == nil {
		// Defensive — a well-formed Provider returns both.
		return nil, errors.New("dashboard auth: jwt provider returned nil subject/token")
	}
	tokenStr := token.Value
	exp := token.ExpiresAt

	// Persist the session — independent of the JWT lifecycle so
	// password change / explicit logout can revoke a still-valid
	// JWT without touching the signing material.
	session := &domain.DashboardSession{
		SessionID:    sessionID,
		AdminID:      admin.ID,
		IPAddress:    ip,
		UserAgent:    userAgent,
		CreatedAt:    now,
		ExpiresAt:    exp,
		LastActiveAt: now,
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	// Update last login info
	_ = s.adminRepo.Update(ctx, admin, map[string]interface{}{
		"last_login_at": now,
		"last_login_ip": ip,
	})

	s.auditRepo.Record(ctx, admin.ID, username, "login_success", "auth",
		fmt.Sprintf("ip=%s", ip), ip, userAgent)

	return &domain.LoginResult{
		Token:     tokenStr,
		SessionID: sessionID,
		ExpiresAt: exp,
		Admin: domain.AdminInfo{
			ID:          admin.ID,
			Username:    admin.Username,
			DisplayName: admin.DisplayName,
			Role:        admin.Role,
			IsSuperUser: admin.IsSuperUser,
		},
	}, nil
}

// ValidateToken validates a JWT through the framework provider
// and returns the typed DashboardClaims. It additionally verifies
// the admin still exists and is not disabled — the framework
// handles signature + exp; admin liveness is dashboard business.
func (s *AuthService) ValidateToken(ctx context.Context, tokenStr string) (*domain.DashboardClaims, error) {
	subject, err := s.jwtProvider.Validate(ctx, tokenStr)
	if err != nil || subject == nil {
		return nil, domain.ErrUnauthorized
	}

	adminID, parseErr := strconv.ParseUint(subject.ID, 10, 64)
	if parseErr != nil {
		// Token shape we don't recognise — not a dashboard
		// JWT (e.g. someone forwarded a user-facing access
		// token here). Reject as auth failure rather than
		// 500.
		return nil, domain.ErrUnauthorized
	}

	if _, err := s.adminRepo.FindActiveByID(ctx, adminID); err != nil {
		return nil, domain.ErrUnauthorized
	}

	return &domain.DashboardClaims{
		AdminID:   adminID,
		Username:  subject.Attributes[attrUsername],
		Role:      subject.Attributes[attrRole],
		SessionID: subject.SessionID,
	}, nil
}

// Logout revokes a session identified by sessionID for the given admin.
func (s *AuthService) Logout(ctx context.Context, sessionID string, adminID uint64, ip, userAgent string) error {
	if err := s.sessionRepo.RevokeBySessionID(ctx, sessionID, adminID); err != nil {
		return err
	}

	admin, _ := s.adminRepo.FindByID(ctx, adminID)
	username := ""
	if admin != nil {
		username = admin.Username
	}
	s.auditRepo.Record(ctx, adminID, username, "logout", "auth", "", ip, userAgent)
	return nil
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

// CreateAdmin creates a new admin. The super user is retired once a real
// admin is created.
func (s *AuthService) CreateAdmin(ctx context.Context, req domain.CreateAdminRequest, creatorID uint64, ip, userAgent string) (*domain.DashboardAdmin, error) {
	hash, err := domain.HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	admin := &domain.DashboardAdmin{
		Username:     req.Username,
		PasswordHash: hash,
		DisplayName:  req.DisplayName,
		Role:         domain.AdminRoleAdmin,
		DID:          req.DID,
	}

	if err := s.adminRepo.Create(ctx, admin); err != nil {
		return nil, fmt.Errorf("failed to create admin: %w", err)
	}

	// Retire super user once a real admin exists
	_ = s.adminRepo.RetireSuperUsers(ctx)

	creator, _ := s.adminRepo.FindByID(ctx, creatorID)
	creatorName := ""
	if creator != nil {
		creatorName = creator.Username
	}
	s.auditRepo.Record(ctx, creatorID, creatorName, "create_admin", "admin",
		fmt.Sprintf("created user: %s", req.Username), ip, userAgent)

	log.Infof(ctx, "[dashboard] admin created: %s, super user retired", req.Username)
	return admin, nil
}

// ListAdmins returns all dashboard admins (soft-deleted excluded).
func (s *AuthService) ListAdmins(ctx context.Context) ([]domain.DashboardAdmin, error) {
	return s.adminRepo.ListAll(ctx)
}

// DisableAdmin disables an admin account and revokes all its sessions.
func (s *AuthService) DisableAdmin(ctx context.Context, adminID, operatorID uint64, ip, userAgent string) error {
	if adminID == operatorID {
		return errors.New("cannot disable your own account")
	}

	admin, err := s.adminRepo.FindByID(ctx, adminID)
	if err != nil {
		return err
	}

	if err := s.adminRepo.Update(ctx, admin, map[string]interface{}{"disabled": true}); err != nil {
		return err
	}

	// Revoke all sessions
	_ = s.sessionRepo.RevokeByAdminID(ctx, adminID)

	operator, _ := s.adminRepo.FindByID(ctx, operatorID)
	operatorName := ""
	if operator != nil {
		operatorName = operator.Username
	}
	s.auditRepo.Record(ctx, operatorID, operatorName, "disable_admin", "admin",
		fmt.Sprintf("disabled: %s", admin.Username), ip, userAgent)

	return nil
}

// EnableAdmin re-enables a disabled admin. Super users cannot be re-enabled.
func (s *AuthService) EnableAdmin(ctx context.Context, adminID, operatorID uint64, ip, userAgent string) error {
	admin, err := s.adminRepo.FindByID(ctx, adminID)
	if err != nil {
		return err
	}

	if admin.IsSuperUser {
		return errors.New("cannot re-enable super user")
	}

	if err := s.adminRepo.Update(ctx, admin, map[string]interface{}{"disabled": false}); err != nil {
		return err
	}

	operator, _ := s.adminRepo.FindByID(ctx, operatorID)
	operatorName := ""
	if operator != nil {
		operatorName = operator.Username
	}
	s.auditRepo.Record(ctx, operatorID, operatorName, "enable_admin", "admin",
		fmt.Sprintf("enabled: %s", admin.Username), ip, userAgent)

	return nil
}

// DeleteAdmin soft-deletes an admin and revokes all its sessions.
func (s *AuthService) DeleteAdmin(ctx context.Context, adminID, operatorID uint64, ip, userAgent string) error {
	if adminID == operatorID {
		return errors.New("cannot delete your own account")
	}

	admin, err := s.adminRepo.FindByID(ctx, adminID)
	if err != nil {
		return err
	}

	if err := s.adminRepo.Delete(ctx, admin); err != nil {
		return err
	}

	// Revoke all sessions
	_ = s.sessionRepo.RevokeByAdminID(ctx, adminID)

	operator, _ := s.adminRepo.FindByID(ctx, operatorID)
	operatorName := ""
	if operator != nil {
		operatorName = operator.Username
	}
	s.auditRepo.Record(ctx, operatorID, operatorName, "delete_admin", "admin",
		fmt.Sprintf("deleted: %s", admin.Username), ip, userAgent)

	return nil
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

// ChangePassword changes an admin's password and revokes all active sessions.
func (s *AuthService) ChangePassword(ctx context.Context, adminID uint64, oldPassword, newPassword, ip, userAgent string) error {
	admin, err := s.adminRepo.FindByID(ctx, adminID)
	if err != nil {
		return domain.ErrInvalidCredentials
	}

	if !domain.CheckPassword(admin.PasswordHash, oldPassword) {
		s.auditRepo.Record(ctx, adminID, admin.Username, "change_password_failed", "auth",
			"wrong old password", ip, userAgent)
		return domain.ErrInvalidCredentials
	}

	hash, err := domain.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	if err := s.adminRepo.Update(ctx, admin, map[string]interface{}{"password_hash": hash}); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// Revoke all sessions after password change
	_ = s.sessionRepo.RevokeByAdminID(ctx, adminID)

	s.auditRepo.Record(ctx, adminID, admin.Username, "change_password", "auth",
		"password changed, all sessions revoked", ip, userAgent)
	return nil
}

// ---------------------------------------------------------------------------
// Session queries
// ---------------------------------------------------------------------------

// GetActiveSessions retrieves all non-expired, non-revoked dashboard sessions.
func (s *AuthService) GetActiveSessions(ctx context.Context) ([]domain.DashboardSessionInfo, error) {
	records, err := s.sessionRepo.ListActive(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]domain.DashboardSessionInfo, 0, len(records))
	for _, r := range records {
		admin, _ := s.adminRepo.FindByID(ctx, r.AdminID)
		username := ""
		if admin != nil {
			username = admin.Username
		}
		result = append(result, domain.DashboardSessionInfo{
			SessionID:    r.SessionID,
			AdminID:      r.AdminID,
			Username:     username,
			IPAddress:    r.IPAddress,
			UserAgent:    r.UserAgent,
			CreatedAt:    r.CreatedAt,
			LastActiveAt: r.LastActiveAt,
			ExpiresAt:    r.ExpiresAt,
		})
	}

	return result, nil
}

// RevokeSession revokes a specific dashboard session.
func (s *AuthService) RevokeSession(ctx context.Context, sessionID string, operatorID uint64, ip, userAgent string) error {
	if err := s.sessionRepo.RevokeBySessionIDOnly(ctx, sessionID); err != nil {
		return err
	}

	operator, _ := s.adminRepo.FindByID(ctx, operatorID)
	operatorName := ""
	if operator != nil {
		operatorName = operator.Username
	}
	s.auditRepo.Record(ctx, operatorID, operatorName, "revoke_session", "session",
		fmt.Sprintf("revoked session: %s", sessionID), ip, userAgent)

	return nil
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

// GetAuditLogs retrieves audit logs with pagination.
func (s *AuthService) GetAuditLogs(ctx context.Context, page, pageSize int) ([]domain.DashboardAuditLog, int64, error) {
	return s.auditRepo.ListPaginated(ctx, page, pageSize)
}

// RecordAudit exposes audit recording for use by the handler layer.
func (s *AuthService) RecordAudit(ctx context.Context, adminID uint64, username, action, resource, detail, ip, userAgent string) {
	s.auditRepo.Record(ctx, adminID, username, action, resource, detail, ip, userAgent)
}
