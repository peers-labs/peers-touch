package application

import (
	"testing"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// G-BOT-02: the endpoint manifest validator gates both issuance and
// verification; it must accept AGENT actors so bot endpoints route.
func TestValidateManifestActorAcceptsAgent(t *testing.T) {
	ref := &actormodel.ActorRef{
		Ptid: "ptid:v1:actor:peers:b:claude-code-notifier:abcdef0123456789",
		Kind: actormodel.ActorKind_ACTOR_KIND_AGENT,
	}
	if err := validateManifestActor("test", ref); err != nil {
		t.Fatalf("AGENT actor must pass manifest validation: %v", err)
	}

	ref.Kind = actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED
	if err := validateManifestActor("test", ref); err == nil {
		t.Fatal("unspecified actor kind must be rejected")
	}
}
