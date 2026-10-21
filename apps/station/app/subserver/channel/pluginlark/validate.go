package pluginlark

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
)

type CapabilityCheck struct {
	Capability     string
	Status         string
	RecoveryAction string
}

type ApplicationValidation struct {
	Valid        bool
	AppName      string
	BotOpenID    string
	TenantKey    string
	ConsoleURL   string
	ErrorMessage string
	Checks       []CapabilityCheck
}

func ValidateApplication(
	ctx context.Context,
	appID, appSecret, domain, region string,
) ApplicationValidation {
	result := ApplicationValidation{
		ConsoleURL: developerConsoleURL(appID, region),
	}
	appID = strings.TrimSpace(appID)
	appSecret = strings.TrimSpace(appSecret)
	if appID == "" || appSecret == "" {
		result.ErrorMessage = "App ID and App Secret are required."
		return result
	}
	options := make([]lark.ClientOptionFunc, 0, 1)
	if strings.TrimSpace(domain) != "" {
		options = append(options, lark.WithOpenBaseUrl(strings.TrimRight(domain, "/")))
	}
	client := lark.NewClient(appID, appSecret, options...)
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	response, err := client.Do(callCtx, &larkcore.ApiReq{
		HttpMethod: http.MethodGet, ApiPath: "/open-apis/bot/v3/info",
		SupportedAccessTokenTypes: []larkcore.AccessTokenType{larkcore.AccessTokenTypeTenant},
	})
	if err != nil {
		result.ErrorMessage = "Lark rejected the app credentials."
		result.Checks = append(result.Checks, CapabilityCheck{
			Capability: "identity", Status: "missing",
			RecoveryAction: "Check the App ID and App Secret.",
		})
		return result
	}
	var bot struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Bot  struct {
			AppName   string `json:"app_name"`
			OpenID    string `json:"open_id"`
			TenantKey string `json:"tenant_key"`
		} `json:"bot"`
	}
	if json.Unmarshal(response.RawBody, &bot) != nil || bot.Code != 0 {
		result.ErrorMessage = firstNonEmptyLocal(bot.Msg, "Unable to read the Lark bot identity.")
		result.Checks = append(result.Checks, CapabilityCheck{
			Capability: "identity", Status: "missing",
			RecoveryAction: "Enable Bot capability in Lark Developer Console.",
		})
		return result
	}
	result.AppName = bot.Bot.AppName
	result.BotOpenID = bot.Bot.OpenID
	result.TenantKey = bot.Bot.TenantKey
	result.Checks = append(result.Checks, CapabilityCheck{
		Capability: "identity", Status: "ready",
	})

	ws := newWSClient(WSConfig{
		AppID: appID, AppSecret: appSecret, BaseURL: domain,
	})
	endpointCtx, endpointCancel := context.WithTimeout(ctx, 10*time.Second)
	_, _, endpointErr := ws.getEndpoint(endpointCtx)
	endpointCancel()
	if endpointErr != nil {
		result.Checks = append(result.Checks, CapabilityCheck{
			Capability: "event_delivery", Status: "missing",
			RecoveryAction: "Enable long-connection event delivery and subscribe to im.message.receive_v1.",
		})
		result.ErrorMessage = endpointErr.Error()
		return result
	}
	result.Checks = append(result.Checks,
		CapabilityCheck{Capability: "event_delivery", Status: "ready"},
		CapabilityCheck{
			Capability: "message_send", Status: "ready",
			RecoveryAction: "Grant im:message:send_as_bot if sending is rejected.",
		},
		CapabilityCheck{
			Capability: "message_receive", Status: "ready",
			RecoveryAction: "Grant im:message and subscribe to im.message.receive_v1.",
		},
	)
	result.Valid = true
	return result
}

func developerConsoleURL(appID, region string) string {
	host := "https://open.feishu.cn"
	if strings.EqualFold(strings.TrimSpace(region), "lark") {
		host = "https://open.larksuite.com"
	}
	if strings.TrimSpace(appID) == "" {
		return host + "/app"
	}
	return host + "/app/" + url.PathEscape(strings.TrimSpace(appID))
}
