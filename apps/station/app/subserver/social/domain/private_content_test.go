package domain

import (
	"bytes"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func TestCanonicalGroupRecipientSnapshotRoundTrip(t *testing.T) {
	snapshot := GroupRecipientSnapshot{
		FederationID:        "federation-canonical-snapshot",
		ConversationID:      "group-canonical-snapshot",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     7,
		AuthorityHeadSHA256: bytes.Repeat([]byte{0x31}, sha256.Size),
		Members: []RecipientLocality{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-local",
			},
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-local",
			},
		},
	}
	encoded, err := CanonicalGroupRecipientSnapshotBytes(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(
		encoded,
		[]byte(`"federation_id":"federation-canonical-snapshot"`),
	) {
		t.Fatalf("canonical Group snapshot omits Federation ID: %s", encoded)
	}
	decoded, err := ParseCanonicalGroupRecipientSnapshot(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.FederationID != snapshot.FederationID {
		t.Fatalf(
			"decoded Federation ID = %q, want %q",
			decoded.FederationID,
			snapshot.FederationID,
		)
	}
	reencoded, err := CanonicalGroupRecipientSnapshotBytes(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encoded, reencoded) {
		t.Fatal("Group recipient snapshot did not round-trip canonically")
	}
	otherFederation := snapshot
	otherFederation.FederationID = "federation-other"
	otherEncoded, err := CanonicalGroupRecipientSnapshotBytes(otherFederation)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(encoded, otherEncoded) {
		t.Fatal("Federation ID did not change canonical Group snapshot bytes")
	}

	nonCanonical := append([]byte(" "), encoded...)
	if _, err := ParseCanonicalGroupRecipientSnapshot(nonCanonical); !IsPrivateContentCode(
		err,
		PrivateContentIntegrityFailed,
	) {
		t.Fatalf("non-canonical Group snapshot error = %v", err)
	}

	withoutFederation := snapshot
	withoutFederation.FederationID = ""
	if _, err := CanonicalGroupRecipientSnapshotBytes(
		withoutFederation,
	); !IsPrivateContentCode(err, PrivateContentInvalidArgument) {
		t.Fatalf("missing Group Federation ID error = %v", err)
	}
}

func TestCanonicalizePrivateMomentPrepareRejectsCustomDenyPublicAsUnsupported(
	t *testing.T,
) {
	request := &privatecontentpb.PreparePrivateMomentRequest{
		ContentId: ulid.Make().String(),
		Audience: &model.Audience{
			Kind:       model.Audience_CUSTOM_DENY,
			BaseKind:   model.Audience_PUBLIC,
			ActorPtids: []string{"ptid:bob"},
		},
		CommandId: "prepare-custom-deny-public",
		Kind: privatecontentpb.
			PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
	}
	if _, err := CanonicalizePrivateMomentPrepare(request); !IsPrivateContentCode(
		err,
		PrivateContentUnsupported,
	) {
		t.Fatalf("CUSTOM_DENY(PUBLIC) prepare error = %v", err)
	}
}

func TestCanonicalizePrivateMomentPrepareBindsPollAuthority(t *testing.T) {
	contentID := ulid.Make().String()
	first := bytes.Repeat([]byte{0x11}, sha256.Size)
	second := bytes.Repeat([]byte{0x22}, sha256.Size)
	optionSetBytes := appendBytesField(nil, 1, first)
	optionSetBytes = appendBytesField(optionSetBytes, 1, second)
	optionSetHash := sha256.Sum256(optionSetBytes)
	authority := &privatecontentpb.PrivatePollAuthority{
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.
				SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:  contentID,
			Generation: 1,
		},
		OpaqueOptionIds: [][]byte{first, second},
		OptionSetSha256: optionSetHash[:],
		MinChoices:      1,
		MaxChoices:      1,
		ExpiresAt: timestamppb.New(
			time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC),
		),
	}
	material, err := CanonicalizePrivateMomentPrepare(
		&privatecontentpb.PreparePrivateMomentRequest{
			ContentId: contentID,
			Audience: &model.Audience{
				Kind: model.Audience_FRIENDS,
			},
			CommandId: "prepare-poll",
			Kind: privatecontentpb.
				PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL,
			PollAuthority: authority,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(material.SubtypePrepareAuthorityBytes) == 0 ||
		!bytes.Equal(
			material.SubtypePrepareAuthoritySHA256[:],
			privateSHA256ForTest(material.SubtypePrepareAuthorityBytes),
		) {
		t.Fatal("poll authority was not bound into the prepare material")
	}
	domainBinding := &privatecontentpb.PrivateMomentDomainBinding{}
	if err := proto.Unmarshal(material.DomainBinding, domainBinding); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(
		domainBinding.GetSubtypePrepareAuthoritySha256(),
		material.SubtypePrepareAuthoritySHA256[:],
	) {
		t.Fatal("poll authority was not bound into the domain binding")
	}
}

func TestCanonicalizePrivateMomentPrepareBindsRepostAuthority(t *testing.T) {
	contentID := ulid.Make().String()
	authority := &privatecontentpb.PrivateRepostAuthority{
		Source: &privatecontentpb.SocialPostSourceRef{
			PostId: "public-source",
		},
		SourceAuthor: &model.ActorRef{
			Ptid: "ptid:alice",
		},
		RenderedSourceCommitment: bytes.Repeat(
			[]byte{0x33},
			sha256.Size,
		),
		SourceProof: &privatecontentpb.
			PrivateRepostAuthority_PublicSource{
			PublicSource: &privatecontentpb.PublicRepostSourceProof{
				CanonicalPublicPostSha256: bytes.Repeat(
					[]byte{0x44},
					sha256.Size,
				),
			},
		},
	}
	material, err := CanonicalizePrivateMomentPrepare(
		&privatecontentpb.PreparePrivateMomentRequest{
			ContentId: contentID,
			Audience: &model.Audience{
				Kind: model.Audience_FRIENDS,
			},
			CommandId: "prepare-repost",
			Kind: privatecontentpb.
				PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST,
			RepostAuthority: authority,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(material.SubtypePrepareAuthorityBytes) == 0 ||
		!bytes.Equal(
			material.SubtypePrepareAuthoritySHA256[:],
			privateSHA256ForTest(material.SubtypePrepareAuthorityBytes),
		) {
		t.Fatal("repost authority was not bound into the prepare material")
	}
}

func TestCanonicalizePrivateMomentPrepareSubtypeObjectBounds(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		kind        privatecontentpb.PrivateMomentKind
		objectCount uint32
	}{
		{"text", privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT, 0},
		{"image", privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE, 1},
		{"video", privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_VIDEO, 1},
		{"link", privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LINK, 0},
		{"location", privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LOCATION, 0},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := CanonicalizePrivateMomentPrepare(
				&privatecontentpb.PreparePrivateMomentRequest{
					ContentId: ulid.Make().String(),
					Audience: &model.Audience{
						Kind: model.Audience_FRIENDS,
					},
					CommandId:   "prepare-" + testCase.name,
					Kind:        testCase.kind,
					ObjectCount: testCase.objectCount,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func privateSHA256ForTest(value []byte) []byte {
	digest := sha256.Sum256(value)
	return digest[:]
}

func TestNormalizePrivateAudienceSnapshotBindsExactAudience(t *testing.T) {
	head := sha256.Sum256([]byte("same-source"))
	base := FriendsSnapshot{
		Audience:         &model.Audience{Kind: model.Audience_FRIENDS},
		SourceRevision:   1,
		SourceHeadSHA256: head[:],
		RecipientPTIDs:   []string{"ptid:bob"},
		RecipientLocalities: []RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-local",
		}},
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
