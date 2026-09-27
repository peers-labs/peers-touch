package domain

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestPost_IsPublic(t *testing.T) {
	cases := []struct {
		name string
		p    *Post
		want bool
	}{
		{"nil audience treated as public", &Post{}, true},
		{"explicit PUBLIC", &Post{Audience: &model.Audience{Kind: model.Audience_PUBLIC}}, true},
		{"FOLLOWERS not public", &Post{Audience: &model.Audience{Kind: model.Audience_FOLLOWERS}}, false},
		{"SELF not public", &Post{Audience: &model.Audience{Kind: model.Audience_SELF}}, false},
		{"CUSTOM_DENY base PUBLIC NOT public", &Post{
			Audience: &model.Audience{
				Kind:       model.Audience_CUSTOM_DENY,
				BaseKind:   model.Audience_PUBLIC,
				ActorPtids: []string{"x"},
			},
		}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.p.IsPublic(); got != tc.want {
				t.Fatalf("IsPublic() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestPost_IsDeleted(t *testing.T) {
	now := time.Now()
	if (&Post{}).IsDeleted() {
		t.Fatal("zero post must not be considered deleted")
	}
	if !(&Post{DeletedAt: &now}).IsDeleted() {
		t.Fatal("post with DeletedAt set must be considered deleted")
	}
}

func TestComment_IsTopLevel(t *testing.T) {
	if !(&Comment{}).IsTopLevel() {
		t.Fatal("ParentCommentID==0 means top-level")
	}
	if (&Comment{ParentCommentID: 42}).IsTopLevel() {
		t.Fatal("non-zero ParentCommentID means a reply")
	}
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

func TestCursor_RoundTrip(t *testing.T) {
	original := Cursor{LastID: 12345, CreatedAt: time.Date(2026, 4, 27, 19, 30, 38, 0, time.UTC)}
	encoded := original.Encode()
	if encoded == "" {
		t.Fatal("non-zero cursor must encode to a non-empty string")
	}
	decoded, err := DecodeCursor(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.LastID != original.LastID {
		t.Fatalf("LastID = %d, want %d", decoded.LastID, original.LastID)
	}
	if !decoded.CreatedAt.Equal(original.CreatedAt) {
		t.Fatalf("CreatedAt = %v, want %v", decoded.CreatedAt, original.CreatedAt)
	}
}

func TestCursor_ZeroEncodesEmpty(t *testing.T) {
	zero := Cursor{}
	if zero.Encode() != "" {
		t.Fatal("zero cursor must encode to empty string for clean omit-empty")
	}
	if !zero.IsZero() {
		t.Fatal("zero cursor must be IsZero")
	}
}

func TestDecodeCursor_EmptyOK(t *testing.T) {
	c, err := DecodeCursor("")
	if err != nil {
		t.Fatalf("empty string must decode without error, got %v", err)
	}
	if !c.IsZero() {
		t.Fatal("empty string must decode to zero cursor")
	}
}

func TestDecodeCursor_GarbageRejected(t *testing.T) {
	if _, err := DecodeCursor("not-a-valid-base64!@#$"); err == nil {
		t.Fatal("garbage cursor must error so callers don't silently dup pages")
	}
}

func TestMultiSourceCursor_RoundTrip(t *testing.T) {
	original := MultiSourceCursor{}
	original.SetSource("home_public", &Cursor{LastID: 1, CreatedAt: time.Now().UTC()})
	original.SetSource("home_circles", &Cursor{LastID: 2, CreatedAt: time.Now().UTC()})
	original.SetSource("home_groups", nil) // exhausted

	encoded := original.Encode()
	if encoded == "" {
		t.Fatal("non-empty multi-source cursor must encode")
	}
	decoded, err := DecodeMultiSourceCursor(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.Source("home_public").LastID != 1 {
		t.Fatalf("home_public LastID = %d, want 1", decoded.Source("home_public").LastID)
	}
	if !decoded.Source("home_unknown").IsZero() {
		t.Fatal("unknown source must yield zero cursor")
	}
	// "home_groups" was set to nil — should also yield zero cursor.
	if !decoded.Source("home_groups").IsZero() {
		t.Fatal("nil-marked exhausted source must yield zero cursor")
	}
}

// ---------------------------------------------------------------------------
// PostClass / GrantRole
// ---------------------------------------------------------------------------

func TestPostClass_Constants(t *testing.T) {
	// Lock in the on-the-wire string values; changing these breaks
	// existing rows in the social_comments / social_reactions tables.
	if PostClassPublic != "public" {
		t.Fatalf("PostClassPublic = %q, want public", PostClassPublic)
	}
	if PostClassPrivate != "private" {
		t.Fatalf("PostClassPrivate = %q, want private", PostClassPrivate)
	}
}
