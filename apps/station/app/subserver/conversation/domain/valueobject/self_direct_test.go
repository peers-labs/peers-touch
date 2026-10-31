package valueobject

import (
	"strings"
	"testing"
)

func TestSelfDirectConversationIDDeterministic(t *testing.T) {
	id, err := SelfDirectConversationID("ptid:actor:alice")
	if err != nil {
		t.Fatalf("self direct id: %v", err)
	}
	if !strings.HasPrefix(string(id), "direct-self-") {
		t.Fatalf("self direct id must carry the direct-self prefix, got %q", id)
	}
	again, err := SelfDirectConversationID("ptid:actor:alice")
	if err != nil {
		t.Fatalf("self direct id repeat: %v", err)
	}
	if id != again {
		t.Fatalf("self direct id must be deterministic: %q != %q", id, again)
	}
}

func TestSelfDirectIDDistinguishesActorsAndNeverCollidesWithPair(t *testing.T) {
	alice := PTID("ptid:actor:alice")
	bob := PTID("ptid:actor:bob")
	self, err := SelfDirectConversationID(alice)
	if err != nil {
		t.Fatalf("self id: %v", err)
	}
	pair, err := DirectConversationID(alice, bob)
	if err != nil {
		t.Fatalf("pair id: %v", err)
	}
	if self == pair {
		t.Fatalf("self id %q collides with pair id %q", self, pair)
	}
	other, err := SelfDirectConversationID(bob)
	if err != nil {
		t.Fatalf("other self id: %v", err)
	}
	if self == other {
		t.Fatalf("self ids for different actors must differ: %q", self)
	}
}

func TestSelfDirectConversationIDRejectsEmptyActor(t *testing.T) {
	if _, err := SelfDirectConversationID(""); err == nil {
		t.Fatal("empty actor must be rejected")
	}
}

func TestDirectConversationIDForActorsDispatch(t *testing.T) {
	actor := PTID("ptid:actor:alice")
	expectedSelf, _ := SelfDirectConversationID(actor)
	gotSelf, err := DirectConversationIDForActors(actor, actor)
	if err != nil {
		t.Fatalf("dispatch self: %v", err)
	}
	if gotSelf != expectedSelf {
		t.Fatalf("dispatch equal actors = %q, want %q", gotSelf, expectedSelf)
	}
	expectedPair, _ := DirectConversationID(actor, PTID("ptid:actor:bob"))
	gotPair, err := DirectConversationIDForActors(actor, PTID("ptid:actor:bob"))
	if err != nil {
		t.Fatalf("dispatch pair: %v", err)
	}
	if gotPair != expectedPair {
		t.Fatalf("dispatch distinct actors = %q, want %q", gotPair, expectedPair)
	}
}
