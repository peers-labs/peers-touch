package provisioning

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Manager owns in-memory QR setup sessions. Sessions are short lived and never
// persist credentials to disk.
type Manager struct {
	cfg      Config
	mu       sync.Mutex
	sessions map[string]*setupSession
}

type setupSession struct {
	mu             sync.Mutex
	login          *loginClient
	flowKey        string
	appName        string
	appDescription string
	cfg            Config

	status     PollStatus
	polling    bool
	processing bool
	completed  bool
	cancelled  bool
	bot        *botResult
	err        string
	expiresAt  time.Time
	timer      *time.Timer
	workCancel context.CancelFunc
}

// NewManager builds a provisioning manager for the given endpoint config.
func NewManager(cfg Config) *Manager {
	if cfg.WWWBase == "" {
		cfg.WWWBase = defaultWWWBase
	}
	return &Manager{cfg: cfg, sessions: map[string]*setupSession{}}
}

// Start begins a QR-login session and returns the token rendered as a QR.
func (m *Manager) Start(
	ctx context.Context,
	appName, appDescription, region string,
) (*QRStart, error) {
	cfg := configForRegion(m.cfg, region)
	httpc := newHTTPClient()
	lc := &loginClient{base: cfg.WWWBase, client: httpc}
	token, flowKey, err := lc.initQR(ctx)
	if err != nil {
		return nil, err
	}
	sid := uuid.NewString()
	now := time.Now()
	_, workCancel := context.WithCancel(context.Background())
	sess := &setupSession{
		login:          lc,
		flowKey:        flowKey,
		appName:        appName,
		appDescription: strings.TrimSpace(appDescription),
		cfg:            cfg,
		status:         StatusPending,
		expiresAt:      now.Add(qrSessionTTL),
		workCancel:     workCancel,
	}
	sess.timer = time.AfterFunc(qrSessionTTL, func() {
		m.mu.Lock()
		if cur, ok := m.sessions[sid]; ok && cur == sess && time.Now().After(cur.expiresAt) {
			cur.workCancel()
			delete(m.sessions, sid)
		}
		m.mu.Unlock()
	})
	m.mu.Lock()
	m.sessions[sid] = sess
	m.mu.Unlock()

	return &QRStart{
		SessionID: sid,
		QRPayload: fmt.Sprintf(`{"qrlogin":{"token":"%s"}}`, token),
		ExpiresIn: qrSessionTTL,
	}, nil
}

// Poll advances QR login and returns a non-blocking provisioning snapshot.
// The developer-console operation is owned by one background job per session.
func (m *Manager) Poll(ctx context.Context, sessionID string) *PollResult {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return &PollResult{Status: StatusNotFound}
	}

	sess.mu.Lock()
	if !sess.expiresAt.IsZero() && time.Now().After(sess.expiresAt) {
		sess.cancelled = true
		sess.mu.Unlock()
		m.deleteSession(sessionID, sess)
		return &PollResult{Status: StatusExpired}
	}
	if sess.completed {
		result := m.terminalResult(sess)
		sess.mu.Unlock()
		return result
	}
	if sess.processing {
		sess.mu.Unlock()
		return &PollResult{Status: StatusProcessing}
	}
	if sess.polling {
		status := sess.status
		sess.mu.Unlock()
		return &PollResult{Status: status}
	}
	sess.polling = true
	login := sess.login
	flowKey := sess.flowKey
	sess.mu.Unlock()

	nextStep, status, err := login.pollQR(ctx, flowKey)
	sess.mu.Lock()
	sess.polling = false
	if sess.cancelled {
		sess.mu.Unlock()
		return &PollResult{Status: StatusNotFound}
	}
	if err != nil {
		sess.status = StatusError
		sess.mu.Unlock()
		return &PollResult{Status: StatusError, Error: err.Error()}
	}
	if nextStep != "enter_app" {
		switch {
		case status < 0:
			sess.status = StatusError
			sess.mu.Unlock()
			return &PollResult{Status: StatusError, Error: fmt.Sprintf("unexpected qr status %d", status)}
		case status <= 1:
			sess.status = StatusPending
			sess.mu.Unlock()
			return &PollResult{Status: StatusPending}
		default:
			sess.status = StatusScanned
			sess.mu.Unlock()
			return &PollResult{Status: StatusScanned}
		}
	}

	sess.processing = true
	sess.status = StatusProcessing
	workCtx, workCancel := context.WithCancel(context.Background())
	previousCancel := sess.workCancel
	sess.workCancel = workCancel
	sess.mu.Unlock()
	previousCancel()
	go m.completeProvisioning(workCtx, sessionID, sess)
	return &PollResult{Status: StatusProcessing}
}

func (m *Manager) completeProvisioning(
	ctx context.Context,
	sessionID string,
	sess *setupSession,
) {
	if err := syncSessionCookies(
		sess.login.client,
		sess.cfg.WWWBase,
		sess.cfg.OpenBase,
	); err != nil {
		m.completeProvisioningResult(sessionID, sess, nil, err)
		return
	}
	var bot *botResult
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		bot, lastErr = createBotWithClient(
			ctx,
			sess.cfg,
			sess.login.client,
			sess.appName,
			sess.appDescription,
		)
		if lastErr == nil {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(attempt+1) * 2 * time.Second):
		}
	}
	m.completeProvisioningResult(sessionID, sess, bot, lastErr)
}

func (m *Manager) completeProvisioningResult(
	sessionID string,
	sess *setupSession,
	bot *botResult,
	resultErr error,
) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if sess.cancelled {
		return
	}
	m.mu.Lock()
	current := m.sessions[sessionID]
	m.mu.Unlock()
	if current != sess {
		return
	}
	sess.processing = false
	sess.completed = true
	sess.expiresAt = time.Now().Add(completedSessionTTL)
	if sess.timer != nil {
		sess.timer.Reset(completedSessionTTL)
	}
	if resultErr != nil {
		sess.status = StatusError
		sess.err = resultErr.Error()
		return
	}
	sess.bot = bot
	if bot != nil && bot.online {
		sess.status = StatusSuccess
	} else {
		sess.status = StatusReviewRequired
	}
}

func (m *Manager) terminalResult(sess *setupSession) *PollResult {
	if sess.err != "" {
		return &PollResult{Status: StatusError, Error: sess.err}
	}
	if sess.bot == nil {
		return &PollResult{Status: StatusProcessing}
	}
	summary := sess.bot.summary(sess.cfg.OpenBase)
	if !sess.bot.online {
		return &PollResult{
			Status:     StatusReviewRequired,
			Bot:        summary,
			ConsoleURL: summary.ConsoleURL,
			Error:      "release requires tenant administrator approval; approve in the console then bind with app credentials",
		}
	}
	return &PollResult{Status: StatusSuccess, Bot: summary, ConsoleURL: summary.ConsoleURL}
}

// ConsumeCredential returns the created app credential exactly once and drops
// the session. Only an online, successful session yields a credential.
func (m *Manager) ConsumeCredential(sessionID string) (Credential, bool) {
	credential, summary, ok := m.SnapshotCredential(sessionID)
	if !ok || summary == nil || !summary.PublishedOnline {
		return Credential{}, false
	}
	m.CommitCredential(sessionID)
	return credential, true
}

// SnapshotCredential returns the completed credential without consuming the
// setup identity. The durable coordinator seals it before confirm and calls
// CommitCredential only after the binding transaction succeeds.
func (m *Manager) SnapshotCredential(sessionID string) (Credential, *BotSummary, bool) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return Credential{}, nil, false
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if !sess.completed || sess.bot == nil {
		return Credential{}, nil, false
	}
	cred := Credential{AppID: sess.bot.appID, AppSecret: sess.bot.appSecret}
	return cred, sess.bot.summary(sess.cfg.OpenBase), true
}

func (m *Manager) CommitCredential(sessionID string) {
	m.mu.Lock()
	sess := m.sessions[sessionID]
	m.mu.Unlock()
	if sess == nil {
		return
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	m.deleteSession(sessionID, sess)
}

func (m *Manager) Cancel(sessionID string) bool {
	m.mu.Lock()
	sess := m.sessions[sessionID]
	m.mu.Unlock()
	if sess == nil {
		return false
	}
	sess.mu.Lock()
	sess.cancelled = true
	defer sess.mu.Unlock()
	m.deleteSession(sessionID, sess)
	return true
}

func (m *Manager) deleteSession(sessionID string, sess *setupSession) {
	m.mu.Lock()
	if cur, ok := m.sessions[sessionID]; ok && cur == sess {
		if sess.workCancel != nil {
			sess.workCancel()
		}
		if sess.timer != nil {
			sess.timer.Stop()
		}
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()
}

func configForRegion(cfg Config, region string) Config {
	if strings.EqualFold(strings.TrimSpace(region), "lark") {
		if cfg.OpenBase == "" {
			cfg.OpenBase = defaultLarkOpenBase
		}
		if cfg.WSBase == "" {
			cfg.WSBase = defaultLarkWSBase
		}
	} else {
		if cfg.OpenBase == "" {
			cfg.OpenBase = defaultFeishuOpenBase
		}
		if cfg.WSBase == "" {
			cfg.WSBase = defaultFeishuWSBase
		}
	}
	if cfg.WWWBase == "" {
		cfg.WWWBase = defaultWWWBase
	}
	return cfg
}

func syncSessionCookies(client *http.Client, sourceBase, targetBase string) error {
	if client == nil || client.Jar == nil {
		return fmt.Errorf("provisioning cookie jar is unavailable")
	}
	sourceURL, err := url.Parse(sourceBase)
	if err != nil {
		return fmt.Errorf("parse login host: %w", err)
	}
	targetURL, err := url.Parse(targetBase)
	if err != nil {
		return fmt.Errorf("parse developer console host: %w", err)
	}
	if sourceURL.Host == targetURL.Host {
		return nil
	}
	cookies := client.Jar.Cookies(sourceURL)
	if len(cookies) == 0 {
		return fmt.Errorf("authenticated login session has no cookies")
	}
	copied := make([]*http.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		copied = append(copied, &http.Cookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Path:     "/",
			Secure:   targetURL.Scheme == "https",
			HttpOnly: cookie.HttpOnly,
			SameSite: cookie.SameSite,
		})
	}
	client.Jar.SetCookies(targetURL, copied)
	return nil
}
