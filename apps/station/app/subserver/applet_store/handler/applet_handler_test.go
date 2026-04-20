package applet_store

import (
	"context"
	"os"
	"testing"

	dbmodel "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestStoreService(t *testing.T) *service.StoreService {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&dbmodel.Applet{}, &dbmodel.AppletVersion{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	storageDir := t.TempDir()
	// Ensure temp dir exists (defensive).
	if err := os.MkdirAll(storageDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	return service.NewStoreService(db, storageDir)
}

func TestHandleListApplets(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "test_user",
	})

	svc := newTestStoreService(t)
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

	svc := newTestStoreService(t)
	h := NewAppletHandlers(svc)

	// Seed mock applets via list handler so we can fetch a real id.
	listResp, err := h.HandleListApplets(ctx, &model.ListAppletsRequest{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("seed/list applets error: %v", err)
	}
	if listResp == nil || len(listResp.Applets) == 0 {
		t.Fatalf("expected seeded applets, got empty")
	}
	existingID := listResp.Applets[0].Id

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
