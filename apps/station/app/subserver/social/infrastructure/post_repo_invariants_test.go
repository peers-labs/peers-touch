package infrastructure

import (
	"context"
	"strings"
	"testing"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestCommentsCountDeltaExpressionIsPostgresPortable(t *testing.T) {
	if strings.Contains(strings.ToUpper(nonNegativeCommentsCountDeltaSQL), "MAX(") {
		t.Fatal("comments_count delta must not use SQLite scalar MAX in PostgreSQL")
	}
	for _, token := range []string{"CASE WHEN", "COALESCE", "THEN 0", "ELSE"} {
		if !strings.Contains(nonNegativeCommentsCountDeltaSQL, token) {
			t.Fatalf("comments_count delta expression missing %q", token)
		}
	}
	if strings.Count(nonNegativeCommentsCountDeltaSQL, "?") != 2 {
		t.Fatal("comments_count delta expression must bind the same delta twice")
	}
}

// These tests lock in the "Create panics on wrong audience class"
// invariant at the storage-separation boundary. The panic happens
// BEFORE any DB access, so the *gorm.DB handle can be nil — we only
// care that the storage-separation invariant is enforced loudly
// rather than silently allowing a non-PUBLIC post into the public
// table. See `docs/architecture/domains/social/core/moments.md §8`.

func TestPublicPostRepo_Create_PanicsOnNonPublic(t *testing.T) {
	repo := NewPublicPostRepository(nil)

	cases := []struct {
		name string
		a    *model.Audience
	}{
		{"FOLLOWERS", &model.Audience{Kind: model.Audience_FOLLOWERS}},
		{"SELF", &model.Audience{Kind: model.Audience_SELF}},
		{"CIRCLE", &model.Audience{
			Kind:   model.Audience_CIRCLE,
			Target: &model.Audience_CircleId{CircleId: 1},
		}},
		{"GROUP", &model.Audience{
			Kind: model.Audience_GROUP,
			Target: &model.Audience_GroupConversationId{
				GroupConversationId: "group-1",
			},
		}},
		{"CUSTOM_ALLOW", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{"x"}}},
		{
			"CUSTOM_DENY base PUBLIC NOT public",
			&model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"x"},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("publicPostRepo.Create with audience=%s must panic", tc.a.Kind)
				}
			}()
			_ = repo.Create(context.Background(), &domain.Post{
				AuthorPTID: "ptid:test:author",
				Audience:   tc.a,
			})
		})
	}
}
