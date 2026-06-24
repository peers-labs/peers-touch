package domain

import "testing"

func TestInteractionVisibility_PostAuthorSeesAll(t *testing.T) {
	v := InteractionVisibility{ViewerID: 100, PostAuthorID: 100}
	if !v.CanSeeActor(200) {
		t.Fatal("post author should see every interaction actor")
	}
}

func TestInteractionVisibility_ViewerSeesOwnAndAuthor(t *testing.T) {
	v := InteractionVisibility{ViewerID: 200, PostAuthorID: 100}
	if !v.CanSeeActor(200) {
		t.Fatal("viewer should see own interaction")
	}
	if !v.CanSeeActor(100) {
		t.Fatal("viewer should see post author interaction")
	}
}

func TestInteractionVisibility_RequiresMutualConnectionForThirdParty(t *testing.T) {
	v := InteractionVisibility{
		ViewerID:       200,
		PostAuthorID:   100,
		MutualActorIDs: map[uint64]struct{}{300: {}},
	}
	if !v.CanSeeActor(300) {
		t.Fatal("viewer should see mutually connected actor")
	}
	if v.CanSeeActor(400) {
		t.Fatal("viewer must not see non-mutual third-party actor")
	}
}
