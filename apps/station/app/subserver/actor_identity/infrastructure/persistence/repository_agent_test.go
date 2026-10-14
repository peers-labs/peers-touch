package persistence

import (
	"testing"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Migration kind mapping accepts the "b" agent shorthand.
func TestMigrationActorKindAgent(t *testing.T) {
	got, err := migrationActorKind("b")
	if err != nil {
		t.Fatalf("migrationActorKind(b): %v", err)
	}
	if got != int32(actormodel.ActorKind_ACTOR_KIND_AGENT) {
		t.Fatalf("migrationActorKind(b) = %d, want AGENT(%d)",
			got, actormodel.ActorKind_ACTOR_KIND_AGENT)
	}
	if _, err := migrationActorKind("z"); err == nil {
		t.Fatal("unknown shorthand must error, not silently map")
	}
}
