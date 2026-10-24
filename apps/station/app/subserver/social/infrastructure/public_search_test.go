package infrastructure

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicSearchLiteralMatchingAndScanBound(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&db.SocialPublicPost{}, &db.SocialComment{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 105; i++ {
		post := db.SocialPublicPost{ID: uint64(i + 1), AuthorID: 1, Type: "TEXT", AudienceKind: "PUBLIC",
			TextBody: "ordinary", CreatedAt: now.Add(time.Duration(i) * time.Second)}
		if i == 104 {
			post.TextBody = "literal %_! ' OR 1=1 -- \u4e2d\u6587 mix"
		}
		if err := database.Create(&post).Error; err != nil {
			t.Fatal(err)
		}
	}
	private := db.SocialComment{ID: 999, PostID: 105, PostClass: "private", AuthorID: 1,
		TextBody: "literal %_! secret", CreatedAt: now.Add(time.Hour)}
	if err := database.Create(&private).Error; err != nil {
		t.Fatal(err)
	}
	repository := NewPublicSearchRepository(database)
	first, more, err := repository.Scan(ctx, true, true, PublicSearchPosition{})
	if err != nil || !more || len(first) != 100 || first[0].ID != 105 {
		t.Fatalf("scan bound/public-only: %+v/%v/%v", first, more, err)
	}
	for _, query := range []string{"%_!", "' OR 1=1 --", "\u4e2d\u6587", "mix"} {
		matches, err := repository.Match(ctx, first, query)
		if err != nil || len(matches) != 1 || !matches[first[0]] {
			t.Fatalf("literal query %q: %v/%v", query, matches, err)
		}
	}
	matches, err := repository.Match(ctx, first, "_")
	if err != nil || len(matches) != 1 {
		t.Fatalf("underscore treated as wildcard: %+v/%v", matches, err)
	}
	second, more, err := repository.Scan(ctx, true, true, first[len(first)-1])
	if err != nil || more || len(second) != 5 {
		t.Fatalf("scan continuation: %+v/%v/%v", second, more, err)
	}
	if err := repository.Snapshot(ctx, func(*gorm.DB, string) error { return nil }); err == nil {
		t.Fatal("SQLite must not pretend to provide a PostgreSQL read revision")
	}
}

func TestPublicSearchIndexesOnlyCoverOriginalPublicColumns(t *testing.T) {
	for _, index := range publicSearchIndexes {
		if strings.Contains(index, "private") || !strings.Contains(index, "deleted_at IS NULL") {
			t.Fatalf("unsafe public index: %s", index)
		}
		if strings.Contains(index, "social_public_posts") && !strings.Contains(index, "audience_kind = 'PUBLIC'") {
			t.Fatalf("post index lacks public predicate: %s", index)
		}
		if strings.Contains(index, "social_comments") && !strings.Contains(index, "post_class = 'public'") {
			t.Fatalf("comment index lacks public predicate: %s", index)
		}
	}
	if len(publicSearchIndexes) != 4 || strings.Count(strings.Join(publicSearchIndexes, "\n"), "gin_trgm_ops") != 2 {
		t.Fatal("missing original trgm or scan indexes")
	}
}
