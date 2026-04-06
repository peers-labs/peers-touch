// Package turn — ICE Server 配置 Handler。
//
// 端请求 GET /api/v1/turn/ice-servers 时，此 handler 聚合多源 ICE Server：
// 1. station: 本地 TURN SubServer 实时生成的凭证（最高优先级）
// 2. relay/public: 从 ICE Store 中查询的缓存凭证（Relay 注册时写入）
//
// 改造记录：
// - 原版：仅返回本地 TURN + 公共 STUN，无 Store 依赖
// - 改造：新增 ICEStore，聚合所有 source，返回带 source/priority 的完整列表
package turn

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	turnmodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// TURNCredentials 是本地 TURN 凭证的生成结果。
type TURNCredentials struct {
	Username   string    `json:"username"`
	Credential string    `json:"credential"`
	TTL        int64     `json:"ttl"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// ICEHandler 处理 ICE Server 配置请求。
// 支持从 ICEStore 聚合多来源的 ICE Server，与本地 TURN 实时凭证合并返回。
type ICEHandler struct {
	opts     *Options
	iceStore *ICEStore
}

// NewICEHandler 构造 ICE Handler。
// iceStore 可以为 nil（降级模式：仅返回本地 TURN 配置）。
func NewICEHandler(opts *Options, iceStore *ICEStore) *ICEHandler {
	return &ICEHandler{
		opts:     opts,
		iceStore: iceStore,
	}
}

func (h *ICEHandler) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler(
			"turn-ice-servers",
			"/api/v1/turn/ice-servers",
			server.GET,
			server.HTTPHandlerFunc(h.handleGetICEServers),
		),
	}
}

// handleGetICEServers 聚合所有来源的 ICE Server 配置。
//
// 聚合策略：
//  1. 先加入本地 TURN 实时生成的凭证（source=station, priority=1）
//  2. 再从 ICEStore 查询所有缓存的凭证（source=relay/public 等）
//  3. 按 priority 升序排列返回（数字越小优先级越高）
func (h *ICEHandler) handleGetICEServers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. 本地 TURN 实时凭证
	creds := h.GenerateCredentials("webrtc-user", 24*time.Hour)
	localServers := []turnmodel.ICEServerInfo{
		{
			URLs:     []string{"stun:stun.l.google.com:19302"},
			Source:   "public",
			Priority: 0,
		},
		{
			URLs:       []string{fmt.Sprintf("turn:%s:%d", h.opts.PublicIP, h.opts.Port)},
			Username:   creds.Username,
			Credential: creds.Credential,
			Source:     "station",
			Priority:   1,
		},
		{
			URLs:       []string{fmt.Sprintf("turn:%s:%d?transport=tcp", h.opts.PublicIP, h.opts.Port)},
			Username:   creds.Username,
			Credential: creds.Credential,
			Source:     "station",
			Priority:   1,
		},
	}

	// 2. 从 ICE Store 聚合缓存的凭证（relay、public 等来源）
	var cachedServers []turnmodel.ICEServerInfo
	if h.iceStore != nil {
		records, err := h.iceStore.ListAll(ctx)
		if err != nil {
			logger.Warnf(ctx, "[turn] failed to query ICE store: %v", err)
		} else if len(records) > 0 {
			cachedServers = ToICEServerInfoList(records)
		}
	}

	// 3. 合并：本地优先，缓存补充
	allServers := make([]turnmodel.ICEServerInfo, 0, len(localServers)+len(cachedServers))
	allServers = append(allServers, localServers...)
	allServers = append(allServers, cachedServers...)

	// 响应
	resp, _ := json.Marshal(map[string]interface{}{
		"ice_servers": allServers,
		"ttl":         creds.TTL,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(resp)
}

// GenerateCredentials 基于 HMAC-SHA1 生成 TURN 临时凭证。
// 使用 TURN auth-secret 签名，格式为 "timestamp:username"。
func (h *ICEHandler) GenerateCredentials(username string, ttl time.Duration) TURNCredentials {
	expiresAt := time.Now().Add(ttl)
	timestamp := expiresAt.Unix()
	tempUsername := fmt.Sprintf("%d:%s", timestamp, username)

	mac := hmac.New(sha1.New, []byte(h.opts.AuthSecret))
	mac.Write([]byte(tempUsername))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return TURNCredentials{
		Username:   tempUsername,
		Credential: credential,
		TTL:        int64(ttl.Seconds()),
		ExpiresAt:  expiresAt,
	}
}
