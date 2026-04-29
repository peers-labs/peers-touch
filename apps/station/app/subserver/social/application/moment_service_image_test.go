package application

import (
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// imageFixture wraps newFixture with the production OssMediaResolver so
// we can exercise the real CID-validation path. The OSS file table is
// created alongside the social tables and seeded per-test via
// `seedOssKey`. We don't reuse `newFixture` directly because that one
// wires the no-op resolver to keep the existing P1 fixtures green.
//
// The OSS subserver's `FileMeta` model carries a Postgres-flavoured
// `default:now()` clause that sqlite rejects, so we hand-roll a
// portable CREATE TABLE here mirroring the column set GORM uses on
// the production path. The OSS model still owns the canonical schema;
// this function only tracks it for tests.
func newImageFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	const ddl = `CREATE TABLE oss_files (
		id          TEXT PRIMARY KEY,
		key         TEXT UNIQUE,
		name        TEXT,
		size        INTEGER,
		mime        TEXT,
		backend     TEXT,
		path        TEXT,
		sha256      TEXT,
		created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`
	if err := f.gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create oss_files (sqlite): %v", err)
	}
	resolver := NewNoopActorResolver()
	groups := NewNoopGroupMembershipChecker()
	mediaResolver := infrastructure.NewOssMediaResolver(f.gdb)
	f.moments = NewMomentService(f.gdb, f.repos, resolver, groups, mediaResolver, f.reactions)
	return f
}

// seedOssKey inserts a minimal FileMeta row so the resolver's
// `key IN (...)` lookup succeeds. The non-key fields are set to
// realistic-but-arbitrary values; nothing else exercises them.
func seedOssKey(t *testing.T, f *fixture, key string) {
	t.Helper()
	row := &ossmodel.FileMeta{
		ID:      "test-" + key,
		Key:     key,
		Name:    "img.png",
		Size:    1024,
		Mime:    "image/png",
		Backend: "local",
		Path:    "/tmp/" + key,
	}
	if err := f.gdb.Create(row).Error; err != nil {
		t.Fatalf("seed oss_files key=%q: %v", key, err)
	}
}

// ---------------------------------------------------------------------------
// IMAGE — happy path: every CID resolves to a locally-stored object.
// ---------------------------------------------------------------------------

func TestImagePost_AcceptsLocalCIDs(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	const author = uint64(101)
	keys := []string{
		"2026/04/29/aaa.png",
		"2026/04/29/bbb.jpg",
	}
	for _, k := range keys {
		seedOssKey(t, f, k)
	}

	cids := []string{
		"oss://station.local/" + keys[0],
		// Bare key form (legacy chat upload responses) — should also
		// resolve via the same lookup.
		keys[1],
	}

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "two photos",
				ImageIds: cids,
			},
		},
	}, author)
	if err != nil {
		t.Fatalf("create IMAGE: %v", err)
	}
	if got := post.GetImagePost(); got == nil || len(got.Images) != 2 {
		t.Fatalf("expected 2 images on returned post, got %+v", post.GetImagePost())
	}
}

// ---------------------------------------------------------------------------
// IMAGE — foreign-origin CID rejection.
// ---------------------------------------------------------------------------

func TestImagePost_RejectsForeignOriginCID(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	// We deliberately do NOT seed `attacker.example/leak.png` — the
	// gate must reject it because the key is unknown locally,
	// regardless of the cosmetic origin segment.
	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "hot-link attempt",
				ImageIds: []string{"oss://attacker.example/leak.png"},
			},
		},
	}, 200)
	if err == nil {
		t.Fatal("expected error for foreign-origin cid, got nil")
	}
	if !strings.Contains(err.Error(), "unknown object key") {
		t.Fatalf("expected 'unknown object key' rejection, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// IMAGE — empty image list rejection (proto says repeated, but the
// service requires at least one CID for IMAGE posts).
// ---------------------------------------------------------------------------

func TestImagePost_RejectsEmptyImageList(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "no images attached",
				ImageIds: nil,
			},
		},
	}, 300)
	if err == nil {
		t.Fatal("expected error for empty image_ids, got nil")
	}
	if !strings.Contains(err.Error(), "at least one image_id") {
		t.Fatalf("expected 'at least one image_id' rejection, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// IMAGE — over-cap rejection (10 > maxImagesPerPost).
// ---------------------------------------------------------------------------

func TestImagePost_RejectsOverCap(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	// Seed 10 keys so the failure CANNOT be due to "key not found";
	// it must be the cap that trips.
	cids := make([]string, 10)
	for i := range cids {
		key := "cap/" + string(rune('a'+i)) + ".png"
		seedOssKey(t, f, key)
		cids[i] = "oss://station.local/" + key
	}

	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "ten images",
				ImageIds: cids,
			},
		},
	}, 400)
	if err == nil {
		t.Fatal("expected error for >9 images, got nil")
	}
	if !strings.Contains(err.Error(), "at most 9 images") {
		t.Fatalf("expected 'at most 9 images' rejection, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// IMAGE — malformed CID envelope rejection.
// ---------------------------------------------------------------------------

func TestImagePost_RejectsMalformedCID(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	cases := []struct {
		name string
		cid  string
		want string
	}{
		{"missing-key-segment", "oss://station.local/", "missing key"},
		{"only-scheme", "oss://", "missing key"},
		{"empty", "", "empty"},
		{"http-scheme", "http://example.com/leak.png", "non-oss scheme"},
		{"whitespace", "key with space.png", "whitespace in key"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
				Type:     model.PostType_IMAGE,
				Audience: &model.Audience{Kind: model.Audience_PUBLIC},
				Content: &model.CreatePostRequest_Image{
					Image: &model.CreateImagePostRequest{
						Text:     "malformed",
						ImageIds: []string{tc.cid},
					},
				},
			}, 500)
			if err == nil {
				t.Fatalf("cid %q: expected error, got nil", tc.cid)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("cid %q: expected error containing %q, got %v",
					tc.cid, tc.want, err)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// IMAGE — partial-known set rejection: 2 valid + 1 unknown still fails
// (proves we don't accept just because the majority is good).
// ---------------------------------------------------------------------------

func TestImagePost_RejectsPartialUnknownSet(t *testing.T) {
	f := newImageFixture(t)
	ctx := context.Background()

	good1 := "partial/aaa.png"
	good2 := "partial/bbb.png"
	seedOssKey(t, f, good1)
	seedOssKey(t, f, good2)

	cids := []string{
		"oss://station.local/" + good1,
		"oss://station.local/" + good2,
		"oss://station.local/partial/missing.png",
	}

	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "two known, one missing",
				ImageIds: cids,
			},
		},
	}, 600)
	if err == nil {
		t.Fatal("expected error when one of the cids is unknown, got nil")
	}
	if !strings.Contains(err.Error(), "missing.png") {
		t.Fatalf("expected error to name 'missing.png', got %v", err)
	}
}
