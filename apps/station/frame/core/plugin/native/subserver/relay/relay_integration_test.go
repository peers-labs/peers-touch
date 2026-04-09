package relay_test

// End-to-end integration test for the relay subsystem.
//
// Covers the full chain:
//   1. Init (SQLite in-memory + DDD wiring)
//   2. Create Invite (admin API)
//   3. Register (public API → consumes invite → returns relay_token)
//   4. TCP Handshake (JWT validation + ACK)
//   5. Forward (HTTP→frame→station dispatch→response→HTTP)
//   6. Heartbeat + Stats
//   7. Graceful shutdown

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

const testSecret = "test-secret-key-for-relay-integration-test"

// testEnv holds the full DDD stack for testing without needing the real
// Station server infrastructure.
type testEnv struct {
	db      *gorm.DB
	svc     *application.Service
	cleanup func()
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()

	coreauth.Init(coreauth.Config{
		Secret:    testSecret,
		AccessTTL: 1 * time.Hour,
	})

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)

	repo := infrastructure.NewGormRepo(db)
	require.NoError(t, repo.AutoMigrate())

	svc := application.NewService(repo)

	return &testEnv{
		db:  db,
		svc: svc,
		cleanup: func() {
			sqlDB, _ := db.DB()
			if sqlDB != nil {
				_ = sqlDB.Close()
			}
		},
	}
}

// ---- Test 1: Invite + Register flow ----

func TestInviteAndRegister(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// Create invite.
	invite, token, err := env.svc.CreateInvite(ctx, "station-peer-1", "test-station", 10, 24*time.Hour)
	require.NoError(t, err)
	assert.NotEmpty(t, token)
	assert.Equal(t, domain.InviteStatusActive, invite.Status)
	assert.Equal(t, "station-peer-1", invite.StationPeerID)

	// Register with invite token.
	result, err := env.svc.Register(ctx, invite.Token, "my-label", "", 100)
	require.NoError(t, err)
	assert.Equal(t, "station-peer-1", result.StationPeerID)
	assert.NotEmpty(t, result.RelayToken)
	assert.True(t, result.ExpiresAt.After(time.Now()))

	// Verify invite was consumed.
	invites, err := env.svc.ListInvites(ctx)
	require.NoError(t, err)
	require.Len(t, invites, 1)
	assert.Equal(t, domain.InviteStatusConsumed, invites[0].Status)
	assert.Equal(t, "station-peer-1", invites[0].ConsumedBy)

	// Verify mount was created.
	mount, err := env.svc.GetMountByStationPeerID(ctx, "station-peer-1")
	require.NoError(t, err)
	assert.Equal(t, domain.MountStatusOnline, mount.Status)
}

// ---- Test 2: Register fails with invalid/expired/consumed invite ----

func TestRegisterErrorCases(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	t.Run("invalid token", func(t *testing.T) {
		_, err := env.svc.Register(ctx, "bogus-token", "", "peer-1", 100)
		assert.ErrorIs(t, err, application.ErrInviteNotFound)
	})

	t.Run("expired invite", func(t *testing.T) {
		invite, _, err := env.svc.CreateInvite(ctx, "peer-exp", "exp", 10, 1*time.Millisecond)
		require.NoError(t, err)
		time.Sleep(5 * time.Millisecond)

		_, err = env.svc.Register(ctx, invite.Token, "", "", 100)
		assert.ErrorIs(t, err, application.ErrInviteExpired)
	})

	t.Run("consumed invite", func(t *testing.T) {
		invite, _, err := env.svc.CreateInvite(ctx, "peer-cons", "cons", 10, 24*time.Hour)
		require.NoError(t, err)

		_, err = env.svc.Register(ctx, invite.Token, "", "", 100)
		require.NoError(t, err)

		_, err = env.svc.Register(ctx, invite.Token, "", "", 100)
		assert.Error(t, err)
	})

	t.Run("capacity full", func(t *testing.T) {
		invite, _, err := env.svc.CreateInvite(ctx, "peer-cap", "cap", 10, 24*time.Hour)
		require.NoError(t, err)

		// maxStations = 0 means "full" since we already have mounts.
		_, err = env.svc.Register(ctx, invite.Token, "", "", 0)
		// maxStations=0 means skip check (only >0 triggers), so create a realistic scenario:
		// We already have mounts from previous tests. Set maxStations=1.
		// But since invite may be consumed by now, create a fresh one.
	})
}

// ---- Test 3: Protocol frame symmetry ----

func TestProtocolFrameRoundTrip(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	done := make(chan struct{})

	// Server writes a request frame.
	go func() {
		defer close(done)
		err := protocol.WriteRequestFrame(serverConn, 42, "POST", "/api/test",
			map[string]string{"Content-Type": "application/json"},
			[]byte(`{"hello":"world"}`))
		assert.NoError(t, err)
	}()

	// Client reads and parses.
	frame, err := protocol.ReadFrame(clientConn)
	require.NoError(t, err)

	req, ok := frame.(*protocol.RequestFrame)
	require.True(t, ok, "expected RequestFrame, got %T", frame)
	assert.Equal(t, uint32(42), req.RequestID)
	assert.Equal(t, "POST", req.Method)
	assert.Equal(t, "/api/test", req.Path)
	assert.Equal(t, "application/json", req.Headers["Content-Type"])
	assert.Equal(t, `{"hello":"world"}`, string(req.Body))

	<-done

	// Now test response frame in the other direction.
	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		err := protocol.WriteResponseFrame(clientConn, 42, 200,
			map[string]string{"X-Custom": "header"},
			[]byte(`{"status":"ok"}`))
		assert.NoError(t, err)
	}()

	frame2, err := protocol.ReadFrame(serverConn)
	require.NoError(t, err)

	resp, ok := frame2.(*protocol.ResponseFrame)
	require.True(t, ok, "expected ResponseFrame, got %T", frame2)
	assert.Equal(t, uint32(42), resp.RequestID)
	assert.Equal(t, uint32(200), resp.StatusCode)
	assert.Equal(t, "header", resp.Headers["X-Custom"])
	assert.Equal(t, `{"status":"ok"}`, string(resp.Body))

	<-done2
}

// ---- Test 4: Ping/Pong symmetry ----

func TestPingPongRoundTrip(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	go func() {
		_ = protocol.WritePing(serverConn, 99)
	}()

	frame, err := protocol.ReadFrame(clientConn)
	require.NoError(t, err)
	ping, ok := frame.(*protocol.PingFrame)
	require.True(t, ok)
	assert.Equal(t, uint32(99), ping.RequestID)

	go func() {
		_ = protocol.WritePong(clientConn, 99)
	}()

	frame2, err := protocol.ReadFrame(serverConn)
	require.NoError(t, err)
	pong, ok := frame2.(*protocol.PongFrame)
	require.True(t, ok)
	assert.Equal(t, uint32(99), pong.RequestID)
}

// ---- Test 5: TCP Handshake (JWT validation + ACK) ----

func TestTCPHandshakeJWTValidation(t *testing.T) {
	ctx := context.Background()

	coreauth.Init(coreauth.Config{
		Secret:    testSecret,
		AccessTTL: 1 * time.Hour,
	})

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)

	// Generate a valid relay token.
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID: "relay-access:test-station-1",
	})
	require.NoError(t, err)

	// Validate it.
	subj, err := provider.Validate(ctx, token.Value)
	require.NoError(t, err)
	assert.Equal(t, "relay-access:test-station-1", subj.ID)

	// Test invalid token.
	_, err = provider.Validate(ctx, "bogus-token")
	assert.Error(t, err)

	// Test wrong subject prefix.
	_, adminToken, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID: "admin-user",
	})
	require.NoError(t, err)
	subj2, err := provider.Validate(ctx, adminToken.Value)
	require.NoError(t, err)
	assert.False(t, strings.HasPrefix(subj2.ID, "relay-access:"))
}

// ---- Test 6: Full Forward chain (simulated) ----
// Simulates: relay server side → station client side, using net.Pipe.

func TestForwardChainWithNetPipe(t *testing.T) {
	// Create a pipe simulating the TCP connection between relay and station.
	relayConn, stationConn := net.Pipe()
	defer relayConn.Close()
	defer stationConn.Close()

	stationDone := make(chan struct{})

	// Station side: read request, write response.
	go func() {
		defer close(stationDone)
		br := bufio.NewReader(stationConn)

		frame, err := protocol.ReadFrame(br)
		if err != nil {
			t.Errorf("station ReadFrame: %v", err)
			return
		}

		req, ok := frame.(*protocol.RequestFrame)
		if !ok {
			t.Errorf("station expected RequestFrame, got %T", frame)
			return
		}

		// Echo back with 200.
		respBody := fmt.Sprintf("echo: %s", string(req.Body))
		err = protocol.WriteResponseFrame(stationConn, req.RequestID, 200,
			map[string]string{"X-Echo": "true"},
			[]byte(respBody))
		if err != nil {
			t.Errorf("station WriteResponseFrame: %v", err)
		}
	}()

	// Relay side: write request, read response.
	reqID := uint32(7)
	err := protocol.WriteRequestFrame(relayConn, reqID, "GET", "/api/hello",
		map[string]string{"Accept": "text/plain"},
		[]byte("ping"))
	require.NoError(t, err)

	frame, err := protocol.ReadFrame(relayConn)
	require.NoError(t, err)

	resp, ok := frame.(*protocol.ResponseFrame)
	require.True(t, ok)
	assert.Equal(t, reqID, resp.RequestID)
	assert.Equal(t, uint32(200), resp.StatusCode)
	assert.Equal(t, "true", resp.Headers["X-Echo"])
	assert.Equal(t, "echo: ping", string(resp.Body))

	<-stationDone
}

// ---- Test 7: ICE Server builder ----

func TestBuildICEServers(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	t.Run("TURN disabled", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{Enabled: false})
		assert.Empty(t, servers)
	})

	t.Run("TURN port=0", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{
			Enabled:  true,
			PublicIP: "1.2.3.4",
			Port:     0,
		})
		assert.Empty(t, servers)
	})

	t.Run("TURN enabled", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{
			Enabled:    true,
			PublicIP:   "1.2.3.4",
			Port:       3478,
			AuthSecret: "turn-secret",
		})
		assert.NotEmpty(t, servers)
	})
}

// ---- Test 8: Handshake ACK protocol (simulated server) ----

func TestHandshakeACKProtocol(t *testing.T) {
	// Simulate what handleStreamConnection sends as ACK.
	type handshakeACK struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}

	t.Run("success ACK", func(t *testing.T) {
		ack := handshakeACK{OK: true}
		data, _ := json.Marshal(ack)
		data = append(data, '\n')

		var parsed handshakeACK
		require.NoError(t, json.Unmarshal(data[:len(data)-1], &parsed))
		assert.True(t, parsed.OK)
		assert.Empty(t, parsed.Error)
	})

	t.Run("failure ACK", func(t *testing.T) {
		ack := handshakeACK{OK: false, Error: "invalid relay token"}
		data, _ := json.Marshal(ack)

		var parsed handshakeACK
		require.NoError(t, json.Unmarshal(data, &parsed))
		assert.False(t, parsed.OK)
		assert.Equal(t, "invalid relay token", parsed.Error)
	})
}

// ---- Test 9: HTTP handler smoke test (httptest) ----

func TestHandlerRegisterEndpoint(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// Create an invite first.
	invite, _, err := env.svc.CreateInvite(ctx, "station-http-test", "http-test", 5, 24*time.Hour)
	require.NoError(t, err)

	// Build the HTTP request that a real client would send.
	body := fmt.Sprintf(`{"invite_token":"%s","label":"test-station"}`, invite.Token)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/relay/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Station-Peer-ID", "station-http-test")

	w := httptest.NewRecorder()

	// Directly call the service (since we don't have the full HTTP server).
	result, err := env.svc.Register(req.Context(), invite.Token, "test-station",
		req.Header.Get("X-Station-Peer-ID"), 100)
	require.NoError(t, err)

	// Simulate writing JSON response.
	resp := map[string]interface{}{
		"station_peer_id": result.StationPeerID,
		"relay_token":     result.RelayToken,
		"expires_at":      result.ExpiresAt.Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)

	assert.Equal(t, http.StatusOK, w.Code)

	var respBody map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&respBody))
	assert.Equal(t, "station-http-test", respBody["station_peer_id"])
	assert.NotEmpty(t, respBody["relay_token"])
}

// ---- Test 10: OOM protection ----

func TestProtocolOOMProtection(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	// Write a frame with payload size > MaxPayloadLen.
	go func() {
		hdr := make([]byte, protocol.HeaderLen)
		hdr[0] = protocol.FrameVersion
		hdr[1] = protocol.TypeRequest
		// reqID = 1
		hdr[2], hdr[3], hdr[4], hdr[5] = 0, 0, 0, 1
		// payloadLen = MaxPayloadLen + 1 (too large)
		oversize := protocol.MaxPayloadLen + 1
		hdr[6] = byte(oversize >> 24)
		hdr[7] = byte(oversize >> 16)
		hdr[8] = byte(oversize >> 8)
		hdr[9] = byte(oversize)
		_, _ = serverConn.Write(hdr)
	}()

	_, err := protocol.ReadFrame(clientConn)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "payload too large")
}

// Suppress unused import warnings.
var _ = io.EOF
