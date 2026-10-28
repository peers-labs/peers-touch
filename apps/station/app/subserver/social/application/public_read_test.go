package application

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

func seedPublicReadRows(t *testing.T, f *fixture, count int) {
	t.Helper()
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	post := db.SocialPublicPost{ID: 1001, AuthorID: 1, Type: "TEXT", AudienceKind: "PUBLIC",
		TextBody: "original public post", CreatedAt: now, UpdatedAt: now}
	if err := f.gdb.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	for index := 0; index < count; index++ {
		comment := db.SocialComment{ID: uint64(2001 + index), PostID: 1001, PostClass: "public",
			AuthorID: 3, TextBody: fmt.Sprintf("reply %d", index),
			CreatedAt: now.Add(time.Duration(index) * time.Minute), UpdatedAt: now}
		if index == 0 {
			comment.AuthorID = 1
		}
		if index == 1 {
			comment.AuthorID = 2
		}
		if err := f.gdb.Create(&comment).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestPublicReadPointBatchPolicyParity(t *testing.T) {
	f := newFixture(t)
	seedPublicReadRows(t, f, 3)
	ctx, viewer := context.Background(), fixturePTID(2)
	port := NewPublicReadPort(f.repos)
	check := func(wantThird bool) {
		t.Helper()
		batch, err := port.Read(ctx, viewer, []uint64{1001}, []uint64{2001, 2002, 2003})
		if err != nil || batch.Posts[1001] == nil || batch.Comments[2001] == nil || batch.Comments[2002] == nil {
			t.Fatalf("public owner/own interaction: batch=%+v err=%v", batch, err)
		}
		third, err := f.comments.GetByPost(ctx, 1001, 2003, viewer)
		if err != nil || (third != nil) != wantThird || (batch.Comments[2003] != nil) != wantThird {
			t.Fatalf("point/batch mismatch: third=%+v batch=%+v err=%v", third, batch.Comments, err)
		}
	}
	check(false)
	seedFollow(t, f, 2, 3)
	seedFollow(t, f, 3, 2)
	check(true)
	seedBlock(t, f, 3, 2)
	check(false)
	seedBlock(t, f, 1, 2)
	batch, err := port.Read(ctx, viewer, []uint64{1001}, []uint64{2001, 2002, 2003})
	point, _, pointErr := f.moments.GetMomentDetail(ctx, "1001", viewer)
	if err != nil || pointErr != nil || point != nil || len(batch.Posts)+len(batch.Comments) != 0 {
		t.Fatalf("blocked parent leaked: point=%+v batch=%+v errors=%v/%v", point, batch, err, pointErr)
	}
}

func TestPublicReadModerationChecksDomainAndPeerForCommenter(t *testing.T) {
	for _, key := range []string{"station_domain", "station_peer_id"} {
		t.Run(key, func(t *testing.T) {
			f := newFixture(t)
			seedPublicReadRows(t, f, 3)
			if err := f.gdb.Model(&db.Actor{}).Where("id = 3").
				Updates(map[string]any{"home_station_domain": "author.example", "home_station_peer_id": "original-peer"}).Error; err != nil {
				t.Fatal(err)
			}
			policy := db.SocialStationModerationPolicy{ID: 9001, Kind: "BLOCK"}
			if key == "station_domain" {
				policy.StationDomain = "author.example"
			} else {
				policy.StationPeerID = "original-peer"
			}
			// Use the original writer's enum spelling, rather than assuming it.
			if err := f.gdb.Create(&policy).Error; err != nil {
				t.Fatal(err)
			}
			batch, err := NewPublicReadPort(f.repos).Read(context.Background(), fixturePTID(1), nil, []uint64{2003})
			if err != nil || batch.Comments[2003] != nil {
				t.Fatalf("moderated commenter visible to post author: %+v/%v", batch, err)
			}
		})
	}
}

func TestPublicReadBatchHasBoundedPolicyQueries(t *testing.T) {
	f := newFixture(t)
	seedPublicReadRows(t, f, 100)
	seedFollow(t, f, 2, 3)
	seedFollow(t, f, 3, 2)
	queries := 0
	if err := f.gdb.Callback().Query().After("gorm:query").Register("public-read-query-count", func(*gorm.DB) {
		queries++
	}); err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 100)
	for i := range ids {
		ids[i] = uint64(2001 + i)
	}
	batch, err := NewPublicReadPort(f.repos).Read(context.Background(), fixturePTID(2), nil, ids)
	if err != nil || len(batch.Comments) != 100 || queries > 16 {
		t.Fatalf("unbounded public policy: comments=%d queries=%d err=%v", len(batch.Comments), queries, err)
	}
}

func TestPublicCommentsAnchorWindowAndFilteredContinuation(t *testing.T) {
	f := newFixture(t)
	seedPublicReadRows(t, f, 130)
	ctx := context.Background()
	// The target is older than the first 100 candidates, and the author can
	// see the entire discussion. The window starts at the original target.
	window, err := f.comments.ListByPost(ctx, 1001, fixturePTID(1), "", 3, 2001)
	if err != nil || len(window.Comments) != 1 || window.Comments[0].Id != "2001" {
		t.Fatalf("direct old anchor window: %+v/%v", window, err)
	}
	if _, err := f.comments.ListByPost(ctx, 1001, fixturePTID(1), "cursor", 3, 2001); err == nil {
		t.Fatal("cursor and anchor accepted together")
	}
	if _, err := f.comments.ListByPost(ctx, 1001, fixturePTID(2), "", 3, 2003); !errors.Is(err, ErrPublicCommentUnavailable) {
		t.Fatalf("hidden target window not rejected: %v", err)
	}
	if _, err := f.comments.ListByPost(ctx, 9999, fixturePTID(1), "", 3, 2001); !errors.Is(err, ErrPublicCommentUnavailable) {
		t.Fatalf("cross-parent anchor accepted: %v", err)
	}
	first, err := f.comments.ListByPost(ctx, 1001, fixturePTID(2), "", 20)
	if err != nil || len(first.Comments) != 0 || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("filtered page lost scan continuation: %+v/%v", first, err)
	}
	second, err := f.comments.ListByPost(ctx, 1001, fixturePTID(2), first.NextCursor, 100)
	if err != nil || len(second.Comments) != 2 || second.HasMore {
		t.Fatalf("filtered continuation did not reach own/author comments: %+v/%v", second, err)
	}
}
