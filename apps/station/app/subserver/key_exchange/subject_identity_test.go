package key_exchange

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestCanonicalKeyExchangeSubjectWrapsJWTBeforeHandler(t *testing.T) {
	jwt := func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			return next(coreauth.WithSubject(ctx, &coreauth.Subject{ID: "42"}), req, resp)
		}
	}
	resolver := func(_ context.Context, subjectID string) (string, error) {
		if subjectID != "42" {
			t.Fatalf("resolver received %q, want numeric JWT subject", subjectID)
		}
		return "ptid:v1:actor:peers:p:alice:fingerprint", nil
	}

	var got string
	handler := func(ctx context.Context, _ server.Request, _ server.Response) error {
		got = coreauth.GetSubject(ctx).ID
		return nil
	}
	if err := withCanonicalKeyExchangeSubject(jwt, resolver)(handler)(
		context.Background(),
		nil,
		nil,
	); err != nil {
		t.Fatalf("wrapped handler failed: %v", err)
	}
	if got != "ptid:v1:actor:peers:p:alice:fingerprint" {
		t.Fatalf("handler subject = %q, want canonical PTID", got)
	}
}
