package provisioning

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
)

// loginClient talks to the Feishu consumer QR-login endpoints. These are the
// same endpoints the Feishu web client uses; after the user confirms on the
// phone the session cookies in the shared jar authenticate the developer
// console client.
type loginClient struct {
	base   string
	client *http.Client
}

var loginHeaders = map[string]string{
	"x-app-id":        "2",
	"x-api-version":   "1.0.8",
	"x-locale":        "zh-CN",
	"x-terminal-type": "2",
	"x-device-info":   "device_id=0;device_name=Chrome;device_os=Mac;device_model=Chrome;channel=Release;package_name=feishu;tt_app_id=1658",
}

func newHTTPClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 30 * time.Second}
}

// initQR starts a QR login and returns the qrlogin token plus the flow key
// required on subsequent polls.
func (l *loginClient) initQR(ctx context.Context) (token, flowKey string, err error) {
	initURL := fmt.Sprintf("%s/accounts/qrlogin/init?_r%d=%d", strings.TrimRight(l.base, "/"),
		rand.Intn(70000)+10000, time.Now().UnixMilli())
	payload := `{"biz_type":null,"redirect_uri":""}`
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, initURL, strings.NewReader(payload))
	if err != nil {
		return "", "", err
	}
	l.setLoginHeaders(req)
	resp, err := l.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("qr init failed: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		Code int `json:"code"`
		Data struct {
			StepInfo struct {
				Token string `json:"token"`
			} `json:"step_info"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", fmt.Errorf("decode qr init: %w", err)
	}
	if out.Data.StepInfo.Token == "" {
		return "", "", fmt.Errorf("empty qr token (code=%d)", out.Code)
	}
	flowKey = resp.Header.Get("x-flow-key")
	if flowKey == "" {
		return "", "", fmt.Errorf("empty x-flow-key")
	}
	return out.Data.StepInfo.Token, flowKey, nil
}

// pollQR reports the login step. nextStep=="enter_app" means the human has
// authenticated; status differentiates pending vs scanned-before-confirm.
func (l *loginClient) pollQR(ctx context.Context, flowKey string) (nextStep string, status int, err error) {
	pollURL := fmt.Sprintf("%s/accounts/qrlogin/polling?_r%d=%d", strings.TrimRight(l.base, "/"),
		rand.Intn(70000)+10000, time.Now().UnixMilli())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pollURL, strings.NewReader(`{"biz_type":null}`))
	if err != nil {
		return "", 0, err
	}
	l.setLoginHeaders(req)
	req.Header.Set("x-flow-key", flowKey)
	resp, err := l.client.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("qr polling failed: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		Data struct {
			NextStep string `json:"next_step"`
			StepInfo struct {
				Status int `json:"status"`
			} `json:"step_info"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", 0, fmt.Errorf("decode qr polling: %w", err)
	}
	return out.Data.NextStep, out.Data.StepInfo.Status, nil
}

func (l *loginClient) setLoginHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	for k, v := range loginHeaders {
		req.Header.Set(k, v)
	}
}
