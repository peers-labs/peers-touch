package handler

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/actor"
)

func TestHandleVerifySession(t *testing.T) {
	tests := []struct {
		name           string
		setupContext   func() context.Context
		expectedValid  bool
		expectedID     string
		expectNilSubj  bool
	}{
		{
			name: "valid session with subject",
			setupContext: func() context.Context {
				ctx := context.Background()
				subject := &coreauth.Subject{
					ID: "user123",
					Attributes: map[string]string{
						"role":  "admin",
						"email": "test@example.com",
					},
				}
				return coreauth.WithSubject(ctx, subject)
			},
			expectedValid: true,
			expectedID:    "user123",
			expectNilSubj: false,
		},
		{
			name: "no subject in context",
			setupContext: func() context.Context {
				return context.Background()
			},
			expectedValid: false,
			expectedID:    "",
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
			expectedValid: true,
			expectedID:    "",
			expectNilSubj: false,
		},
		{
			name: "subject with attributes",
			setupContext: func() context.Context {
				ctx := context.Background()
				subject := &coreauth.Subject{
					ID: "user456",
					Attributes: map[string]string{
						"role":        "moderator",
						"permissions": "read,write",
					},
				}
				return coreauth.WithSubject(ctx, subject)
			},
			expectedValid: true,
			expectedID:    "user456",
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

			if resp.SubjectId != tt.expectedID {
				t.Errorf("SubjectId = %v, want %v", resp.SubjectId, tt.expectedID)
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
