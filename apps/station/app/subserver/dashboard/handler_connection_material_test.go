package dashboard

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

type connectionMaterialIssuerStub struct {
	request nativeRelay.ConnectionMaterialRequest
}

func (s *connectionMaterialIssuerStub) IssueConnectionMaterial(
	_ context.Context,
	request nativeRelay.ConnectionMaterialRequest,
) (*nativeRelay.ConnectionMaterial, error) {
	s.request = request
	return &nativeRelay.ConnectionMaterial{
		Code:      "ptc1:payload",
		DeepLink:  "peers-touch://connect#payload",
		ExpiresAt: time.Unix(123, 0).UTC(),
	}, nil
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
	nativeRelay.RegisterConnectionMaterialIssuer(issuer)
	t.Cleanup(func() { nativeRelay.RegisterConnectionMaterialIssuer(nil) })
	handler := &dashboardHandler{sub: &subServer{}}
	result, err := handler.handleIssueRelayConnectionMaterial(
		context.Background(),
		&peerpb.IssueStationConnectionMaterialRequest{
			RouteId:              "private-route",
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
		issuer.request.MaxUses != 2 {
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
	issuer := &connectionMaterialIssuerStub{}
	nativeRelay.RegisterConnectionMaterialIssuer(issuer)
	t.Cleanup(func() { nativeRelay.RegisterConnectionMaterialIssuer(nil) })
	subserver := &subServer{}
	if subserver.getConnectionMaterialIssuer() != issuer {
		t.Fatal("Dashboard did not resolve the Station Relay runtime issuer")
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
