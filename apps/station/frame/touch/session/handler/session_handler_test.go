package handler

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/actor"
)

func TestHandleVerifySession(t *testing.T) {
	tests := []struct {
		name          string
		setupContext  func() context.Context
		expectedValid bool
		expectNilSubj bool
	}{
		{
			name: "no subject in context",
			setupContext: func() context.Context {
				return context.Background()
			},
			expectedValid: false,
			expectNilSubj: true,
		},
		{
			name: "subject with empty ID",
			setupContext: func() context.Context {
				ctx := context.Background()
				subject := &coreauth.Subject{
					ID: "",
					Attributes: map[string]string{
						"role": "user",
					},
				}
				return coreauth.WithSubject(ctx, subject)
			},
			expectedValid: false,
			expectNilSubj: false,
		},
		{
			name: "numeric subject fails closed",
			setupContext: func() context.Context {
				ctx := context.Background()
				subject := &coreauth.Subject{
					ID: "12345",
				}
				return coreauth.WithSubject(ctx, subject)
			},
			expectedValid: false,
			expectNilSubj: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tt.setupContext()
			req := &pb.VerifySessionRequest{}

			resp, err := HandleVerifySession(ctx, req)

			if err != nil {
				t.Fatalf("HandleVerifySession() error = %v", err)
			}

			if resp == nil {
				t.Fatal("HandleVerifySession() returned nil response")
			}

			if resp.Valid != tt.expectedValid {
				t.Errorf("Valid = %v, want %v", resp.Valid, tt.expectedValid)
			}

			if !tt.expectNilSubj {
				subject := coreauth.GetSubject(ctx)
				if subject == nil {
					t.Error("Expected subject in context but got nil")
				}
				if resp.Attributes != nil && len(resp.Attributes) != len(subject.Attributes) {
					t.Errorf("Attributes length = %v, want %v", len(resp.Attributes), len(subject.Attributes))
				}
			}
		})
	}
}
