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
// Actor set fields use PTID keys for O(1) membership.
// An anonymous viewer (no auth) is represented by an empty ActorPTID
// and empty maps; in that case only PUBLIC posts are visible.
type Viewer struct {
	// Globally unique PTID of the viewer (empty = anonymous).
	ActorPTID string
	// Set of actor PTIDs the viewer follows.
	Following map[string]struct{}
	// Set of actor PTIDs with an accepted Social relationship to the viewer.
	Friends map[string]struct{}
	// Set of actor PTIDs that are blocked in either direction with this viewer.
	// Block is a cross-social privacy boundary: it suppresses follow-derived
	// visibility and prevents audience selectors from becoming a bypass.
	BlockedActors map[string]struct{}
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
//  3. nil audience → treated as PUBLIC. Only public Post rows reach this
//     evaluator; private resources use the Secure Content authority.
//  4. Otherwise, dispatch on `audience.Kind` (see `Audience` proto doc).
//
// The returned `reason` is human-readable and intended for log lines /
// 403 explanations; do NOT pattern-match on it.
func CanRead(viewer Viewer, authorPTID string, audience *model.Audience, deleted bool) (bool, string) {
	if deleted {
		return false, "post is deleted"
	}
	if viewer.ActorPTID != "" && viewer.ActorPTID == authorPTID {
		return true, "author"
	}
	if _, blocked := viewer.BlockedActors[authorPTID]; blocked {
		return false, "blocked relationship"
	}
	if audience == nil {
		return true, "no audience (legacy public)"
	}
	return canReadKind(viewer, authorPTID, audience, audience.Kind)
}

func canReadKind(viewer Viewer, authorPTID string, audience *model.Audience, kind model.Audience_Kind) (bool, string) {
	switch kind {
	case model.Audience_PUBLIC:
		return true, "public"

	case model.Audience_FOLLOWERS:
		if viewer.ActorPTID == "" {
			return false, "anonymous viewer cannot read FOLLOWERS audience"
		}
		if _, ok := viewer.Following[authorPTID]; ok {
			return true, "follower of author"
		}
		return false, "not a follower"

	case model.Audience_FRIENDS:
		if viewer.ActorPTID == "" {
			return false, "anonymous viewer cannot read FRIENDS audience"
		}
		if _, ok := viewer.Friends[authorPTID]; ok {
			return true, "accepted friend of author"
		}
		return false, "not an accepted friend"

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
		if viewer.ActorPTID == "" {
			return false, "anonymous viewer cannot match CUSTOM_ALLOW"
		}
		for _, ptid := range audience.ActorPtids {
			if ptid == viewer.ActorPTID {
				return true, "in custom allow list"
			}
		}
		return false, "not in custom allow list"

	case model.Audience_CUSTOM_DENY:
		// Hard-deny first.
		if viewer.ActorPTID != "" {
			for _, ptid := range audience.ActorPtids {
				if ptid == viewer.ActorPTID {
					return false, "in custom deny list"
				}
			}
		}
		// Then defer to base.
		base := audience.BaseKind
		if base != model.Audience_PUBLIC && base != model.Audience_FOLLOWERS {
			return false, "CUSTOM_DENY base_kind must be PUBLIC or FOLLOWERS"
		}
		return canReadKind(viewer, authorPTID, audience, base)

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

	case model.Audience_PUBLIC, model.Audience_FOLLOWERS, model.Audience_FRIENDS, model.Audience_SELF:
		if a.TargetId != 0 {
			return fmt.Errorf("%s audience must not set target_id", a.Kind)
		}
		if len(a.ActorPtids) > 0 {
			return fmt.Errorf("%s audience must not set actor_ptids", a.Kind)
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("%s audience must not set base_kind", a.Kind)
		}

	case model.Audience_CIRCLE, model.Audience_GROUP:
		if a.TargetId == 0 {
			return fmt.Errorf("%s audience requires target_id", a.Kind)
		}
		if len(a.ActorPtids) > 0 {
			return fmt.Errorf("%s audience must not set actor_ptids", a.Kind)
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("%s audience must not set base_kind", a.Kind)
		}

	case model.Audience_CUSTOM_ALLOW:
		if len(a.ActorPtids) == 0 {
			return fmt.Errorf("CUSTOM_ALLOW audience requires non-empty actor_ptids")
		}
		if a.TargetId != 0 {
			return fmt.Errorf("CUSTOM_ALLOW audience must not set target_id")
		}
		if a.BaseKind != model.Audience_KIND_UNSPECIFIED {
			return fmt.Errorf("CUSTOM_ALLOW audience must not set base_kind")
		}

	case model.Audience_CUSTOM_DENY:
		if len(a.ActorPtids) == 0 {
			return fmt.Errorf("CUSTOM_DENY audience requires non-empty actor_ptids")
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

// ValidateForAuthor layers author-aware semantic checks on top of
// `ValidateAudience`'s shape checks. It MUST be called by the
// application layer before persisting a Post; persistence after this
// returns nil is guaranteed not to violate any author-bound invariant.
//
// Checks (after `ValidateAudience` has passed):
//
//   - CIRCLE/GROUP target_id is non-zero (already enforced by
//     ValidateAudience but re-asserted here for defensive depth).
//   - For CUSTOM_ALLOW / CUSTOM_DENY, the author's own PTID must NOT
//     appear in the actor list. Including yourself in your own allow
//     list is meaningless (you can always read your own posts) and
//     including yourself in your own deny list would be silently
//     unenforced (you'll see your own post anyway via the author
//     shortcut in CanRead). Either case is almost certainly a client
//     bug; surfacing it as a 400 is friendlier than silent ignore.
//
// What this function intentionally does NOT check (deferred to the
// application layer because they require external lookups):
//
//   - Whether a CIRCLE's target_id refers to a circle owned by this
//     author — that needs a CircleRepository call (MomentService does it).
//   - Whether the author is a member of a GROUP target — that needs a
//     GroupMembershipChecker call (MomentService does it).
//   - Whether each PTID in CUSTOM_* resolves to a known local actor —
//     that's an ActorResolver concern, optional in P1 (no-op default).
//
// Splitting "shape" (ValidateAudience), "author-bound" (this function),
// and "cross-subserver" (MomentService) keeps the domain layer testable
// without DB / chat dependencies while still covering the predicate
// "would creating this Post violate any audience invariant".
func ValidateForAuthor(authorPTID string, a *model.Audience) error {
	if err := ValidateAudience(a); err != nil {
		return err
	}
	switch a.Kind {
	case model.Audience_CIRCLE, model.Audience_GROUP:
		// ValidateAudience already enforced TargetId != 0; keep the
		// re-check so future readers see the invariant explicitly.
		if a.TargetId == 0 {
			return fmt.Errorf("%s audience requires target_id (re-check)", a.Kind)
		}

	case model.Audience_CUSTOM_ALLOW, model.Audience_CUSTOM_DENY:
		if authorPTID == "" {
			// Without a PTID we cannot enforce "author not in own list";
			// fail closed. In practice the application layer always has
			// the author's PTID at hand.
			return fmt.Errorf("%s audience requires non-empty author PTID for self-inclusion check", a.Kind)
		}
		for _, ptid := range a.ActorPtids {
			if ptid == authorPTID {
				return fmt.Errorf("%s audience must not include the author themselves", a.Kind)
			}
		}
	}
	return nil
}
