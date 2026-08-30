package applet_store

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestStoreService(t *testing.T) (*service.StoreService, *gorm.DB) {
	t.Helper()

	dsn := "file:" + strings.NewReplacer("/", "_", " ", "_").Replace(t.Name()) + "?mode=memory&cache=private"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	storageDir := t.TempDir()
	svc := service.NewStoreService(db, storageDir)
	if err := svc.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return svc, db
}

func seedStoreApplet(t *testing.T, db *gorm.DB) string {
	t.Helper()
	now := time.Now()
	appletID := "peers.note"
	versionID := "peers.note-1.0.0"
	if err := db.Create(&dbmodel.Applet{
		ID:          appletID,
		Name:        "Peers Note",
		Description: "Official note applet",
		DeveloperID: "peers",
		Status:      int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed applet: %v", err)
	}
	if err := db.Create(&dbmodel.AppletVersion{
		ID:             versionID,
		AppletID:       appletID,
		Version:        "1.0.0",
		BundlePath:     "peers.note/main.lynx.bundle",
		BundleHash:     "sha256-note",
		BundleSize:     1024,
		StorageBackend: "local",
		Status:         int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
		Channel:        int32(model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE),
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed version: %v", err)
	}
	if err := db.Create(&dbmodel.AppletVersionChannel{
		ID:             "peers.note-stable",
		AppletID:       appletID,
		Channel:        int32(model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE),
		Version:        "1.0.0",
		RolloutPercent: 100,
		Enabled:        true,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed channel: %v", err)
	}
	return appletID
}

func publishStoreAppletFixture(t *testing.T, svc *service.StoreService, appletID string) *model.PublishAppletResponse {
	t.Helper()

	sourcePath := filepath.Join(t.TempDir(), "main.lynx.bundle")
	if err := os.WriteFile(sourcePath, []byte("bundle-content"), 0644); err != nil {
		t.Fatalf("write bundle: %v", err)
	}
	bundle, err := svc.SaveBundleFromPath(appletID, "1.0.0", sourcePath, "main.lynx.bundle", "sha256:17cc744c34dd53bc69277fd7b622b0e1c99d9157e0714d1afffc8264893b2ea3")
	if err != nil {
		t.Fatalf("save bundle: %v", err)
	}
	bundle.Assets = []*model.BundleAssetIntegrity{{
		Path:        "main.lynx.bundle",
		Sha256:      bundle.GetBundleSha256(),
		SizeBytes:   bundle.GetBundleSizeBytes(),
		ContentType: "application/javascript",
	}}

	response, err := svc.PublishAppletVersion(&model.PublishAppletRequest{
		Name:        "Published Applet",
		Description: "Published through typed station store path",
		Version:     "1.0.0",
		AppletId:    appletID,
		OwnerId:     "peers",
		Channel:     model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_DEV,
		Manifest: &model.ManifestSnapshot{
			ManifestJson:    `{"id":"` + appletID + `","name":"Published Applet","version":"1.0.0"}`,
			TargetPlatforms: []string{"desktop"},
			Permissions:     []string{"network.request"},
			Integrity:       map[string]string{"main.lynx.bundle": bundle.GetBundleSha256()},
			BridgeProtocol:  "peers-touch.applet.bridge",
			RuntimeType:     "lynx-web",
		},
		Bundle: bundle,
		Policy: &model.AppletPolicySet{
			PolicyId: appletID + "-1.0.0",
			AppletId: appletID,
			Version:  "1.0.0",
			CapabilityPolicies: []*model.AppletCapabilityPolicy{{
				Capability: "network.request",
				Methods:    []string{"network.request"},
				Decision:   model.AppletPolicyDecision_APPLET_POLICY_DECISION_ALLOW,
			}},
		},
	})
	if err != nil {
		t.Fatalf("publish fixture: %v", err)
	}
	return response
}

func TestHandleListApplets(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "test_user",
	})

	svc, _ := newTestStoreService(t)
	h := NewAppletHandlers(svc)

	tests := []struct {
		name      string
		req       *model.ListAppletsRequest
		wantError bool
	}{
		{
			name: "default limit and offset",
			req: &model.ListAppletsRequest{
				Limit:  0,
				Offset: 0,
			},
			wantError: false,
		},
		{
			name: "custom limit and offset",
			req: &model.ListAppletsRequest{
				Limit:  10,
				Offset: 5,
			},
			wantError: false,
		},
		{
			name: "negative offset should be normalized",
			req: &model.ListAppletsRequest{
				Limit:  20,
				Offset: -10,
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := h.HandleListApplets(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("HandleListApplets() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleListApplets() returned nil response")
			}

			if resp.Applets == nil {
				t.Error("Expected Applets to be non-nil")
			}

			if resp.TotalCount < 0 {
				t.Errorf("TotalCount = %v, want >= 0", resp.TotalCount)
			}
		})
	}
}

func TestHandleGetAppletDetails(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "test_user",
	})

	svc, db := newTestStoreService(t)
	h := NewAppletHandlers(svc)
	existingID := seedStoreApplet(t, db)

	tests := []struct {
		name      string
		req       *model.GetAppletDetailsRequest
		wantError bool
	}{
		{name: "missing applet_id", req: &model.GetAppletDetailsRequest{AppletId: ""}, wantError: true},
		{name: "non-existing applet_id", req: &model.GetAppletDetailsRequest{AppletId: "non_existing_applet"}, wantError: true},
		{name: "existing applet_id", req: &model.GetAppletDetailsRequest{AppletId: existingID}, wantError: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := h.HandleGetAppletDetails(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("HandleGetAppletDetails() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleGetAppletDetails() returned nil response")
			}

			if resp.Info == nil {
				t.Error("Expected Info to be non-nil")
			}
		})
	}
}

func TestAppletStoreInstallRevokeRollbackAndAudit(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{ID: "test_user"})

	svc, db := newTestStoreService(t)
	h := NewAppletHandlers(svc)
	appletID := seedStoreApplet(t, db)

	catalog, err := h.HandleListAppletCatalog(ctx, &model.ListAppletCatalogRequest{
		ActorPtid: "ptid:v1:actor:peers:p:test_user:test",
		DeviceId:  "device-a",
		Channel:   model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE,
	})
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if catalog.TotalCount != 1 || len(catalog.Items) != 1 {
		t.Fatalf("catalog count = %d/%d, want 1/1", catalog.TotalCount, len(catalog.Items))
	}

	install, err := h.HandleInstallApplet(ctx, &model.InstallAppletRequest{
		ActorPtid: "ptid:v1:actor:peers:p:test_user:test",
		DeviceId:  "device-a",
		AppletId:  appletID,
		Channel:   model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE,
		Config:    map[string]string{"locale": "en"},
	})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if install.State.GetStatus() != model.AppletInstallStatus_APPLET_INSTALL_STATUS_INSTALLED {
		t.Fatalf("install status = %v, want installed", install.State.GetStatus())
	}

	installed, err := h.HandleListInstalledApplets(ctx, &model.ListInstalledAppletsRequest{
		ActorPtid: "ptid:v1:actor:peers:p:test_user:test",
		DeviceId:  "device-a",
	})
	if err != nil {
		t.Fatalf("list installed: %v", err)
	}
	if len(installed.States) != 1 {
		t.Fatalf("installed states = %d, want 1", len(installed.States))
	}

	rollback, err := h.HandleRollbackAppletChannel(ctx, &model.RollbackAppletChannelRequest{
		AppletId:      appletID,
		Channel:       model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE,
		TargetVersion: "1.0.0",
		Reason:        "test rollback",
		OperatorId:    "operator",
	})
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if rollback.Channel.GetVersion() != "1.0.0" {
		t.Fatalf("rollback version = %q, want 1.0.0", rollback.Channel.GetVersion())
	}

	audit, err := h.HandleIngestAppletAudit(ctx, &model.IngestAppletAuditRequest{
		Records: []*model.AppletAuditRecord{{
			AuditId:    "audit-1",
			ActorPtid:  "ptid:v1:actor:peers:p:test_user:test",
			DeviceId:   "device-a",
			AppletId:   appletID,
			Version:    "1.0.0",
			SessionId:  "session-1",
			Capability: "network",
			Method:     "request",
			Decision:   model.AppletAuditDecision_APPLET_AUDIT_DECISION_ALLOWED,
			RecordedAt: time.Now().Unix(),
		}},
	})
	if err != nil {
		t.Fatalf("ingest audit: %v", err)
	}
	if audit.AcceptedCount != 1 {
		t.Fatalf("accepted audit count = %d, want 1", audit.AcceptedCount)
	}

	auditQuery, err := h.HandleQueryAppletAudit(ctx, &model.QueryAppletAuditRequest{AppletId: appletID})
	if err != nil {
		t.Fatalf("query audit: %v", err)
	}
	if auditQuery.TotalCount != 1 || len(auditQuery.Records) != 1 {
		t.Fatalf("audit count = %d/%d, want 1/1", auditQuery.TotalCount, len(auditQuery.Records))
	}

	revoked, err := h.HandleRevokeAppletVersion(ctx, &model.RevokeAppletVersionRequest{
		AppletId:   appletID,
		Version:    "1.0.0",
		Reason:     "security revocation",
		OperatorId: "operator",
	})
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if revoked.Version.GetStatus() != model.AppletPackageStatus_APPLET_PACKAGE_STATUS_REVOKED {
		t.Fatalf("revoked status = %v, want revoked", revoked.Version.GetStatus())
	}
}

func TestAppletStoreTypedPublishAndBundleServing(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{ID: "test_user"})

	svc, _ := newTestStoreService(t)
	h := NewAppletHandlers(svc)
	published := publishStoreAppletFixture(t, svc, "published.applet")

	catalog, err := h.HandleListAppletCatalog(ctx, &model.ListAppletCatalogRequest{
		ActorPtid: "ptid:v1:actor:peers:p:test_user:test",
		DeviceId:  "device-a",
		Channel:   model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_DEV,
	})
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if catalog.TotalCount != 1 || catalog.Items[0].GetVersion().GetVersion() != "1.0.0" {
		t.Fatalf("catalog after publish = %d/%q, want 1/1.0.0", catalog.TotalCount, catalog.Items[0].GetVersion().GetVersion())
	}

	version, err := h.HandleGetAppletVersion(ctx, &model.GetAppletVersionRequest{
		AppletId: "published.applet",
		Channel:  model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_DEV,
	})
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if len(version.GetPolicy().GetCapabilityPolicies()) != 1 {
		t.Fatalf("capability policy count = %d, want 1", len(version.GetPolicy().GetCapabilityPolicies()))
	}

	handler := NewAppletHandler("/api/v1/applets", svc)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/applets/bundle?path="+published.GetVersion().GetBundle().GetBundleUri(), nil)
	rec := httptest.NewRecorder()
	handler.handleGetBundle(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("bundle status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "bundle-content" {
		t.Fatalf("bundle body = %q, want bundle-content", rec.Body.String())
	}
}
