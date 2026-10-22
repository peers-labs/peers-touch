package provisioning

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// minPrivateChatScopes are the permissions needed for a bot that receives
// private 1:1 text messages and replies as the bot. Scope numeric ids are
// resolved live from the developer console; names are the documented ids.
// NOTE: exact scope availability/levels are verified against the real console
// during provisioning (UNPROVEN without a real developer account).
var minPrivateChatScopes = []string{
	"im:message",
	"im:message:send_as_bot",
	"im:message.p2p_msg:readonly",
	"im:chat:read",
	"im:chat:create",
	"contact:user.id:readonly",
}

// developerClient drives the (non-public) Feishu developer console HTTP API
// using the human session cookies captured by the QR login.
type developerClient struct {
	openBase string
	apiRoot  string
	httpc    *http.Client
	csrf     string

	sleep func(time.Duration)
	// establishWS opens a live long-connection so the console accepts
	// callbackMode=4; overridable in tests. Returns a cleanup.
	establishWS func(ctx context.Context, appID, appSecret string) (func(), error)
}

func newDeveloperClient(openBase string, httpc *http.Client) *developerClient {
	return &developerClient{
		openBase: strings.TrimRight(openBase, "/"),
		apiRoot:  strings.TrimRight(openBase, "/") + developerAPIPath,
		httpc:    httpc,
		sleep:    time.Sleep,
	}
}

func (d *developerClient) postJSON(ctx context.Context, path string, payload any) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.apiRoot+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if d.csrf != "" {
		req.Header.Set("x-csrf-token", d.csrf)
	}
	resp, err := d.httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response from %s: %w", path, err)
	}
	return result, nil
}

// fetchCSRF loads the console landing page and extracts window.csrfToken.
func (d *developerClient) fetchCSRF(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.openBase+csrfPagePath, nil)
	if err != nil {
		return err
	}
	resp, err := d.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("fetch CSRF page: %w", err)
	}
	defer resp.Body.Close()
	raw := make([]byte, 0, 1<<20)
	buf := make([]byte, 64<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		raw = append(raw, buf[:n]...)
		if len(raw) > 4<<20 {
			break
		}
		if rerr != nil {
			break
		}
	}
	const marker = `window.csrfToken="`
	pos := strings.Index(string(raw), marker)
	if pos < 0 {
		return fmt.Errorf("CSRF token not found (QR login may have failed or account lacks developer access)")
	}
	rest := string(raw)[pos+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return fmt.Errorf("CSRF token end not found")
	}
	d.csrf = rest[:end]
	return nil
}

// findApp returns the app id for an existing app with the given name, or "".
func (d *developerClient) findApp(ctx context.Context, appName string) (string, error) {
	resp, err := d.postJSON(ctx, "/app/list", map[string]any{
		"Count": 100, "Cursor": 0, "OrderBy": 0,
		"QueryFilter": map[string]any{
			"searchContent":          appName,
			"filterAppSceneTypeList": []int{0},
		},
	})
	if err != nil {
		return "", fmt.Errorf("list apps: %w", err)
	}
	if respCode(resp) != 0 {
		return "", fmt.Errorf("list apps failed: %s", respSummary(resp))
	}
	for _, a := range asMapSlice(respData(resp)["apps"]) {
		if asString(a["name"]) == appName {
			return asString(a["appID"]), nil
		}
	}
	return "", nil
}

func (d *developerClient) createApp(
	ctx context.Context,
	appName, appDescription string,
) (string, error) {
	resp, err := d.postJSON(ctx, "/app/create", map[string]any{
		"appSceneType": 0,
		"name":         appName,
		"desc":         appDescription,
		"i18n": map[string]any{
			"zh_cn": map[string]any{
				"name": appName, "description": appDescription,
			},
		},
		"primaryLang": "zh_cn",
	})
	if err != nil {
		return "", fmt.Errorf("create app: %w", err)
	}
	if respCode(resp) != 0 {
		return "", fmt.Errorf("create app failed: %s", respSummary(resp))
	}
	appID := respString(resp, "data", "ClientID")
	if appID == "" {
		return "", fmt.Errorf("ClientID missing in create response")
	}
	return appID, nil
}

func (d *developerClient) getAppSecret(ctx context.Context, appID string) (string, error) {
	resp, err := d.postJSON(ctx, "/secret/"+appID, map[string]any{})
	if err != nil || respCode(resp) != 0 {
		return "", fmt.Errorf("get secret failed: %s", respSummary(resp))
	}
	secret := respString(resp, "data", "secret")
	if secret == "" {
		return "", fmt.Errorf("secret missing in response")
	}
	return secret, nil
}

func (d *developerClient) enableBot(ctx context.Context, appID string) error {
	if resp, err := d.postJSON(ctx, "/robot/switch/"+appID, map[string]any{"enable": true}); err != nil || respCode(resp) != 0 {
		return fmt.Errorf("enable bot switch failed: %s", respSummary(resp))
	}
	if resp, err := d.postJSON(ctx, "/developer_panel/menu_ability", map[string]any{
		"clientId": appID, "ability": []string{"bot"},
	}); err != nil || respCode(resp) != 0 {
		return fmt.Errorf("enable bot ability failed: %s", respSummary(resp))
	}
	return nil
}

// importScopes adds the minimum private-chat scopes. The first submit carries
// both scope names and resolved numeric ids; when the console rejects the
// combined submit a numeric-only submit retries it. Failure of either is
// returned so the caller can surface the console URL instead of pretending
// success.
func (d *developerClient) importScopes(ctx context.Context, appID string) error {
	appIDs, userIDs, err := d.resolveScopeIDs(ctx, appID, minPrivateChatScopes)
	if err != nil {
		return err
	}
	resp, err := d.postJSON(ctx, "/scope/update/"+appID, map[string]any{
		"scopeIds":         minPrivateChatScopes,
		"appScopeIDs":      appIDs,
		"userScopeIDs":     userIDs,
		"operation":        "add",
		"isDeveloperPanel": true,
	})
	if err != nil {
		return fmt.Errorf("update permissions: %w", err)
	}
	if respCode(resp) == 0 {
		return nil
	}
	primary := respSummary(resp)

	numeric, err := d.postJSON(ctx, "/scope/update/"+appID, map[string]any{
		"scopeIds":         []string{},
		"appScopeIDs":      appIDs,
		"userScopeIDs":     userIDs,
		"operation":        "add",
		"isDeveloperPanel": true,
	})
	if err != nil {
		return fmt.Errorf("update permissions: %w", err)
	}
	if respCode(numeric) != 0 {
		return fmt.Errorf("update permissions failed: primary=%s numeric=%s", primary, respSummary(numeric))
	}
	return nil
}

// resolveScopeIDs maps scope names to numeric console ids. Embedded seed ids
// are authoritative for identity and the fallback values; a live /scope/all
// response refreshes the numeric ids when available, but never fails the flow.
func (d *developerClient) resolveScopeIDs(ctx context.Context, appID string, names []string) (appIDs, userIDs []string, err error) {
	live := map[string]string{}
	if resp, ferr := d.postJSON(ctx, "/scope/all/"+appID, map[string]any{}); ferr == nil && respCode(resp) == 0 {
		found := map[string]developerScope{}
		collectScopes(respData(resp), found)
		for name, info := range found {
			live[name] = info.ID
		}
	}
	for _, name := range names {
		seed, ok := embeddedScopes[name]
		if !ok {
			return nil, nil, fmt.Errorf("scope %s has no embedded metadata for app %s", name, appID)
		}
		id := seed.id
		if liveID := live[name]; liveID != "" {
			id = liveID
		}
		if seed.app {
			appIDs = append(appIDs, id)
		}
		if seed.user {
			userIDs = append(userIDs, id)
		}
	}
	return unique(appIDs), unique(userIDs), nil
}

// setLongConnection enables WebSocket event delivery. The console only accepts
// callbackMode=4 while a live connection exists, so establish one temporarily.
func (d *developerClient) setLongConnection(ctx context.Context, appID, appSecret string) error {
	if d.establishWS == nil {
		return fmt.Errorf("long-connection establisher not configured")
	}
	cleanup, err := d.establishWS(ctx, appID, appSecret)
	if err != nil {
		return fmt.Errorf("establish long connection: %w", err)
	}
	defer cleanup()

	// Clear stale mode, then switch to long connection (4).
	_, _ = d.postJSON(ctx, "/callback/switch/"+appID, map[string]any{"callbackMode": 0})
	d.sleep(time.Second)
	resp, err := d.postJSON(ctx, "/callback/switch/"+appID, map[string]any{"callbackMode": 4})
	if err != nil || respCode(resp) != 0 {
		return fmt.Errorf("set callback mode failed: %s", respSummary(resp))
	}
	return nil
}

// subscribePrivateMessage registers the private-message event (mode 4).
func (d *developerClient) subscribePrivateMessage(ctx context.Context, appID string) error {
	if resp, err := d.postJSON(ctx, "/event/switch/"+appID, map[string]any{"eventMode": 4}); err != nil || respCode(resp) != 0 {
		return fmt.Errorf("set event mode failed: %s", respSummary(resp))
	}
	resp, err := d.postJSON(ctx, "/event/update/"+appID, map[string]any{
		"operation": "add",
		"events":    []string{},
		"appEvents": []string{
			"im.message.receive_v1",
			"drive.file.edit_v1",
			"drive.file.title_updated_v1",
			"drive.file.created_in_folder_v1",
			"drive.file.deleted_v1",
			"drive.file.trashed_v1",
		},
		"userEvents": []string{},
		"eventMode":  4,
	})
	if err != nil || respCode(resp) != 0 {
		return fmt.Errorf("subscribe events failed: %s", respSummary(resp))
	}
	return nil
}
