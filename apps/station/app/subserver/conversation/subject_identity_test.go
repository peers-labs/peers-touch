package conversation

import (
	"context"
	"errors"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestCanonicalConversationSubjectWrapsJWTBeforeHandler(t *testing.T) {
	const ptid = "ptid:v1:actor:peers:p:alice:fingerprint"
	jwt := func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			return next(coreauth.WithSubject(ctx, &coreauth.Subject{
				ID:         ptid,
				SessionID:  "session-1",
				Attributes: map[string]string{"device": "desktop"},
			}), req, resp)
		}
	}
	resolver := func(_ context.Context, subjectID string) (string, error) {
		if subjectID != ptid {
			t.Fatalf("resolver received %q, want PTID JWT subject", subjectID)
		}
		return ptid, nil
	}

	var got *coreauth.Subject
	handler := func(ctx context.Context, _ server.Request, _ server.Response) error {
		got = coreauth.GetSubject(ctx)
		return nil
	}
	if err := withCanonicalConversationSubject(jwt, resolver)(handler)(
		context.Background(),
		nil,
		nil,
	); err != nil {
		t.Fatalf("wrapped handler failed: %v", err)
	}
	if got == nil || got.ID != ptid {
		t.Fatalf("handler subject = %#v, want canonical PTID", got)
	}
	if got.SessionID != "session-1" || got.Attributes["device"] != "desktop" {
		t.Fatalf("subject metadata was not preserved: %#v", got)
	}
}

func TestCanonicalConversationSubjectFailsClosed(t *testing.T) {
	jwt := func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			return next(coreauth.WithSubject(ctx, &coreauth.Subject{ID: "42"}), req, resp)
		}
	}
	resolver := func(context.Context, string) (string, error) {
		return "", errors.New("actor has no PTID")
	}
	called := false
	handler := func(context.Context, server.Request, server.Response) error {
		called = true
		return nil
	}

	if err := withCanonicalConversationSubject(jwt, resolver)(handler)(
		context.Background(),
		nil,
		nil,
	); err == nil {
		t.Fatal("expected canonical subject resolution failure")
	}
	if called {
		t.Fatal("handler ran with an unresolved numeric subject")
	}
}

func TestResolveConversationSubjectPTIDAcceptsCanonicalValue(t *testing.T) {
	const ptid = "ptid:v1:actor:peers:p:alice:fingerprint"
	got, err := resolveConversationSubjectPTID(context.Background(), ptid)
	if err != nil || got != ptid {
		t.Fatalf("resolve canonical PTID = %q, %v", got, err)
	}
}
