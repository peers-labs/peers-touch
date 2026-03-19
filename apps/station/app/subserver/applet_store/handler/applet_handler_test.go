package applet_store

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func TestHandleListApplets(t *testing.T) {
	ctx := context.Background()
	ctx = coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "test_user",
	})

	svc := service.NewStoreService()
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

	svc := service.NewStoreService()
	h := NewAppletHandlers(svc)

	tests := []struct {
		name      string
		req       *model.GetAppletDetailsRequest
		wantError bool
	}{
		{
			name: "missing applet_id",
			req: &model.GetAppletDetailsRequest{
				AppletId: "",
			},
			wantError: true,
		},
		{
			name: "valid applet_id",
			req: &model.GetAppletDetailsRequest{
				AppletId: "test_applet_123",
			},
			wantError: false,
		},
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

func TestHandleGetAppletDetails_ErrorCases(t *testing.T) {
	ctx := context.Background()
	svc := service.NewStoreService()
	h := NewAppletHandlers(svc)

	tests := []struct {
		name        string
		setupCtx    func() context.Context
		appletId    string
		expectError bool
	}{
		{
			name: "no auth subject",
			setupCtx: func() context.Context {
				return context.Background()
			},
			appletId:    "test_applet_123",
			expectError: false,
		},
		{
			name: "with auth subject",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID:         "user_456",
					Attributes: map[string]string{"role": "admin"},
				})
			},
			appletId:    "admin_applet",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			req := &model.GetAppletDetailsRequest{
				AppletId: tt.appletId,
			}

			resp, err := h.HandleGetAppletDetails(ctx, req)

			if tt.expectError && err == nil {
				t.Error("Expected error but got none")
			}

			if !tt.expectError && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}

			if !tt.expectError && resp != nil && resp.Info != nil {
				if resp.Info.Id != tt.appletId {
					t.Errorf("Info.Id = %v, want %v", resp.Info.Id, tt.appletId)
				}
			}
		})
	}
}
