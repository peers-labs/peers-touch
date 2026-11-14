package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	agentservice "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationpb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type aiPortTest struct {
	agentservice.ProviderManagementPort
	owner agentservice.ProviderOwner
	calls int
}

type federationPortTest struct {
	federationdomain.ManagementPort
	calls int
}

func (p *federationPortTest) ListManagedFederations(context.Context) (*federationpb.ListFederationsResponse, error) {
	p.calls++
	return &federationpb.ListFederationsResponse{}, nil
}

func (p *aiPortTest) List(_ context.Context, owner agentservice.ProviderOwner) (*model.ListProvidersResponse, error) {
	p.calls++
	p.owner = owner
	return &model.ListProvidersResponse{}, nil
}

func TestAIControlPlaneRequiresLiveAdministratorJWT(t *testing.T) {
	t.Setenv("PEERS_AUTH_SECRET", "ai-auth-test-process-secret")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&domain.DashboardAdmin{}, &domain.DashboardSession{}, &domain.DashboardAuditLog{}); err != nil {
		t.Fatal(err)
	}
	admins := infrastructure.NewAdminRepository(db)
	sessions := infrastructure.NewSessionRepository(db)
	provider := coreauth.NewJWTProvider("ai-dashboard-jwt-test-secret", time.Hour)
	auth := application.NewAuthService(admins, sessions, infrastructure.NewAuditRepository(db), provider, time.Hour)
	if err := auth.EnsureSuperUser(context.Background(), "test-admin", "test-password"); err != nil {
		t.Fatal(err)
	}
	login, err := auth.Login(context.Background(), "test-admin", "test-password", "127.0.0.1", "focused-test")
	if err != nil {
		t.Fatal(err)
	}
	port := &aiPortTest{}
	federationPort := &federationPortTest{}
	h := &dashboardHandler{sub: &subServer{authSvc: auth, aiSvc: port, federationSvc: federationPort}}
	invoke := func(route server.Handler, token string) int {
		t.Helper()
		headers := map[string]string{"Content-Type": "application/json"}
		if token != "" {
			headers["Authorization"] = "Bearer " + token
		}
		req := &connectionMaterialRequest{path: route.Path(), headers: headers, body: []byte("{}")}
		resp := &connectionMaterialResponse{headers: map[string]string{}}
		endpoint := route.Handler()
		for _, wrapper := range route.Wrappers() {
			endpoint = wrapper(endpoint)
		}
		err := endpoint(context.Background(), req, resp)
		if resp.headers["Cache-Control"] != "no-store" {
			t.Fatal("AI management response can be cached")
		}
		if token == "" || resp.status == 401 {
			if err != nil || resp.status != 401 {
				t.Fatalf("authentication failure escaped the response boundary: %d %v", resp.status, err)
			}
			var body map[string]any
			if err := json.Unmarshal(resp.body.Bytes(), &body); err != nil || body["error"] == nil {
				t.Fatalf("authentication failure has no JSON body: %q %v", resp.body.String(), err)
			}
		}
		var handlerErr *server.HandlerError
		if errors.As(err, &handlerErr) {
			return handlerErr.Code
		}
		if err != nil {
			t.Fatal(err)
		}
		if resp.status == 0 {
			return 200
		}
		return resp.status
	}
	routes := h.aiHandlers()
	if len(routes) != 20 {
		t.Fatalf("control plane registration count = %d", len(routes))
	}
	for _, route := range routes {
		if got := invoke(route, ""); got != 401 {
			t.Fatalf("unauthenticated %s status = %d", route.Name(), got)
		}
	}
	federationRoutes := h.federationHandlers()
	if len(federationRoutes) != 6 {
		t.Fatalf("Federation control plane registration count = %d", len(federationRoutes))
	}
	for _, route := range federationRoutes {
		if got := invoke(route, ""); got != 401 {
			t.Fatalf("unauthenticated %s status = %d", route.Name(), got)
		}
	}
	federationList := findDashboardHandler(t, federationRoutes, "dashboard-federation-list")
	if got := invoke(federationList, login.Token); got != 200 || federationPort.calls != 1 {
		t.Fatalf("administrator cannot consume Federation management port: %d", got)
	}
	list := findDashboardHandler(t, routes, "dashboard-ai-provider-list")
	if got := invoke(list, login.Token); got != 200 || port.calls != 1 ||
		port.owner != agentservice.StationProviderOwner() {
		t.Fatalf("administrator did not delegate Station ownership: %d %+v", got, port.owner)
	}
	_, actorToken, err := provider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: "ptid:person:consumer", SessionID: "actor-session",
		Attributes: map[string]string{"role": "super"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := invoke(list, actorToken.Value); got != 401 || port.calls != 1 {
		t.Fatalf("actor JWT gained management authority: %d", got)
	}
	if got := invoke(federationList, actorToken.Value); got != 401 || federationPort.calls != 1 {
		t.Fatalf("actor JWT gained Federation governance authority: %d", got)
	}
	other := coreauth.NewJWTProvider("different-jwt-test-secret", time.Hour)
	_, forged, err := other.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: strconv.FormatUint(login.Admin.ID, 10), SessionID: login.SessionID,
		Attributes: map[string]string{"role": "super"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := invoke(list, forged.Value); got != 401 {
		t.Fatalf("forged JWT gained management authority: %d", got)
	}
	if err := db.Model(&domain.DashboardAdmin{}).Where("id = ?", login.Admin.ID).Update("role", "viewer").Error; err != nil {
		t.Fatal(err)
	}
	if got := invoke(list, login.Token); got != 403 || port.calls != 1 {
		t.Fatalf("stale elevated role survived a role change: %d", got)
	}
	if got := invoke(federationList, login.Token); got != 403 {
		t.Fatalf("stale elevated role survived Federation governance: %d", got)
	}
	if err := db.Model(&domain.DashboardAdmin{}).Where("id = ?", login.Admin.ID).Update("role", "super").Error; err != nil {
		t.Fatal(err)
	}
	if err := sessions.RevokeBySessionID(context.Background(), login.SessionID, login.Admin.ID); err != nil {
		t.Fatal(err)
	}
	if got := invoke(list, login.Token); got != 401 || port.calls != 1 {
		t.Fatalf("revoked administrator session retained management authority: %d", got)
	}
	if got := invoke(federationList, login.Token); got != 401 {
		t.Fatalf("revoked session retained Federation governance authority: %d", got)
	}
}
