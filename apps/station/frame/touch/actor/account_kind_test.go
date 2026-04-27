package actor

import (
	"testing"

	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// SignUp sets db.Actor.Kind and identity.CreateIdentity from signupProfileFromRequest; these
// cases mirror the “explicit kind” and “default person” sign-up behavior.

func TestSignupResolvesProtoPersonKind(t *testing.T) {
	t.Parallel()
	k := model.ActorKind_ACTOR_KIND_PERSON
	req := &model.ActorSignRequest{Kind: &k}
	p := signupProfileFromRequest(req)
	if p.kindDB != "p" {
		t.Fatalf("kindDB: got %q want p", p.kindDB)
	}
	if p.identityType != identity.TypePerson {
		t.Fatalf("identity: got %q want p", p.identityType)
	}
}

func TestSignupResolvesUnspecifiedToPerson(t *testing.T) {
	t.Parallel()
	// Unset proto kind + empty legacy type → Person, matching SignUp after Check() with legacy defaults
	req := &model.ActorSignRequest{}
	p := signupProfileFromRequest(req)
	if p.kindDB != "p" {
		t.Fatalf("kindDB: got %q want p", p.kindDB)
	}
	if p.identityType != identity.TypePerson {
		t.Fatalf("identity: got %q want p", p.identityType)
	}
}
