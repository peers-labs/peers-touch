package domain

import (
	"bytes"
	"crypto/sha256"
	"testing"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func TestPrivateContentRequiresCanonicalULID(t *testing.T) {
	request := &privatecontentpb.PreparePrivateMomentRequest{
		ContentId: "123",
		Audience:  &model.Audience{Kind: model.Audience_FRIENDS},
		CommandId: "prepare-command",
		Kind: privatecontentpb.
			PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
	}
	if _, err := CanonicalizePrivateMomentPrepare(request); !IsPrivateContentCode(
		err,
		PrivateContentInvalidArgument,
	) {
		t.Fatalf("numeric private content ID error = %v", err)
	}

	request.ContentId = ulid.Make().String()
	if _, err := CanonicalizePrivateMomentPrepare(request); err != nil {
		t.Fatalf("canonical ULID rejected: %v", err)
	}
}

func TestNormalizePrivateAudienceSnapshotBindsExactAudience(t *testing.T) {
	head := sha256.Sum256([]byte("same-source"))
	base := FriendsSnapshot{
		Audience:         &model.Audience{Kind: model.Audience_FRIENDS},
		SourceRevision:   1,
		SourceHeadSHA256: head[:],
		RecipientPTIDs:   []string{"ptid:bob"},
	}
	_, friendsHash, err := NormalizeFriendsSnapshot(
		"test.normalize_private_audience",
		"ptid:alice",
		base,
	)
	if err != nil {
		t.Fatal(err)
	}
	base.Audience = &model.Audience{Kind: model.Audience_FOLLOWERS}
	_, followersHash, err := NormalizeFriendsSnapshot(
		"test.normalize_private_audience",
		"ptid:alice",
		base,
	)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(friendsHash[:], followersHash[:]) {
		t.Fatal("audience kind did not affect the authorization snapshot")
	}
}

func TestNormalizePrivateAudienceSnapshotAllowsSelfWithoutRecipients(t *testing.T) {
	head := sha256.Sum256([]byte("self-source"))
	normalized, _, err := NormalizeFriendsSnapshot(
		"test.normalize_private_self",
		"ptid:alice",
		FriendsSnapshot{
			Audience:         &model.Audience{Kind: model.Audience_SELF},
			SourceRevision:   1,
			SourceHeadSHA256: head[:],
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(normalized.RecipientPTIDs) != 0 {
		t.Fatalf("SELF recipients = %v, want none", normalized.RecipientPTIDs)
	}
}
