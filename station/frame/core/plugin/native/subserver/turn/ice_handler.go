package turn

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type iceURL struct {
	name string
	path string
}

func (u iceURL) Name() string    { return u.name }
func (u iceURL) SubPath() string { return u.path }

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type TURNCredentials struct {
	Username   string    `json:"username"`
	Credential string    `json:"credential"`
	TTL        int64     `json:"ttl"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type ICEHandler struct {
	opts *Options
}

func NewICEHandler(opts *Options) *ICEHandler {
	return &ICEHandler{opts: opts}
}

func (h *ICEHandler) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			iceURL{name: "turn-ice-servers", path: "/api/v1/turn/ice-servers"},
			http.HandlerFunc(h.handleGetICEServers),
			server.WithMethod(server.GET),
		),
	}
}

func (h *ICEHandler) handleGetICEServers(w http.ResponseWriter, r *http.Request) {
	creds := h.GenerateCredentials("webrtc-user", 24*time.Hour)

	servers := []ICEServer{
		{
			URLs: []string{"stun:stun.l.google.com:19302"},
		},
		{
			URLs:       []string{fmt.Sprintf("turn:%s:%d", h.opts.PublicIP, h.opts.Port)},
			Username:   creds.Username,
			Credential: creds.Credential,
		},
		{
			URLs:       []string{fmt.Sprintf("turn:%s:%d?transport=tcp", h.opts.PublicIP, h.opts.Port)},
			Username:   creds.Username,
			Credential: creds.Credential,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"ice_servers":%s,"ttl":%d}`, mustMarshalICEServers(servers), creds.TTL)
}

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

func mustMarshalICEServers(servers []ICEServer) string {
	result := "["
	for i, s := range servers {
		if i > 0 {
			result += ","
		}
		result += fmt.Sprintf(`{"urls":[`)
		for j, url := range s.URLs {
			if j > 0 {
				result += ","
			}
			result += fmt.Sprintf(`"%s"`, url)
		}
		result += "]"
		if s.Username != "" {
			result += fmt.Sprintf(`,"username":"%s","credential":"%s"`, s.Username, s.Credential)
		}
		result += "}"
	}
	result += "]"
	return result
}
