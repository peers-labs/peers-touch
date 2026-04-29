package actor

import (
	"strings"

	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type signupProfile struct {
	identityType identity.AccountType
	kindDB       string
	apType       string
}

func signupProfileFromRequest(req *model.ActorSignRequest) signupProfile {
	if req != nil && req.GetKind() != model.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return fromProtoActorKind(req.GetKind())
	}
	if req == nil {
		return signupProfile{identityType: identity.TypePerson, kindDB: "p", apType: "Person"}
	}
	return fromLegacyAccountType(req.GetAccountType())
}

func fromProtoActorKind(k model.ActorKind) signupProfile {
	switch k {
	case model.ActorKind_ACTOR_KIND_PERSON, model.ActorKind_ACTOR_KIND_UNSPECIFIED:
		return signupProfile{identity.TypePerson, "p", "Person"}
	case model.ActorKind_ACTOR_KIND_GROUP:
		return signupProfile{identity.TypeGroup, "g", "Group"}
	case model.ActorKind_ACTOR_KIND_ORGANIZATION:
		return signupProfile{identity.TypeOrganization, "o", "Organization"}
	case model.ActorKind_ACTOR_KIND_SERVICE:
		return signupProfile{identity.TypeService, "s", "Service"}
	case model.ActorKind_ACTOR_KIND_APPLICATION:
		return signupProfile{identity.TypeApplication, "a", "Application"}
	case model.ActorKind_ACTOR_KIND_NODE:
		// PTID layer has no dedicated node type; mint a person identity, mark db kind as node.
		return signupProfile{identity.TypePerson, "n", "Service"}
	default:
		return signupProfile{identity.TypePerson, "p", "Person"}
	}
}

func fromLegacyAccountType(s string) signupProfile {
	t := strings.TrimSpace(strings.ToLower(s))
	switch t {
	case "", "person":
		return signupProfile{identity.TypePerson, "p", "Person"}
	case "group", "g":
		return signupProfile{identity.TypeGroup, "g", "Group"}
	case "organization", "org", "o":
		return signupProfile{identity.TypeOrganization, "o", "Organization"}
	case "service", "s":
		return signupProfile{identity.TypeService, "s", "Service"}
	case "application", "app", "a":
		return signupProfile{identity.TypeApplication, "a", "Application"}
	case "node", "n":
		return signupProfile{identity.TypePerson, "n", "Service"}
	default:
		return signupProfile{identity.TypePerson, "p", "Person"}
	}
}
