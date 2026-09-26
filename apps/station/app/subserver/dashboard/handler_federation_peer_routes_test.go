package dashboard

import (
	"context"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type federationPeerRouteRequest struct {
	method        server.Method
	path          string
	nativeContext *federationPeerRouteContext
}

func (r *federationPeerRouteRequest) Context() context.Context {
	return context.Background()
}

func (r *federationPeerRouteRequest) Header() map[string]string {
	return map[string]string{}
}

func (r *federationPeerRouteRequest) Method() server.Method {
	return r.method
}

func (r *federationPeerRouteRequest) Path() string {
	return r.path
}

func (r *federationPeerRouteRequest) Body() []byte {
	return nil
}

func (r *federationPeerRouteRequest) GetHertzContext() interface{} {
	return r.nativeContext
}

type federationPeerRouteContext struct {
	peerID string
}

func (c *federationPeerRouteContext) Param(name string) string {
	if name == "id" {
		return c.peerID
	}
	return ""
}

type federationPeerRouteResponse struct {
	headers map[string]string
	status  int
}

func (r *federationPeerRouteResponse) Header() map[string]string {
	return r.headers
}

func (r *federationPeerRouteResponse) SetHeader(key, value string) {
	r.headers[key] = value
}

func (r *federationPeerRouteResponse) Write(body []byte) (int, error) {
	return len(body), nil
}

func (r *federationPeerRouteResponse) Flush() error {
	return nil
}

func (r *federationPeerRouteResponse) WriteHeader(status int) {
	r.status = status
}

func (r *federationPeerRouteResponse) Status() int {
	return r.status
}

type federationPeerRouteRepo struct {
	infrastructure.OSSRepository
	pinCalls []struct {
		peerID string
		pinned bool
	}
	forgetCalls []string
	auditCalls  []infrastructure.OSSAuditAppend
}

func (r *federationPeerRouteRepo) SetPeerPin(
	_ context.Context,
	peerID string,
	pinned bool,
) error {
	r.pinCalls = append(r.pinCalls, struct {
		peerID string
		pinned bool
	}{peerID: peerID, pinned: pinned})
	return nil
}

func (r *federationPeerRouteRepo) ForgetPeer(
	_ context.Context,
	peerID string,
) error {
	r.forgetCalls = append(r.forgetCalls, peerID)
	return nil
}

func (r *federationPeerRouteRepo) RecordOSSAudit(
	_ context.Context,
	event infrastructure.OSSAuditAppend,
) error {
	r.auditCalls = append(r.auditCalls, event)
	return nil
}

type federationPeerRouteAuditRepo struct {
	infrastructure.AuditRepository
	actions []string
}

func (r *federationPeerRouteAuditRepo) Record(
	_ context.Context,
	_ uint64,
	_ string,
	action string,
	_ string,
	_ string,
	_ string,
	_ string,
) {
	r.actions = append(r.actions, action)
}

func TestFederationPeerTrustRoutesBindPeerStationID(t *testing.T) {
	const peerID = "12D3KooWPeer"
	tests := []struct {
		name        string
		handlerName string
		method      server.Method
		path        string
		pinned      *bool
	}{
		{
			name:        "pin",
			handlerName: "dashboard-oss-fed-peer-pin",
			method:      server.POST,
			path:        "/dashboard/api/oss/federation/peers/" + peerID + "/pin",
			pinned:      boolPointer(true),
		},
		{
			name:        "unpin",
			handlerName: "dashboard-oss-fed-peer-unpin",
			method:      server.POST,
			path:        "/dashboard/api/oss/federation/peers/" + peerID + "/unpin",
			pinned:      boolPointer(false),
		},
		{
			name:        "forget",
			handlerName: "dashboard-oss-fed-peer-forget",
			method:      server.DELETE,
			path:        "/dashboard/api/oss/federation/peers/" + peerID,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ossRepo := &federationPeerRouteRepo{}
			auditRepo := &federationPeerRouteAuditRepo{}
			handlerOwner := &dashboardHandler{
				sub: &subServer{
					ossSvc: application.NewOSSService(ossRepo),
					authSvc: application.NewAuthService(
						nil,
						nil,
						auditRepo,
						nil,
						0,
					),
				},
			}
			var handler server.Handler
			for _, candidate := range handlerOwner.handlers() {
				if candidate.Name() == test.handlerName {
					handler = candidate
					break
				}
			}
			if handler == nil {
				t.Fatalf("handler %q is not registered", test.handlerName)
			}
			request := &federationPeerRouteRequest{
				method: test.method,
				path:   test.path,
				nativeContext: &federationPeerRouteContext{
					peerID: peerID,
				},
			}
			response := &federationPeerRouteResponse{
				headers: map[string]string{},
			}
			ctx := context.WithValue(
				context.Background(),
				dashboardCtxKey{},
				&dashboardCtx{
					claims: &domain.DashboardClaims{
						AdminID:  1,
						Username: "operator",
					},
				},
			)

			if err := handler.Handler()(
				ctx,
				request,
				response,
			); err != nil {
				t.Fatal(err)
			}
			if response.status != http.StatusOK {
				t.Fatalf("status = %d, want 200", response.status)
			}
			if test.pinned == nil {
				if len(ossRepo.forgetCalls) != 1 ||
					ossRepo.forgetCalls[0] != peerID {
					t.Fatalf("forget calls = %v, want %q", ossRepo.forgetCalls, peerID)
				}
			} else if len(ossRepo.pinCalls) != 1 ||
				ossRepo.pinCalls[0].peerID != peerID ||
				ossRepo.pinCalls[0].pinned != *test.pinned {
				t.Fatalf(
					"pin calls = %+v, want peer %q pinned %t",
					ossRepo.pinCalls,
					peerID,
					*test.pinned,
				)
			}
			if len(auditRepo.actions) != 1 {
				t.Fatalf("dashboard audit actions = %v, want one", auditRepo.actions)
			}
		})
	}
}

func boolPointer(value bool) *bool {
	return &value
}
