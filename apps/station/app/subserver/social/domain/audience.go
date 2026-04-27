package domain

import (
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Viewer captures the relationship facts about a single viewer needed to
// evaluate `CanRead`. It is constructed by the application layer from
// repository queries; this domain function is intentionally pure (zero
// DB / network) so it can be unit-tested with handcrafted relationship
// graphs.
//
// All set-typed fields use `map[uint64]struct{}` for O(1) membership.
// An anonymous viewer (no auth) is represented by zero-valued ActorID
// and empty maps; in that case only PUBLIC posts are visible.
type Viewer struct {
	// Internal actor ID of the viewer (0 = anonymous).
	ActorID uint64
	// Globally unique DID of the viewer (empty = anonymous).
	ActorDID string
	// Set of actor IDs the viewer follows.
	Following map[uint64]struct{}
	// Set of circle IDs the viewer is a member of (looked up via the
	// circle owner's perspective — circles are publisher-owned but
	// here we enumerate from the viewer's side).
	MemberOfCircles map[uint64]struct{}
	// Set of chat.Group IDs the viewer belongs to.
	MemberOfGroups map[uint64]struct{}
}

// CanRead is the SOLE access decision function for Moments / Posts.
//
// Inputs are intentionally narrow (no DB handles, no full Post struct) so
// the caller is forced to pre-resolve the audience and the relationship
// graph. This shape also makes the function ergonomic for fan-out at write
// time (you call it once per recipient candidate during `CreateMoment`).
//
// Rules (in evaluation order):
//  1. Deleted posts are invisible to everyone, including the author.
//  2. Author can always read their own (non-deleted) post.
//  3. nil audience → treated as PUBLIC (legacy compatibility for posts
//     created before the Moments P0 schema; safe default since legacy
//     `PostVisibility` already filtered private content at DB layer).
//  4. Otherwise, dispatch on `audience.Kind` (see `Audience` proto doc).
//
// The returned `reason` is human-readable and intended for log lines /
// 403 explanations; do NOT pattern-match on it.
func CanRead(viewer Viewer, authorID uint64, audience *model.Audience, deleted bool) (bool, string) {
	if deleted {
		return false, "post is deleted"
	}
	if viewer.ActorID != 0 && viewer.ActorID == authorID {
		return true, "author"
	}
	if audience == nil {
		return true, "no audience (legacy public)"
	}
	return canReadKind(viewer, authorID, audience, audience.Kind)
}

func canReadKind(viewer Viewer, authorID uint64, audience *model.Audience, kind model.Audience_Kind) (bool, string) {
	switch kind {
	case model.Audience_PUBLIC:
		return true, "public"

	case model.Audience_FOLLOWERS:
		if viewer.ActorID == 0 {
			return false, "anonymous viewer cannot read FOLLOWERS audience"
		}
		if _, ok := viewer.Following[authorID]; ok {
			return true, "follower of author"
		}
		return false, "not a follower"

	case model.Audience_CIRCLE:
		if audience.TargetId == 0 {
			return false, "CIRCLE audience missing target_id"
		}
		if _, ok := viewer.MemberOfCircles[audience.TargetId]; ok {
			return true, "circle member"
		}
		return false, "not in target circle"

	case model.Audience_GROUP:
		if audience.TargetId == 0 {
			return false, "GROUP audience missing target_id"
		}
		if _, ok := viewer.MemberOfGroups[audience.TargetId]; ok {
			return true, "group member"
		}
		return false, "not in target group"

	case model.Audience_SELF:
		// Author shortcut already handled in CanRead; reaching here means
		// viewer != author, hence denied.
		return false, "self-only audience"

	case model.Audience_CUSTOM_ALLOW:
		if viewer.ActorDID == "" {
			return false, "anonymous viewer cannot match CUSTOM_ALLOW"
		}
		for _, did := range audience.ActorDids {
			if did == viewer.ActorDID {
				return true, "in custom allow list"
			}
		}
		return false, "not in custom allow list"

	case model.Audience_CUSTOM_DENY:
		// Hard-deny first.
		if viewer.ActorDID != "" {
			for _, did := range audience.ActorDids {
				if did == viewer.ActorDID {
					return false, "in custom deny list"
				}
			}
		}
		// Then defer to base.
		base := audience.BaseKind
		if base != model.Audience_PUBLIC && base != model.Audience_FOLLOWERS {
			return false, "CUSTOM_DENY base_kind must be PUBLIC or FOLLOWERS"
		}
		return canReadKind(viewer, authorID, audience, base)

	default:
		return false, fmt.Sprintf("unknown audience kind: %s", kind)
	}
}

// IsPublic reports whether the post should be visible to anonymous /
// federated viewers. CUSTOM_DENY with base PUBLIC is intentionally NOT
// considered public — its presence of any deny entries makes it private
// for outbound federation purposes (consistent with the architecture
// document's storage-separation invariant: only IsPublic == true posts
// may be persisted in the `social_public` schema).
func IsPublic(a *model.Audience) bool {
	if a == nil {
		// Legacy posts (pre-Moments) default to public. The application
		// layer should populate `audience` going forward.
		return true
	}
	return a.Kind == model.Audience_PUBLIC
}

// ValidateAudience enforces the field-presence invariants documented on
// the `Audience` proto. The application layer MUST call this before
// persisting a Post; persistence with an invalid audience is a bug.
func ValidateAudience(a *model.Audience) error {
	if a == nil {
		return fmt.Errorf("audience is nil")
	}
	switch a.Kind {
	case model.Audience_KIND_UNSPECIFIED:
		return fmt.Errorf("audience kind unspecified")

	case model.Audience_PUBLIC, model.Audience_FOLLOWERS, model.Audience_SELF:
		if a.TargetId != 0 {
			return fmt.Errorf("%s audience must not set target_id", a.Kind)
		}
		if len(a.ActorDids) > 0 {
			return fmt.Errorf("%s audience must not set actor_dids", a.Kind)
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("%s audience must not set base_kind", a.Kind)
		}

	case model.Audience_CIRCLE, model.Audience_GROUP:
		if a.TargetId == 0 {
			return fmt.Errorf("%s audience requires target_id", a.Kind)
		}
		if len(a.ActorDids) > 0 {
			return fmt.Errorf("%s audience must not set actor_dids", a.Kind)
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("%s audience must not set base_kind", a.Kind)
		}

	case model.Audience_CUSTOM_ALLOW:
		if len(a.ActorDids) == 0 {
			return fmt.Errorf("CUSTOM_ALLOW audience requires non-empty actor_dids")
		}
		if a.TargetId != 0 {
			return fmt.Errorf("CUSTOM_ALLOW audience must not set target_id")
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("CUSTOM_ALLOW audience must not set base_kind")
		}

	case model.Audience_CUSTOM_DENY:
		if len(a.ActorDids) == 0 {
			return fmt.Errorf("CUSTOM_DENY audience requires non-empty actor_dids")
		}
		if a.TargetId != 0 {
			return fmt.Errorf("CUSTOM_DENY audience must not set target_id")
		}
		if a.BaseKind != model.Audience_PUBLIC && a.BaseKind != model.Audience_FOLLOWERS {
			return fmt.Errorf("CUSTOM_DENY base_kind must be PUBLIC or FOLLOWERS, got %s", a.BaseKind)
		}

	default:
		return fmt.Errorf("unsupported audience kind: %s", a.Kind)
	}
	return nil
}
