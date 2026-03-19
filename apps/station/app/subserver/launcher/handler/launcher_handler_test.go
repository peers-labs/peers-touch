package handler

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func TestHandleGetFeed(t *testing.T) {
	h := NewLauncherHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.GetFeedRequest
		wantError bool
	}{
		{
			name: "valid request with user_id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "user123",
				})
			},
			req: &model.GetFeedRequest{
				UserId: "user123",
				Limit:  20,
			},
			wantError: false,
		},
		{
			name: "empty user_id should use default",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.GetFeedRequest{
				UserId: "",
				Limit:  10,
			},
			wantError: false,
		},
		{
			name: "zero limit should use default",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.GetFeedRequest{
				UserId: "user456",
				Limit:  0,
			},
			wantError: false,
		},
		{
			name: "negative limit should use default",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.GetFeedRequest{
				UserId: "user789",
				Limit:  -5,
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleGetFeed(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("HandleGetFeed() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleGetFeed() returned nil response")
			}

			if resp.Items == nil {
				t.Error("Expected Items to be non-nil")
			}
		})
	}
}

func TestHandleSearch(t *testing.T) {
	h := NewLauncherHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *model.SearchRequest
		wantError bool
	}{
		{
			name: "missing query",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.SearchRequest{
				Query: "",
				Limit: 10,
			},
			wantError: true,
		},
		{
			name: "valid query",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "user123",
				})
			},
			req: &model.SearchRequest{
				Query: "test search",
				Limit: 20,
			},
			wantError: false,
		},
		{
			name: "zero limit should use default",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.SearchRequest{
				Query: "another search",
				Limit: 0,
			},
			wantError: false,
		},
		{
			name: "negative limit should use default",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &model.SearchRequest{
				Query: "query",
				Limit: -10,
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleSearch(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("HandleSearch() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleSearch() returned nil response")
			}

			if resp.Results == nil {
				t.Error("Expected Results to be non-nil")
			}

			if resp.Total < 0 {
				t.Errorf("Total = %v, want >= 0", resp.Total)
			}
		})
	}
}

func TestHandleSearch_WithAuth(t *testing.T) {
	h := NewLauncherHandlers()

	tests := []struct {
		name     string
		setupCtx func() context.Context
		query    string
	}{
		{
			name: "user with admin role",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID:         "admin_user",
					Attributes: map[string]string{"role": "admin"},
				})
			},
			query: "admin search",
		},
		{
			name: "regular user",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID:         "regular_user",
					Attributes: map[string]string{"role": "user"},
				})
			},
			query: "user search",
		},
		{
			name: "no auth context",
			setupCtx: func() context.Context {
				return context.Background()
			},
			query: "anonymous search",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			req := &model.SearchRequest{
				Query: tt.query,
				Limit: 10,
			}

			resp, err := h.HandleSearch(ctx, req)
			if err != nil {
				t.Fatalf("HandleSearch() error = %v", err)
			}

			if resp == nil {
				t.Fatal("Expected non-nil response")
			}
		})
	}
}
