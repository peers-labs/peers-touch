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

func privatePollVoteFixture(t *testing.T) (*privatecontentpb.VotePrivatePollRequest, *privatecontentpb.PrivatePollAuthority, time.Time) {
	t.Helper()
	at := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	id := ulid.Make().String()
	first, second := bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)
	hash := sha256.Sum256(appendBytesField(appendBytesField(nil, 1, first), 1, second))
	authority := &privatecontentpb.PrivatePollAuthority{
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   id, Generation: 1,
		},
		OpaqueOptionIds: [][]byte{first, second}, OptionSetSha256: hash[:],
		MinChoices: 1, MaxChoices: 1, ExpiresAt: timestamppb.New(at.Add(time.Minute)),
	}
	return &privatecontentpb.VotePrivatePollRequest{
		PostId: id, CommandId: "private-vote", OpaqueOptionIds: [][]byte{first},
		OptionSetSha256: hash[:], ActorSigningKeyId: "device-key",
		ActorDeviceSignature: bytes.Repeat([]byte{0x33}, 64),
	}, authority, at
}

func TestPrivatePollVoteCanonicalAuthorityAndSourceCutoff(t *testing.T) {
	request, authority, at := privatePollVoteFixture(t)
	if err := ValidatePrivatePollVote(request, authority, at, "test"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		change func(*privatecontentpb.VotePrivatePollRequest)
		code   PrivateContentErrorCode
	}{
		{"empty", func(r *privatecontentpb.VotePrivatePollRequest) { r.OpaqueOptionIds = nil }, PrivateContentPollInvalidSelection},
		{"duplicate", func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = [][]byte{r.OpaqueOptionIds[0], r.OpaqueOptionIds[0]}
		}, PrivateContentPollInvalidSelection},
		{"unordered", func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = [][]byte{authority.OpaqueOptionIds[1], authority.OpaqueOptionIds[0]}
		}, PrivateContentPollInvalidSelection},
		{"too-many", func(r *privatecontentpb.VotePrivatePollRequest) { r.OpaqueOptionIds = authority.OpaqueOptionIds }, PrivateContentPollInvalidSelection},
		{"foreign-option", func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = [][]byte{bytes.Repeat([]byte{0x44}, 32)}
		}, PrivateContentPollInvalidSelection},
		{"wrong-definition", func(r *privatecontentpb.VotePrivatePollRequest) { r.OptionSetSha256 = bytes.Repeat([]byte{0x55}, 32) }, PrivateContentPollDefinitionChanged},
		{"unsigned", func(r *privatecontentpb.VotePrivatePollRequest) { r.ActorDeviceSignature = nil }, PrivateContentInvalidArgument},
		{"unknown-field", func(r *privatecontentpb.VotePrivatePollRequest) { r.ProtoReflect().SetUnknown([]byte{0x78, 1}) }, PrivateContentInvalidArgument},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := proto.Clone(request).(*privatecontentpb.VotePrivatePollRequest)
			test.change(candidate)
			if err := ValidatePrivatePollVote(candidate, authority, at, "test"); !IsPrivateContentCode(err, test.code) {
				t.Fatalf("code = %s, want %s; error = %v", PrivateContentCodeOf(err), test.code, err)
			}
		})
	}
	for _, cutoff := range []time.Time{authority.ExpiresAt.AsTime(), authority.ExpiresAt.AsTime().Add(time.Hour)} {
		if err := ValidatePrivatePollVote(request, authority, cutoff, "test"); !IsPrivateContentCode(err, PrivateContentPollClosed) {
			t.Fatalf("source accepted a ballot at or after cutoff: %v", err)
		}
	}
	if err := ValidatePrivatePollVote(request, nil, at, "test"); !IsPrivateContentCode(err, PrivateContentPollNotPoll) {
		t.Fatalf("non-poll accepted: %v", err)
	}
}

func TestPrivatePollIntentHashBindsCommandKeyDefinitionAndFullChoiceSet(t *testing.T) {
	request, authority, _ := privatePollVoteFixture(t)
	hash, err := VotePrivatePollRequestHash(request, "test")
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*privatecontentpb.VotePrivatePollRequest){
		func(r *privatecontentpb.VotePrivatePollRequest) { r.CommandId = "another-command" },
		func(r *privatecontentpb.VotePrivatePollRequest) { r.ActorSigningKeyId = "another-device" },
		func(r *privatecontentpb.VotePrivatePollRequest) { r.OptionSetSha256 = bytes.Repeat([]byte{0x66}, 32) },
		func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = [][]byte{authority.OpaqueOptionIds[1]}
		},
	} {
		candidate := proto.Clone(request).(*privatecontentpb.VotePrivatePollRequest)
		change(candidate)
		changed, err := VotePrivatePollRequestHash(candidate, "test")
		if err != nil || bytes.Equal(hash, changed) {
			t.Fatalf("different intent reused its hash: %v", err)
		}
	}
}

func TestPrivatePollProjectionRejectsImpossibleAndForeignResults(t *testing.T) {
	request, authority, _ := privatePollVoteFixture(t)
	projection := &privatecontentpb.PrivatePollProjection{
		PostId: request.PostId, OptionSetSha256: request.OptionSetSha256, ProjectionRevision: 1,
		CommandId: request.CommandId, VoteActorPtid: "ptid:viewer", VoterCount: 1,
		Options: []*privatecontentpb.PrivatePollOptionResult{
			{OpaqueOptionId: authority.OpaqueOptionIds[0], VoteCount: 1, SelectedByViewer: true},
			{OpaqueOptionId: authority.OpaqueOptionIds[1]},
		},
	}
	if err := ValidatePrivatePollProjection(projection, authority, "test"); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*privatecontentpb.PrivatePollProjection){
		func(p *privatecontentpb.PrivatePollProjection) { p.Options[1].VoteCount = 1 },
		func(p *privatecontentpb.PrivatePollProjection) { p.Options[0].VoteCount = 2 },
		func(p *privatecontentpb.PrivatePollProjection) { p.Options[1].SelectedByViewer = true },
		func(p *privatecontentpb.PrivatePollProjection) {
			p.Options[0].OpaqueOptionId = bytes.Repeat([]byte{0x77}, 32)
		},
		func(p *privatecontentpb.PrivatePollProjection) { p.ProjectionRevision = 0 },
		func(p *privatecontentpb.PrivatePollProjection) { p.PostId = ulid.Make().String() },
	} {
		candidate := proto.Clone(projection).(*privatecontentpb.PrivatePollProjection)
		change(candidate)
		if err := ValidatePrivatePollProjection(candidate, authority, "test"); !IsPrivateContentCode(err, PrivateContentIntegrityFailed) {
			t.Fatalf("invalid projection accepted: %v", err)
		}
	}
}

func TestCanonicalRecipientLocalitiesRoundTrip(t *testing.T) {
	localities := []RecipientLocality{
		{
			ActorPTID:         "ptid:carol",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		},
		{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-local",
		},
	}
	encoded, err := CanonicalRecipientLocalitiesBytes(localities)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ParseCanonicalRecipientLocalities(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 2 ||
		decoded[0].ActorPTID != "ptid:bob" ||
		decoded[1].FederationID != "federation-one" {
		t.Fatalf("decoded recipient localities = %+v", decoded)
	}
	reencoded, err := CanonicalRecipientLocalitiesBytes(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encoded, reencoded) {
		t.Fatal("recipient localities did not round-trip canonically")
	}
	if _, err := ParseCanonicalRecipientLocalities(
		append([]byte(" "), encoded...),
	); !IsPrivateContentCode(err, PrivateContentIntegrityFailed) {
		t.Fatalf("non-canonical recipient localities error = %v", err)
	}
	if _, err := CanonicalRecipientLocalitiesBytes(
		append(localities, localities[0]),
	); !IsPrivateContentCode(err, PrivateContentConflict) {
		t.Fatalf("duplicate recipient locality error = %v", err)
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
