package domain

import (
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// helpers

func setU64(ids ...uint64) map[uint64]struct{} {
	s := make(map[uint64]struct{}, len(ids))
	for _, id := range ids {
		s[id] = struct{}{}
	}
	return s
}

func setStrings(ids ...string) map[string]struct{} {
	s := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		s[id] = struct{}{}
	}
	return s
}

func anon() Viewer {
	return Viewer{}
}

func viewer(_ uint64, ptid string) Viewer {
	return Viewer{ActorPTID: ptid}
}

func (v Viewer) following(authorPTIDs ...string) Viewer {
	v.Following = setStrings(authorPTIDs...)
	return v
}

func (v Viewer) inCircles(ids ...uint64) Viewer {
	v.MemberOfCircles = setU64(ids...)
	return v
}

func (v Viewer) inGroups(ids ...uint64) Viewer {
	v.MemberOfGroups = setU64(ids...)
	return v
}

const authorID = "did:peers:author"

// ---------------------------------------------------------------------------
// CanRead: PUBLIC
// ---------------------------------------------------------------------------

func TestCanRead_Public_AllowsEveryone(t *testing.T) {
	a := &model.Audience{Kind: model.Audience_PUBLIC}
	cases := []struct {
		name string
		v    Viewer
	}{
		{"anonymous", anon()},
		{"random user", viewer(7, "did:peers:bob")},
		{"author themself", viewer(100, authorID)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ok, _ := CanRead(tc.v, authorID, a, false)
			if !ok {
				t.Fatalf("PUBLIC should allow %s", tc.name)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// CanRead: FOLLOWERS
// ---------------------------------------------------------------------------

func TestCanRead_Followers(t *testing.T) {
	a := &model.Audience{Kind: model.Audience_FOLLOWERS}

	t.Run("anonymous denied", func(t *testing.T) {
		ok, reason := CanRead(anon(), authorID, a, false)
		if ok {
			t.Fatal("anonymous should be denied for FOLLOWERS")
		}
		if !strings.Contains(reason, "anonymous") {
			t.Fatalf("expected anonymous reason, got %q", reason)
		}
	})

	t.Run("non-follower denied", func(t *testing.T) {
		v := viewer(7, "did:peers:bob") // not following authorID
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("non-follower should be denied")
		}
	})

	t.Run("follower allowed", func(t *testing.T) {
		v := viewer(7, "did:peers:bob").following(authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("follower should be allowed")
		}
	})

	t.Run("author allowed (short-circuit)", func(t *testing.T) {
		v := viewer(100, authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("author always allowed")
		}
	})
}

// ---------------------------------------------------------------------------
// CanRead: CIRCLE
// ---------------------------------------------------------------------------

func TestCanRead_Circle(t *testing.T) {
	const circleID uint64 = 42

	t.Run("missing target_id rejected", func(t *testing.T) {
		a := &model.Audience{Kind: model.Audience_CIRCLE} // TargetId == 0
		v := viewer(7, "did:peers:bob").inCircles(circleID)
		ok, reason := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("CIRCLE without target_id must be denied")
		}
		if !strings.Contains(reason, "target_id") {
			t.Fatalf("expected target_id error, got %q", reason)
		}
	})

	a := &model.Audience{Kind: model.Audience_CIRCLE, TargetId: circleID}

	t.Run("non-member denied", func(t *testing.T) {
		v := viewer(7, "did:peers:bob")
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("non-circle-member should be denied")
		}
	})

	t.Run("member allowed", func(t *testing.T) {
		v := viewer(7, "did:peers:bob").inCircles(circleID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("circle member should be allowed")
		}
	})

	t.Run("author allowed even without circle membership", func(t *testing.T) {
		v := viewer(100, authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("author always allowed")
		}
	})
}

// ---------------------------------------------------------------------------
// CanRead: GROUP
// ---------------------------------------------------------------------------

func TestCanRead_Group(t *testing.T) {
	const groupID uint64 = 9

	t.Run("missing target_id rejected", func(t *testing.T) {
		a := &model.Audience{Kind: model.Audience_GROUP}
		v := viewer(7, "did:peers:bob").inGroups(groupID)
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("GROUP without target_id must be denied")
		}
	})

	a := &model.Audience{Kind: model.Audience_GROUP, TargetId: groupID}

	t.Run("non-member denied", func(t *testing.T) {
		v := viewer(7, "did:peers:bob")
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("non-group-member denied")
		}
	})

	t.Run("member allowed", func(t *testing.T) {
		v := viewer(7, "did:peers:bob").inGroups(groupID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("group member allowed")
		}
	})
}

// ---------------------------------------------------------------------------
// CanRead: SELF
// ---------------------------------------------------------------------------

func TestCanRead_Self(t *testing.T) {
	a := &model.Audience{Kind: model.Audience_SELF}

	t.Run("author allowed", func(t *testing.T) {
		v := viewer(100, authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("author must be able to read own SELF post")
		}
	})

	t.Run("everyone else denied", func(t *testing.T) {
		for _, v := range []Viewer{anon(), viewer(7, "did:peers:bob")} {
			ok, _ := CanRead(v, authorID, a, false)
			if ok {
				t.Fatalf("SELF must deny non-author %#v", v)
			}
		}
	})
}

// ---------------------------------------------------------------------------
// CanRead: CUSTOM_ALLOW
// ---------------------------------------------------------------------------

func TestCanRead_CustomAllow(t *testing.T) {
	a := &model.Audience{
		Kind:       model.Audience_CUSTOM_ALLOW,
		ActorPtids: []string{"did:peers:alice", "did:peers:bob"},
	}

	t.Run("listed PTID allowed", func(t *testing.T) {
		v := viewer(7, "did:peers:alice")
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("listed PTID must be allowed")
		}
	})

	t.Run("unlisted PTID denied", func(t *testing.T) {
		v := viewer(7, "did:peers:eve")
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("unlisted PTID must be denied")
		}
	})

	t.Run("anonymous (empty PTID) denied even if list contains empty", func(t *testing.T) {
		// Defensive: even if the deny list pathologically contains "", an
		// anonymous viewer with empty PTID must NOT match.
		a2 := &model.Audience{
			Kind:       model.Audience_CUSTOM_ALLOW,
			ActorPtids: []string{""},
		}
		ok, _ := CanRead(anon(), authorID, a2, false)
		if ok {
			t.Fatal("anonymous viewer must not match CUSTOM_ALLOW empty PTID")
		}
	})
}

// ---------------------------------------------------------------------------
// CanRead: CUSTOM_DENY
// ---------------------------------------------------------------------------

func TestCanRead_CustomDeny_BasePublic(t *testing.T) {
	a := &model.Audience{
		Kind:       model.Audience_CUSTOM_DENY,
		BaseKind:   model.Audience_PUBLIC,
		ActorPtids: []string{"did:peers:eve"},
	}

	t.Run("listed PTID denied", func(t *testing.T) {
		v := viewer(7, "did:peers:eve")
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("CUSTOM_DENY listed PTID must be denied")
		}
	})

	t.Run("unlisted PTID falls through to PUBLIC", func(t *testing.T) {
		v := viewer(7, "did:peers:alice")
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("unlisted PTID must inherit base_kind PUBLIC visibility")
		}
	})

	t.Run("anonymous viewer falls through to PUBLIC", func(t *testing.T) {
		ok, _ := CanRead(anon(), authorID, a, false)
		if !ok {
			t.Fatal("anonymous viewer must inherit base_kind PUBLIC")
		}
	})
}

func TestCanRead_CustomDeny_BaseFollowers(t *testing.T) {
	a := &model.Audience{
		Kind:       model.Audience_CUSTOM_DENY,
		BaseKind:   model.Audience_FOLLOWERS,
		ActorPtids: []string{"did:peers:eve"},
	}

	t.Run("listed PTID denied even if follower", func(t *testing.T) {
		v := viewer(9, "did:peers:eve").following(authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("CUSTOM_DENY hard-deny must trump follower status")
		}
	})

	t.Run("unlisted follower allowed", func(t *testing.T) {
		v := viewer(7, "did:peers:alice").following(authorID)
		ok, _ := CanRead(v, authorID, a, false)
		if !ok {
			t.Fatal("unlisted follower must inherit FOLLOWERS visibility")
		}
	})

	t.Run("unlisted non-follower denied (base FOLLOWERS)", func(t *testing.T) {
		v := viewer(7, "did:peers:alice")
		ok, _ := CanRead(v, authorID, a, false)
		if ok {
			t.Fatal("unlisted non-follower must be denied via base_kind FOLLOWERS")
		}
	})
}

func TestCanRead_CustomDeny_InvalidBase(t *testing.T) {
	cases := []struct {
		name string
		base model.Audience_Kind
	}{
		{"unspecified", model.Audience_KIND_UNSPECIFIED},
		{"circle", model.Audience_CIRCLE},
		{"group", model.Audience_GROUP},
		{"self", model.Audience_SELF},
		{"custom_allow", model.Audience_CUSTOM_ALLOW},
		{"custom_deny (recursive)", model.Audience_CUSTOM_DENY},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := &model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   tc.base,
				ActorPtids: []string{"did:peers:eve"},
			}
			v := viewer(7, "did:peers:alice")
			ok, reason := CanRead(v, authorID, a, false)
			if ok {
				t.Fatalf("CUSTOM_DENY with invalid base %s must be denied", tc.name)
			}
			if !strings.Contains(reason, "base_kind") {
				t.Fatalf("expected base_kind in reason, got %q", reason)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// CanRead: cross-cutting edge cases
// ---------------------------------------------------------------------------

func TestCanRead_DeletedAlwaysInvisible(t *testing.T) {
	cases := []struct {
		name string
		a    *model.Audience
		v    Viewer
	}{
		{"public", &model.Audience{Kind: model.Audience_PUBLIC}, viewer(7, "did:peers:bob")},
		{"author of a deleted self post", &model.Audience{Kind: model.Audience_SELF}, viewer(100, authorID)},
		{"nil audience", nil, viewer(100, authorID)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ok, reason := CanRead(tc.v, authorID, tc.a, true)
			if ok {
				t.Fatal("deleted post must be invisible")
			}
			if !strings.Contains(reason, "deleted") {
				t.Fatalf("expected 'deleted' in reason, got %q", reason)
			}
		})
	}
}

func TestCanRead_NilAudienceTreatedAsPublic(t *testing.T) {
	ok, reason := CanRead(anon(), authorID, nil, false)
	if !ok {
		t.Fatal("nil audience must default to PUBLIC")
	}
	if !strings.Contains(reason, "legacy") {
		t.Fatalf("expected 'legacy' in reason for nil audience, got %q", reason)
	}
}

func TestCanRead_UnknownKind(t *testing.T) {
	a := &model.Audience{Kind: model.Audience_Kind(99)}
	ok, reason := CanRead(viewer(7, "did:peers:bob"), authorID, a, false)
	if ok {
		t.Fatal("unknown audience kind must be denied")
	}
	if !strings.Contains(reason, "unknown") {
		t.Fatalf("expected 'unknown' in reason, got %q", reason)
	}
}

// An anonymous viewer must never match an author by accident.
func TestCanRead_AnonymousNeverMatchesZeroAuthor(t *testing.T) {
	a := &model.Audience{Kind: model.Audience_FOLLOWERS}
	ok, _ := CanRead(anon(), "", a, false)
	if ok {
		t.Fatal("anonymous must not be treated as author of an authorless post")
	}
}

// ---------------------------------------------------------------------------
// IsPublic
// ---------------------------------------------------------------------------

func TestIsPublic(t *testing.T) {
	cases := []struct {
		name string
		a    *model.Audience
		want bool
	}{
		{"nil → public", nil, true},
		{"public", &model.Audience{Kind: model.Audience_PUBLIC}, true},
		{"followers", &model.Audience{Kind: model.Audience_FOLLOWERS}, false},
		{"circle", &model.Audience{Kind: model.Audience_CIRCLE, TargetId: 1}, false},
		{"self", &model.Audience{Kind: model.Audience_SELF}, false},
		{"custom_allow", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{"x"}}, false},
		{
			"custom_deny base public",
			&model.Audience{Kind: model.Audience_CUSTOM_DENY, BaseKind: model.Audience_PUBLIC, ActorPtids: []string{"x"}},
			false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsPublic(tc.a); got != tc.want {
				t.Fatalf("IsPublic(%v) = %v, want %v", tc.a, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ValidateAudience
// ---------------------------------------------------------------------------

func TestValidateAudience_HappyPaths(t *testing.T) {
	cases := []struct {
		name string
		a    *model.Audience
	}{
		{"public", &model.Audience{Kind: model.Audience_PUBLIC}},
		{"followers", &model.Audience{Kind: model.Audience_FOLLOWERS}},
		{"self", &model.Audience{Kind: model.Audience_SELF}},
		{"circle", &model.Audience{Kind: model.Audience_CIRCLE, TargetId: 1}},
		{"group", &model.Audience{Kind: model.Audience_GROUP, TargetId: 1}},
		{
			"custom_allow",
			&model.Audience{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{"did:peers:a"}},
		},
		{
			"custom_deny base public",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"did:peers:a"},
			},
		},
		{
			"custom_deny base followers",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_FOLLOWERS,
				ActorPtids: []string{"did:peers:a"},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateAudience(tc.a); err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
		})
	}
}

func TestValidateAudience_NilRejected(t *testing.T) {
	if err := ValidateAudience(nil); err == nil {
		t.Fatal("nil audience must be rejected")
	}
}

func TestValidateAudience_Errors(t *testing.T) {
	cases := []struct {
		name    string
		a       *model.Audience
		wantSub string
	}{
		{"unspecified", &model.Audience{Kind: model.Audience_KIND_UNSPECIFIED}, "unspecified"},
		{
			"public with target_id",
			&model.Audience{Kind: model.Audience_PUBLIC, TargetId: 1},
			"target_id",
		},
		{
			"public with actor_ptids",
			&model.Audience{Kind: model.Audience_PUBLIC, ActorPtids: []string{"did:x"}},
			"actor_ptids",
		},
		{
			"public with base_kind",
			&model.Audience{Kind: model.Audience_PUBLIC, BaseKind: model.Audience_FOLLOWERS},
			"base_kind",
		},
		{"circle missing target", &model.Audience{Kind: model.Audience_CIRCLE}, "target_id"},
		{
			"circle with actor_ptids",
			&model.Audience{Kind: model.Audience_CIRCLE, TargetId: 1, ActorPtids: []string{"x"}},
			"actor_ptids",
		},
		{
			"circle with base_kind",
			&model.Audience{Kind: model.Audience_CIRCLE, TargetId: 1, BaseKind: model.Audience_PUBLIC},
			"base_kind",
		},
		{"group missing target", &model.Audience{Kind: model.Audience_GROUP}, "target_id"},
		{
			"custom_allow empty list",
			&model.Audience{Kind: model.Audience_CUSTOM_ALLOW},
			"actor_ptids",
		},
		{
			"custom_allow with target_id",
			&model.Audience{Kind: model.Audience_CUSTOM_ALLOW, TargetId: 1, ActorPtids: []string{"x"}},
			"target_id",
		},
		{
			"custom_allow with base_kind",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_ALLOW,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"x"},
			},
			"base_kind",
		},
		{
			"custom_deny empty list",
			&model.Audience{Kind: model.Audience_CUSTOM_DENY, BaseKind: model.Audience_PUBLIC},
			"actor_ptids",
		},
		{
			"custom_deny with target_id",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				TargetId:   1,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"x"},
			},
			"target_id",
		},
		{
			"custom_deny base unspecified",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				ActorPtids: []string{"x"},
			},
			"base_kind",
		},
		{
			"custom_deny base circle",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_CIRCLE,
				ActorPtids: []string{"x"},
			},
			"base_kind",
		},
		{
			"unsupported kind",
			&model.Audience{Kind: model.Audience_Kind(99)},
			"unsupported",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateAudience(tc.a)
			if err == nil {
				t.Fatalf("expected error, got nil for %#v", tc.a)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSub)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ValidateCircle
// ---------------------------------------------------------------------------

func TestValidateCircle(t *testing.T) {
	t.Run("nil rejected", func(t *testing.T) {
		if err := ValidateCircle(nil); err == nil {
			t.Fatal("nil circle must be rejected")
		}
	})

	t.Run("valid", func(t *testing.T) {
		c := &Circle{ID: 1, OwnerPTID: authorID, Name: "Family"}
		if err := ValidateCircle(c); err != nil {
			t.Fatalf("expected nil, got %v", err)
		}
	})

	t.Run("missing owner", func(t *testing.T) {
		c := &Circle{ID: 1, Name: "Family"}
		if err := ValidateCircle(c); err == nil {
			t.Fatal("missing owner must be rejected")
		}
	})

	t.Run("blank name", func(t *testing.T) {
		c := &Circle{OwnerPTID: authorID, Name: "   "}
		if err := ValidateCircle(c); err == nil {
			t.Fatal("blank name must be rejected")
		}
	})

	t.Run("name too long", func(t *testing.T) {
		c := &Circle{OwnerPTID: authorID, Name: strings.Repeat("a", CircleNameMax+1)}
		if err := ValidateCircle(c); err == nil {
			t.Fatal("over-long name must be rejected")
		}
	})

	t.Run("description too long", func(t *testing.T) {
		c := &Circle{OwnerPTID: authorID, Name: "OK", Description: strings.Repeat("d", CircleDescMax+1)}
		if err := ValidateCircle(c); err == nil {
			t.Fatal("over-long description must be rejected")
		}
	})
}

// ---------------------------------------------------------------------------
// ValidateForAuthor
// ---------------------------------------------------------------------------

func TestValidateForAuthor_DelegatesShape(t *testing.T) {
	// Shape errors from ValidateAudience must propagate before any
	// author-bound check kicks in.
	cases := []struct {
		name   string
		a      *model.Audience
		author string
	}{
		{"nil audience", nil, "did:peers:author"},
		{"unspecified", &model.Audience{Kind: model.Audience_KIND_UNSPECIFIED}, "did:peers:author"},
		{"circle missing target", &model.Audience{Kind: model.Audience_CIRCLE}, "did:peers:author"},
		{"custom_allow empty list", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW}, "did:peers:author"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateForAuthor(tc.author, tc.a); err == nil {
				t.Fatalf("expected shape error, got nil for %#v", tc.a)
			}
		})
	}
}

func TestValidateForAuthor_AuthorSelfInclusion(t *testing.T) {
	const authorPTID = "did:peers:alice"
	cases := []struct {
		name string
		a    *model.Audience
		want bool // true = should be allowed
	}{
		{
			"custom_allow excludes author",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_ALLOW,
				ActorPtids: []string{"did:peers:bob", "did:peers:carol"},
			},
			true,
		},
		{
			"custom_allow includes author",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_ALLOW,
				ActorPtids: []string{"did:peers:bob", authorPTID},
			},
			false,
		},
		{
			"custom_deny excludes author",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"did:peers:bob"},
			},
			true,
		},
		{
			"custom_deny includes author",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_FOLLOWERS,
				ActorPtids: []string{authorPTID, "did:peers:bob"},
			},
			false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateForAuthor(authorPTID, tc.a)
			if tc.want && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !tc.want && err == nil {
				t.Fatal("expected reject, got nil")
			}
		})
	}
}

func TestValidateForAuthor_RequiresAuthorDIDForCustom(t *testing.T) {
	cases := []*model.Audience{
		{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{"did:peers:bob"}},
		{Kind: model.Audience_CUSTOM_DENY, BaseKind: model.Audience_PUBLIC, ActorPtids: []string{"did:peers:bob"}},
	}
	for _, a := range cases {
		t.Run(a.Kind.String(), func(t *testing.T) {
			if err := ValidateForAuthor("", a); err == nil {
				t.Fatal("empty author PTID must be rejected for CUSTOM_*")
			}
		})
	}
}

func TestValidateForAuthor_PublicFollowersSelfNoAuthorRequired(t *testing.T) {
	// PUBLIC / FOLLOWERS / SELF do not need the author PTID.
	cases := []model.Audience_Kind{
		model.Audience_PUBLIC,
		model.Audience_FOLLOWERS,
		model.Audience_SELF,
	}
	for _, kind := range cases {
		t.Run(kind.String(), func(t *testing.T) {
			if err := ValidateForAuthor("", &model.Audience{Kind: kind}); err != nil {
				t.Fatalf("expected allow for %s with empty author, got %v", kind, err)
			}
		})
	}
}

func TestValidateForAuthor_CircleGroupTargetReassertedAfterShape(t *testing.T) {
	// ValidateAudience already enforces TargetId != 0 — but ValidateForAuthor
	// re-asserts it. Both should reject; the test exists to lock in the
	// belt-and-braces invariant.
	for _, kind := range []model.Audience_Kind{model.Audience_CIRCLE, model.Audience_GROUP} {
		t.Run(kind.String(), func(t *testing.T) {
			err := ValidateForAuthor("did:peers:alice", &model.Audience{Kind: kind, TargetId: 0})
			if err == nil {
				t.Fatal("missing target_id must be rejected")
			}
		})
	}
}
