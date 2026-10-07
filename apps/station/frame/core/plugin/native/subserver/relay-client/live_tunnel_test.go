package relayclient

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
	authpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	accesspb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const liveTunnelResponseLimit = 1 << 20

func TestLiveOpaqueTunnelProbe(t *testing.T) {
	stationOrigin := strings.TrimRight(
		os.Getenv("PT_LIVE_TUNNEL_STATION_URL"),
		"/",
	)
	relayOrigin := strings.TrimRight(
		os.Getenv("PT_LIVE_TUNNEL_RELAY_URL"),
		"/",
	)
	if stationOrigin == "" || relayOrigin == "" {
		t.Skip("live opaque tunnel runtime is not configured")
	}
	marker := os.Getenv("PT_LIVE_TUNNEL_MARKER")
	if marker == "" {
		t.Fatal("PT_LIVE_TUNNEL_MARKER is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	assertRejectedWebSocketPolicies(t, ctx, relayOrigin)
	dashboardToken := liveDashboardLogin(t, ctx, stationOrigin)
	envelope := liveIssueConnectionMaterial(
		t,
		ctx,
		stationOrigin,
		dashboardToken,
	)
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		envelope.GetConnectionGrant(),
	)
	if err != nil {
		t.Fatal(err)
	}
	discovery, relayPeerID := liveDiscoverRoute(
		t,
		ctx,
		relayOrigin,
		grantBytes,
	)
	if len(discovery.GetStationRoutes()) != 1 {
		t.Fatalf("discovered routes = %d, want 1", len(discovery.GetStationRoutes()))
	}
	route := discovery.GetStationRoutes()[0]
	statement, err := domain.VerifyStationRouteAttestation(
		route,
		relayPeerID,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("verify discovered Station route: %v", err)
	}
	if !proto.Equal(route, envelope.GetRouteAttestation()) {
		t.Fatal("discovered route differs from Station-issued connection material")
	}

	socket, opened := liveOpenClientTunnel(
		t,
		ctx,
		relayOrigin,
		grantBytes,
		statement,
	)
	rawTunnel := newWebSocketTunnelConn(
		socket,
		opened.GetTunnelId(),
		opened.GetLimits(),
	)
	innerTLS := tls.Client(rawTunnel, &tls.Config{
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
		InsecureSkipVerify: true,
		NextProtos:         []string{"http/1.1"},
		VerifyConnection: func(state tls.ConnectionState) error {
			return verifyPinnedSPKI(
				state,
				statement.GetInnerTlsSpkiSha256(),
			)
		},
	})
	if err := innerTLS.HandshakeContext(ctx); err != nil {
		t.Fatalf("inner TLS handshake: %v", err)
	}
	liveLoginThroughAccessGate(
		t,
		ctx,
		innerTLS,
		statement.GetStationPeerId(),
		marker,
	)
	_ = innerTLS.Close()

	result, err := json.Marshal(map[string]bool{
		"binaryTunnel":       true,
		"innerTLS13":         true,
		"stationSPKIPinned":  true,
		"stationLoginPassed": true,
		"relayNonceBounded":  len(opened.GetRelayNonce()) == 32,
		"limitsAdvertised":   liveTunnelLimitsValid(opened.GetLimits()),
	})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("PT_OPAQUE_TUNNEL_PROBE=%s\n", result)
}

func liveLoginThroughAccessGate(
	t *testing.T,
	ctx context.Context,
	connection io.ReadWriter,
	stationPeerID string,
	marker string,
) {
	t.Helper()
	deviceNonce := make([]byte, 12)
	if _, err := rand.Read(deviceNonce); err != nil {
		t.Fatal(err)
	}
	deviceID := "opaque-tunnel-" + base64.RawURLEncoding.EncodeToString(deviceNonce)
	reader := bufio.NewReader(connection)

	start := &accesspb.StartAccessAttemptResponse{}
	livePostPeersProtoThroughTunnel(
		t,
		ctx,
		connection,
		reader,
		"/actor/access/start",
		&accesspb.StartAccessAttemptRequest{
			StationUrl:    "https://station.invalid",
			StationPeerId: stationPeerID,
			Client: &accesspb.AccessGateClientInfo{
				Platform:            "desktop",
				AppVersion:          "1",
				DeviceId:            deviceID,
				Locale:              "en",
				LifecycleGeneration: 1,
			},
		},
		start,
		marker,
	)
	decision := start.GetDecision()
	gate := liveCurrentLoginGate(decision)
	if decision == nil || decision.GetAttemptId() == "" || gate == nil {
		t.Fatal("inner access start returned no password gate")
	}

	submit := &accesspb.SubmitAccessGateResponse{}
	livePostPeersProtoThroughTunnel(
		t,
		ctx,
		connection,
		reader,
		"/actor/access/submit",
		&accesspb.SubmitAccessGateRequest{
			AttemptId: decision.GetAttemptId(),
			GateId:    gate.GetGateId(),
			Type:      accesspb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			ActionInput: &accesspb.SubmitAccessGateRequest_Login{
				Login: &authpb.LoginRequest{
					Email:      liveEnv("PT_LIVE_TUNNEL_ACCOUNT", "alice@p.t"),
					Password:   liveEnv("PT_LIVE_TUNNEL_PASSWORD", "1"),
					DeviceType: "desktop",
				},
			},
			ActionId:            gate.GetActionId(),
			StationPeerId:       stationPeerID,
			DeviceId:            deviceID,
			LifecycleGeneration: 1,
			SchemaRevision:      gate.GetSchemaRevision(),
			SchemaDigest:        gate.GetSchemaDigest(),
			SubmissionId:        deviceID,
		},
		submit,
		marker,
	)
	if submit.GetDecision().GetState() !=
		accesspb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED ||
		submit.GetLoginResponse().GetTokens().GetAccessToken() == "" {
		t.Fatal("inner access submit did not return a granted session")
	}
}

func liveCurrentLoginGate(
	decision *accesspb.AccessDecision,
) *accesspb.AccessGate {
	if decision == nil {
		return nil
	}
	for _, gate := range decision.GetGates() {
		if gate.GetGateId() == decision.GetCurrentGateId() &&
			gate.GetType() ==
				accesspb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN {
			return gate
		}
	}
	return nil
}

func livePostPeersProtoThroughTunnel(
	t *testing.T,
	ctx context.Context,
	connection io.Writer,
	reader *bufio.Reader,
	path string,
	requestMessage proto.Message,
	responseMessage proto.Message,
	marker string,
) {
	t.Helper()
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(requestMessage)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://station.invalid"+path,
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Content-Type", "application/protobuf")
	request.Header.Set("X-Peers-Opaque-Probe", marker)
	if err := request.Write(connection); err != nil {
		t.Fatalf("write inner HTTP request %s: %v", path, err)
	}
	response, err := http.ReadResponse(reader, request)
	if err != nil {
		t.Fatalf("read inner HTTP response %s: %v", path, err)
	}
	raw := liveReadBounded(t, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf(
			"inner request %s status=%d body=%s",
			path,
			response.StatusCode,
			strings.TrimSpace(string(raw)),
		)
	}
	envelope := &types.PeersResponse{}
	if err := proto.Unmarshal(raw, envelope); err != nil {
		t.Fatalf("decode inner Peers response %s: %v", path, err)
	}
	if envelope.GetData() == nil {
		t.Fatalf(
			"inner Peers response %s has no data: code=%s msg=%s",
			path,
			envelope.GetCode(),
			envelope.GetMsg(),
		)
	}
	if err := envelope.GetData().UnmarshalTo(responseMessage); err != nil {
		t.Fatalf("decode inner response data %s: %v", path, err)
	}
}

func liveDashboardLogin(
	t *testing.T,
	ctx context.Context,
	stationOrigin string,
) string {
	t.Helper()
	body, err := json.Marshal(map[string]string{
		"username": liveEnv("PT_LIVE_TUNNEL_DASHBOARD_USER", "peers"),
		"password": liveEnv("PT_LIVE_TUNNEL_DASHBOARD_PASSWORD", "peers"),
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		stationOrigin+"/dashboard/api/auth/login",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Dashboard login: %v", err)
	}
	raw := liveReadBounded(t, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("Dashboard login status=%d", response.StatusCode)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode Dashboard login: %v", err)
	}
	if data, ok := decoded["data"].(map[string]any); ok {
		decoded = data
	}
	token, _ := decoded["token"].(string)
	if token == "" {
		t.Fatal("Dashboard login returned no token")
	}
	return token
}

func liveIssueConnectionMaterial(
	t *testing.T,
	ctx context.Context,
	stationOrigin string,
	dashboardToken string,
) *peerpb.StationConnectionEnvelope {
	t.Helper()
	body, err := proto.Marshal(&peerpb.IssueStationConnectionMaterialRequest{
		RouteLifetimeSeconds: 600,
		GrantLifetimeSeconds: 300,
		MaxUses:              1,
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		stationOrigin+"/dashboard/api/relay/connection-material",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Authorization", "Bearer "+dashboardToken)
	request.Header.Set("Content-Type", "application/protobuf")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("issue connection material: %v", err)
	}
	raw := liveReadBounded(t, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("connection material status=%d", response.StatusCode)
	}
	material := &peerpb.IssueStationConnectionMaterialResponse{}
	if err := proto.Unmarshal(raw, material); err != nil {
		t.Fatalf("decode connection material: %v", err)
	}
	payload := strings.TrimPrefix(material.GetCode(), connectionCodePrefix)
	if payload == material.GetCode() || payload == "" {
		t.Fatal("connection material code is invalid")
	}
	envelopeBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		t.Fatalf("decode connection material code: %v", err)
	}
	envelope := &peerpb.StationConnectionEnvelope{}
	if err := proto.Unmarshal(envelopeBytes, envelope); err != nil {
		t.Fatalf("decode connection envelope: %v", err)
	}
	return envelope
}

func liveDiscoverRoute(
	t *testing.T,
	ctx context.Context,
	relayOrigin string,
	grant []byte,
) (*peerpb.AccessEndpointResponse, string) {
	t.Helper()
	challenge := make([]byte, domain.DiscoveryChallengeSize)
	if _, err := rand.Read(challenge); err != nil {
		t.Fatal(err)
	}
	body, err := proto.Marshal(&peerpb.AccessEndpointRequest{
		Challenge:             challenge,
		ConnectionGrant:       grant,
		ClientProtocolVersion: domain.AccessProtocolVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		relayOrigin+"/.well-known/peers-touch/access",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Content-Type", "application/protobuf")
	response, err := (&http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}).Do(request)
	if err != nil {
		t.Fatalf("discover Relay route: %v", err)
	}
	raw := liveReadBounded(t, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("Relay discovery status=%d", response.StatusCode)
	}
	discovery := &peerpb.AccessEndpointResponse{}
	if err := proto.Unmarshal(raw, discovery); err != nil {
		t.Fatalf("decode Relay discovery: %v", err)
	}
	statement := &peerpb.AccessEndpointStatement{}
	if err := proto.Unmarshal(
		discovery.GetEndpointStatementBytes(),
		statement,
	); err != nil {
		t.Fatalf("decode Relay endpoint statement: %v", err)
	}
	if !bytes.Equal(statement.GetChallenge(), challenge) ||
		statement.GetEndpointRole() !=
			peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY {
		t.Fatal("Relay discovery statement is not challenge and role bound")
	}
	publicKey, err := libp2pcrypto.UnmarshalPublicKey(
		discovery.GetEndpointPublicKey(),
	)
	if err != nil {
		t.Fatalf("decode Relay public key: %v", err)
	}
	relayPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil ||
		relayPeerID.String() != statement.GetEndpointPeerId() {
		t.Fatal("Relay endpoint identity does not match its key")
	}
	valid, err := publicKey.Verify(
		append(
			[]byte(domain.AccessEndpointDomain),
			discovery.GetEndpointStatementBytes()...,
		),
		discovery.GetEndpointSignature(),
	)
	if err != nil || !valid {
		t.Fatal("Relay endpoint signature is invalid")
	}
	return discovery, relayPeerID.String()
}

func liveOpenClientTunnel(
	t *testing.T,
	ctx context.Context,
	relayOrigin string,
	grant []byte,
	statement *peerpb.StationRouteStatement,
) (*websocket.Conn, *federationmodel.RelayTunnelOpened) {
	t.Helper()
	endpoint, err := relayTunnelURL(relayOrigin)
	if err != nil {
		t.Fatal(err)
	}
	socket, response, err := (&websocket.Dialer{
		HandshakeTimeout:  10 * time.Second,
		Subprotocols:      []string{outerTunnelSubprotocol},
		EnableCompression: false,
		TLSClientConfig: &tls.Config{
			MinVersion:         tls.VersionTLS13,
			InsecureSkipVerify: true,
		},
	}).DialContext(ctx, endpoint, nil)
	if err != nil {
		if response != nil {
			_ = response.Body.Close()
		}
		t.Fatalf("open Relay WebSocket: %v", err)
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		_ = socket.Close()
		t.Fatal(err)
	}
	if err := writeClientOuterFrame(socket, &federationmodel.RelayTunnelFrame{
		ProtocolVersion: outerTunnelProtocolVersion,
		Payload: &federationmodel.RelayTunnelFrame_Open{
			Open: &federationmodel.RelayTunnelOpen{
				RouteId:         statement.GetRouteId(),
				RouteGeneration: statement.GetRouteGeneration(),
				ClientNonce:     nonce,
				ConnectionGrant: grant,
				Purpose:         federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_CLIENT_ACCESS,
			},
		},
	}); err != nil {
		_ = socket.Close()
		t.Fatal(err)
	}
	openedFrame, err := readClientOuterFrame(socket)
	if err != nil || openedFrame.GetOpened() == nil {
		_ = socket.Close()
		t.Fatalf("Relay rejected client tunnel: %v", err)
	}
	opened := openedFrame.GetOpened()
	if opened.GetTunnelId() == 0 ||
		len(opened.GetRelayNonce()) != 32 ||
		opened.GetLimits() == nil {
		_ = socket.Close()
		t.Fatal("Relay returned incomplete tunnel metadata")
	}
	return socket, opened
}

func assertRejectedWebSocketPolicies(
	t *testing.T,
	ctx context.Context,
	relayOrigin string,
) {
	t.Helper()
	endpoint, err := relayTunnelURL(relayOrigin)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		dialer websocket.Dialer
	}{
		{
			name: "missing subprotocol",
			dialer: websocket.Dialer{
				HandshakeTimeout: 10 * time.Second,
			},
		},
		{
			name: "compression",
			dialer: websocket.Dialer{
				HandshakeTimeout:  10 * time.Second,
				Subprotocols:      []string{outerTunnelSubprotocol},
				EnableCompression: true,
			},
		},
	} {
		socket, response, dialErr := test.dialer.DialContext(
			ctx,
			endpoint,
			nil,
		)
		if socket != nil {
			_ = socket.Close()
		}
		if response != nil {
			_ = response.Body.Close()
		}
		if dialErr == nil {
			t.Fatalf("%s WebSocket policy was accepted", test.name)
		}
	}

	socket, _, err := (&websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{outerTunnelSubprotocol},
	}).DialContext(ctx, endpoint, nil)
	if err != nil {
		t.Fatalf("open text-frame probe: %v", err)
	}
	if err := socket.WriteMessage(websocket.TextMessage, []byte("plaintext")); err != nil {
		_ = socket.Close()
		t.Fatal(err)
	}
	_, _, err = socket.ReadMessage()
	_ = socket.Close()
	if !websocket.IsCloseError(err, websocket.CloseUnsupportedData) {
		t.Fatalf("text frame close error = %v", err)
	}

	socket, _, err = (&websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{outerTunnelSubprotocol},
	}).DialContext(ctx, endpoint, nil)
	if err != nil {
		t.Fatalf("open protocol-downgrade probe: %v", err)
	}
	downgrade, err := proto.Marshal(&federationmodel.RelayTunnelFrame{
		ProtocolVersion: 0,
		Payload: &federationmodel.RelayTunnelFrame_Open{
			Open: &federationmodel.RelayTunnelOpen{},
		},
	})
	if err != nil {
		_ = socket.Close()
		t.Fatal(err)
	}
	if err := socket.WriteMessage(websocket.BinaryMessage, downgrade); err != nil {
		_ = socket.Close()
		t.Fatal(err)
	}
	_, _, err = socket.ReadMessage()
	_ = socket.Close()
	if !websocket.IsCloseError(err, websocket.CloseProtocolError) {
		t.Fatalf("protocol downgrade close error = %v", err)
	}
}

func liveReadBounded(t *testing.T, body io.Reader) []byte {
	t.Helper()
	raw, err := io.ReadAll(io.LimitReader(body, liveTunnelResponseLimit+1))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > liveTunnelResponseLimit {
		t.Fatal("live tunnel response exceeded byte limit")
	}
	return raw
}

func liveTunnelLimitsValid(limits *federationmodel.RelayTunnelLimits) bool {
	return limits != nil &&
		limits.GetMaxFrameBytes() > 0 &&
		limits.GetMaxRequestBytes() >= limits.GetMaxFrameBytes() &&
		limits.GetMaxResponseBytes() >= limits.GetMaxFrameBytes() &&
		limits.GetMaxConnectionBytes() >=
			limits.GetMaxRequestBytes()+limits.GetMaxResponseBytes() &&
		limits.GetIdleTimeoutSeconds() > 0 &&
		limits.GetRateBytesPerSecond() > 0
}

func liveEnv(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
