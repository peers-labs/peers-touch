package domain

import "testing"

func TestInteractionVisibility_PostAuthorSeesAll(t *testing.T) {
	v := InteractionVisibility{ViewerPTID: "author", PostAuthorPTID: "author"}
	if !v.CanSeeActor("third-party") {
		t.Fatal("post author should see every interaction actor")
	}
}

func TestInteractionVisibility_ViewerSeesOwnAndAuthor(t *testing.T) {
	v := InteractionVisibility{ViewerPTID: "viewer", PostAuthorPTID: "author"}
	if !v.CanSeeActor("viewer") {
		t.Fatal("viewer should see own interaction")
	}
	if !v.CanSeeActor("author") {
		t.Fatal("viewer should see post author interaction")
	}
}

func TestInteractionVisibility_RequiresMutualConnectionForThirdParty(t *testing.T) {
	v := InteractionVisibility{
		ViewerPTID:       "viewer",
		PostAuthorPTID:   "author",
		MutualActorPTIDs: map[string]struct{}{"mutual": {}},
	}
	if !v.CanSeeActor("mutual") {
		t.Fatal("viewer should see mutually connected actor")
	}
	if v.CanSeeActor("stranger") {
		t.Fatal("viewer must not see non-mutual third-party actor")
	}
}
