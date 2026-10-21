package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"gorm.io/gorm"
)

const (
	requesterAuthDisconnected = "disconnected"
	requesterAuthPending      = "pending"
	requesterAuthReady        = "ready"
	requesterAuthNeedsRefresh = "needs_refresh"
	requesterAuthExpired      = "expired"
	requesterAuthScopeDenied  = "scope_denied"
	requesterAuthRevoked      = "revoked"
	requesterAuthFailed       = "failed"

	requesterAuthProfile     = "requester"
	requesterAuthLease       = 15 * time.Minute
	requesterCLIOutput       = 4 * 1024 * 1024
	requesterRefreshInterval = 10 * time.Minute
)

var requesterDomains = map[string]struct{}{
	"all":        {},
	"approval":   {},
	"apps":       {},
	"attendance": {},
	"base":       {},
	"calendar":   {},
	"contact":    {},
	"docs":       {},
	"drive":      {},
	"event":      {},
	"im":         {},
	"mail":       {},
	"markdown":   {},
	"minutes":    {},
	"note":       {},
	"okr":        {},
	"sheets":     {},
	"slides":     {},
	"task":       {},
	"vc":         {},
	"wiki":       {},
}

var managedLarkCLIIdentityEnv = map[string]struct{}{
	"FEISHU_APP_ID":                     {},
	"FEISHU_APP_SECRET":                 {},
	"HERMES_HOME":                       {},
	"LARK_APP_ID":                       {},
	"LARK_APP_SECRET":                   {},
	"LARK_CHANNEL":                      {},
	"LARKSUITE_CLI_APP_ID":              {},
	"LARKSUITE_CLI_APP_SECRET":          {},
	"LARKSUITE_CLI_AUTH_PROXY":          {},
	"LARKSUITE_CLI_BRAND":               {},
	"LARKSUITE_CLI_CONFIG_DIR":          {},
	"LARKSUITE_CLI_DATA_DIR":            {},
	"LARKSUITE_CLI_DEFAULT_AS":          {},
	"LARKSUITE_CLI_PROFILE":             {},
	"LARKSUITE_CLI_PROXY_KEY":           {},
	"LARKSUITE_CLI_STRICT_MODE":         {},
	"LARKSUITE_CLI_TENANT_ACCESS_TOKEN": {},
	"LARKSUITE_CLI_USER_ACCESS_TOKEN":   {},
	"OPENCLAW_CLI":                      {},
	"OPENCLAW_HOME":                     {},
}

type RequesterAuthorizationView struct {
	ID               string
	BindingID        string
	ProviderUserID   string
	TenantKey        string
	Region           string
	Status           string
	UserName         string
	Email            string
	GrantedScopes    []string
	RequestedDomains []string
	PendingDomains   []string
	RecoveryAction   string
	ErrorMessage     string
	VerificationURL  string
	ExpiresAt        *time.Time
	AccessExpiresAt  *time.Time
	LastVerifiedAt   *time.Time
	Revision         uint64
}

type StartRequesterAuthorizationInput struct {
	ActorPTID      string
	BindingID      string
	ProviderUserID string
	TenantKey      string
	Domains        []string
	IdempotencyKey string
}

type CLIInvocation struct {
	Args    []string
	Stdin   []byte
	WorkDir string
}

type LarkCLIRunner interface {
	Run(context.Context, string, CLIInvocation) ([]byte, []byte, error)
}

type managedLarkCLIRunner struct {
	executable string
}

func NewManagedLarkCLIRunner(configured string) (LarkCLIRunner, error) {
	candidates := []string{
		strings.TrimSpace(configured),
		strings.TrimSpace(os.Getenv("PT_CHANNEL_LARK_CLI")),
	}
	if found, err := exec.LookPath("lark-cli"); err == nil {
		candidates = append(candidates, found)
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		absolute, err := validateManagedLarkCLIExecutable(candidate)
		if err == nil {
			return &managedLarkCLIRunner{executable: absolute}, nil
		}
	}
	return nil, errors.New("managed lark-cli is unavailable")
}

func validateManagedLarkCLIExecutable(candidate string) (string, error) {
	absolute, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if info.IsDir() || info.Mode()&0o111 == 0 {
		return "", errors.New("lark-cli candidate is not executable")
	}
	file, err := os.Open(absolute)
	if err != nil {
		return "", err
	}
	defer file.Close()
	header := make([]byte, 64*1024)
	n, readErr := file.Read(header)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return "", readErr
	}
	header = header[:n]
	if bytes.HasPrefix(header, []byte("#!")) &&
		(bytes.Contains(header, []byte("LARKSUITE_CLI_CONFIG_DIR=")) ||
			bytes.Contains(header, []byte("LARKSUITE_CLI_DATA_DIR="))) {
		return "", errors.New("lark-cli wrapper overrides managed identity storage")
	}
	return absolute, nil
}

func (r *managedLarkCLIRunner) Run(
	ctx context.Context,
	configDir string,
	invocation CLIInvocation,
) ([]byte, []byte, error) {
	if r == nil || strings.TrimSpace(r.executable) == "" {
		return nil, nil, errors.New("managed lark-cli is unavailable")
	}
	if len(invocation.Args) == 0 {
		return nil, nil, errors.New("lark-cli arguments are required")
	}
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, nil, fmt.Errorf("create lark-cli profile directory: %w", err)
	}
	dataDir := filepath.Join(configDir, "data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, nil, fmt.Errorf("create lark-cli data directory: %w", err)
	}
	command := exec.CommandContext(ctx, r.executable, invocation.Args...)
	command.Env = append(managedLarkCLIEnvironment(os.Environ()),
		"LARKSUITE_CLI_CONFIG_DIR="+configDir,
		"LARKSUITE_CLI_DATA_DIR="+dataDir,
		"LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1",
		"LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1",
	)
	if invocation.WorkDir != "" {
		command.Dir = invocation.WorkDir
	}
	command.Stdin = bytes.NewReader(invocation.Stdin)
	stdout := &boundedBuffer{limit: requesterCLIOutput}
	stderr := &boundedBuffer{limit: requesterCLIOutput}
	command.Stdout = stdout
	command.Stderr = stderr
	err := command.Run()
	if stdout.overflow || stderr.overflow {
		return stdout.Bytes(), stderr.Bytes(), errors.New("lark-cli output exceeded the bounded limit")
	}
	return stdout.Bytes(), stderr.Bytes(), err
}

func managedLarkCLIEnvironment(current []string) []string {
	filtered := make([]string, 0, len(current))
	for _, entry := range current {
		name, _, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if _, remove := managedLarkCLIIdentityEnv[name]; remove || strings.HasSuffix(name, "_LARK_PROFILE") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

type boundedBuffer struct {
	buffer   bytes.Buffer
	limit    int
	overflow bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	original := len(p)
	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		b.overflow = true
		return original, nil
	}
	if len(p) > remaining {
		b.overflow = true
		p = p[:remaining]
	}
	_, _ = b.buffer.Write(p)
	return original, nil
}

func (b *boundedBuffer) Bytes() []byte {
	return append([]byte(nil), b.buffer.Bytes()...)
}

type requesterDeviceFlowSecret struct {
	DeviceCode      string `json:"device_code"`
	VerificationURL string `json:"verification_url"`
}

type RequesterAuthorizationService struct {
	db       *gorm.DB
	bindings *BindingService
	secrets  *secret.Service
	runner   LarkCLIRunner
	root     string
	now      func() time.Time

	runMu   sync.Mutex
	runCtx  context.Context
	running bool

	pendingMu sync.Mutex
	pending   map[string]*pendingAuthorizationProcess

	refreshMu  sync.Mutex
	refreshing bool
}

type pendingAuthorizationProcess struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func NewRequesterAuthorizationService(
	db *gorm.DB,
	bindings *BindingService,
	secrets *secret.Service,
	runner LarkCLIRunner,
	root string,
) *RequesterAuthorizationService {
	if strings.TrimSpace(root) == "" {
		if dataDir, err := appdir.Resolve("station", "data"); err == nil {
			root = filepath.Join(dataDir, "channel", "lark-requesters")
		} else {
			root = filepath.Join(os.TempDir(), "peers-touch", "lark-requesters")
		}
	}
	return &RequesterAuthorizationService{
		db: db, bindings: bindings, secrets: secrets, runner: runner,
		root: root, now: func() time.Time { return time.Now().UTC() },
		pending: make(map[string]*pendingAuthorizationProcess),
	}
}

func (s *RequesterAuthorizationService) Start(ctx context.Context) {
	if s == nil {
		return
	}
	s.runMu.Lock()
	if s.running {
		select {
		case <-s.runCtx.Done():
			s.running = false
		default:
			s.runMu.Unlock()
			return
		}
	}
	s.running = true
	s.runCtx = ctx
	s.runMu.Unlock()
	go func() {
		s.runRecovery(ctx)
		s.runMu.Lock()
		if s.runCtx == ctx {
			s.running = false
		}
		s.runMu.Unlock()
	}()
}

func (s *RequesterAuthorizationService) runRecovery(ctx context.Context) {
	pendingTicker := time.NewTicker(2 * time.Second)
	refreshTicker := time.NewTicker(requesterRefreshInterval)
	defer pendingTicker.Stop()
	defer refreshTicker.Stop()
	s.resumePending(ctx)
	s.triggerReadyRefresh(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-pendingTicker.C:
			s.resumePending(ctx)
		case <-refreshTicker.C:
			s.triggerReadyRefresh(ctx)
		}
	}
}

func (s *RequesterAuthorizationService) triggerReadyRefresh(ctx context.Context) {
	if s.runner == nil {
		return
	}
	s.refreshMu.Lock()
	if s.refreshing {
		s.refreshMu.Unlock()
		return
	}
	s.refreshing = true
	s.refreshMu.Unlock()
	go func() {
		defer func() {
			s.refreshMu.Lock()
			s.refreshing = false
			s.refreshMu.Unlock()
		}()
		s.refreshReadyAuthorizations(ctx)
	}()
}

func (s *RequesterAuthorizationService) refreshReadyAuthorizations(ctx context.Context) {
	now := s.now()
	var expired []persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).
		Where(
			"status IN ? AND expires_at IS NOT NULL AND expires_at <= ?",
			[]string{requesterAuthReady, requesterAuthNeedsRefresh},
			now,
		).Find(&expired).Error; err != nil {
		return
	}
	for i := range expired {
		_ = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			result := tx.Model(&persistence.ChannelRequesterAuthorization{}).
				Where(
					"id = ? AND revision = ? AND status IN ?",
					expired[i].ID,
					expired[i].Revision,
					[]string{requesterAuthReady, requesterAuthNeedsRefresh},
				).
				Updates(map[string]any{
					"status": requesterAuthExpired, "recovery_action": "reconnect",
					"error_message": "requester refresh grant expired",
					"revision":      expired[i].Revision + 1, "updated_at": now,
				})
			if result.Error != nil || result.RowsAffected != 1 {
				return result.Error
			}
			return tx.Model(&persistence.ChannelBinding{}).
				Where(
					"id = ? AND actor_ptid = ? AND personal_oauth_connection_id = ?",
					expired[i].BindingID,
					expired[i].ActorPTID,
					expired[i].ID,
				).
				Updates(map[string]any{
					"personal_oauth_status": requesterAuthExpired,
					"updated_at":            now,
				}).Error
		})
	}
	var records []persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).
		Where(
			"status IN ? AND (expires_at IS NULL OR expires_at > ?)",
			[]string{requesterAuthReady, requesterAuthNeedsRefresh},
			now,
		).
		Order("last_verified_at ASC, updated_at ASC").
		Limit(64).
		Find(&records).Error; err != nil {
		return
	}
	for i := range records {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_, _ = s.RefreshAuthorization(
			ctx,
			records[i].ActorPTID,
			records[i].BindingID,
			records[i].ID,
			records[i].Revision,
		)
	}
}

func (s *RequesterAuthorizationService) backgroundContext(fallback context.Context) context.Context {
	s.runMu.Lock()
	defer s.runMu.Unlock()
	if s.runCtx != nil {
		select {
		case <-s.runCtx.Done():
		default:
			return s.runCtx
		}
	}
	return context.WithoutCancel(fallback)
}

func (s *RequesterAuthorizationService) registerPendingProcess(
	id string,
	cancel context.CancelFunc,
) (*pendingAuthorizationProcess, bool) {
	process := &pendingAuthorizationProcess{cancel: cancel, done: make(chan struct{})}
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	if _, exists := s.pending[id]; exists {
		return nil, false
	}
	s.pending[id] = process
	return process, true
}

func (s *RequesterAuthorizationService) finishPendingProcess(
	id string,
	process *pendingAuthorizationProcess,
) {
	s.pendingMu.Lock()
	if s.pending[id] == process {
		delete(s.pending, id)
		close(process.done)
	}
	s.pendingMu.Unlock()
}

func (s *RequesterAuthorizationService) stopPendingProcess(
	ctx context.Context,
	id string,
) error {
	s.pendingMu.Lock()
	process := s.pending[id]
	s.pendingMu.Unlock()
	if process == nil {
		return nil
	}
	process.cancel()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-process.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return errors.New("requester authorization worker did not stop")
	}
}

func (s *RequesterAuthorizationService) StartAuthorization(
	ctx context.Context,
	in StartRequesterAuthorizationInput,
) (RequesterAuthorizationView, error) {
	if s == nil || s.db == nil || s.bindings == nil || s.secrets == nil {
		return RequesterAuthorizationView{}, fmt.Errorf("%w: requester authorization unavailable", ErrInvalidBinding)
	}
	if s.runner == nil {
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: managed lark-cli is unavailable", ErrInvalidBinding,
		)
	}
	in.ActorPTID = strings.TrimSpace(in.ActorPTID)
	in.BindingID = strings.TrimSpace(in.BindingID)
	in.ProviderUserID = strings.TrimSpace(in.ProviderUserID)
	in.TenantKey = strings.TrimSpace(in.TenantKey)
	in.IdempotencyKey = strings.TrimSpace(in.IdempotencyKey)
	if in.ActorPTID == "" || in.BindingID == "" || in.IdempotencyKey == "" {
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: actor, binding and idempotency key are required", ErrInvalidBinding,
		)
	}
	binding, err := s.bindings.loadForActor(in.ActorPTID, in.BindingID)
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	if !strings.EqualFold(binding.ProviderKind, "lark") {
		return RequesterAuthorizationView{}, fmt.Errorf("%w: binding is not a Lark provider", ErrInvalidBinding)
	}
	if in.ProviderUserID == "" {
		in.ProviderUserID = strings.TrimSpace(binding.OwnerProviderUserID)
	}
	if in.TenantKey == "" {
		in.TenantKey = strings.TrimSpace(binding.TenantKey)
	}
	if binding.TenantKey != "" && in.TenantKey != "" && binding.TenantKey != in.TenantKey {
		return RequesterAuthorizationView{}, fmt.Errorf("%w: requester tenant does not match binding", ErrInvalidBinding)
	}
	if in.TenantKey == "" {
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: wait for the Lark connection to report its tenant before authorizing a requester",
			ErrInvalidBinding,
		)
	}
	domains, scope, err := normalizeRequesterDomains(in.Domains)
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	var replay persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).Where(
		"attempt_key = ? AND actor_ptid = ?", in.IdempotencyKey, in.ActorPTID,
	).First(&replay).Error; err == nil {
		if replay.BindingID != in.BindingID ||
			replay.TenantKey != in.TenantKey ||
			(in.ProviderUserID != "" && replay.ProviderUserID != in.ProviderUserID) ||
			!requesterScopeIncludes(requesterAttemptScope(&replay), scope) {
			return RequesterAuthorizationView{}, fmt.Errorf("%w: requester authorization idempotency conflict", ErrInvalidBinding)
		}
		return s.view(ctx, &replay)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return RequesterAuthorizationView{}, err
	}

	reuseProfile := false
	previousStatus := ""
	existing, err := s.findAuthorizationByIdentity(ctx, binding, in)
	if err == nil {
		if existing.Status == requesterAuthPending &&
			(existing.AttemptExpiresAt == nil ||
				existing.AttemptExpiresAt.After(s.now())) {
			return s.view(ctx, existing)
		}
		if existing.Status == requesterAuthReady ||
			existing.Status == requesterAuthNeedsRefresh {
			if _, refreshErr := s.RefreshAuthorization(
				ctx,
				in.ActorPTID,
				in.BindingID,
				existing.ID,
				existing.Revision,
			); refreshErr != nil {
				return RequesterAuthorizationView{}, refreshErr
			}
			if err := s.db.WithContext(ctx).First(existing, "id = ?", existing.ID).Error; err != nil {
				return RequesterAuthorizationView{}, err
			}
			if requesterScopeIncludes(existing.RequestedScope, scope) ||
				existing.Status == requesterAuthNeedsRefresh {
				return s.view(ctx, existing)
			}
			if existing.Status != requesterAuthReady {
				return s.view(ctx, existing)
			}
			domains, scope = mergeRequesterScopes(existing.RequestedScope, scope)
			reuseProfile = true
			previousStatus = existing.Status
		} else {
			if err := s.clearAuthorizationProfile(ctx, existing, true, true); err != nil {
				return RequesterAuthorizationView{}, err
			}
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return RequesterAuthorizationView{}, err
	}

	record, err := s.prepareAttempt(ctx, binding, in, scope, reuseProfile)
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	configDir := s.profileDir(record.ID)
	if !reuseProfile {
		credential, credentialErr := s.bindings.CredentialForBinding(ctx, binding.ID)
		if credentialErr != nil {
			s.failAttempt(ctx, record.ID, "credential_unavailable", credentialErr)
			return RequesterAuthorizationView{}, credentialErr
		}
		brand := normalizedRegion(binding.Region, binding.Domain)
		_, stderr, runErr := s.runner.Run(ctx, configDir, CLIInvocation{
			Args: []string{
				"config", "init", "--name", requesterAuthProfile,
				"--app-id", credential.AppID, "--app-secret-stdin",
				"--brand", brand, "--lang", "zh_cn",
			},
			Stdin: []byte(credential.AppSecret + "\n"),
		})
		credential.AppSecret = ""
		if runErr != nil {
			cause := cliFailure("initialize managed lark-cli profile", stderr, runErr)
			s.failAttempt(ctx, record.ID, "cli_profile_failed", cause)
			_ = os.RemoveAll(configDir)
			return RequesterAuthorizationView{}, cause
		}
	}
	stdout, stderr, err := s.runner.Run(ctx, configDir, CLIInvocation{
		Args: []string{
			"--profile", requesterAuthProfile,
			"auth", "login", "--domain", strings.Join(domains, ","),
			"--no-wait", "--json",
		},
	})
	if err != nil {
		cause := cliFailure("start requester device authorization", stderr, err)
		s.failAuthorizationStart(
			ctx, record.ID, previousStatus, reuseProfile,
			"authorization_start_failed", cause,
		)
		if !reuseProfile {
			_ = os.RemoveAll(configDir)
		}
		return RequesterAuthorizationView{}, cause
	}
	var start struct {
		VerificationURL string `json:"verification_url"`
		DeviceCode      string `json:"device_code"`
		ExpiresIn       int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(stdout, &start); err != nil ||
		strings.TrimSpace(start.VerificationURL) == "" ||
		strings.TrimSpace(start.DeviceCode) == "" {
		cause := errors.New("lark-cli returned an invalid device authorization response")
		s.failAuthorizationStart(
			ctx, record.ID, previousStatus, reuseProfile,
			"authorization_response_invalid", cause,
		)
		if !reuseProfile {
			_ = os.RemoveAll(configDir)
		}
		return RequesterAuthorizationView{}, cause
	}
	if start.ExpiresIn <= 0 {
		start.ExpiresIn = 600
	}
	expiresAt := s.now().Add(time.Duration(start.ExpiresIn) * time.Second)
	secretPayload, _ := json.Marshal(requesterDeviceFlowSecret{
		DeviceCode: start.DeviceCode, VerificationURL: start.VerificationURL,
	})
	secretID, err := s.secrets.Put(ctx, secret.PutInput{
		ActorPTID: record.ActorPTID, Purpose: secret.PurposeChannelRequesterOAuth,
		Name: "requester:" + record.ID, Plaintext: secretPayload, ExpiresAt: &expiresAt,
	})
	if err != nil {
		s.failAuthorizationStart(
			ctx, record.ID, previousStatus, reuseProfile,
			"authorization_secret_failed", err,
		)
		if !reuseProfile {
			_ = os.RemoveAll(configDir)
		}
		return RequesterAuthorizationView{}, err
	}
	now := s.now()
	update := s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ? AND revision = ?", record.ID, record.Revision).
		Updates(map[string]any{
			"secret_id": secretID, "status": requesterAuthPending,
			"attempt_expires_at": expiresAt,
			"recovery_action":    "complete_authorization",
			"error_message":      "", "revision": record.Revision + 1, "updated_at": now,
		})
	if update.Error != nil || update.RowsAffected != 1 {
		_ = s.secrets.Delete(ctx, record.ActorPTID, secret.PurposeChannelRequesterOAuth, secretID)
		cause := update.Error
		if cause == nil {
			cause = errors.New("requester authorization changed during start")
		}
		s.failAuthorizationStart(
			ctx, record.ID, previousStatus, reuseProfile,
			"authorization_state_conflict", cause,
		)
		if !reuseProfile {
			_ = os.RemoveAll(configDir)
		}
		if update.Error != nil {
			return RequesterAuthorizationView{}, update.Error
		}
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: requester authorization changed during start",
			ErrInvalidBinding,
		)
	}
	var refreshed persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).Where("id = ?", record.ID).First(&refreshed).Error; err != nil {
		return RequesterAuthorizationView{}, err
	}
	go s.processPending(s.backgroundContext(ctx), refreshed.ID)
	return s.view(ctx, &refreshed)
}

func (s *RequesterAuthorizationService) findAuthorizationByIdentity(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	in StartRequesterAuthorizationInput,
) (*persistence.ChannelRequesterAuthorization, error) {
	query := s.db.WithContext(ctx).Where(
		"actor_ptid = ? AND binding_id = ? AND tenant_key = ? AND region = ?",
		in.ActorPTID,
		binding.ID,
		in.TenantKey,
		normalizedRegion(binding.Region, binding.Domain),
	)
	if in.ProviderUserID == "" {
		query = query.Where("provider_user_id = ''")
	} else {
		query = query.Where("provider_user_id = ?", in.ProviderUserID)
	}
	var record persistence.ChannelRequesterAuthorization
	err := query.Order("updated_at DESC").First(&record).Error
	return &record, err
}

func (s *RequesterAuthorizationService) clearAuthorizationProfile(
	ctx context.Context,
	record *persistence.ChannelRequesterAuthorization,
	revoke bool,
	stopWorker bool,
) error {
	if record == nil {
		return nil
	}
	if stopWorker {
		if err := s.stopPendingProcess(ctx, record.ID); err != nil {
			return err
		}
	}
	if revoke && record.Status != requesterAuthRevoked {
		if s.runner == nil {
			return errors.New("managed lark-cli is unavailable for requester revocation")
		}
		revokeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		_, stderr, err := s.runner.Run(revokeCtx, s.profileDir(record.ID), CLIInvocation{
			Args: []string{
				"--profile", requesterAuthProfile,
				"auth", "logout", "--json",
			},
		})
		if err != nil {
			return cliFailure("revoke previous requester authorization", stderr, err)
		}
	}
	if record.SecretID != "" {
		if err := s.secrets.Delete(
			ctx,
			record.ActorPTID,
			secret.PurposeChannelRequesterOAuth,
			record.SecretID,
		); err != nil && !errors.Is(err, secret.ErrSecretNotFound) {
			return err
		}
	}
	if err := os.RemoveAll(s.profileDir(record.ID)); err != nil {
		return fmt.Errorf("remove requester authorization profile: %w", err)
	}
	return nil
}

func normalizeRequesterDomains(domains []string) ([]string, string, error) {
	if len(domains) == 0 {
		domains = []string{"contact", "docs", "drive", "wiki"}
	}
	seen := make(map[string]struct{}, len(domains))
	normalized := make([]string, 0, len(domains))
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if _, ok := requesterDomains[domain]; !ok {
			return nil, "", fmt.Errorf("%w: unsupported requester authorization domain %q", ErrInvalidBinding, domain)
		}
		if _, duplicate := seen[domain]; duplicate {
			continue
		}
		seen[domain] = struct{}{}
		normalized = append(normalized, domain)
	}
	if _, all := seen["all"]; all {
		return []string{"all"}, "all", nil
	}
	sort.Strings(normalized)
	return normalized, strings.Join(normalized, ","), nil
}

func mergeRequesterScopes(current, requested string) ([]string, string) {
	merged := splitScopes(current + "," + requested)
	if slicesContain(merged, "all") {
		return []string{"all"}, "all"
	}
	return merged, strings.Join(merged, ",")
}

func requesterScopeIncludes(current, requested string) bool {
	currentValues := splitScopes(current)
	if slicesContain(currentValues, "all") {
		return true
	}
	currentSet := make(map[string]struct{}, len(currentValues))
	for _, value := range currentValues {
		currentSet[value] = struct{}{}
	}
	for _, value := range splitScopes(requested) {
		if _, ok := currentSet[value]; !ok {
			return false
		}
	}
	return true
}

func requesterAttemptScope(record *persistence.ChannelRequesterAuthorization) string {
	if record == nil {
		return ""
	}
	if record.PendingScope != "" {
		return record.PendingScope
	}
	return record.RequestedScope
}

func slicesContain(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *RequesterAuthorizationService) prepareAttempt(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	in StartRequesterAuthorizationInput,
	scope string,
	preserveGrant bool,
) (*persistence.ChannelRequesterAuthorization, error) {
	now := s.now()
	var result persistence.ChannelRequesterAuthorization
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"actor_ptid = ? AND binding_id = ? AND tenant_key = ? AND region = ?",
			in.ActorPTID,
			binding.ID,
			in.TenantKey,
			normalizedRegion(binding.Region, binding.Domain),
		)
		if in.ProviderUserID != "" {
			query = query.Where("provider_user_id = ?", in.ProviderUserID)
		} else {
			query = query.Where("provider_user_id = ''")
		}
		err := query.Order("updated_at DESC").First(&result).Error
		if err == nil {
			result.AttemptKey = in.IdempotencyKey
			result.TenantKey = in.TenantKey
			result.PendingScope = scope
			result.Status = requesterAuthPending
			result.RecoveryAction = "starting_authorization"
			result.ErrorMessage = ""
			result.SecretID = ""
			result.AttemptExpiresAt = nil
			result.LeaseToken = ""
			result.LeaseExpiresAt = nil
			result.RevokedAt = nil
			if !preserveGrant {
				result.RequestedScope = ""
				result.GrantedScopes = ""
				result.ExpiresAt = nil
				result.AccessExpiresAt = nil
				result.LastVerifiedAt = nil
			}
			result.Revision++
			result.UpdatedAt = now
			return tx.Save(&result).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		result = persistence.ChannelRequesterAuthorization{
			ID: newBindingID(), ActorPTID: in.ActorPTID, BindingID: binding.ID,
			ProviderUserID: in.ProviderUserID, TenantKey: in.TenantKey,
			Region: normalizedRegion(binding.Region, binding.Domain),
			Status: requesterAuthPending, PendingScope: scope,
			AttemptKey: in.IdempotencyKey, Revision: 1,
			RecoveryAction: "starting_authorization", CreatedAt: now, UpdatedAt: now,
		}
		return tx.Create(&result).Error
	})
	return &result, err
}

func (s *RequesterAuthorizationService) resumePending(ctx context.Context) {
	now := s.now()
	var records []persistence.ChannelRequesterAuthorization
	if s.runner != nil {
		if err := s.db.WithContext(ctx).
			Where(
				"status = ? AND secret_id <> '' AND attempt_expires_at > ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
				requesterAuthPending, now, now,
			).
			Order("updated_at ASC").Limit(8).Find(&records).Error; err != nil {
			return
		}
		for i := range records {
			go s.processPending(ctx, records[i].ID)
		}
	}
	var expired []persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).
		Where(
			"status = ? AND attempt_expires_at IS NOT NULL AND attempt_expires_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
			requesterAuthPending,
			now,
			now,
		).Find(&expired).Error; err != nil {
		return
	}
	for i := range expired {
		s.expirePendingAttempt(ctx, &expired[i], now)
	}
}

func (s *RequesterAuthorizationService) expirePendingAttempt(
	ctx context.Context,
	record *persistence.ChannelRequesterAuthorization,
	now time.Time,
) {
	status := requesterAuthExpired
	recovery := "restart_authorization"
	message := "authorization expired before completion"
	if record.RequestedScope != "" && record.ProviderUserID != "" {
		status = requesterAuthReady
		recovery = "retry_scope_upgrade"
		message = "additional authorization expired; existing access remains active"
	}
	result := s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ? AND revision = ? AND status = ?", record.ID, record.Revision, requesterAuthPending).
		Updates(map[string]any{
			"status": status, "recovery_action": recovery,
			"error_message": message, "pending_scope": "",
			"attempt_expires_at": nil, "secret_id": "",
			"lease_token": "", "lease_expires_at": nil,
			"revision": record.Revision + 1, "updated_at": now,
		})
	if result.Error == nil && result.RowsAffected == 1 && record.SecretID != "" {
		_ = s.secrets.Delete(
			ctx,
			record.ActorPTID,
			secret.PurposeChannelRequesterOAuth,
			record.SecretID,
		)
	}
}

func (s *RequesterAuthorizationService) processPending(ctx context.Context, id string) {
	if s == nil || s.db == nil || s.secrets == nil || s.runner == nil {
		return
	}
	lease := randomToken(16)
	now := s.now()
	result := s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where(
			"id = ? AND status = ? AND secret_id <> '' AND attempt_expires_at > ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
			id, requesterAuthPending, now, now,
		).
		Updates(map[string]any{
			"lease_token": lease, "lease_expires_at": now.Add(requesterAuthLease),
			"updated_at": now,
		})
	if result.Error != nil || result.RowsAffected != 1 {
		return
	}
	workerCtx, workerCancel := context.WithCancel(ctx)
	process, registered := s.registerPendingProcess(id, workerCancel)
	if !registered {
		workerCancel()
		s.releasePendingLease(context.WithoutCancel(ctx), id, lease)
		return
	}
	defer func() {
		workerCancel()
		s.finishPendingProcess(id, process)
	}()
	var record persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(workerCtx).Where("id = ? AND lease_token = ?", id, lease).
		First(&record).Error; err != nil {
		s.releasePendingLease(context.WithoutCancel(ctx), id, lease)
		return
	}
	raw, err := s.secrets.Get(
		workerCtx,
		record.ActorPTID,
		secret.PurposeChannelRequesterOAuth,
		record.SecretID,
	)
	if err != nil {
		s.finishPendingFailure(
			context.WithoutCancel(ctx),
			&record,
			lease,
			requesterAuthFailed,
			"restart_authorization",
			err,
		)
		return
	}
	var flow requesterDeviceFlowSecret
	if json.Unmarshal(raw, &flow) != nil || strings.TrimSpace(flow.DeviceCode) == "" {
		s.finishPendingFailure(
			ctx, &record, lease, requesterAuthFailed, "restart_authorization",
			errors.New("requester device authorization state is invalid"),
		)
		return
	}
	deadline := record.AttemptExpiresAt
	if deadline == nil {
		expires := now.Add(10 * time.Minute)
		deadline = &expires
	}
	commandCtx, deadlineCancel := context.WithDeadline(workerCtx, *deadline)
	defer deadlineCancel()
	_, stderr, err := s.runner.Run(commandCtx, s.profileDir(record.ID), CLIInvocation{
		Args: []string{
			"--profile", requesterAuthProfile,
			"auth", "login", "--device-code", flow.DeviceCode,
		},
	})
	if err != nil {
		if errors.Is(commandCtx.Err(), context.Canceled) {
			s.releasePendingLease(context.WithoutCancel(ctx), record.ID, lease)
			return
		}
		cause := cliFailure("complete requester device authorization", stderr, err)
		if record.RequestedScope != "" && record.ProviderUserID != "" {
			verifyErr := s.verifyReadyAuthorization(
				context.WithoutCancel(ctx),
				&record,
				lease,
				false,
				cause,
			)
			if verifyErr == nil {
				return
			}
			if errors.Is(verifyErr, errRequesterIdentityMismatch) {
				s.finishPendingFailure(
					context.WithoutCancel(ctx),
					&record,
					lease,
					requesterAuthFailed,
					"authorize_correct_requester",
					verifyErr,
				)
				_ = s.clearAuthorizationProfile(
					context.WithoutCancel(ctx),
					&record,
					true,
					false,
				)
				return
			}
			s.finishPendingFailure(
				context.WithoutCancel(ctx),
				&record,
				lease,
				requesterAuthNeedsRefresh,
				"retry_scope_upgrade",
				cause,
			)
			return
		}
		status := requesterAuthFailed
		recovery := "retry_authorization"
		if errors.Is(commandCtx.Err(), context.DeadlineExceeded) || !deadline.After(s.now()) {
			status = requesterAuthExpired
			recovery = "restart_authorization"
		}
		s.finishPendingFailure(context.WithoutCancel(ctx), &record, lease, status, recovery,
			cause)
		_ = s.clearAuthorizationProfile(
			context.WithoutCancel(ctx),
			&record,
			true,
			false,
		)
		return
	}
	if err := s.verifyReadyAuthorization(ctx, &record, lease, true, nil); err != nil {
		recovery := "retry_verification"
		if errors.Is(err, errRequesterIdentityMismatch) {
			recovery = "authorize_correct_requester"
			_ = s.clearAuthorizationProfile(
				context.WithoutCancel(ctx),
				&record,
				true,
				false,
			)
		}
		s.finishPendingFailure(
			context.WithoutCancel(ctx),
			&record,
			lease,
			requesterAuthFailed,
			recovery,
			err,
		)
	}
}

func (s *RequesterAuthorizationService) releasePendingLease(
	ctx context.Context,
	id, lease string,
) {
	_ = s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ? AND lease_token = ? AND status = ?", id, lease, requesterAuthPending).
		Updates(map[string]any{
			"lease_token": "", "lease_expires_at": nil,
			"recovery_action": "complete_authorization", "updated_at": s.now(),
		}).Error
}

var errRequesterIdentityMismatch = errors.New("authorized Lark user does not match the requester")

type requesterCLIStatus struct {
	Identity   string `json:"identity"`
	Identities struct {
		User struct {
			Status           string `json:"status"`
			Available        bool   `json:"available"`
			Verified         *bool  `json:"verified"`
			OpenID           string `json:"openId"`
			UserName         string `json:"userName"`
			Scope            string `json:"scope"`
			ExpiresAt        string `json:"expiresAt"`
			RefreshExpiresAt string `json:"refreshExpiresAt"`
		} `json:"user"`
	} `json:"identities"`
}

func (s *RequesterAuthorizationService) verifyReadyAuthorization(
	ctx context.Context,
	record *persistence.ChannelRequesterAuthorization,
	lease string,
	commitPendingScope bool,
	retainedError error,
) error {
	stdout, stderr, err := s.runner.Run(ctx, s.profileDir(record.ID), CLIInvocation{
		Args: []string{
			"--profile", requesterAuthProfile,
			"auth", "status", "--verify", "--json",
		},
	})
	if err != nil {
		return cliFailure("verify requester authorization", stderr, err)
	}
	var status requesterCLIStatus
	if err := json.Unmarshal(stdout, &status); err != nil {
		return fmt.Errorf("decode requester authorization status: %w", err)
	}
	user := status.Identities.User
	if !user.Available || user.OpenID == "" ||
		(user.Verified != nil && !*user.Verified) {
		return errors.New("lark requester identity is not available")
	}
	if record.ProviderUserID != "" && record.ProviderUserID != user.OpenID {
		return errRequesterIdentityMismatch
	}
	now := s.now()
	accessExpiresAt := parseCLIExpiry(user.ExpiresAt)
	expiresAt := parseCLIExpiry(user.RefreshExpiresAt)
	if expiresAt == nil {
		expiresAt = accessExpiresAt
	}
	updates := map[string]any{
		"provider_user_id": user.OpenID, "status": requesterAuthReady,
		"user_name": user.UserName, "granted_scopes": normalizedScopeString(user.Scope),
		"recovery_action": "", "error_message": "", "last_verified_at": now,
		"pending_scope": "", "attempt_expires_at": nil,
		"lease_token": "", "lease_expires_at": nil,
		"revision": gorm.Expr("revision + 1"), "updated_at": now,
	}
	if commitPendingScope && record.PendingScope != "" {
		updates["requested_scope"] = record.PendingScope
	}
	if retainedError != nil {
		updates["recovery_action"] = "retry_scope_upgrade"
		updates["error_message"] = redactDiagnostic(retainedError.Error())
	}
	if expiresAt != nil {
		updates["expires_at"] = expiresAt
	}
	if accessExpiresAt != nil {
		updates["access_expires_at"] = accessExpiresAt
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		bindingResult := tx.Model(&persistence.ChannelBinding{}).
			Where(
				"id = ? AND actor_ptid = ? AND tenant_key = ? AND (owner_provider_user_id = '' OR owner_provider_user_id = ?)",
				record.BindingID,
				record.ActorPTID,
				record.TenantKey,
				user.OpenID,
			).
			Updates(map[string]any{
				"owner_provider_user_id":       user.OpenID,
				"personal_oauth_connection_id": record.ID,
				"personal_oauth_status":        requesterAuthReady,
				"updated_at":                   now,
			})
		if bindingResult.Error != nil {
			return bindingResult.Error
		}
		if bindingResult.RowsAffected != 1 {
			return errors.New("requester binding identity changed during authorization")
		}
		authResult := tx.Model(&persistence.ChannelRequesterAuthorization{}).
			Where(
				"id = ? AND lease_token = ? AND status = ?",
				record.ID,
				lease,
				requesterAuthPending,
			).
			Updates(updates)
		if authResult.Error != nil {
			return authResult.Error
		}
		if authResult.RowsAffected != 1 {
			return errors.New("requester authorization changed during verification")
		}
		return nil
	}); err != nil {
		return err
	}
	if record.SecretID != "" {
		_ = s.secrets.Delete(
			ctx, record.ActorPTID, secret.PurposeChannelRequesterOAuth, record.SecretID,
		)
		_ = s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
			Where("id = ?", record.ID).Update("secret_id", "").Error
	}
	return nil
}

func (s *RequesterAuthorizationService) finishPendingFailure(
	ctx context.Context,
	record *persistence.ChannelRequesterAuthorization,
	lease, status, recovery string,
	cause error,
) {
	now := s.now()
	result := s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ? AND lease_token = ?", record.ID, lease).
		Updates(map[string]any{
			"status": status, "recovery_action": recovery,
			"error_message": redactDiagnostic(cause.Error()),
			"pending_scope": "", "attempt_expires_at": nil,
			"secret_id": "", "lease_token": "",
			"lease_expires_at": nil,
			"revision":         gorm.Expr("revision + 1"), "updated_at": now,
		})
	if result.Error == nil && result.RowsAffected == 1 && record.SecretID != "" {
		_ = s.secrets.Delete(
			ctx,
			record.ActorPTID,
			secret.PurposeChannelRequesterOAuth,
			record.SecretID,
		)
	}
	_ = s.db.WithContext(ctx).Model(&persistence.ChannelBinding{}).
		Where("id = ? AND personal_oauth_connection_id = ?", record.BindingID, record.ID).
		Updates(map[string]any{
			"personal_oauth_status": status, "updated_at": now,
		}).Error
}

func (s *RequesterAuthorizationService) failAttempt(
	ctx context.Context,
	id, recovery string,
	cause error,
) {
	_ = s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ?", id).Updates(map[string]any{
		"status": requesterAuthFailed, "recovery_action": recovery,
		"error_message": redactDiagnostic(cause.Error()),
		"pending_scope": "",
		"revision":      gorm.Expr("revision + 1"), "updated_at": s.now(),
	}).Error
}

func (s *RequesterAuthorizationService) failAuthorizationStart(
	ctx context.Context,
	id, previousStatus string,
	preserveGrant bool,
	recovery string,
	cause error,
) {
	if !preserveGrant {
		s.failAttempt(ctx, id, recovery, cause)
		return
	}
	if previousStatus == "" {
		previousStatus = requesterAuthReady
	}
	_ = s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"status": previousStatus, "pending_scope": "",
			"recovery_action": "retry_scope_upgrade",
			"error_message":   redactDiagnostic(cause.Error()),
			"revision":        gorm.Expr("revision + 1"),
			"updated_at":      s.now(),
		}).Error
}

func (s *RequesterAuthorizationService) GetAuthorization(
	ctx context.Context,
	actorPTID, bindingID, providerUserID string,
) (RequesterAuthorizationView, error) {
	record, err := s.loadAuthorization(ctx, actorPTID, bindingID, "", providerUserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return RequesterAuthorizationView{
				BindingID: bindingID, Status: requesterAuthDisconnected,
			}, nil
		}
		return RequesterAuthorizationView{}, err
	}
	if record.Status == requesterAuthPending && record.AttemptExpiresAt != nil &&
		!record.AttemptExpiresAt.After(s.now()) {
		s.expirePendingAttempt(ctx, record, s.now())
		_ = s.db.WithContext(ctx).Where("id = ?", record.ID).First(record).Error
	}
	return s.view(ctx, record)
}

func (s *RequesterAuthorizationService) RefreshAuthorization(
	ctx context.Context,
	actorPTID, bindingID, authorizationID string,
	expectedRevision uint64,
) (RequesterAuthorizationView, error) {
	if s == nil || s.runner == nil {
		return RequesterAuthorizationView{}, errors.New("managed lark-cli is unavailable")
	}
	record, err := s.loadAuthorization(ctx, actorPTID, bindingID, authorizationID, "")
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	if expectedRevision == 0 || record.Revision != expectedRevision {
		return RequesterAuthorizationView{}, fmt.Errorf("%w: requester authorization revision conflict", ErrInvalidBinding)
	}
	stdout, stderr, runErr := s.runner.Run(ctx, s.profileDir(record.ID), CLIInvocation{
		Args: []string{
			"--profile", requesterAuthProfile,
			"auth", "status", "--verify", "--json",
		},
	})
	now := s.now()
	updates := map[string]any{
		"last_verified_at": now, "revision": record.Revision + 1, "updated_at": now,
	}
	identityMismatch := false
	if runErr != nil {
		updates["status"] = requesterAuthNeedsRefresh
		updates["recovery_action"] = "retry_refresh"
		updates["error_message"] = redactDiagnostic(cliFailure(
			"refresh requester authorization", stderr, runErr,
		).Error())
	} else {
		var status requesterCLIStatus
		if err := json.Unmarshal(stdout, &status); err != nil {
			updates["status"] = requesterAuthNeedsRefresh
			updates["recovery_action"] = "retry_refresh"
			updates["error_message"] = "requester authorization is unavailable"
		} else {
			user := status.Identities.User
			switch {
			case !user.Available ||
				(user.Verified != nil && !*user.Verified):
				updates["status"] = requesterAuthNeedsRefresh
				updates["recovery_action"] = "retry_refresh"
				updates["error_message"] = "requester authorization is unavailable"
			case record.ProviderUserID != "" && user.OpenID != record.ProviderUserID:
				updates["status"] = requesterAuthFailed
				updates["recovery_action"] = "revoke"
				updates["error_message"] = "requester identity changed"
				identityMismatch = true
			default:
				updates["status"] = requesterAuthReady
				updates["provider_user_id"] = user.OpenID
				updates["user_name"] = user.UserName
				updates["granted_scopes"] = normalizedScopeString(user.Scope)
				updates["recovery_action"] = ""
				updates["error_message"] = ""
				accessExpires := parseCLIExpiry(user.ExpiresAt)
				expires := parseCLIExpiry(user.RefreshExpiresAt)
				if expires == nil {
					expires = accessExpires
				}
				if expires != nil {
					updates["expires_at"] = expires
				}
				if accessExpires != nil {
					updates["access_expires_at"] = accessExpires
				}
			}
		}
	}
	statusValue, _ := updates["status"].(string)
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&persistence.ChannelRequesterAuthorization{}).
			Where("id = ? AND revision = ?", record.ID, record.Revision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf(
				"%w: requester authorization changed concurrently",
				ErrInvalidBinding,
			)
		}
		bindingUpdates := map[string]any{
			"personal_oauth_status": statusValue,
			"updated_at":            now,
		}
		if identityMismatch {
			bindingUpdates["personal_oauth_connection_id"] = ""
		}
		return tx.Model(&persistence.ChannelBinding{}).
			Where(
				"id = ? AND actor_ptid = ? AND personal_oauth_connection_id = ?",
				record.BindingID,
				record.ActorPTID,
				record.ID,
			).
			Updates(bindingUpdates).Error
	}); err != nil {
		return RequesterAuthorizationView{}, err
	}
	if identityMismatch {
		if err := s.clearAuthorizationProfile(ctx, record, true, true); err != nil {
			return RequesterAuthorizationView{}, err
		}
	}
	return s.GetAuthorization(ctx, actorPTID, bindingID, record.ProviderUserID)
}

func (s *RequesterAuthorizationService) CancelAuthorization(
	ctx context.Context,
	actorPTID, bindingID, authorizationID string,
	expectedRevision uint64,
) (RequesterAuthorizationView, error) {
	record, err := s.loadAuthorization(ctx, actorPTID, bindingID, authorizationID, "")
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	if expectedRevision == 0 || record.Revision != expectedRevision {
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: requester authorization revision conflict",
			ErrInvalidBinding,
		)
	}
	if record.Status != requesterAuthPending {
		return s.view(ctx, record)
	}
	if err := s.stopPendingProcess(ctx, record.ID); err != nil {
		return RequesterAuthorizationView{}, err
	}
	if err := s.db.WithContext(ctx).First(&record, "id = ?", record.ID).Error; err != nil {
		return RequesterAuthorizationView{}, err
	}
	if record.Status != requesterAuthPending {
		return s.view(ctx, record)
	}
	if record.RequestedScope == "" || record.ProviderUserID == "" {
		return s.RevokeAuthorization(
			ctx,
			actorPTID,
			bindingID,
			record.ID,
			record.Revision,
		)
	}
	now := s.now()
	result := s.db.WithContext(ctx).Model(&persistence.ChannelRequesterAuthorization{}).
		Where(
			"id = ? AND revision = ? AND status = ?",
			record.ID,
			record.Revision,
			requesterAuthPending,
		).
		Updates(map[string]any{
			"status": requesterAuthReady, "pending_scope": "",
			"attempt_expires_at": nil, "secret_id": "",
			"lease_token": "", "lease_expires_at": nil,
			"recovery_action": "", "error_message": "",
			"revision": record.Revision + 1, "updated_at": now,
		})
	if result.Error != nil {
		return RequesterAuthorizationView{}, result.Error
	}
	if result.RowsAffected != 1 {
		return RequesterAuthorizationView{}, fmt.Errorf(
			"%w: requester authorization changed concurrently",
			ErrInvalidBinding,
		)
	}
	if record.SecretID != "" {
		_ = s.secrets.Delete(
			ctx,
			record.ActorPTID,
			secret.PurposeChannelRequesterOAuth,
			record.SecretID,
		)
	}
	_ = s.db.WithContext(ctx).Model(&persistence.ChannelBinding{}).
		Where(
			"id = ? AND actor_ptid = ? AND personal_oauth_connection_id = ?",
			record.BindingID,
			record.ActorPTID,
			record.ID,
		).
		Updates(map[string]any{
			"personal_oauth_status": requesterAuthReady,
			"updated_at":            now,
		}).Error
	return s.GetAuthorization(ctx, actorPTID, bindingID, record.ProviderUserID)
}

func (s *RequesterAuthorizationService) RevokeAuthorization(
	ctx context.Context,
	actorPTID, bindingID, authorizationID string,
	expectedRevision uint64,
) (RequesterAuthorizationView, error) {
	if s == nil || s.runner == nil {
		return RequesterAuthorizationView{}, errors.New("managed lark-cli is unavailable")
	}
	record, err := s.loadAuthorization(ctx, actorPTID, bindingID, authorizationID, "")
	if err != nil {
		return RequesterAuthorizationView{}, err
	}
	if expectedRevision == 0 || record.Revision != expectedRevision {
		return RequesterAuthorizationView{}, fmt.Errorf("%w: requester authorization revision conflict", ErrInvalidBinding)
	}
	if err := s.clearAuthorizationProfile(ctx, record, true, true); err != nil {
		return RequesterAuthorizationView{}, err
	}
	now := s.now()
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&persistence.ChannelRequesterAuthorization{}).
			Where("id = ? AND revision = ?", record.ID, record.Revision).
			Updates(map[string]any{
				"status": requesterAuthRevoked, "recovery_action": "authorize_again",
				"error_message": "", "secret_id": "", "revoked_at": now,
				"pending_scope": "", "attempt_expires_at": nil,
				"lease_token": "", "lease_expires_at": nil,
				"revision": record.Revision + 1, "updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf(
				"%w: requester authorization changed concurrently",
				ErrInvalidBinding,
			)
		}
		return tx.Model(&persistence.ChannelBinding{}).
			Where(
				"id = ? AND actor_ptid = ? AND personal_oauth_connection_id = ?",
				record.BindingID,
				record.ActorPTID,
				record.ID,
			).
			Updates(map[string]any{
				"personal_oauth_connection_id": "",
				"personal_oauth_status":        requesterAuthDisconnected,
				"updated_at":                   now,
			}).Error
	}); err != nil {
		return RequesterAuthorizationView{}, err
	}
	return s.GetAuthorization(ctx, actorPTID, bindingID, record.ProviderUserID)
}

func (s *RequesterAuthorizationService) RevokeForBinding(
	ctx context.Context,
	actorPTID, bindingID string,
) error {
	var records []persistence.ChannelRequesterAuthorization
	if err := s.db.WithContext(ctx).Where(
		"actor_ptid = ? AND binding_id = ? AND status <> ?",
		actorPTID, bindingID, requesterAuthRevoked,
	).Find(&records).Error; err != nil {
		return err
	}
	for i := range records {
		if _, err := s.RevokeAuthorization(
			ctx, actorPTID, bindingID, records[i].ID, records[i].Revision,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *RequesterAuthorizationService) loadAuthorization(
	ctx context.Context,
	actorPTID, bindingID, authorizationID, providerUserID string,
) (*persistence.ChannelRequesterAuthorization, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	query := s.db.WithContext(ctx).Where(
		"actor_ptid = ? AND binding_id = ?", strings.TrimSpace(actorPTID), strings.TrimSpace(bindingID),
	)
	if strings.TrimSpace(authorizationID) != "" {
		query = query.Where("id = ?", strings.TrimSpace(authorizationID))
	} else if strings.TrimSpace(providerUserID) != "" {
		query = query.Where("provider_user_id = ?", strings.TrimSpace(providerUserID))
	}
	var record persistence.ChannelRequesterAuthorization
	err := query.Order("updated_at DESC").First(&record).Error
	return &record, err
}

func (s *RequesterAuthorizationService) view(
	ctx context.Context,
	record *persistence.ChannelRequesterAuthorization,
) (RequesterAuthorizationView, error) {
	view := RequesterAuthorizationView{
		ID: record.ID, BindingID: record.BindingID,
		ProviderUserID: record.ProviderUserID, TenantKey: record.TenantKey,
		Region: record.Region, Status: record.Status, UserName: record.UserName,
		Email: record.Email, GrantedScopes: splitScopes(record.GrantedScopes),
		RequestedDomains: splitScopes(record.RequestedScope),
		PendingDomains:   splitScopes(record.PendingScope),
		RecoveryAction:   record.RecoveryAction,
		ErrorMessage:     redactDiagnostic(record.ErrorMessage),
		ExpiresAt:        record.ExpiresAt,
		AccessExpiresAt:  record.AccessExpiresAt,
		LastVerifiedAt:   record.LastVerifiedAt,
		Revision:         record.Revision,
	}
	if record.Status == requesterAuthPending && record.SecretID != "" {
		raw, err := s.secrets.Get(
			ctx, record.ActorPTID, secret.PurposeChannelRequesterOAuth, record.SecretID,
		)
		if err == nil {
			var flow requesterDeviceFlowSecret
			if json.Unmarshal(raw, &flow) == nil {
				view.VerificationURL = flow.VerificationURL
			}
		}
	}
	return view, nil
}

func (s *RequesterAuthorizationService) profileDir(id string) string {
	return filepath.Join(s.root, id)
}

func parseCLIExpiry(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	parsed = parsed.UTC()
	return &parsed
}

func normalizedScopeString(value string) string {
	return strings.Join(splitScopes(value), " ")
}

func splitScopes(value string) []string {
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return r == ' ' || r == ','
	})
	seen := make(map[string]struct{}, len(fields))
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if _, duplicate := seen[field]; duplicate {
			continue
		}
		seen[field] = struct{}{}
		result = append(result, field)
	}
	sort.Strings(result)
	return result
}

func cliFailure(operation string, stderr []byte, cause error) error {
	message := strings.TrimSpace(string(stderr))
	if message == "" {
		message = cause.Error()
	}
	var envelope struct {
		Error struct {
			Type    string `json:"type"`
			Subtype string `json:"subtype"`
			Message string `json:"message"`
			Hint    string `json:"hint"`
		} `json:"error"`
	}
	if json.Unmarshal(stderr, &envelope) == nil && envelope.Error.Message != "" {
		message = envelope.Error.Message
		if envelope.Error.Hint != "" {
			message += ": " + envelope.Error.Hint
		}
	}
	return fmt.Errorf("%s: %s", operation, redactDiagnostic(message))
}

var _ io.Writer = (*boundedBuffer)(nil)
