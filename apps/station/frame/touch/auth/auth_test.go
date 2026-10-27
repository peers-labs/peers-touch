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

func TestPendingDeviceLinkSessionIsInactiveAndNotAnOAuthCandidate(t *testing.T) {
	coreauth.Init(coreauth.Config{
		Secret: "pending-session-test-secret", AccessTTL: time.Hour,
	})
	record, response, err := PreparePendingSession(
		context.Background(), credentialTestActor(),
		PendingSessionBinding{
			AccessGateSessionBinding: AccessGateSessionBinding{
				AccessAttemptID: "access-1", StationPeerID: "station-1",
				AccessDecisionRevision: 2, DeviceType: session.DeviceTypeMobile,
				DeviceID: "phone-1", LifecycleGeneration: 1,
			},
			AuthMethod: "device_link",
		},
		time.Unix(1_700_000_000, 0),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !record.Revoked || record.RevokedReason != "credential_delivery_pending" ||
		record.OAuthCandidateID != "" || record.AuthMethod != "device_link" ||
		record.DeviceID != "phone-1" || record.SessionID != response.GetSessionId() {
		t.Fatal("pending Device Link credential escaped its inactive device binding")
	}
	assertCredentialActorRef(t, response.GetActorRef())
}

func TestPendingSessionRejectsCrossMethodAndUnboundDevice(t *testing.T) {
	binding := PendingSessionBinding{
		AccessGateSessionBinding: AccessGateSessionBinding{
			AccessAttemptID: "access-1", StationPeerID: "station-1",
			AccessDecisionRevision: 2, DeviceType: session.DeviceTypeMobile,
			DeviceID: "phone-1", LifecycleGeneration: 1,
		},
		AuthMethod: "device_link",
	}
	for _, name := range []string{"oauth-candidate", "unbound", "web", "unknown-method"} {
		t.Run(name, func(t *testing.T) {
			invalid := binding
			switch name {
			case "oauth-candidate":
				invalid.OAuthCandidateID = "candidate-1"
			case "unbound":
				invalid.DeviceID = ""
			case "web":
				invalid.DeviceType = session.DeviceTypeWeb
			case "unknown-method":
				invalid.AuthMethod = "password"
			}
			if _, _, err := PreparePendingSession(context.Background(),
				credentialTestActor(), invalid, time.Now()); err == nil {
				t.Fatal("invalid pending binding accepted")
			}
		})
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
