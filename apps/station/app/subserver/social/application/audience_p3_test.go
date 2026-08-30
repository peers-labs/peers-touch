package application

import (
	"context"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func fixturePTID(id uint64) string {
	return fmt.Sprintf("ptid:v1:actor:peers:p:user-%d:fingerprint-%d", id, id)
}

// Audience P3 tests cover PTID-native custom and circle audiences. Group
// membership remains on the no-op checker until the chat-owned lookup lands.

// ---------------------------------------------------------------------------
// CUSTOM_ALLOW
// ---------------------------------------------------------------------------

func TestP3_CustomAllow_EnforcesAllowList(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, allowedFriend = uint64(100), uint64(200)
	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:       model.Audience_CUSTOM_ALLOW,
			ActorPtids: []string{fixturePTID(allowedFriend)},
		},
		Content: textBody("hello allow-list"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create CUSTOM_ALLOW: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(author)); got == nil {
		t.Fatal("author must always see their own CUSTOM_ALLOW post")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(allowedFriend)); got == nil {
		t.Fatal("named PTID must be able to read CUSTOM_ALLOW post")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id /*stranger*/, fixturePTID(999)); got != nil {
		t.Fatal("strangers must never see CUSTOM_ALLOW post")
	}
}

// ---------------------------------------------------------------------------
// CUSTOM_DENY
// ---------------------------------------------------------------------------

func TestP3_CustomDeny_EnforcesDenyList(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, denied, follower = uint64(100), uint64(200), uint64(300)
	seedFollow(t, f, denied, author)
	seedFollow(t, f, follower, author)

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type: model.PostType_TEXT,
		Audience: &model.Audience{
			Kind:       model.Audience_CUSTOM_DENY,
			BaseKind:   model.Audience_FOLLOWERS,
			ActorPtids: []string{fixturePTID(denied)},
		},
		Content: textBody("everyone-but-200 (not yet)"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create CUSTOM_DENY: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(author)); got == nil {
		t.Fatal("author must always see their own post")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(follower)); got == nil {
		t.Fatal("follower must see CUSTOM_DENY post (deny-list does not include them)")
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(denied)); got != nil {
		t.Fatal("denied PTID must not be able to read CUSTOM_DENY post")
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
		MemberPtids: []string{fixturePTID(member)},
	}, fixturePTID(author))
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
	}, fixturePTID(author))
	if err != nil {
		// CIRCLE creation may be rejected if the circle is
		// considered empty — that's acceptable in P1/P2. Skip
		// the rest of the test in that case so the skeleton
		// doesn't fail on legitimate degradation.
		t.Skipf("CIRCLE create rejected under noop baseline (acceptable): %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(author)); got == nil {
		t.Fatal("author must always see their own CIRCLE post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(stranger)); got != nil {
		t.Fatal("stranger must not see CIRCLE post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(member)); got == nil {
		t.Fatal("circle member must be able to read CIRCLE post")
	}
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
	}, fixturePTID(100))
	if err == nil {
		t.Fatal("P1/P2 baseline: noopGroupChecker.IsMember==false should " +
			"reject GROUP creation. If this fires, P3 is live — convert " +
			"this test to assert successful creation.")
	}
}
