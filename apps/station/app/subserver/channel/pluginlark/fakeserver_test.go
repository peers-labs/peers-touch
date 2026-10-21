package pluginlark_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

type fakeLarkServer struct {
	httpSrv  *httptest.Server
	upgrader websocket.Upgrader

	mu         sync.Mutex
	conns      []*websocket.Conn
	pushEvent  []byte
	gotPings   int
	gotReplies []larkws.Frame
	deliveries []deliveryCapture
}

type deliveryCapture struct {
	uuid      string
	receiveID string
	body      string
}

func newFakeLarkServer(t *testing.T, pushEvent []byte) *fakeLarkServer {
	t.Helper()
	s := &fakeLarkServer{pushEvent: pushEvent}
	s.upgrader = websocket.Upgrader{HandshakeTimeout: time.Second}
	mux := http.NewServeMux()
	mux.HandleFunc("/callback/ws/endpoint", s.handleEndpoint)
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/open-apis/im/v1/messages", s.handleSend)
	mux.HandleFunc("/open-apis/auth/v3/tenant_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0, "msg": "ok",
			"tenant_access_token": "t-tenant", "expire": 7200,
		})
	})
	s.httpSrv = httptest.NewServer(mux)
	t.Cleanup(s.httpSrv.Close)
	return s
}

func (s *fakeLarkServer) handleEndpoint(w http.ResponseWriter, _ *http.Request) {
	wsURL := "ws://" + strings.TrimPrefix(s.httpSrv.URL, "http://") + "/ws?service_id=7"
	resp := map[string]any{
		"code": 0,
		"data": map[string]any{
			"URL": wsURL,
			"ClientConfig": map[string]int{
				"ReconnectCount":    -1,
				"ReconnectInterval": 1,
				"ReconnectNonce":    0,
				"PingInterval":      600,
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *fakeLarkServer) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.conns = append(s.conns, conn)
	index := len(s.conns) - 1
	event := s.pushEvent
	s.mu.Unlock()

	defer conn.Close()
	if index == 0 && event != nil {
		_ = conn.WriteMessage(websocket.BinaryMessage, event)
	}
	for {
		_, body, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var frame larkws.Frame
		if err := frame.Unmarshal(body); err != nil {
			continue
		}
		if frame.Method == int32(larkws.FrameTypeControl) {
			s.mu.Lock()
			s.gotPings++
			s.mu.Unlock()
			continue
		}
		s.mu.Lock()
		s.gotReplies = append(s.gotReplies, frame)
		s.mu.Unlock()
	}
}

func (s *fakeLarkServer) handleSend(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.mu.Lock()
	s.deliveries = append(s.deliveries, deliveryCapture{
		uuid:      r.URL.Query().Get("uuid"),
		receiveID: r.URL.Query().Get("receive_id_type"),
		body:      body["content"].(string),
	})
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"code": 0,
		"msg":  "success",
		"data": map[string]any{"message_id": "om_reply_1"},
	})
}

func (s *fakeLarkServer) baseURL() string { return s.httpSrv.URL }

func (s *fakeLarkServer) snapshot() (conns, pings int, replies []larkws.Frame, deliveries []deliveryCapture) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns), s.gotPings, append([]larkws.Frame(nil), s.gotReplies...), append([]deliveryCapture(nil), s.deliveries...)
}

func (s *fakeLarkServer) closeAllConns() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.conns {
		_ = c.Close()
	}
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

var _ = context.Background
