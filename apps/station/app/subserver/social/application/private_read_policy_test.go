package application

import (
	"context"
	"strings"
	"testing"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func TestMomentReadPolicyOriginalAuthority(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	post := seedRecoverablePrivateMoment(t, fixture, "policy-post")
	comment := seedRecoverablePrivateComment(t, fixture, post.postID, "policy-comment")
	viewer := &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: "ptid:bob", Kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
		DeviceId: "bob-device",
	}
	targets := []*privatecontentpb.MomentReadPolicyTarget{
		{ItemId: "post", PostId: post.postID},
		{ItemId: "comment", PostId: post.postID, CommentId: comment.commentID},
		{ItemId: "missing", PostId: "missing-post"},
		{ItemId: "wrong-parent", PostId: "missing-post", CommentId: comment.commentID},
		{ItemId: "missing-comment", PostId: post.postID, CommentId: "missing-comment"},
	}
	check := func(wantReadable bool) {
		t.Helper()
		response, err := fixture.service.CheckMomentReadPolicy(context.Background(), viewer,
			&privatecontentpb.CheckMomentReadPolicyRequest{Targets: targets})
		if err != nil {
			t.Fatal(err)
		}
		if len(response.Outcomes) != len(targets) {
			t.Fatalf("outcome count = %d", len(response.Outcomes))
		}
		for index, outcome := range response.Outcomes {
			want := privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_UNAVAILABLE
			if wantReadable && index < 2 {
				want = privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_READABLE
			}
			if outcome.ItemId != targets[index].ItemId || outcome.Decision != want {
				t.Fatalf("outcome %d = %+v, want %v", index, outcome, want)
			}
		}
	}
	check(true)
	if err := fixture.database.Model(&dbmodel.SocialPrivateRecipientGrant{}).
		Where("snapshot_id = ? AND recipient_ptid = ?", post.snapshotID, viewer.Actor.Ptid).
		Update("revoked_at", fixture.clock.now).Error; err != nil {
		t.Fatal(err)
	}
	check(false)
}

func TestMomentReadPolicyCanonicalTargets(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	for _, target := range []*privatecontentpb.MomentReadPolicyTarget{
		nil,
		{ItemId: "", PostId: "post"},
		{ItemId: " item", PostId: "post"},
		{ItemId: "item", PostId: "post "},
		{ItemId: "item", PostId: "post", CommentId: " "},
		{ItemId: "item", PostId: strings.Repeat("p", 129)},
	} {
		_, err := fixture.service.CheckMomentReadPolicy(context.Background(), fixture.author.Endpoint,
			&privatecontentpb.CheckMomentReadPolicyRequest{Targets: []*privatecontentpb.MomentReadPolicyTarget{target}})
		if !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentInvalidArgument) {
			t.Fatalf("target %+v: %v", target, err)
		}
	}
	duplicate := &privatecontentpb.MomentReadPolicyTarget{ItemId: "same", PostId: "post"}
	for _, targets := range [][]*privatecontentpb.MomentReadPolicyTarget{
		{duplicate, duplicate},
		make([]*privatecontentpb.MomentReadPolicyTarget, 101),
	} {
		_, err := fixture.service.CheckMomentReadPolicy(context.Background(), fixture.author.Endpoint,
			&privatecontentpb.CheckMomentReadPolicyRequest{Targets: targets})
		if !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentInvalidArgument) {
			t.Fatalf("invalid batch: %v", err)
		}
	}
}
