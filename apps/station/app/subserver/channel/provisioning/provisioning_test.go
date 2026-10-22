package provisioning

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeFeishu simulates the consumer QR-login host and the developer console in
// one server, sharing the cookie jar exactly like production.
type fakeFeishu struct {
	mu sync.Mutex

	pollStep int
	review   bool // approval flow requires an independent approver

	versionCreated bool
	committed      bool
	scopeAllDown   bool

	paths        []string
	csrfOnPost   bool
	scopeUpdates []map[string]any
	appCreate    map[string]any
	createGate   <-chan struct{}
}

func (f *fakeFeishu) record(path string) {
	f.mu.Lock()
	f.paths = append(f.paths, path)
	f.mu.Unlock()
}

func (f *fakeFeishu) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, p := range f.paths {
		if p == path {
			n++
		}
	}
	return n
}

func (f *fakeFeishu) has(path string) bool { return f.count(path) > 0 }

func (f *fakeFeishu) handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/accounts/qrlogin/init", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-flow-key", "flow-xyz")
		_, _ = io.WriteString(w, `{"code":0,"data":{"step_info":{"token":"tok-1"}}}`)
	})

	mux.HandleFunc("/accounts/qrlogin/polling", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		step := f.pollStep
		f.pollStep++
		f.mu.Unlock()
		switch step {
		case 0:
			_, _ = io.WriteString(w, `{"code":0,"data":{"next_step":"","step_info":{"status":1}}}`)
		case 1:
			_, _ = io.WriteString(w, `{"code":0,"data":{"next_step":"","step_info":{"status":2}}}`)
		default:
			// Phone confirmed: the login session cookies now authenticate the
			// developer console.
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "authed"})
			_, _ = io.WriteString(w, `{"code":0,"data":{"next_step":"enter_app","step_info":{"status":3}}}`)
		}
	})

	mux.HandleFunc("/app", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `<html><script>window.csrfToken="csrf-123";</script></html>`)
	})

	mux.HandleFunc("/developers/v1/", func(w http.ResponseWriter, r *http.Request) {
		f.record(r.URL.Path)
		if r.Header.Get("x-csrf-token") == "csrf-123" {
			f.mu.Lock()
			f.csrfOnPost = true
			f.mu.Unlock()
		}
		write := func(body string) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, body)
		}
		p := r.URL.Path
		switch {
		case p == "/developers/v1/app/list":
			write(`{"code":0,"data":{"apps":[]}}`)
		case p == "/developers/v1/app/create":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			f.mu.Lock()
			f.appCreate = body
			gate := f.createGate
			f.mu.Unlock()
			if gate != nil {
				select {
				case <-gate:
				case <-r.Context().Done():
					return
				}
			}
			write(`{"code":0,"data":{"ClientID":"cli_test"}}`)
		case p == "/developers/v1/secret/cli_test":
			write(`{"code":0,"data":{"secret":"sec_test"}}`)
		case p == "/developers/v1/robot/switch/cli_test",
			p == "/developers/v1/developer_panel/menu_ability",
			p == "/developers/v1/callback/switch/cli_test",
			p == "/developers/v1/event/switch/cli_test",
			p == "/developers/v1/event/update/cli_test",
			p == "/developers/v1/config/audit_rule_notify/cli_test":
			write(`{"code":0,"data":{}}`)
		case p == "/developers/v1/scope/all/cli_test":
			f.mu.Lock()
			down := f.scopeAllDown
			f.mu.Unlock()
			if down {
				write(`{"code":999,"msg":"forbidden"}`)
				return
			}
			write(fakeScopeTree)
		case p == "/developers/v1/scope/update/cli_test":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			f.mu.Lock()
			f.scopeUpdates = append(f.scopeUpdates, body)
			f.mu.Unlock()
			write(`{"code":0,"data":{}}`)
		case p == "/developers/v1/contact_range/cli_test":
			write(`{"code":0,"data":{"contactRangeDetail":{"members":[{"id":"ou_owner"}]}}}`)
		case p == "/developers/v1/app_version/list/cli_test":
			f.mu.Lock()
			created := f.versionCreated
			f.mu.Unlock()
			if !created {
				write(`{"code":0,"data":{"versions":[]}}`)
				return
			}
			write(`{"code":0,"data":{"versions":[{"versionId":"ver-1","appVersion":"0.0.1","versionStatus":2}]}}`)
		case p == "/developers/v1/app_version/create/cli_test":
			f.mu.Lock()
			f.versionCreated = true
			f.mu.Unlock()
			write(`{"code":0,"data":{"versionId":"ver-1"}}`)
		case p == "/developers/v1/approval_nodes/get/cli_test":
			f.mu.Lock()
			review := f.review
			f.mu.Unlock()
			if review {
				write(`{"code":0,"data":{"canAutoApproval":false,"applyInstanceInfo":{"applyNodes":[{"nodeUser":[{"approver":{"id":"ou_boss"}}]}]}}}`)
				return
			}
			write(`{"code":0,"data":{"canAutoApproval":true}}`)
		case p == "/developers/v1/publish/commit/cli_test/ver-1":
			f.mu.Lock()
			f.committed = true
			f.mu.Unlock()
			write(`{"code":0,"data":{}}`)
		default:
			write(`{"code":404,"msg":"unknown path ` + p + `"}`)
		}
	})

	return mux
}

// Live ids differ from the embedded seed (l-prefix) so tests can prove the
// /scope/all refresh overrides seed ids while app/user identity is preserved.
const fakeScopeTree = `{"code":0,"data":{"groups":[{"scopes":[
{"name":"im:message","id":"l20001","scopeType2ScopeLevel":{"1":[1],"2":[1]}},
{"name":"im:message:send_as_bot","id":"l1000","scopeType2ScopeLevel":{"2":[1]}},
{"name":"im:message.p2p_msg:readonly","id":"l3000","scopeType2ScopeLevel":{"2":[1]}},
{"name":"im:chat:read","id":"l1014181","scopeType2ScopeLevel":{"1":[1],"2":[1]}},
{"name":"im:chat:create","id":"l1014178","scopeType2ScopeLevel":{"2":[1]}},
{"name":"contact:user.id:readonly","id":"l8","scopeType2ScopeLevel":{"1":[1],"2":[1]}}
]}]}}`

func newTestManager(t *testing.T, fake *fakeFeishu) (*Manager, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)

	wsOpened := 0
	wsClosed := 0
	cfg := Config{
		WWWBase:        server.URL,
		OpenBase:       server.URL,
		DefaultAppName: "Peers Assistant",
		consoleSleep:   func(time.Duration) {},
		wsEstablish: func(ctx context.Context, appID, appSecret string) (func(), error) {
			wsOpened++
			return func() { wsClosed++ }, nil
		},
	}
	m := NewManager(cfg)
	t.Cleanup(func() {
		if wsOpened == 0 && fake.createGate == nil {
			t.Errorf("ephemeral long connection never established")
		}
		if wsClosed != wsOpened {
			t.Errorf("ws cleanup not invoked: opened=%d closed=%d", wsOpened, wsClosed)
		}
	})
	return m, server
}

func waitForProvisioningResult(
	t *testing.T,
	manager *Manager,
	sessionID string,
) *PollResult {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result := manager.Poll(context.Background(), sessionID)
		if result.Status != StatusProcessing {
			return result
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("provisioning did not reach a terminal result")
	return nil
}

func TestManager_HappyPath(t *testing.T) {
	fake := &fakeFeishu{}
	m, _ := newTestManager(t, fake)
	ctx := context.Background()

	start, err := m.Start(
		ctx,
		"Peers Assistant",
		"Private research assistant",
		"feishu",
	)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if start.QRPayload != `{"qrlogin":{"token":"tok-1"}}` {
		t.Fatalf("unexpected qr payload %q", start.QRPayload)
	}
	if start.SessionID == "" {
		t.Fatal("empty session id")
	}

	pending := m.Poll(ctx, start.SessionID)
	if pending.Status != StatusPending {
		t.Fatalf("poll 1 = %s (%s), want pending", pending.Status, pending.Error)
	}
	scanned := m.Poll(ctx, start.SessionID)
	if scanned.Status != StatusScanned {
		t.Fatalf("poll 2 = %s (%s), want scanned", scanned.Status, scanned.Error)
	}
	processing := m.Poll(ctx, start.SessionID)
	if processing.Status != StatusProcessing {
		t.Fatalf("poll 3 = %s (%s), want processing", processing.Status, processing.Error)
	}
	done := waitForProvisioningResult(t, m, start.SessionID)
	if done.Status != StatusSuccess {
		t.Fatalf("terminal poll = %s (%s), want success", done.Status, done.Error)
	}
	if done.Bot == nil || done.Bot.AppID != "cli_test" || done.Bot.AppName != "Peers Assistant" {
		t.Fatalf("unexpected bot summary: %+v", done.Bot)
	}
	if done.Bot.OwnerProviderUserID != "ou_owner" {
		t.Fatalf("owner identity = %q", done.Bot.OwnerProviderUserID)
	}
	fake.mu.Lock()
	appDescription := fake.appCreate["desc"]
	fake.mu.Unlock()
	if appDescription != "Private research assistant" {
		t.Fatalf("app description = %#v", appDescription)
	}
	if !strings.HasSuffix(done.ConsoleURL, "/app/cli_test") {
		t.Fatalf("console url = %q", done.ConsoleURL)
	}

	cred, ok := m.ConsumeCredential(start.SessionID)
	if !ok || cred.AppID != "cli_test" || cred.AppSecret != "sec_test" {
		t.Fatalf("credential = %+v ok=%v", cred, ok)
	}
	if _, ok := m.ConsumeCredential(start.SessionID); ok {
		t.Fatal("credential must be consumable exactly once")
	}

	for _, want := range []string{
		"/developers/v1/app/list",
		"/developers/v1/app/create",
		"/developers/v1/secret/cli_test",
		"/developers/v1/scope/all/cli_test",
		"/developers/v1/scope/update/cli_test",
		"/developers/v1/callback/switch/cli_test",
		"/developers/v1/event/switch/cli_test",
		"/developers/v1/event/update/cli_test",
		"/developers/v1/contact_range/cli_test",
		"/developers/v1/app_version/create/cli_test",
		"/developers/v1/approval_nodes/get/cli_test",
		"/developers/v1/config/audit_rule_notify/cli_test",
		"/developers/v1/publish/commit/cli_test/ver-1",
	} {
		if !fake.has(want) {
			t.Errorf("developer console never called %s; sequence=%v", want, fake.paths)
		}
	}
	if fake.count("/developers/v1/callback/switch/cli_test") < 2 {
		t.Error("callback mode must be reset (0) then switched to long connection (4)")
	}
	if !fake.committed {
		t.Error("version was never committed")
	}
	if !fake.csrfOnPost {
		t.Error("developer POSTs did not carry the scraped CSRF token")
	}
	if len(fake.scopeUpdates) == 0 {
		t.Fatal("no scope update submitted")
	}
	first := fake.scopeUpdates[0]
	appIDs, _ := first["appScopeIDs"].([]any)
	joined := joinAny(appIDs)
	for _, want := range []string{"l1000", "l3000", "l20001"} {
		if !strings.Contains(joined, want) {
			t.Errorf("scope submit missing live id %s: %v", want, appIDs)
		}
	}
}

func TestManager_ReviewRequired(t *testing.T) {
	fake := &fakeFeishu{review: true}
	m, _ := newTestManager(t, fake)
	ctx := context.Background()

	start, err := m.Start(ctx, "Peers Assistant", "", "feishu")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res := m.Poll(ctx, start.SessionID); res.Status != StatusPending {
		t.Fatalf("poll 1 = %s, want pending", res.Status)
	}
	if res := m.Poll(ctx, start.SessionID); res.Status != StatusScanned {
		t.Fatalf("poll 2 = %s, want scanned", res.Status)
	}
	if res := m.Poll(ctx, start.SessionID); res.Status != StatusProcessing {
		t.Fatalf("poll 3 = %s (%s), want processing", res.Status, res.Error)
	}
	res := waitForProvisioningResult(t, m, start.SessionID)
	if res.Status != StatusReviewRequired {
		t.Fatalf("terminal poll = %s (%s), want review_required", res.Status, res.Error)
	}
	if !fake.committed {
		t.Error("version must be submitted for tenant review")
	}
	if _, ok := m.ConsumeCredential(start.SessionID); ok {
		t.Fatal("credential must not be consumable while release is pending review")
	}
}

func TestManager_PollDoesNotBlockAndCancelStopsProvisioning(t *testing.T) {
	gate := make(chan struct{})
	fake := &fakeFeishu{createGate: gate}
	manager, _ := newTestManager(t, fake)
	start, err := manager.Start(
		context.Background(),
		"Peers Assistant",
		"",
		"feishu",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result := manager.Poll(context.Background(), start.SessionID); result.Status != StatusPending {
		t.Fatalf("first poll = %s", result.Status)
	}
	if result := manager.Poll(context.Background(), start.SessionID); result.Status != StatusScanned {
		t.Fatalf("second poll = %s", result.Status)
	}
	startedAt := time.Now()
	if result := manager.Poll(context.Background(), start.SessionID); result.Status != StatusProcessing {
		t.Fatalf("third poll = %s", result.Status)
	}
	if elapsed := time.Since(startedAt); elapsed > 100*time.Millisecond {
		t.Fatalf("processing snapshot blocked for %s", elapsed)
	}
	if !manager.Cancel(start.SessionID) {
		t.Fatal("cancel did not own the active session")
	}
	if result := manager.Poll(context.Background(), start.SessionID); result.Status != StatusNotFound {
		t.Fatalf("poll after cancel = %s", result.Status)
	}
}

func TestManager_QRError(t *testing.T) {
	fake := &fakeFeishu{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/accounts/qrlogin/polling" {
			_, _ = io.WriteString(w, `{"code":0,"data":{"next_step":"","step_info":{"status":-1}}}`)
			return
		}
		fake.handler().ServeHTTP(w, r)
	}))
	defer server.Close()
	m := NewManager(Config{WWWBase: server.URL, OpenBase: server.URL})
	start, err := m.Start(context.Background(), "Peers Assistant", "", "feishu")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res := m.Poll(context.Background(), start.SessionID); res.Status != StatusError {
		t.Fatalf("status = %s, want error", res.Status)
	}
}

func TestManager_NotFound(t *testing.T) {
	m := NewManager(Config{})
	if res := m.Poll(context.Background(), "missing"); res.Status != StatusNotFound {
		t.Fatalf("status = %s, want not_found", res.Status)
	}
}

func TestManager_RegionSessionsKeepIndependentEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/accounts/qrlogin/init" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("x-flow-key", "flow-"+r.URL.Query().Get("_r"))
		_, _ = io.WriteString(w, `{"code":0,"data":{"step_info":{"token":"token"}}}`)
	}))
	defer server.Close()

	m := NewManager(Config{WWWBase: server.URL})
	feishu, err := m.Start(context.Background(), "Feishu Bot", "", "feishu")
	if err != nil {
		t.Fatalf("start feishu: %v", err)
	}
	lark, err := m.Start(context.Background(), "Lark Bot", "", "lark")
	if err != nil {
		t.Fatalf("start lark: %v", err)
	}
	t.Cleanup(func() {
		m.Cancel(feishu.SessionID)
		m.Cancel(lark.SessionID)
	})

	m.mu.Lock()
	feishuConfig := m.sessions[feishu.SessionID].cfg
	larkConfig := m.sessions[lark.SessionID].cfg
	m.mu.Unlock()
	if feishuConfig.OpenBase != defaultFeishuOpenBase ||
		feishuConfig.WSBase != defaultFeishuWSBase {
		t.Fatalf("unexpected feishu endpoints: %+v", feishuConfig)
	}
	if larkConfig.OpenBase != defaultLarkOpenBase ||
		larkConfig.WSBase != defaultLarkWSBase {
		t.Fatalf("unexpected lark endpoints: %+v", larkConfig)
	}
}

func TestSyncSessionCookiesCopiesAuthenticatedSessionToConsoleHost(t *testing.T) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	source, _ := url.Parse("https://www.feishu.cn")
	target, _ := url.Parse("https://open.larkoffice.com")
	jar.SetCookies(source, []*http.Cookie{{
		Name: "session", Value: "authenticated", Path: "/", HttpOnly: true,
	}})
	client := &http.Client{Jar: jar}

	if err := syncSessionCookies(client, source.String(), target.String()); err != nil {
		t.Fatalf("sync cookies: %v", err)
	}
	cookies := client.Jar.Cookies(target)
	if len(cookies) != 1 || cookies[0].Name != "session" ||
		cookies[0].Value != "authenticated" {
		t.Fatalf("unexpected target cookies: %+v", cookies)
	}
}

func TestInitQR_Failures(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"missing flow key": func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, `{"code":0,"data":{"step_info":{"token":"t"}}}`)
		},
		"empty token": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("x-flow-key", "k")
			_, _ = io.WriteString(w, `{"code":0,"data":{"step_info":{}}}`)
		},
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(h)
			defer server.Close()
			lc := &loginClient{base: server.URL, client: server.Client()}
			if _, _, err := lc.initQR(context.Background()); err == nil {
				t.Fatal("expected init error")
			}
		})
	}
}

func TestResolveScopeIDs_EmbeddedFallback(t *testing.T) {
	fake := &fakeFeishu{scopeAllDown: true}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	client := server.Client()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client.Jar = jar
	dev := newDeveloperClient(server.URL, client)
	dev.sleep = func(time.Duration) {}

	appIDs, userIDs, err := dev.resolveScopeIDs(context.Background(), "cli_test", minPrivateChatScopes)
	if err != nil {
		t.Fatalf("resolve with /scope/all down must fall back to seed: %v", err)
	}
	wantApp := []string{"20001", "1000", "3000", "1014181", "1014178", "8"}
	wantUser := []string{"20001", "1014181", "8"}
	if strings.Join(appIDs, ",") != strings.Join(wantApp, ",") {
		t.Fatalf("app ids = %v, want %v", appIDs, wantApp)
	}
	if strings.Join(userIDs, ",") != strings.Join(wantUser, ",") {
		t.Fatalf("user ids = %v, want %v", userIDs, wantUser)
	}
}

func TestBumpVersion(t *testing.T) {
	cases := map[string]string{
		"0.0.1": "0.0.2",
		"1.2.9": "1.2.10",
		"":      "0.0.1",
		"bad":   "0.0.1",
		"1.2":   "0.0.1",
	}
	for in, want := range cases {
		if got := bumpVersion(in); got != want {
			t.Errorf("bumpVersion(%q) = %q, want %q", in, got, want)
		}
	}
}

func joinAny(items []any) string {
	parts := make([]string, len(items))
	for i, v := range items {
		parts[i], _ = v.(string)
	}
	return strings.Join(parts, ",")
}
