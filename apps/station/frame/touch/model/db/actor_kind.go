package db

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// KindFromProto maps a proto ActorKind to the single-letter store shorthand (p|g|o|s|a|n).
// ACTOR_KIND_UNSPECIFIED defaults to "p" (Person).
func KindFromProto(k model.ActorKind) string {
	switch k {
	case model.ActorKind_ACTOR_KIND_PERSON, model.ActorKind_ACTOR_KIND_UNSPECIFIED:
		return "p"
	case model.ActorKind_ACTOR_KIND_GROUP:
		return "g"
	case model.ActorKind_ACTOR_KIND_ORGANIZATION:
		return "o"
	case model.ActorKind_ACTOR_KIND_SERVICE:
		return "s"
	case model.ActorKind_ACTOR_KIND_APPLICATION:
		return "a"
	case model.ActorKind_ACTOR_KIND_NODE:
		return "n"
	// AGENT is an explicit branch; the default Person fallback must not
	// collapse a bot into "p".
	case model.ActorKind_ACTOR_KIND_AGENT:
		return "b"
	default:
		return "p"
	}
}

// ActorKindFromShorthand maps DB kind (p|g|o|s|a|n) to proto ActorKind.
// Unknown/empty values map to ACTOR_KIND_UNSPECIFIED.
func ActorKindFromShorthand(s string) model.ActorKind {
	switch strings.TrimSpace(strings.ToLower(s)) {
	case "g":
		return model.ActorKind_ACTOR_KIND_GROUP
	case "o":
		return model.ActorKind_ACTOR_KIND_ORGANIZATION
	case "s":
		return model.ActorKind_ACTOR_KIND_SERVICE
	case "a":
		return model.ActorKind_ACTOR_KIND_APPLICATION
	case "n":
		return model.ActorKind_ACTOR_KIND_NODE
	case "b":
		return model.ActorKind_ACTOR_KIND_AGENT
	case "p", "":
		return model.ActorKind_ACTOR_KIND_PERSON
	default:
		return model.ActorKind_ACTOR_KIND_UNSPECIFIED
	}
}
