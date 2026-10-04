package application

import (
	"context"
	"crypto/ed25519"
	"sort"
	"testing"

	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestFederatedAudienceMatrixReceiverAcceptsSupportedKinds(t *testing.T) {
	kinds := []actormodel.Audience_Kind{
		actormodel.Audience_FRIENDS,
		actormodel.Audience_FOLLOWERS,
		actormodel.Audience_CIRCLE,
		actormodel.Audience_GROUP,
		actormodel.Audience_CUSTOM_ALLOW,
		actormodel.Audience_CUSTOM_DENY,
	}
	for _, kind := range kinds {
		t.Run(kind.String(), func(t *testing.T) {
			ctx := context.Background()
			source := newPrivateContentServiceFixture(t)
			frame := buildFederatedPrivateTextFrame(t, source)
			delivery := &privatecontentpb.FederatedPrivateResourceDelivery{}
			if err := proto.Unmarshal(
				frame.GetOpaquePayload(),
				delivery,
			); err != nil {
				t.Fatal(err)
			}
			delivery.GetPost().AudienceKind = kind
			delivery.GetAudienceExplanation().Kind = kind
			payload, err := socialdomain.CanonicalProtoBytes(delivery)
			if err != nil {
				t.Fatal(err)
			}
			frame.OpaquePayload = payload
			frame.PayloadSha256 = federationdelivery.PayloadSHA256(payload)
			frame.StationSignature = nil
			signingBytes, err := federationdelivery.SigningBytes(frame)
			if err != nil {
				t.Fatal(err)
			}
			frame.StationSignature, err = source.stationSigner.Sign(
				ctx,
				source.stationSigner.keyID,
				signingBytes,
			)
			if err != nil {
				t.Fatal(err)
			}

			receiver := newFederatedPrivateReceiver(
				t,
				source.clock.now,
				source.authorPrivateKey.Public().(ed25519.PublicKey),
				source.stationSigner.privateKey.Public().(ed25519.PublicKey),
				source.stationSigner.keyID,
			)
			result, err := receiver.receiver.Receive(ctx, frame)
			if err != nil {
				t.Fatal(err)
			}
			if result.Disposition != federationdelivery.DispositionAccepted {
				t.Fatalf("receiver disposition = %+v", result)
			}
			assertTableCount(
				t,
				receiver.database,
				"social_remote_private_resources",
				1,
			)
		})
	}
}

func TestFederatedAudienceMatrixPublishesExactMixedRecipients(t *testing.T) {
	tests := []struct {
		name     string
		audience *actormodel.Audience
	}{
		{
			name:     "FRIENDS",
			audience: &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		},
		{
			name:     "FOLLOWERS",
			audience: &actormodel.Audience{Kind: actormodel.Audience_FOLLOWERS},
		},
		{
			name: "CIRCLE",
			audience: &actormodel.Audience{
				Kind: actormodel.Audience_CIRCLE,
				Target: &actormodel.Audience_CircleId{
					CircleId: 42,
				},
			},
		},
		{
			name: "GROUP",
			audience: &actormodel.Audience{
				Kind: actormodel.Audience_GROUP,
				Target: &actormodel.Audience_GroupConversationId{
					GroupConversationId: "group-audience-matrix",
				},
			},
		},
		{
			name: "CUSTOM_ALLOW",
			audience: &actormodel.Audience{
				Kind:       actormodel.Audience_CUSTOM_ALLOW,
				ActorPtids: []string{"ptid:bob", "ptid:carol", "ptid:dana"},
			},
		},
		{
			name: "CUSTOM_DENY_FOLLOWERS",
			audience: &actormodel.Audience{
				Kind:       actormodel.Audience_CUSTOM_DENY,
				ActorPtids: []string{"ptid:eve"},
				BaseKind:   actormodel.Audience_FOLLOWERS,
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			localities := []socialdomain.RecipientLocality{
				{
					ActorPTID:         "ptid:bob",
					HomeStationPeerID: "station-remote-b",
					FederationID:      "federation-one",
				},
				{
					ActorPTID:         "ptid:carol",
					HomeStationPeerID: "station-local",
				},
				{
					ActorPTID:         "ptid:dana",
					HomeStationPeerID: "station-remote-b",
					FederationID:      "federation-one",
				},
			}
			fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
				Audience:         proto.Clone(testCase.audience).(*actormodel.Audience),
				SourceRevision:   9,
				SourceHeadSHA256: privateDigest("audience-matrix-" + testCase.name),
				RecipientPTIDs:   []string{"ptid:bob", "ptid:carol", "ptid:dana"},
				RecipientLocalities: append(
					[]socialdomain.RecipientLocality(nil),
					localities...,
				),
			}
			fixture.service.recipients = &privateContentRemoteRecipientDirectory{
				delegate: privateContentTestRecipients{
					author: fixture.author.Endpoint,
				},
				localities: localities,
			}
			membership := &federatedAudienceMembership{}
			if err := fixture.service.ConfigureFederatedPrivateDelivery(
				"station-local",
				membership,
				NewMomentEventPublisher(),
			); err != nil {
				t.Fatal(err)
			}
			var groups *privateContentFencedGroupReader
			if testCase.audience.GetKind() == actormodel.Audience_GROUP {
				group := socialdomain.GroupRecipientSnapshot{
					FederationID:        "federation-one",
					ConversationID:      testCase.audience.GetGroupConversationId(),
					AuthorPTID:          fixture.author.Endpoint.GetActor().GetPtid(),
					MembershipEpoch:     9,
					AuthorityHeadSHA256: privateDigest("group-audience-matrix"),
					Members: []socialdomain.RecipientLocality{
						{
							ActorPTID:         "ptid:alice",
							HomeStationPeerID: "station-local",
						},
						{
							ActorPTID:         "ptid:bob",
							HomeStationPeerID: "station-remote-b",
						},
						{
							ActorPTID:         "ptid:carol",
							HomeStationPeerID: "station-local",
						},
						{
							ActorPTID:         "ptid:dana",
							HomeStationPeerID: "station-remote-b",
						},
					},
				}
				groups = &privateContentFencedGroupReader{
					prepared: group,
					current:  group,
				}
				fixture.service.groups = groups
				authority, err := infrastructure.NewGORMPrivateAudienceAuthority(
					fixture.database,
				)
				if err != nil {
					t.Fatal(err)
				}
				fixture.service.audiences = authority
			}

			prepareRequest := privateMomentPrepareRequest(
				"prepare-audience-matrix-"+testCase.name,
				"content-audience-matrix-"+testCase.name,
			)
			prepareRequest.Audience = proto.Clone(
				testCase.audience,
			).(*actormodel.Audience)
			prepared, err := fixture.service.PreparePrivateMoment(
				context.Background(),
				fixture.author,
				prepareRequest,
			)
			if err != nil {
				t.Fatal(err)
			}
			submit := privateTextSubmitRequest(
				t,
				prepared.GetPlan(),
				fixture.author.Endpoint,
				fixture.authorPrivateKey,
				"submit-audience-matrix-"+testCase.name,
				"audience matrix ciphertext",
			)
			created, err := fixture.service.SubmitPrivateMoment(
				context.Background(),
				fixture.author.Endpoint,
				submit,
			)
			if err != nil {
				t.Fatal(err)
			}
			replayed, err := fixture.service.SubmitPrivateMoment(
				context.Background(),
				fixture.author.Endpoint,
				proto.Clone(submit).(*privatecontentpb.SubmitPrivateMomentRequest),
			)
			if err != nil {
				t.Fatal(err)
			}
			if !replayed.GetExactReplay() ||
				!proto.Equal(created.GetPost(), replayed.GetPost()) {
				t.Fatalf("audience submit replay = %+v", replayed)
			}

			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateContentPost{},
				1,
			)
			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateRecipientGrant{},
				3,
			)
			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateDeliveryIntent{},
				1,
			)
			var localDelivery dbmodel.SocialPrivateDeliveryIntent
			if err := fixture.database.First(&localDelivery).Error; err != nil {
				t.Fatal(err)
			}
			if localDelivery.RecipientPTID != "ptid:carol" {
				t.Fatalf(
					"local delivery recipient = %q, want ptid:carol",
					localDelivery.RecipientPTID,
				)
			}

			var outboxRows []federationdelivery.OutboxRecord
			if err := fixture.database.Find(&outboxRows).Error; err != nil {
				t.Fatal(err)
			}
			if len(outboxRows) != 2 {
				t.Fatalf("Federation outbox rows = %d, want 2", len(outboxRows))
			}
			targets := make([]string, 0, len(outboxRows))
			for _, row := range outboxRows {
				frame := &federationdelivery.Frame{}
				if err := proto.Unmarshal(row.FrameBytes, frame); err != nil {
					t.Fatal(err)
				}
				delivery := &privatecontentpb.FederatedPrivateResourceDelivery{}
				if err := proto.Unmarshal(
					frame.GetOpaquePayload(),
					delivery,
				); err != nil {
					t.Fatal(err)
				}
				targetPTID := delivery.GetTargetActor().GetPtid()
				targets = append(targets, targetPTID)
				if delivery.GetFederationId() != "federation-one" ||
					delivery.GetPost().GetAudienceKind() !=
						testCase.audience.GetKind() ||
					len(delivery.GetTargetActorEnvelopes()) != 2 {
					t.Fatalf("viewer-scoped delivery = %+v", delivery)
				}
				for _, envelope := range delivery.GetTargetActorEnvelopes() {
					recipientPTID := envelope.GetRecoveryActor().GetPtid()
					if envelope.GetEndpoint() != nil {
						recipientPTID = envelope.GetEndpoint().
							GetActor().
							GetPtid()
					}
					if recipientPTID != targetPTID {
						t.Fatalf(
							"delivery for %q contains envelope for %q",
							targetPTID,
							recipientPTID,
						)
					}
				}
			}
			sort.Strings(targets)
			if len(targets) != 2 ||
				targets[0] != "ptid:bob" ||
				targets[1] != "ptid:dana" {
				t.Fatalf("Federation frame targets = %v", targets)
			}
			if groups != nil &&
				(groups.fenceCalls != 1 || groups.commitCalls != 1) {
				t.Fatalf(
					"Group submit fence calls/commits = %d/%d",
					groups.fenceCalls,
					groups.commitCalls,
				)
			}
			if groups != nil && len(membership.calls) != 2 {
				t.Fatalf(
					"Group Federation membership checks = %d, want prepare and submit",
					len(membership.calls),
				)
			}
		})
	}
}

type federatedAudienceMembership struct {
	err   error
	calls []string
}

func (m *federatedAudienceMembership) ValidateActiveStationPair(
	_ context.Context,
	federationID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) error {
	m.calls = append(
		m.calls,
		federationID+"\x00"+sourceStationPeerID+"\x00"+targetStationPeerID,
	)
	return m.err
}

var _ PrivateContentFederationMembership = (*federatedAudienceMembership)(nil)

func TestFederatedAudienceMatrixRejectsCrossFederationBeforePreKeyClaim(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FOLLOWERS},
		SourceRevision:   2,
		SourceHeadSHA256: privateDigest("cross-federation-audience"),
		RecipientPTIDs:   []string{"ptid:bob", "ptid:carol"},
	}
	fixture.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: fixture.author.Endpoint},
		localities: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote-b",
				FederationID:      "federation-one",
			},
			{
				ActorPTID:         "ptid:carol",
				HomeStationPeerID: "station-remote-c",
				FederationID:      "federation-two",
			},
		},
	}
	request := privateMomentPrepareRequest(
		"prepare-cross-federation-audience",
		"content-cross-federation-audience",
	)
	request.Audience = proto.Clone(
		fixture.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	_, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnsupported,
	) {
		t.Fatalf("cross-Federation audience error = %v", err)
	}
	if fixture.keyExchange.claimCalls != 0 {
		t.Fatalf(
			"cross-Federation audience claimed %d PreKey batches",
			fixture.keyExchange.claimCalls,
		)
	}
	assertPrivateContentRemotePrepareLeftNoRows(t, fixture)
}

func TestFederatedAudienceMatrixRollsBackEveryRowWhenSecondFrameFails(
	t *testing.T,
) {
	outboxWrites := 0
	fixture := newPrivateContentServiceFixtureWithStoreOptions(
		t,
		infrastructure.WithPrivateContentFailpoint(
			infrastructure.PrivateContentFailpointFunc(func(
				_ context.Context,
				boundary infrastructure.PrivateContentWriteBoundary,
			) error {
				if boundary ==
					infrastructure.PrivateContentBoundaryFederationOutbox {
					outboxWrites++
					if outboxWrites == 2 {
						return errFederatedPrivateFailpoint
					}
				}
				return nil
			}),
		),
	)
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FOLLOWERS},
		SourceRevision:   2,
		SourceHeadSHA256: privateDigest("audience-matrix-rollback"),
		RecipientPTIDs:   []string{"ptid:bob", "ptid:dana"},
	}
	fixture.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: fixture.author.Endpoint},
		localities: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote",
				FederationID:      "federation-one",
			},
			{
				ActorPTID:         "ptid:dana",
				HomeStationPeerID: "station-remote",
				FederationID:      "federation-one",
			},
		},
	}
	if err := fixture.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		&federatedAudienceMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	request := privateMomentPrepareRequest(
		"prepare-audience-matrix-rollback",
		"content-audience-matrix-rollback",
	)
	request.Audience = proto.Clone(
		fixture.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		privateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			"submit-audience-matrix-rollback",
			"audience matrix rollback",
		),
	)
	if err == nil {
		t.Fatal("second Federation frame failure returned no error")
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateAudienceSnapshot{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateRecipientGrant{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentEnvelope{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateDeliveryIntent{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommitProof{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		0,
	)
	assertTableCount(t, fixture.database, "federation_delivery_outbox", 0)
}

func TestFederatedAudienceGroupRevalidatesMembershipBeforePrepareAndSubmit(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	group := socialdomain.GroupRecipientSnapshot{
		FederationID:        "federation-one",
		ConversationID:      "group-federation-membership",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     3,
		AuthorityHeadSHA256: privateDigest("group-federation-membership"),
		Members: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-local",
			},
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote",
			},
		},
	}
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind: actormodel.Audience_GROUP,
			Target: &actormodel.Audience_GroupConversationId{
				GroupConversationId: group.ConversationID,
			},
		},
		SourceRevision:   group.MembershipEpoch,
		SourceHeadSHA256: privateDigest("group-federation-audience"),
		RecipientPTIDs:   []string{"ptid:bob"},
		RecipientLocalities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      group.FederationID,
		}},
	}
	groups := &privateContentFencedGroupReader{
		prepared: group,
		current:  group,
	}
	membership := &federatedAudienceMembership{}
	fixture.service.groups = groups
	if err := fixture.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		membership,
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	request := privateMomentPrepareRequest(
		"prepare-group-federation-membership",
		"content-group-federation-membership",
	)
	request.Audience = proto.Clone(
		fixture.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(membership.calls) != 1 {
		t.Fatalf("prepare membership checks = %d, want 1", len(membership.calls))
	}

	membership.err = errFederatedPrivateFailpoint
	_, err = fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		privateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			fixture.author.Endpoint,
			fixture.authorPrivateKey,
			"submit-group-federation-membership",
			"group federation ciphertext",
		),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentDependency,
	) {
		t.Fatalf("submit membership dependency error = %v", err)
	}
	if groups.commitCalls != 1 {
		t.Fatalf("Conversation fence commit calls = %d, want 1", groups.commitCalls)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		0,
	)
}

func TestFederatedAudienceGroupPrepareReplayRevalidatesMembershipWithoutReclaim(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	group := socialdomain.GroupRecipientSnapshot{
		FederationID:        "federation-one",
		ConversationID:      "group-federation-replay",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     3,
		AuthorityHeadSHA256: privateDigest("group-federation-replay"),
		Members: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-local",
			},
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote",
			},
		},
	}
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind: actormodel.Audience_GROUP,
			Target: &actormodel.Audience_GroupConversationId{
				GroupConversationId: group.ConversationID,
			},
		},
		SourceRevision:   group.MembershipEpoch,
		SourceHeadSHA256: privateDigest("group-federation-replay-audience"),
		RecipientPTIDs:   []string{"ptid:bob"},
		RecipientLocalities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      group.FederationID,
		}},
	}
	groups := &privateContentFencedGroupReader{
		prepared: group,
		current:  group,
	}
	membership := &federatedAudienceMembership{}
	fixture.service.groups = groups
	if err := fixture.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		membership,
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	request := privateMomentPrepareRequest(
		"prepare-group-federation-replay",
		"content-group-federation-replay",
	)
	request.Audience = proto.Clone(
		fixture.audiences.snapshot.Audience,
	).(*actormodel.Audience)

	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		proto.Clone(request).(*privatecontentpb.PreparePrivateMomentRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(prepared.GetPlan(), replayed.GetPlan()) {
		t.Fatal("Group prepare replay changed the durable signed plan")
	}
	if groups.prepareCalls != 1 {
		t.Fatalf(
			"Group prepare replay resolved Conversation snapshot %d times",
			groups.prepareCalls,
		)
	}
	if fixture.keyExchange.claimCalls != 1 {
		t.Fatalf(
			"Group prepare replay claimed %d PreKey batches, want 1",
			fixture.keyExchange.claimCalls,
		)
	}
	if len(membership.calls) != 2 {
		t.Fatalf(
			"Group prepare replay membership checks = %d, want 2",
			len(membership.calls),
		)
	}

	membership.err = federationdomain.ErrInactiveStationPair
	_, err = fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		proto.Clone(request).(*privatecontentpb.PreparePrivateMomentRequest),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnsupported,
	) {
		t.Fatalf("inactive Group prepare replay error = %v", err)
	}
	if fixture.keyExchange.claimCalls != 1 {
		t.Fatalf(
			"inactive Group replay claimed %d PreKey batches, want 1",
			fixture.keyExchange.claimCalls,
		)
	}
}

func TestFederatedAudienceGroupRejectsInactiveMembershipBeforePreKeyClaim(
	t *testing.T,
) {
	fixture := newPrivateContentServiceFixture(t)
	group := socialdomain.GroupRecipientSnapshot{
		FederationID:        "federation-one",
		ConversationID:      "group-inactive-federation",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     3,
		AuthorityHeadSHA256: privateDigest("group-inactive-federation"),
		Members: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-local",
			},
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote",
			},
		},
	}
	fixture.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind: actormodel.Audience_GROUP,
			Target: &actormodel.Audience_GroupConversationId{
				GroupConversationId: group.ConversationID,
			},
		},
		SourceRevision:   group.MembershipEpoch,
		SourceHeadSHA256: privateDigest("group-inactive-audience"),
		RecipientPTIDs:   []string{"ptid:bob"},
	}
	fixture.service.groups = &privateContentRemoteGroupReader{snapshot: group}
	if err := fixture.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		&federatedAudienceMembership{
			err: federationdomain.ErrInactiveStationPair,
		},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	request := privateMomentPrepareRequest(
		"prepare-group-inactive-federation",
		"content-group-inactive-federation",
	)
	request.Audience = proto.Clone(
		fixture.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	_, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnsupported,
	) {
		t.Fatalf("inactive Group Federation error = %v", err)
	}
	if fixture.keyExchange.claimCalls != 0 {
		t.Fatalf(
			"inactive Group Federation claimed %d PreKey batches",
			fixture.keyExchange.claimCalls,
		)
	}
	assertPrivateContentRemotePrepareLeftNoRows(t, fixture)
}
