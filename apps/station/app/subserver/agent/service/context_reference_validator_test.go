package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

func TestFirstRetiredInlineContextReference(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantKind  string
		wantToken string
		wantFound bool
	}{
		{
			name:      "file with line range",
			input:     "Review @file:src/main.go:10-20 before answering",
			wantKind:  "file",
			wantToken: "@file:src/main.go:10-20",
			wantFound: true,
		},
		{
			name:      "folder",
			input:     "Summarize @folder:apps/station",
			wantKind:  "folder",
			wantToken: "@folder:apps/station",
			wantFound: true,
		},
		{
			name:      "url",
			input:     "Read @url:https://example.test/reference?q=1",
			wantKind:  "url",
			wantToken: "@url:https://example.test/reference?q=1",
			wantFound: true,
		},
		{
			name:      "diff",
			input:     "Review @diff now",
			wantKind:  "diff",
			wantToken: "@diff",
			wantFound: true,
		},
		{
			name:      "staged",
			input:     "Review @staged now",
			wantKind:  "staged",
			wantToken: "@staged",
			wantFound: true,
		},
		{
			name:      "git",
			input:     "Summarize @git:3",
			wantKind:  "git",
			wantToken: "@git:3",
			wantFound: true,
		},
		{
			name:      "empty explicit reference",
			input:     "Broken @file: reference",
			wantKind:  "file",
			wantToken: "@file:",
			wantFound: true,
		},
		{
			name:      "first reference wins",
			input:     "Read @url:https://example.test first, then @file:README.md",
			wantKind:  "url",
			wantToken: "@url:https://example.test",
			wantFound: true,
		},
		{
			name:      "ordinary agent mentions remain text",
			input:     "Ask @Agent and @reviewer about @difference and @stagedWork",
			wantFound: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, found := firstRetiredInlineContextReference(test.input)
			if found != test.wantFound {
				t.Fatalf("found = %t, want %t: %+v", found, test.wantFound, got)
			}
			if !found {
				if err := validateNoRetiredInlineContextReference(test.input); err != nil {
					t.Fatalf("ordinary mention validation = %v", err)
				}
				return
			}
			if got.kind != test.wantKind || got.token != test.wantToken {
				t.Fatalf(
					"reference = {%q, %q}, want {%q, %q}",
					got.kind,
					got.token,
					test.wantKind,
					test.wantToken,
				)
			}
		})
	}
}

func TestValidateNoRetiredInlineContextReferenceReturnsTypedHash(t *testing.T) {
	const token = "@folder:private/work"

	err := validateNoRetiredInlineContextReference("Inspect " + token + " please")
	assertContextInvalidReferenceError(t, err, "folder", token)
}

func TestExecuteTurnRejectsRetiredInlineReferenceBeforeExecution(t *testing.T) {
	providerCalls := 0
	service := &TurnService{
		providerCall: func(
			context.Context,
			*ProviderCallRequest,
		) (*ProviderCallResponse, error) {
			providerCalls++

			return &ProviderCallResponse{}, nil
		},
	}
	config := &TurnConfig{}
	const token = "@git:5"

	turn, err := service.ExecuteTurn(
		context.Background(),
		config,
		"Summarize "+token,
	)
	if turn != nil {
		t.Fatalf("rejected direct turn = %+v, want nil", turn)
	}
	assertContextInvalidReferenceError(t, err, "git", token)
	if config.TurnID != "" {
		t.Fatalf("rejected direct turn allocated turn ID %q", config.TurnID)
	}
	if providerCalls != 0 {
		t.Fatalf("rejected direct turn invoked provider %d times", providerCalls)
	}
}

func assertContextInvalidReferenceError(
	t *testing.T,
	err error,
	wantKind string,
	wantToken string,
) {
	t.Helper()

	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) {
		t.Fatalf("error = %T %v, want *errcode.BizError", err, err)
	}
	wantHash := sha256.Sum256([]byte(wantToken))
	if bizErr.Code != errcode.AgentContextInvalidReference ||
		bizErr.Payload == nil ||
		bizErr.Payload.GetError() != errcode.AgentContextInvalidReferenceLocaleKey ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentContextInvalidReference) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentContextInvalidReferenceLocaleKey ||
		bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		len(bizErr.Payload.GetDetails()) != 2 ||
		bizErr.Payload.GetDetails()["reference_kind"] != wantKind ||
		bizErr.Payload.GetDetails()["reference_hash"] != fmt.Sprintf("%x", wantHash) {
		t.Fatalf("invalid reference error = %+v", bizErr)
	}
}
