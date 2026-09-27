package actor

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func TestProtoActorRefUsesPersistedFederatedHandle(t *testing.T) {
	t.Parallel()

	ref := ProtoActorRef(&db.Actor{
		PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
		PreferredUsername: "transport-alias",
		FederatedHandle:   " @Alice@Home.Example ",
		Kind:              "p",
	})

	if got, want := ref.GetAcct(), "alice@home.example"; got != want {
		t.Fatalf("acct = %q, want %q", got, want)
	}
	if got, want := ref.GetPtid(), "ptid:v1:actor:peers:p:alice:fingerprint"; got != want {
		t.Fatalf("ptid = %q, want %q", got, want)
	}
	if got, want := ref.GetKind(), model.ActorKind_ACTOR_KIND_PERSON; got != want {
		t.Fatalf("kind = %s, want %s", got, want)
	}
}

func TestProtoActorRefFailsClosedForInvalidFederatedHandle(t *testing.T) {
	t.Parallel()

	ref := ProtoActorRef(&db.Actor{
		PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
		PreferredUsername: "alice",
		FederatedHandle:   "not-a-federated-handle",
		Kind:              "p",
	})

	if got := ref.GetAcct(); got != "" {
		t.Fatalf("acct = %q, want empty for invalid persisted handle", got)
	}
}

func TestProtoActorRefNilActor(t *testing.T) {
	t.Parallel()

	if ref := ProtoActorRef(nil); ref != nil {
		t.Fatalf("ProtoActorRef(nil) = %#v, want nil", ref)
	}
}
