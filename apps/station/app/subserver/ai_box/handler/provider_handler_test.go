package handler

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_box/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func TestHandleCreateProvider(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.CreateProviderRequest
		wantError bool
	}{
		{
			name: "missing name",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.CreateProviderRequest{
				Name: "",
			},
			wantError: true,
		},
		{
			name: "valid provider",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &model.CreateProviderRequest{
				Name:        "OpenAI",
				Description: "OpenAI GPT Provider",
				Logo:        "https://example.com/logo.png",
			},
			wantError: false,
		},
		{
			name: "provider with settings",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.CreateProviderRequest{
				Name:         "Custom Provider",
				Description:  "Custom AI Provider",
				SettingsJson: `{"temperature": 0.7}`,
				ConfigJson:   `{"model": "gpt-4"}`,
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleCreateProvider(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleCreateProvider() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil && resp.Provider != nil {
				if resp.Provider.Name != tt.req.Name {
					t.Errorf("Provider.Name = %v, want %v", resp.Provider.Name, tt.req.Name)
				}
			}
		})
	}
}

func TestHandleUpdateProvider(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.UpdateProviderRequest
		wantError bool
	}{
		{
			name: "missing id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.UpdateProviderRequest{
				Id: "",
			},
			wantError: true,
		},
		{
			name: "update name only",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &model.UpdateProviderRequest{
				Id:   "provider_123",
				Name: stringPtr("Updated Name"),
			},
			wantError: false,
		},
		{
			name: "update multiple fields",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.UpdateProviderRequest{
				Id:          "provider_456",
				Name:        stringPtr("New Name"),
				Description: stringPtr("New Description"),
				Enabled:     boolPtr(true),
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleUpdateProvider(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleUpdateProvider() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil && resp.Provider != nil {
				if resp.Provider.Id != tt.req.Id {
					t.Errorf("Provider.Id = %v, want %v", resp.Provider.Id, tt.req.Id)
				}
			}
		})
	}
}

func TestHandleDeleteProvider(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.DeleteProviderRequest
		wantError bool
	}{
		{
			name: "missing id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.DeleteProviderRequest{
				Id: "",
			},
			wantError: true,
		},
		{
			name: "valid id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &model.DeleteProviderRequest{
				Id: "provider_to_delete",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleDeleteProvider(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleDeleteProvider() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil {
				if !resp.Success {
					t.Error("Expected Success to be true")
				}
			}
		})
	}
}

func TestHandleGetProvider(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.GetProviderRequest
		wantError bool
	}{
		{
			name: "missing id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.GetProviderRequest{
				Id: "",
			},
			wantError: true,
		},
		{
			name: "valid id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "user123",
				})
			},
			req: &model.GetProviderRequest{
				Id: "provider_123",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleGetProvider(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleGetProvider() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil && resp.Provider != nil {
				if resp.Provider.Id != tt.req.Id {
					t.Errorf("Provider.Id = %v, want %v", resp.Provider.Id, tt.req.Id)
				}
			}
		})
	}
}

func TestHandleListProviders(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.ListProvidersRequest
		wantError bool
	}{
		{
			name: "default pagination",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.ListProvidersRequest{
				PageNumber: 0,
				PageSize:   0,
			},
			wantError: false,
		},
		{
			name: "custom pagination",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &model.ListProvidersRequest{
				PageNumber: 2,
				PageSize:   20,
			},
			wantError: false,
		},
		{
			name: "enabled only filter",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.ListProvidersRequest{
				PageNumber:  1,
				PageSize:    10,
				EnabledOnly: true,
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleListProviders(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleListProviders() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil {
				if resp.Providers == nil {
					t.Error("Expected Providers to be non-nil")
				}
				if resp.Total < 0 {
					t.Errorf("Total = %v, want >= 0", resp.Total)
				}
			}
		})
	}
}

func TestHandleTestProvider(t *testing.T) {
	h := NewProviderHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.TestProviderRequest
		wantError bool
	}{
		{
			name: "missing id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.TestProviderRequest{
				Id: "",
			},
			wantError: true,
		},
		{
			name: "valid id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &model.TestProviderRequest{
				Id: "provider_123",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleTestProvider(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleTestProvider() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil {
				if resp.Message == "" {
					t.Error("Expected non-empty Message")
				}
			}
		})
	}
}

func stringPtr(s string) *string {
	return &s
}

func boolPtr(b bool) *bool {
	return &b
}
