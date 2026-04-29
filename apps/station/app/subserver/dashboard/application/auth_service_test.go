// auth_service_test pins the contract between AuthService and the
// framework's coreauth.Provider after the η migration of the
// auth-unification refactor. The point: ValidateToken should
// reconstruct the same per-admin business fields (admin_id,
// username, role, session_id) that Login stamped, even though the
// JWT mechanics now live in the framework.
package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

type fakeAdminRepo struct {
	byUsername  map[string]*domain.DashboardAdmin
	byID        map[uint64]*domain.DashboardAdmin
	count       int64
	createdAdds []*domain.DashboardAdmin
	updateCalls int
}

func newFakeAdminRepo() *fakeAdminRepo {
	return &fakeAdminRepo{
		byUsername: map[string]*domain.DashboardAdmin{},
		byID:       map[uint64]*domain.DashboardAdmin{},
	}
}

func (r *fakeAdminRepo) Create(ctx context.Context, admin *domain.DashboardAdmin) error {
	if _, exists := r.byUsername[admin.Username]; exists {
		return errors.New("UNIQUE constraint failed")
	}
	if admin.ID == 0 {
		admin.ID = uint64(len(r.byID) + 1)
	}
	r.byUsername[admin.Username] = admin
	r.byID[admin.ID] = admin
	r.count++
	r.createdAdds = append(r.createdAdds, admin)
	return nil
}
func (r *fakeAdminRepo) FindByUsername(ctx context.Context, u string) (*domain.DashboardAdmin, error) {
	a, ok := r.byUsername[u]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return a, nil
}
func (r *fakeAdminRepo) FindByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error) {
	a, ok := r.byID[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return a, nil
}
func (r *fakeAdminRepo) FindActiveByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error) {
	a, ok := r.byID[id]
	if !ok || a.Disabled {
		return nil, gorm.ErrRecordNotFound
	}
	return a, nil
}
func (r *fakeAdminRepo) Update(ctx context.Context, admin *domain.DashboardAdmin, fields map[string]interface{}) error {
	r.updateCalls++
	if v, ok := fields["disabled"]; ok {
		admin.Disabled, _ = v.(bool)
	}
	return nil
}
func (r *fakeAdminRepo) Delete(ctx context.Context, admin *domain.DashboardAdmin) error {
	delete(r.byUsername, admin.Username)
	delete(r.byID, admin.ID)
	return nil
}
func (r *fakeAdminRepo) Count(ctx context.Context) (int64, error)         { return r.count, nil }
func (r *fakeAdminRepo) CountNonSuper(ctx context.Context) (int64, error) { return 0, nil }
func (r *fakeAdminRepo) RetireSuperUsers(ctx context.Context) error       { return nil }
func (r *fakeAdminRepo) ListAll(ctx context.Context) ([]domain.DashboardAdmin, error) {
	out := make([]domain.DashboardAdmin, 0, len(r.byID))
	for _, a := range r.byID {
		out = append(out, *a)
	}
	return out, nil
}

type fakeSessionRepo struct {
	created  []*domain.DashboardSession
	revoked  []uint64
	revokeID []string
}

func (r *fakeSessionRepo) Create(ctx context.Context, s *domain.DashboardSession) error {
	r.created = append(r.created, s)
	return nil
}
func (r *fakeSessionRepo) RevokeByAdminID(ctx context.Context, id uint64) error {
	r.revoked = append(r.revoked, id)
	return nil
}
func (r *fakeSessionRepo) RevokeBySessionID(ctx context.Context, sid string, id uint64) error {
	r.revokeID = append(r.revokeID, sid)
	return nil
}
func (r *fakeSessionRepo) RevokeBySessionIDOnly(ctx context.Context, sid string) error {
	r.revokeID = append(r.revokeID, sid)
	return nil
}
func (r *fakeSessionRepo) ListActive(ctx context.Context) ([]domain.DashboardSession, error) {
	return nil, nil
}
func (r *fakeSessionRepo) FindBySessionID(ctx context.Context, sid string) (*domain.DashboardSession, error) {
	return nil, gorm.ErrRecordNotFound
}

type fakeAuditRepo struct {
	records []string
}

func (r *fakeAuditRepo) Record(ctx context.Context, adminID uint64, username, action, resource, detail, ip, ua string) {
	r.records = append(r.records, action)
}
func (r *fakeAuditRepo) ListPaginated(ctx context.Context, page, pageSize int) ([]domain.DashboardAuditLog, int64, error) {
	return nil, 0, nil
}
func (r *fakeAuditRepo) ListRecent(ctx context.Context, limit int) ([]domain.DashboardAuditLog, error) {
	return nil, nil
}

// Compile-time interface checks.
var (
	_ infrastructure.AdminRepository   = (*fakeAdminRepo)(nil)
	_ infrastructure.SessionRepository = (*fakeSessionRepo)(nil)
	_ infrastructure.AuditRepository   = (*fakeAuditRepo)(nil)
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func newAuthSvc(t *testing.T) (*AuthService, *fakeAdminRepo, *fakeSessionRepo) {
	t.Helper()
	admins := newFakeAdminRepo()
	sessions := &fakeSessionRepo{}
	audit := &fakeAuditRepo{}
	provider := coreauth.NewJWTProvider("test-secret-please-rotate", time.Hour)
	return NewAuthService(admins, sessions, audit, provider, time.Hour), admins, sessions
}

func bootstrapAdmin(t *testing.T, svc *AuthService, admins *fakeAdminRepo, password string) *domain.DashboardAdmin {
	t.Helper()
	if err := svc.EnsureSuperUser(context.Background(), "alice", password); err != nil {
		t.Fatalf("ensure super user: %v", err)
	}
	a, err := admins.FindByUsername(context.Background(), "alice")
	if err != nil {
		t.Fatalf("find alice: %v", err)
	}
	return a
}

func TestAuth_LoginReturnsTokenAndSession(t *testing.T) {
	svc, admins, sessions := newAuthSvc(t)
	bootstrapAdmin(t, svc, admins, "p@ss")

	res, err := svc.Login(context.Background(), "alice", "p@ss", "127.0.0.1", "go-test")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if res.Token == "" {
		t.Errorf("expected non-empty token")
	}
	if res.SessionID == "" {
		t.Errorf("expected non-empty session id")
	}
	if res.Admin.Username != "alice" {
		t.Errorf("admin info username: %q", res.Admin.Username)
	}
	if len(sessions.created) != 1 {
		t.Errorf("expected 1 session created, got %d", len(sessions.created))
	}
}

func TestAuth_ValidateRoundTripsClaims(t *testing.T) {
	svc, admins, _ := newAuthSvc(t)
	bootstrapAdmin(t, svc, admins, "p@ss")

	res, err := svc.Login(context.Background(), "alice", "p@ss", "127.0.0.1", "go-test")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	claims, err := svc.ValidateToken(context.Background(), res.Token)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.AdminID != res.Admin.ID {
		t.Errorf("admin_id: got %d want %d", claims.AdminID, res.Admin.ID)
	}
	if claims.Username != "alice" {
		t.Errorf("username: %q", claims.Username)
	}
	if claims.Role != string(domain.AdminRoleSuper) {
		t.Errorf("role: %q", claims.Role)
	}
	if claims.SessionID != res.SessionID {
		t.Errorf("session_id: got %q want %q", claims.SessionID, res.SessionID)
	}
}

func TestAuth_ValidateRejectsForgedToken(t *testing.T) {
	svc, admins, _ := newAuthSvc(t)
	bootstrapAdmin(t, svc, admins, "p@ss")

	// Sign with a different secret.
	other := coreauth.NewJWTProvider("different-secret", time.Hour)
	_, tok, err := other.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: "1", SessionID: "fake",
	})
	if err != nil {
		t.Fatalf("forge: %v", err)
	}
	_, err = svc.ValidateToken(context.Background(), tok.Value)
	if !errors.Is(err, domain.ErrUnauthorized) {
		t.Errorf("expected ErrUnauthorized on forged token, got %v", err)
	}
}

func TestAuth_ValidateRejectsDisabledAdmin(t *testing.T) {
	svc, admins, _ := newAuthSvc(t)
	a := bootstrapAdmin(t, svc, admins, "p@ss")

	res, err := svc.Login(context.Background(), "alice", "p@ss", "127.0.0.1", "go-test")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	a.Disabled = true
	_, err = svc.ValidateToken(context.Background(), res.Token)
	if !errors.Is(err, domain.ErrUnauthorized) {
		t.Errorf("expected ErrUnauthorized on disabled admin, got %v", err)
	}
}

func TestAuth_LoginRejectsWrongPassword(t *testing.T) {
	svc, admins, _ := newAuthSvc(t)
	bootstrapAdmin(t, svc, admins, "right")

	_, err := svc.Login(context.Background(), "alice", "wrong", "127.0.0.1", "go-test")
	if !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestAuth_LoginRevokesPreviousSessions(t *testing.T) {
	svc, admins, sessions := newAuthSvc(t)
	bootstrapAdmin(t, svc, admins, "p@ss")
	if _, err := svc.Login(context.Background(), "alice", "p@ss", "1.1.1.1", "ua"); err != nil {
		t.Fatalf("login1: %v", err)
	}
	if _, err := svc.Login(context.Background(), "alice", "p@ss", "1.1.1.1", "ua"); err != nil {
		t.Fatalf("login2: %v", err)
	}
	// Two logins → at least two RevokeByAdminID calls
	if len(sessions.revoked) < 2 {
		t.Errorf("expected revoke called per login, got %v", sessions.revoked)
	}
}
