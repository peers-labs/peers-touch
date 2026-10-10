package dashboard

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	relayclient "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay-client"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

type connectionMaterialIssuerStub struct {
	request relayclient.ConnectionMaterialRequest
}

func (s *connectionMaterialIssuerStub) IssueConnectionMaterial(
	_ context.Context,
	request relayclient.ConnectionMaterialRequest,
) (*relayclient.ConnectionMaterial, error) {
	s.request = request
	return &relayclient.ConnectionMaterial{
		Code:      "ptc1:payload",
		DeepLink:  "peers-touch://connect#payload",
		ExpiresAt: time.Unix(123, 0).UTC(),
	}, nil
}

type connectionMaterialSibling struct {
	connectionMaterialIssuerStub
}

func (s *connectionMaterialSibling) Name() string {
	return "relay-client"
}

func (s *connectionMaterialSibling) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

func (s *connectionMaterialSibling) Status() server.Status {
	return server.StatusRunning
}

func (s *connectionMaterialSibling) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (s *connectionMaterialSibling) Init(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (s *connectionMaterialSibling) Start(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (s *connectionMaterialSibling) Stop(context.Context) error {
	return nil
}

func (s *connectionMaterialSibling) Handlers() []server.Handler {
	return nil
}

type connectionMaterialRequest struct {
	headers map[string]string
	path    string
	body    []byte
}

func (r *connectionMaterialRequest) Context() context.Context {
	return context.Background()
}

func (r *connectionMaterialRequest) Header() map[string]string {
	return r.headers
}

func (r *connectionMaterialRequest) Method() server.Method {
	return server.POST
}

func (r *connectionMaterialRequest) Path() string {
	return r.path
}

func (r *connectionMaterialRequest) Body() []byte {
	return r.body
}

type connectionMaterialResponse struct {
	headers map[string]string
	status  int
	body    bytes.Buffer
}

func (r *connectionMaterialResponse) Header() map[string]string {
	return r.headers
}

func (r *connectionMaterialResponse) SetHeader(key, value string) {
	r.headers[key] = value
}

func (r *connectionMaterialResponse) Write(body []byte) (int, error) {
	return r.body.Write(body)
}

func (r *connectionMaterialResponse) Flush() error {
	return nil
}

func (r *connectionMaterialResponse) WriteHeader(status int) {
	r.status = status
}

func (r *connectionMaterialResponse) Status() int {
	return r.status
}

func TestRelayConnectionMaterialHandlerInvokesSiblingIssuer(t *testing.T) {
	issuer := &connectionMaterialIssuerStub{}
	handler := &dashboardHandler{
		sub: &subServer{connectionMaterialIssuer: issuer},
	}
	result, err := handler.handleIssueRelayConnectionMaterial(
		context.Background(),
		&peerpb.IssueStationConnectionMaterialRequest{
			RouteId:              "private-route",
			InnerTlsSpkiSha256:   bytes.Repeat([]byte{0x11}, 32),
			CapabilitiesDigest:   bytes.Repeat([]byte{0x22}, 32),
			RouteLifetimeSeconds: 3600,
			GrantLifetimeSeconds: 600,
			MaxUses:              2,
		},
	)
	if err != nil {
		t.Fatalf("issue connection material: %v", err)
	}
	if result.Code != "ptc1:payload" ||
		result.DeepLink != "peers-touch://connect#payload" {
		t.Fatalf("unexpected response: %+v", result)
	}
	if issuer.request.RouteID != "private-route" ||
		issuer.request.RouteLifetime != time.Hour ||
		issuer.request.GrantLifetime != 10*time.Minute ||
		issuer.request.MaxUses != 2 ||
		len(issuer.request.InnerTLSSPKISHA256) != 32 ||
		len(issuer.request.CapabilitiesDigest) != 32 {
		t.Fatalf("unexpected issuer request: %+v", issuer.request)
	}
}

func TestRelayConnectionMaterialRouteRequiresAuthAndProtectsResponse(t *testing.T) {
	handlerOwner := &dashboardHandler{sub: &subServer{}}
	handler := findDashboardHandler(
		t,
		handlerOwner.handlers(),
		"dashboard-relay-connection-material",
	)
	if len(handler.Wrappers()) != 2 {
		t.Fatalf("wrapper count = %d, want 2", len(handler.Wrappers()))
	}

	request := &connectionMaterialRequest{
		headers: map[string]string{"Content-Type": "application/json"},
		path:    routeRelayConnectionMaterial,
		body:    []byte("{}"),
	}
	response := &connectionMaterialResponse{headers: map[string]string{}}
	endpoint := handler.Handler()
	for _, wrapper := range handler.Wrappers() {
		endpoint = wrapper(endpoint)
	}
	if err := endpoint(context.Background(), request, response); err != nil {
		t.Fatal(err)
	}
	if response.status != 401 {
		t.Fatalf("status = %d, want 401", response.status)
	}
	if response.headers["Cache-Control"] != "no-store" ||
		response.headers["Referrer-Policy"] != "no-referrer" {
		t.Fatalf("sensitive response headers = %#v", response.headers)
	}
}

func TestRelayConnectionMaterialRouteRejectsUnknownJSON(t *testing.T) {
	handlerOwner := &dashboardHandler{sub: &subServer{}}
	handler := findDashboardHandler(
		t,
		handlerOwner.handlers(),
		"dashboard-relay-connection-material",
	)
	body, err := json.Marshal(map[string]any{"unexpected": true})
	if err != nil {
		t.Fatal(err)
	}
	request := &connectionMaterialRequest{
		headers: map[string]string{"Content-Type": "application/json"},
		path:    routeRelayConnectionMaterial,
		body:    body,
	}
	response := &connectionMaterialResponse{headers: map[string]string{}}
	endpoint := handler.Wrappers()[1](handler.Handler())
	if err := endpoint(context.Background(), request, response); err != nil {
		t.Fatal(err)
	}
	if response.status != 400 {
		t.Fatalf("status = %d, want 400", response.status)
	}
	if response.headers["Cache-Control"] != "no-store" ||
		response.headers["Referrer-Policy"] != "no-referrer" {
		t.Fatalf("sensitive response headers = %#v", response.headers)
	}
}

func TestDashboardResolvesRelayConnectionMaterialIssuer(t *testing.T) {
	issuer := &connectionMaterialSibling{}
	subserver := &subServer{subservers: []server.Subserver{issuer}}
	subserver.resolveConnectionMaterialIssuer(context.Background())
	if subserver.getConnectionMaterialIssuer() != issuer {
		t.Fatal("Dashboard did not retain the relay-client issuer")
	}
}

func findDashboardHandler(
	t *testing.T,
	handlers []server.Handler,
	name string,
) server.Handler {
	t.Helper()
	for _, handler := range handlers {
		if handler.Name() == name {
			return handler
		}
	}
	t.Fatalf("handler %q is not registered", name)
	return nil
}
