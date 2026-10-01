package application

import (
	"context"
	"reflect"
	"testing"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
)

func TestPrivateContentServiceRejectsRemoteRecipientsBeforePrepareSideEffects(
	t *testing.T,
) {
	tests := []struct {
		name              string
		audience          *actormodel.Audience
		group             socialdomain.GroupRecipientSnapshot
		resolvedLocality  []socialdomain.RecipientLocality
		blockRemote       bool
		wantGroupCalls    int
		wantLocalityCalls int
	}{
		{
			name: "GROUP uses Conversation locality projection",
			audience: &actormodel.Audience{
				Kind: actormodel.Audience_GROUP,
				Target: &actormodel.Audience_GroupConversationId{
					GroupConversationId: "group-remote-recipient",
				},
			},
			group: socialdomain.GroupRecipientSnapshot{
				ConversationID:      "group-remote-recipient",
				AuthorPTID:          "ptid:alice",
				MembershipEpoch:     7,
				AuthorityHeadSHA256: privateDigest("group-authority-head"),
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
			},
			blockRemote:    true,
			wantGroupCalls: 1,
		},
		{
			name: "CUSTOM_ALLOW uses Actor Identity locality projection",
			audience: &actormodel.Audience{
				Kind:       actormodel.Audience_CUSTOM_ALLOW,
				ActorPtids: []string{"ptid:bob"},
			},
			resolvedLocality: []socialdomain.RecipientLocality{
				{
					ActorPTID:         "ptid:bob",
					HomeStationPeerID: "station-remote",
				},
			},
			wantLocalityCalls: 1,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			audiences, err := infrastructure.NewGORMPrivateAudienceAuthority(
				fixture.database,
			)
			if err != nil {
				t.Fatal(err)
			}
			recipients := &privateContentRemoteRecipientDirectory{
				delegate: privateContentTestRecipients{
					author: fixture.author.Endpoint,
				},
				localities: testCase.resolvedLocality,
			}
			groups := &privateContentRemoteGroupReader{
				snapshot: testCase.group,
			}
			fixture.service.audiences = audiences
			fixture.service.recipients = recipients
			fixture.service.groups = groups
			if testCase.blockRemote {
				if err := fixture.database.Exec(
					"INSERT INTO social_directional_relationships "+
						"(actor_ptid, target_actor_ptid, actor_home_station_peer_id, "+
						"target_home_station_peer_id, blocked, revision, updated_at) "+
						"VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
					"ptid:alice",
					"ptid:bob",
					"station-local",
					"station-remote",
					true,
					1,
				).Error; err != nil {
					t.Fatal(err)
				}
			}

			request := privateMomentPrepareRequest(
				"prepare-remote-recipient",
				"content-remote-recipient",
			)
			request.Audience = proto.Clone(
				testCase.audience,
			).(*actormodel.Audience)
			_, err = fixture.service.PreparePrivateMoment(
				context.Background(),
				fixture.author,
				request,
			)
			if !socialdomain.IsPrivateContentCode(
				err,
				socialdomain.PrivateContentUnsupported,
			) {
				t.Fatalf("PreparePrivateMoment() error = %v", err)
			}
			if groups.prepareCalls != testCase.wantGroupCalls {
				t.Fatalf(
					"Conversation PrepareSnapshot calls = %d, want %d",
					groups.prepareCalls,
					testCase.wantGroupCalls,
				)
			}
			if recipients.localityCalls != testCase.wantLocalityCalls {
				t.Fatalf(
					"Actor Identity locality calls = %d, want %d",
					recipients.localityCalls,
					testCase.wantLocalityCalls,
				)
			}
			if recipients.preKeyTargetCalls != 0 {
				t.Fatalf(
					"Content PreKey target resolution calls = %d, want 0",
					recipients.preKeyTargetCalls,
				)
			}
			if fixture.keyExchange.claimCalls != 0 {
				t.Fatalf(
					"Content PreKey claim calls = %d, want 0",
					fixture.keyExchange.claimCalls,
				)
			}
			assertPrivateContentRemotePrepareLeftNoRows(t, fixture)
		})
	}
}

func TestPrivateContentServiceFencesExactPreparedGroupSnapshot(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	audiences, err := infrastructure.NewGORMPrivateAudienceAuthority(
		fixture.database,
	)
	if err != nil {
		t.Fatal(err)
	}
	preparedGroup := socialdomain.GroupRecipientSnapshot{
		ConversationID:      "group-prepared-snapshot",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     7,
		AuthorityHeadSHA256: privateDigest("group-authority-head-7"),
		Members: []socialdomain.RecipientLocality{
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
	groups := &privateContentFencedGroupReader{
		prepared: preparedGroup,
		current:  preparedGroup,
	}
	fixture.service.audiences = audiences
	fixture.service.groups = groups

	request := privateMomentPrepareRequest(
		"prepare-group-snapshot",
		"content-group-snapshot",
	)
	request.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_GROUP,
		Target: &actormodel.Audience_GroupConversationId{
			GroupConversationId: preparedGroup.ConversationID,
		},
	}
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}

	persisted, err := fixture.store.LoadSubmitPreparation(
		context.Background(),
		prepared.GetPlan().GetPlanId(),
		fixture.author.Endpoint.GetActor().GetPtid(),
	)
	if err != nil {
		t.Fatal(err)
	}
	persistedGroup, err := socialdomain.ParseCanonicalGroupRecipientSnapshot(
		persisted.Binding.GroupRecipientSnapshotBytes,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persistedGroup, preparedGroup) {
		t.Fatalf(
			"persisted Group snapshot = %+v, want %+v",
			persistedGroup,
			preparedGroup,
		)
	}

	groups.current.MembershipEpoch++
	groups.current.AuthorityHeadSHA256 = privateDigest(
		"group-authority-head-8",
	)
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-group-snapshot",
		"group ciphertext",
	)
	_, err = fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		submit,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentStalePlan,
	) {
		t.Fatalf("stale Group submit error = %v", err)
	}
	if groups.prepareCalls != 1 {
		t.Fatalf(
			"Conversation PrepareSnapshot calls = %d, want prepare only",
			groups.prepareCalls,
		)
	}
	if groups.fenceCalls != 1 ||
		!reflect.DeepEqual(groups.expected, preparedGroup) {
		t.Fatalf(
			"submit fence = calls %d expected %+v",
			groups.fenceCalls,
			groups.expected,
		)
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

type privateContentRemoteRecipientDirectory struct {
	delegate          privateContentTestRecipients
	localities        []socialdomain.RecipientLocality
	localityCalls     int
	preKeyTargetCalls int
}

func (r *privateContentRemoteRecipientDirectory) ResolveRecipientLocalities(
	context.Context,
	string,
	[]string,
) ([]socialdomain.RecipientLocality, error) {
	r.localityCalls++

	return append([]socialdomain.RecipientLocality(nil), r.localities...), nil
}

func (r *privateContentRemoteRecipientDirectory) ResolveContentPreKeyTargets(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	recipients []string,
) ([]*securecontentpb.ContentPreKeyClaimTarget, error) {
	r.preKeyTargetCalls++

	return r.delegate.ResolveContentPreKeyTargets(ctx, author, recipients)
}

func (r *privateContentRemoteRecipientDirectory) ValidateActiveEndpoint(
	ctx context.Context,
	endpoint *actormodel.ActorDeviceRef,
) error {
	return r.delegate.ValidateActiveEndpoint(ctx, endpoint)
}

type privateContentRemoteGroupReader struct {
	snapshot     socialdomain.GroupRecipientSnapshot
	prepareCalls int
}

func (r *privateContentRemoteGroupReader) PrepareSnapshot(
	context.Context,
	string,
	string,
) (socialdomain.GroupRecipientSnapshot, error) {
	r.prepareCalls++
	snapshot := r.snapshot
	snapshot.AuthorityHeadSHA256 = append(
		[]byte(nil),
		r.snapshot.AuthorityHeadSHA256...,
	)
	snapshot.Members = append(
		[]socialdomain.RecipientLocality(nil),
		r.snapshot.Members...,
	)

	return snapshot, nil
}

func (*privateContentRemoteGroupReader) WithSubmitFence(
	context.Context,
	socialdomain.GroupRecipientSnapshot,
	func(socialdomain.GroupRecipientSnapshot) error,
) error {
	return nil
}

func assertPrivateContentRemotePrepareLeftNoRows(
	t *testing.T,
	fixture *privateContentServiceFixture,
) {
	t.Helper()
	models := []any{
		&dbmodel.SocialPrivateContentPlan{},
		&dbmodel.SocialPrivateContentPlanSlot{},
		&dbmodel.SocialPrivateAudienceSnapshot{},
		&dbmodel.SocialPrivateRecipientGrant{},
		&dbmodel.SocialPrivateContentPost{},
		&dbmodel.SocialPrivateContentEnvelope{},
		&dbmodel.SocialPrivateCommandReceipt{},
	}
	for _, model := range models {
		assertPrivateContentCount(t, fixture.database, model, 0)
	}
}

var _ PrivateRecipientDirectory = (*privateContentRemoteRecipientDirectory)(nil)
var _ GroupRecipientSnapshotReader = (*privateContentRemoteGroupReader)(nil)

type privateContentFencedGroupReader struct {
	prepared     socialdomain.GroupRecipientSnapshot
	current      socialdomain.GroupRecipientSnapshot
	expected     socialdomain.GroupRecipientSnapshot
	prepareCalls int
	fenceCalls   int
}

func (r *privateContentFencedGroupReader) PrepareSnapshot(
	context.Context,
	string,
	string,
) (socialdomain.GroupRecipientSnapshot, error) {
	r.prepareCalls++

	return clonePrivateContentGroupSnapshot(r.prepared), nil
}

func (r *privateContentFencedGroupReader) WithSubmitFence(
	_ context.Context,
	expected socialdomain.GroupRecipientSnapshot,
	commit func(socialdomain.GroupRecipientSnapshot) error,
) error {
	r.fenceCalls++
	r.expected = clonePrivateContentGroupSnapshot(expected)
	if !reflect.DeepEqual(expected, r.current) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentStalePlan,
			"test.group_snapshot.submit_fence",
			"expected_snapshot",
			"does not match current Group authority",
		)
	}

	return commit(clonePrivateContentGroupSnapshot(r.current))
}

func clonePrivateContentGroupSnapshot(
	snapshot socialdomain.GroupRecipientSnapshot,
) socialdomain.GroupRecipientSnapshot {
	snapshot.AuthorityHeadSHA256 = append(
		[]byte(nil),
		snapshot.AuthorityHeadSHA256...,
	)
	snapshot.Members = append(
		[]socialdomain.RecipientLocality(nil),
		snapshot.Members...,
	)

	return snapshot
}

var _ GroupRecipientSnapshotReader = (*privateContentFencedGroupReader)(nil)
