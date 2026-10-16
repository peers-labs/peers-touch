package groupadmission_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	groupadmission "github.com/peers-labs/peers-touch/station/app/subserver/conversation/groupadmission"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	notificationinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	localStation = "station-local"
	alicePTID    = "ptid:alice"
	bobPTID      = "ptid:bob"
)

type testClock struct {
	now time.Time
}

func (c *testClock) Now() time.Time {
	return c.now
}

type testIDs struct {
	mu   sync.Mutex
	next int
}

func (g *testIDs) NewID() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.next++
	return fmt.Sprintf("id-%d", g.next)
}

type testRelationships struct {
	friends bool
}

func (r *testRelationships) FriendshipProofID(
	context.Context,
	string,
	string,
) (string, bool, error) {
	if !r.friends {
		return "", false, nil
	}
	return "friendship-proof-1", true, nil
}

type testSigner struct{}

func (testSigner) SignGrant(
	_ context.Context,
	grant *chatmodel.GroupAdmissionGrant,
) error {
	grant.HomeStationSigningKeyId = "station-key-1"
	grant.HomeStationSignature = []byte("signed")
	return nil
}

type testVerifier struct{}

func (testVerifier) VerifyDecision(
	context.Context,
	*chatmodel.GroupInvitationDecisionCommand,
	[]byte,
) error {
	return nil
}

type fixture struct {
	service       *groupadmission.Service
	db            *gorm.DB
	clock         *testClock
	relationships *testRelationships
}

func canonicalGrantDigest(
	grant *chatmodel.GroupAdmissionGrant,
) ([]byte, error) {
	issued := &chatmodel.GroupAdmissionGrantSigningInput{
		Version:                  grant.GetVersion(),
		GrantId:                  grant.GetGrantId(),
		ConversationId:           grant.GetConversationId(),
		FederationId:             grant.GetFederationId(),
		AuthorityStationPeerId:   grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:           grant.GetAuthorityEpoch(),
		InviterPtid:              grant.GetInviterPtid(),
		InviterDeviceId:          grant.GetInviterDeviceId(),
		InviteePtid:              grant.GetInviteePtid(),
		InviteeHomeStationPeerId: grant.GetInviteeHomeStationPeerId(),
		SourceRequestId:          grant.GetSourceRequestId(),
		InvitationId:             grant.GetInvitationId(),
		FriendshipProofId:        grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:  grant.GetAdmissionPolicyRevision(),
		State:                    chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED,
		AuthoritySequence:        grant.GetAuthoritySequence(),
		AuthorityHash:            grant.GetAuthorityHash(),
		IssuedAt:                 grant.GetIssuedAt(),
		ExpiresAt:                grant.GetExpiresAt(),
		HomeStationSigningKeyId:  grant.GetHomeStationSigningKeyId(),
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(issued)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	return digest[:], nil
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:group-admission-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := persistence.MigrateCanonicalSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := notificationinfra.NewGormRepo(db).AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	clock := &testClock{now: time.Unix(1_800_000_000, 0).UTC()}
	relationships := &testRelationships{friends: true}
	service, err := groupadmission.NewService(
		persistence.NewGroupAdmissionStore(db),
		relationships,
		testSigner{},
		testVerifier{},
		clock,
		&testIDs{},
		localStation,
	)
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{
		service:       service,
		db:            db,
		clock:         clock,
		relationships: relationships,
	}
}

func evaluation(
	f *fixture,
	requestID string,
	authoritySequence int64,
	deferInvitation bool,
) *chatmodel.GroupAdmissionEvaluationRequest {
	return &chatmodel.GroupAdmissionEvaluationRequest{
		Version:                1,
		RequestId:              requestID,
		ConversationId:         "group-1",
		FederationId:           "federation-1",
		AuthorityStationPeerId: "station-authority",
		AuthorityEpoch:         1,
		Inviter: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: alicePTID},
			DeviceId: "alice-device",
		},
		Invitee:                         &actormodel.ActorRef{Ptid: bobPTID},
		InviteeHomeStationPeerId:        localStation,
		GroupNameSnapshot:               "Trusted group",
		ObservedMembershipEpoch:         authoritySequence,
		ObservedMlsEpoch:                authoritySequence,
		AuthoritySequence:               authoritySequence,
		AuthorityHash:                   make([]byte, 32),
		ExpiresAt:                       timestamppb.New(f.clock.now.Add(5 * time.Minute)),
		AuthorityPlanId:                 "plan-genesis-1",
		DeferInvitationUntilGroupCommit: deferInvitation,
	}
}

func TestDefaultPreferenceDirectAddsFriendsAndRejectsNonFriends(t *testing.T) {
	f := newFixture(t)
	settings, err := f.service.GetSettings(context.Background(), bobPTID)
	if err != nil {
		t.Fatal(err)
	}
	if settings.GetPreference().GetMode() !=
		chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_DIRECT_ADD ||
		settings.GetPreference().GetRevision() != 1 {
		t.Fatalf("default preference = %+v", settings.GetPreference())
	}

	direct, _, err := f.service.Evaluate(
		context.Background(),
		evaluation(f, "request-direct", 1, false),
	)
	if err != nil {
		t.Fatal(err)
	}
	if direct.GetOutcome() !=
		chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DIRECT_ADD ||
		direct.GetGrant() == nil {
		t.Fatalf("direct admission = %+v", direct)
	}

	f.relationships.friends = false
	denied, _, err := f.service.Evaluate(
		context.Background(),
		evaluation(f, "request-nonfriend", 1, false),
	)
	if err != nil {
		t.Fatal(err)
	}
	if denied.GetDenialCode() != "FRIENDSHIP_REQUIRED" {
		t.Fatalf("non-friend admission = %+v", denied)
	}
}

func TestDeferredGenesisInvitationActivatesOnlyAfterCommit(t *testing.T) {
	f := newFixture(t)
	if _, err := f.service.UpdatePreference(
		context.Background(),
		bobPTID,
		chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_REQUIRE_CONFIRMATION,
		1,
	); err != nil {
		t.Fatal(err)
	}
	response, wake, err := f.service.Evaluate(
		context.Background(),
		evaluation(f, "request-deferred", 0, true),
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetOutcome() !=
		chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_CONFIRMATION_REQUIRED ||
		response.GetInvitation() == nil ||
		wake != nil {
		t.Fatalf("deferred admission = %+v, wake = %+v", response, wake)
	}
	before, err := f.service.ListInvitations(context.Background(), bobPTID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != 0 {
		t.Fatalf("invitations before group commit = %d", len(before))
	}

	wakes, activated, err := f.service.ActivateDeferredInvitations(
		context.Background(),
		"plan-genesis-1",
		"group-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if activated != 1 || len(wakes) != 1 {
		t.Fatalf("activation count = %d, wakes = %d", activated, len(wakes))
	}
	after, err := f.service.ListInvitations(context.Background(), bobPTID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 1 ||
		after[0].GetInvitationId() != response.GetInvitation().GetInvitationId() {
		t.Fatalf("activated invitations = %+v", after)
	}
	var notificationCount int64
	if err := f.db.Table("notifications").Count(&notificationCount).Error; err != nil {
		t.Fatal(err)
	}
	if notificationCount != 1 {
		t.Fatalf("notification count = %d", notificationCount)
	}
	if _, activated, err := f.service.ActivateDeferredInvitations(
		context.Background(),
		"plan-genesis-1",
		"group-1",
	); err != nil || activated != 0 {
		t.Fatalf("activation replay = %d, %v", activated, err)
	}
}

func TestAcceptedInvitationReissuesGrantForCurrentAuthorityHeadAndBindsOnce(
	t *testing.T,
) {
	f := newFixture(t)
	preference, err := f.service.UpdatePreference(
		context.Background(),
		bobPTID,
		chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_REQUIRE_CONFIRMATION,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	pending, _, err := f.service.Evaluate(
		context.Background(),
		evaluation(f, "request-invitation", 1, false),
	)
	if err != nil {
		t.Fatal(err)
	}
	invitation := pending.GetInvitation()
	decision := &chatmodel.GroupInvitationDecisionCommand{
		Version:                1,
		CommandId:              "decision-1",
		InvitationId:           invitation.GetInvitationId(),
		Actor:                  &actormodel.ActorDeviceRef{Actor: &actormodel.ActorRef{Ptid: bobPTID}, DeviceId: "bob-device"},
		ActorSigningKeyId:      "bob-signing-key",
		Action:                 chatmodel.GroupInvitationDecisionAction_GROUP_INVITATION_DECISION_ACTION_ACCEPT,
		ObservedState:          invitation.GetState(),
		ObservedPolicyRevision: preference.GetRevision(),
		CreatedAt:              timestamppb.New(f.clock.now),
		ExpiresAt:              timestamppb.New(f.clock.now.Add(time.Minute)),
		ActorSignature:         []byte("verified-by-test"),
	}
	decided, err := f.service.Decide(context.Background(), bobPTID, decision)
	if err != nil {
		t.Fatal(err)
	}
	decisionGrantID := decided.GetGrant().GetGrantId()

	sameHead := evaluation(f, "request-same-head", 1, false)
	sameHeadAdmission, _, err := f.service.Evaluate(
		context.Background(),
		sameHead,
	)
	if err != nil {
		t.Fatal(err)
	}
	if sameHeadAdmission.GetGrant().GetGrantId() != decisionGrantID {
		t.Fatalf(
			"same-head grant = %q, want accepted grant %q",
			sameHeadAdmission.GetGrant().GetGrantId(),
			decisionGrantID,
		)
	}

	current := evaluation(f, "request-current-head", 3, false)
	admission, _, err := f.service.Evaluate(context.Background(), current)
	if err != nil {
		t.Fatal(err)
	}
	grant := admission.GetGrant()
	if grant == nil ||
		grant.GetInvitationId() != invitation.GetInvitationId() ||
		grant.GetSourceRequestId() != current.GetRequestId() ||
		grant.GetAuthoritySequence() != 3 {
		t.Fatalf("current-head grant = %+v", grant)
	}
	replayedDecision, err := f.service.Decide(
		context.Background(),
		bobPTID,
		decision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if replayedDecision.GetGrant().GetGrantId() != decisionGrantID {
		t.Fatalf(
			"decision replay grant = %q, want %q",
			replayedDecision.GetGrant().GetGrantId(),
			decisionGrantID,
		)
	}
	digest, err := canonicalGrantDigest(grant)
	if err != nil {
		t.Fatal(err)
	}
	binding := &chatmodel.GroupAdmissionFulfillmentRequest{
		Version:   1,
		RequestId: "bind-1",
		Fulfillment: &chatmodel.GroupAdmissionFulfillment{
			GrantId:                  grant.GetGrantId(),
			InvitationId:             grant.GetInvitationId(),
			InviteePtid:              bobPTID,
			InviteeHomeStationPeerId: localStation,
			GrantSha256:              digest,
		},
		AuthorityPlanId: "plan-current",
		PlanExpiresAt:   timestamppb.New(f.clock.now.Add(time.Minute)),
	}
	bound, err := f.service.BindFulfillment(context.Background(), binding)
	if err != nil {
		t.Fatal(err)
	}
	if bound.GetBoundAuthorityPlanId() != "plan-current" {
		t.Fatalf("bound grant = %+v", bound)
	}
	if _, err := f.service.BindFulfillment(context.Background(), binding); err != nil {
		t.Fatalf("same-plan binding replay: %v", err)
	}
	other := *binding
	other.AuthorityPlanId = "plan-other"
	if _, err := f.service.BindFulfillment(
		context.Background(),
		&other,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("other-plan binding error = %v", err)
	}
	completedGrant, completedInvitation, err := f.service.CompleteFulfillment(
		context.Background(),
		binding.GetFulfillment(),
		bobPTID,
		"group-1",
		"federation-1",
		"station-authority",
		1,
		"plan-current",
		"transition-joined-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if completedGrant.GetState() !=
		chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_JOINED ||
		completedGrant.GetFulfillmentTransitionId() != "transition-joined-1" ||
		completedInvitation.GetState() !=
			chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_JOINED ||
		completedInvitation.GetFulfillmentTransitionId() != "transition-joined-1" {
		t.Fatalf(
			"completed grant = %+v, invitation = %+v",
			completedGrant,
			completedInvitation,
		)
	}
	if _, _, err := f.service.CompleteFulfillment(
		context.Background(),
		binding.GetFulfillment(),
		bobPTID,
		"group-1",
		"federation-1",
		"station-authority",
		1,
		"plan-current",
		"transition-joined-1",
	); err != nil {
		t.Fatalf("completion replay: %v", err)
	}
	if _, _, err := f.service.CompleteFulfillment(
		context.Background(),
		binding.GetFulfillment(),
		bobPTID,
		"group-1",
		"federation-1",
		"station-authority",
		1,
		"plan-current",
		"transition-conflict",
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting completion = %v", err)
	}
}

func TestRevisionConflictAndLeaveRejectProjection(t *testing.T) {
	f := newFixture(t)
	if _, err := f.service.UpdatePreference(
		context.Background(),
		bobPTID,
		chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_REQUIRE_CONFIRMATION,
		99,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("revision conflict = %v", err)
	}
	operation, _, err := f.service.StartLeaveReject(
		context.Background(),
		bobPTID,
		&chatmodel.StartGroupLeaveRejectRequest{
			OperationId:            "leave-reject-1",
			ConversationId:         "group-1",
			FederationId:           "federation-1",
			AuthorityStationPeerId: "station-authority",
			GroupNameSnapshot:      "Trusted group",
			ObservedPolicyRevision: 1,
			Actor:                  &actormodel.ActorDeviceRef{Actor: &actormodel.ActorRef{Ptid: bobPTID}, DeviceId: "bob-device"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	operation, err = f.service.UpdateLeaveReject(
		context.Background(),
		operation,
		chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED,
		"LEAVE_INTENT_CREATE_REQUIRED",
	)
	if err != nil {
		t.Fatal(err)
	}
	intent := &chatmodel.MlsLeaveIntent{
		IntentId:               "leave-intent-1",
		FederationId:           "federation-1",
		AuthorityStationPeerId: "station-authority",
		HomeStationPeerId:      localStation,
		ConversationId:         "group-1",
		ActorPtid:              bobPTID,
		ActorDeviceId:          "bob-device",
	}
	operation, err = f.service.AttachLeaveRejectIntent(
		context.Background(),
		bobPTID,
		operation.GetOperationId(),
		intent,
	)
	if err != nil {
		t.Fatal(err)
	}
	conflictingIntent := proto.Clone(intent).(*chatmodel.MlsLeaveIntent)
	conflictingIntent.ActorSignature = []byte("different")
	if _, err := f.service.AttachLeaveRejectIntent(
		context.Background(),
		bobPTID,
		operation.GetOperationId(),
		conflictingIntent,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting leave intent replay = %v", err)
	}
	completed, err := f.service.CompleteLeaveReject(
		context.Background(),
		bobPTID,
		"group-1",
		"federation-1",
		"station-authority",
		"leave-intent-1",
		"transition-left-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.GetState() !=
		chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED ||
		completed.GetFulfillmentTransitionId() != "transition-left-1" ||
		completed.GetFailureCode() != "" {
		t.Fatalf("completed leave-reject = %+v", completed)
	}
	if replay, err := f.service.CompleteLeaveReject(
		context.Background(),
		bobPTID,
		"group-1",
		"federation-1",
		"station-authority",
		"leave-intent-1",
		"transition-left-1",
	); err != nil || replay.GetOperationId() != operation.GetOperationId() {
		t.Fatalf("leave completion replay = %+v, %v", replay, err)
	}
	lateRetry, err := f.service.UpdateLeaveReject(
		context.Background(),
		operation,
		chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED,
		"LEAVE_INTENT_SUBMIT_FAILED",
	)
	if err != nil {
		t.Fatal(err)
	}
	if lateRetry.GetState() !=
		chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED ||
		lateRetry.GetFulfillmentTransitionId() != "transition-left-1" {
		t.Fatalf("late retry downgraded completed operation = %+v", lateRetry)
	}
	settings, err := f.service.GetSettings(context.Background(), bobPTID)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.GetRejectedGroups()) != 1 ||
		settings.GetRejectedGroups()[0].GetLeaveRejectOperationId() != "leave-reject-1" ||
		settings.GetRejectedGroups()[0].GetLeaveRejectState() !=
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED {
		t.Fatalf("rejected group projection = %+v", settings.GetRejectedGroups())
	}
	denied, _, err := f.service.Evaluate(
		context.Background(),
		evaluation(f, "request-rejected-group", 2, false),
	)
	if err != nil {
		t.Fatal(err)
	}
	if denied.GetDenialCode() != "GROUP_REJECTED" {
		t.Fatalf("rejected-group admission = %+v", denied)
	}
}
