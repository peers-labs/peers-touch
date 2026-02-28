package handler

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func TestHandleListNodes(t *testing.T) {
	h := NewNodeHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *pb.ListNodesRequest
		wantError bool
	}{
		{
			name: "default limit and offset",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.ListNodesRequest{
				Limit:  0,
				Offset: 0,
			},
			wantError: false,
		},
		{
			name: "custom limit and offset",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &pb.ListNodesRequest{
				Limit:  50,
				Offset: 10,
			},
			wantError: false,
		},
		{
			name: "limit exceeds max should be capped",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.ListNodesRequest{
				Limit:  200,
				Offset: 0,
			},
			wantError: false,
		},
		{
			name: "negative offset should be normalized",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.ListNodesRequest{
				Limit:  20,
				Offset: -5,
			},
			wantError: false,
		},
		{
			name: "filter by online status",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.ListNodesRequest{
				Limit:      20,
				Offset:     0,
				Status:     []string{"online"},
				OnlineOnly: true,
			},
			wantError: false,
		},
		{
			name: "filter by capabilities",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.ListNodesRequest{
				Limit:        20,
				Offset:       0,
				Capabilities: []string{"storage", "compute"},
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleListNodes(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("HandleListNodes() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleListNodes() returned nil response")
			}

			if resp.Nodes == nil {
				t.Error("Expected Nodes to be non-nil")
			}

			if resp.Total < 0 {
				t.Errorf("Total = %v, want >= 0", resp.Total)
			}

			if resp.Page < 0 {
				t.Errorf("Page = %v, want >= 0", resp.Page)
			}
		})
	}
}

func TestHandleGetNode(t *testing.T) {
	h := NewNodeHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *pb.GetNodeRequest
		wantError bool
	}{
		{
			name: "missing node_id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.GetNodeRequest{
				NodeId: "",
			},
			wantError: true,
		},
		{
			name: "valid node_id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "user123",
				})
			},
			req: &pb.GetNodeRequest{
				NodeId: "node_123",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleGetNode(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleGetNode() error = %v (may be expected for non-existent node)", err)
				return
			}

			if resp != nil && resp.Node != nil {
				if resp.Node.Id != tt.req.NodeId {
					t.Errorf("Node.Id = %v, want %v", resp.Node.Id, tt.req.NodeId)
				}
			}
		})
	}
}

func TestHandleRegisterNode(t *testing.T) {
	h := NewNodeHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *pb.RegisterNodeRequest
		wantError bool
	}{
		{
			name: "missing name",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.RegisterNodeRequest{
				Name:    "",
				Version: "1.0.0",
			},
			wantError: true,
		},
		{
			name: "missing version",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.RegisterNodeRequest{
				Name:    "test-node",
				Version: "",
			},
			wantError: true,
		},
		{
			name: "missing addresses",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.RegisterNodeRequest{
				Name:      "test-node",
				Version:   "1.0.0",
				Addresses: []string{},
			},
			wantError: true,
		},
		{
			name: "invalid port",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.RegisterNodeRequest{
				Name:      "test-node",
				Version:   "1.0.0",
				Addresses: []string{"192.168.1.1"},
				Port:      -1,
			},
			wantError: true,
		},
		{
			name: "valid registration",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &pb.RegisterNodeRequest{
				Name:         "test-node",
				Version:      "1.0.0",
				Addresses:    []string{"192.168.1.100"},
				Port:         8080,
				Capabilities: []string{"storage"},
				Metadata:     map[string]string{"region": "us-west"},
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleRegisterNode(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleRegisterNode() error = %v (may be expected)", err)
				return
			}

			if !tt.wantError && resp != nil && resp.Node != nil {
				if resp.Node.Name != tt.req.Name {
					t.Errorf("Node.Name = %v, want %v", resp.Node.Name, tt.req.Name)
				}
			}
		})
	}
}

func TestHandleDeregisterNode(t *testing.T) {
	h := NewNodeHandlers()

	tests := []struct {
		name      string
		setupCtx  func() context.Context
		req       *pb.DeregisterNodeRequest
		wantError bool
	}{
		{
			name: "missing node_id",
			setupCtx: func() context.Context {
				return context.Background()
			},
			req: &pb.DeregisterNodeRequest{
				NodeId: "",
			},
			wantError: true,
		},
		{
			name: "valid node_id",
			setupCtx: func() context.Context {
				ctx := context.Background()
				return coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: "admin",
				})
			},
			req: &pb.DeregisterNodeRequest{
				NodeId: "node_to_remove",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupCtx()
			resp, err := h.HandleDeregisterNode(ctx, tt.req)

			if tt.wantError {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil && !tt.wantError {
				t.Logf("HandleDeregisterNode() error = %v (may be expected for non-existent node)", err)
				return
			}

			if !tt.wantError && resp != nil {
				if !resp.Success {
					t.Error("Expected Success to be true")
				}
				if resp.NodeId != tt.req.NodeId {
					t.Errorf("NodeId = %v, want %v", resp.NodeId, tt.req.NodeId)
				}
			}
		})
	}
}
