package auth

import (
	"context"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func TestPrepareOAuthSessionIncludesCanonicalActorRef(t *testing.T) {
	coreauth.Init(coreauth.Config{
		Secret:    "oauth-session-test-secret",
		AccessTTL: time.Hour,
	})
	actor := credentialTestActor()

	record, response, err := PrepareOAuthSession(
		context.Background(),
		actor,
		OAuthSessionBinding{
			CandidateID:            "candidate-1",
			AccessAttemptID:        "attempt-1",
			StationPeerID:          "station-1",
			AccessDecisionRevision: 1,
			DeviceType:             session.DeviceTypeDesktop,
			DeviceID:               "device-1",
			LifecycleGeneration:    1,
		},
		time.Unix(1_700_000_000, 0),
	)
	if err != nil {
		t.Fatalf("PrepareOAuthSession() error = %v", err)
	}
	if got, want := record.DeviceType, session.DeviceTypeDesktop; got != want {
		t.Fatalf("device type = %q, want %q", got, want)
	}
	assertCredentialActorRef(t, response.GetActorRef())
}

func TestPrepareOAuthSessionRejectsRuntimeClientClassAlias(t *testing.T) {
	coreauth.Init(coreauth.Config{
		Secret:    "oauth-session-test-secret",
		AccessTTL: time.Hour,
	})

	_, _, err := PrepareOAuthSession(
		context.Background(),
		credentialTestActor(),
		OAuthSessionBinding{
			CandidateID:            "candidate-1",
			AccessAttemptID:        "attempt-1",
			StationPeerID:          "station-1",
			AccessDecisionRevision: 1,
			DeviceType:             session.DeviceType("desktop-native"),
			DeviceID:               "device-1",
			LifecycleGeneration:    1,
		},
		time.Unix(1_700_000_000, 0),
	)
	if err == nil {
		t.Fatal("PrepareOAuthSession() accepted a runtime client-class alias")
	}
}

func TestIssueTokenAndSessionRejectsNonCanonicalClientClassBeforeIssuance(t *testing.T) {
	_, err := IssueTokenAndSession(
		context.Background(),
		credentialTestActor(),
		"127.0.0.1",
		"session-class-test",
		"desktop-native",
		nil,
	)
	if err == nil {
		t.Fatal("IssueTokenAndSession() accepted a runtime client-class alias")
	}
}

func TestIssueSessionCredentialIncludesCanonicalActorRef(t *testing.T) {
	coreauth.Init(coreauth.Config{
		Secret:    "access-gate-session-test-secret",
		AccessTTL: time.Hour,
	})

	response, err := issueSessionCredential(
		context.Background(),
		credentialTestActor(),
		"session-1",
	)
	if err != nil {
		t.Fatalf("issueSessionCredential() error = %v", err)
	}
	assertCredentialActorRef(t, response.GetActorRef())
}

func credentialTestActor() *db.Actor {
	return &db.Actor{
		PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
		PreferredUsername: "transport-alias",
		FederatedHandle:   "@Alice@Home.Example",
		Email:             "alice@example.test",
		Kind:              "p",
	}
}

func assertCredentialActorRef(t *testing.T, ref *model.ActorRef) {
	t.Helper()
	if ref == nil {
		t.Fatal("credential ActorRef is nil")
	}
	if got, want := ref.GetPtid(), credentialTestActor().PTID; got != want {
		t.Fatalf("ptid = %q, want %q", got, want)
	}
	if got, want := ref.GetAcct(), "alice@home.example"; got != want {
		t.Fatalf("acct = %q, want %q", got, want)
	}
	if got, want := ref.GetKind(), model.ActorKind_ACTOR_KIND_PERSON; got != want {
		t.Fatalf("kind = %s, want %s", got, want)
	}
}
