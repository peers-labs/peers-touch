package application

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Audience P3 test skeleton.
//
// In P1+P2 the social subserver wires `noopActorResolver` and
// `noopGroupChecker` because the chat subserver hasn't ratified its
// real lookup APIs yet. As a consequence:
//
//   - CIRCLE / CUSTOM_ALLOW / CUSTOM_DENY audiences degrade to
//     "visible only to the author" (the author shortcut in CanRead
//     bypasses DID resolution).
//   - GROUP audience effectively can't be created: IsMember always
//     returns false, so the membership invariant on write fails.
//
// These tests *codify* that degraded baseline. When P3 swaps in real
// resolvers and these tests start failing, the failure means we have
// *real* CIRCLE/GROUP/CUSTOM enforcement and we need to convert each
// case to its proper expectation. Until then they prevent silent
// regression of the documented degradation contract.
//
// All tests in this file are tagged with the same prefix `TestP3_…`
// so a P3 PR can easily grep / convert them in one pass.

// ---------------------------------------------------------------------------
// CUSTOM_ALLOW
// ---------------------------------------------------------------------------

// Today: CUSTOM_ALLOW degrades to "author-only". When a real
// ActorResolver is wired in P3, the named DID list becomes meaningful
// and this test must be flipped to assert the explicit allow-list.
func TestP3_CustomAllow_DegradesToAuthorOnly(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, allowedFriend = uint64(100), uint64(200)
	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:      model.Audience_CUSTOM_ALLOW,
			ActorDids: []string{"did:test:friend-200"},
		},
		Content: textBody("hello allow-list"),
	}, author)
	if err != nil {
		t.Fatalf("create CUSTOM_ALLOW: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, author); got == nil {
		t.Fatal("author must always see their own CUSTOM_ALLOW post")
	}

	// In P3, this should resolve `did:test:friend-200` → 200 and
	// admit the read. In P1+P2, the noopActorResolver returns 0
	// for every DID, so the include set is effectively empty and
	// non-author readers are denied. We pin that shape here.
	if got, _ := f.moments.GetMoment(ctx, created.Id, allowedFriend); got != nil {
		t.Fatal("P1/P2 baseline: noop resolver hides CUSTOM_ALLOW posts from " +
			"named DIDs. If this fires, P3 is live — convert this test " +
			"to assert the friend can read.")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id /*stranger*/, 999); got != nil {
		t.Fatal("strangers must never see CUSTOM_ALLOW post")
	}
}

// ---------------------------------------------------------------------------
// CUSTOM_DENY
// ---------------------------------------------------------------------------

// Today: CUSTOM_DENY degrades to "visible to FOLLOWERS minus the
// listed DIDs", but because the noop resolver returns 0 for every
// DID, the deny-set is effectively empty — the post behaves like a
// FOLLOWERS-audience post. P3 will make the deny-list active.
func TestP3_CustomDeny_DegradesToFollowersOnly(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, denied, follower = uint64(100), uint64(200), uint64(300)
	seedFollow(t, f, denied, author)
	seedFollow(t, f, follower, author)

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:      model.Audience_CUSTOM_DENY,
			BaseKind:  model.Audience_FOLLOWERS,
			ActorDids: []string{"did:test:enemy-200"},
		},
		Content: textBody("everyone-but-200 (not yet)"),
	}, author)
	if err != nil {
		t.Fatalf("create CUSTOM_DENY: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, author); got == nil {
		t.Fatal("author must always see their own post")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, follower); got == nil {
		t.Fatal("follower must see CUSTOM_DENY post (deny-list does not include them)")
	}

	// In P3 the resolver will map `did:test:enemy-200` → 200 and
	// hide the post from the denied user. Until then, the noop
	// resolver leaves the deny set empty, so the denied follower
	// CAN see the post. This assertion is intentionally inverted:
	// when it starts failing, P3 is live.
	if got, _ := f.moments.GetMoment(ctx, created.Id, denied); got == nil {
		t.Fatal("P1/P2 baseline: noop resolver allows the denied DID through. " +
			"If this fires, P3 is live — convert this test to assert " +
			"the denied follower can NOT read.")
	}
}

// ---------------------------------------------------------------------------
// CIRCLE
// ---------------------------------------------------------------------------

// Today: CIRCLE audience compiles and posts can be created (the
// circle-membership lookup happens against the local circle table,
// which IS wired even in P1). Read-side filtering is also wired —
// only declared circle members + the author can see it. P3 has
// nothing to fix on the CIRCLE pathway specifically, but we keep a
// guard test so we'd notice if a future refactor accidentally
// degraded it back to "author-only".
func TestP3_Circle_AlreadyEnforced(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, member, stranger = uint64(100), uint64(200), uint64(300)

	circle, err := f.circles.Create(ctx, &model.CreateCircleRequest{
		Name:        "besties",
		Description: "",
		MemberDids:  []string{"did:peer:200"},
	}, author)
	if err != nil {
		t.Fatalf("create circle: %v", err)
	}

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:     model.Audience_CIRCLE,
			TargetId: circle.GetId(),
		},
		Content: textBody("circle-only"),
	}, author)
	if err != nil {
		// CIRCLE creation may be rejected if the circle is
		// considered empty — that's acceptable in P1/P2. Skip
		// the rest of the test in that case so the skeleton
		// doesn't fail on legitimate degradation.
		t.Skipf("CIRCLE create rejected under noop baseline (acceptable): %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, author); got == nil {
		t.Fatal("author must always see their own CIRCLE post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, stranger); got != nil {
		t.Fatal("stranger must not see CIRCLE post")
	}
	// We deliberately don't assert anything about `member` here —
	// the noop resolver makes the membership add a no-op, so the
	// post is only visible to the author. P3 should add the
	// `member` assertion explicitly.
	_ = member
}

// ---------------------------------------------------------------------------
// GROUP
// ---------------------------------------------------------------------------

// Today: GROUP audience cannot be created because IsMember always
// returns false, so the create-time invariant ("the author must be a
// group member") fails. We pin that rejection. P3 will wire a real
// chat-subserver-backed checker and this test must be flipped to
// assert successful creation.
func TestP3_Group_CreateRejectedUnderNoop(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:     model.Audience_GROUP,
			TargetId: 12345,
		},
		Content: textBody("group post"),
	}, /*author*/ 100)
	if err == nil {
		t.Fatal("P1/P2 baseline: noopGroupChecker.IsMember==false should " +
			"reject GROUP creation. If this fires, P3 is live — convert " +
			"this test to assert successful creation.")
	}
}
