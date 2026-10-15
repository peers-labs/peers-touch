package publishing

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/credential"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

var errUnexpectedPublishingTestCall = errors.New("unexpected publishing test call")

type publishingTestClock struct {
	now time.Time
}

func (c publishingTestClock) Now() time.Time { return c.now }

type publishingTestIDs struct {
	mu   sync.Mutex
	next int
}

func (g *publishingTestIDs) NewID() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.next++
	return fmt.Sprintf("generated-command-%d", g.next)
}

func (g *publishingTestIDs) NewPlanID() valueobject.PlanID {
	return valueobject.PlanID(g.NewID())
}

type publishingTestState struct {
	grants               map[string]entity.PublishingGrant
	publications         map[string]entity.PublicationReceipt
	authorities          map[valueobject.ConversationID]aggregate.Snapshot
	events               map[valueobject.EventID]domainevent.Record
	commandReceipts      map[string]repository.CommandReceipt
	inbox                []ports.DeviceInboxIntent
	commitments          []ports.AuthorityDeliveryCommitment
	notifications        []ports.ServiceNotificationInput
	objects              map[string]ports.PublishedObject
	suppressNotification bool
	notificationError    error
}

func newPublishingTestState() *publishingTestState {
	return &publishingTestState{
		grants:          make(map[string]entity.PublishingGrant),
		publications:    make(map[string]entity.PublicationReceipt),
		authorities:     make(map[valueobject.ConversationID]aggregate.Snapshot),
		events:          make(map[valueobject.EventID]domainevent.Record),
		commandReceipts: make(map[string]repository.CommandReceipt),
		objects:         make(map[string]ports.PublishedObject),
	}
}

func (s *publishingTestState) clone() *publishingTestState {
	result := newPublishingTestState()
	for key, grant := range s.grants {
		grant.AllowedTargets = append([]valueobject.ConversationID(nil), grant.AllowedTargets...)
		result.grants[key] = grant
	}
	for key, publication := range s.publications {
		result.publications[key] = publication
	}
	for key, authority := range s.authorities {
		result.authorities[key] = authority
	}
	for key, event := range s.events {
		result.events[key] = event
	}
	for key, receipt := range s.commandReceipts {
		receipt.EventBytes = append([]byte(nil), receipt.EventBytes...)
		result.commandReceipts[key] = receipt
	}
	result.inbox = append([]ports.DeviceInboxIntent(nil), s.inbox...)
	result.commitments = append(
		[]ports.AuthorityDeliveryCommitment(nil),
		s.commitments...,
	)
	for _, input := range s.notifications {
		copied := input
		copied.Metadata = cloneStringMap(input.Metadata)
		result.notifications = append(result.notifications, copied)
	}
	for key, object := range s.objects {
		result.objects[key] = object
	}
	result.suppressNotification = s.suppressNotification
	result.notificationError = s.notificationError
	return result
}

func cloneStringMap(input map[string]string) map[string]string {
	if input == nil {
		return nil
	}
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

type publishingTestUnitOfWork struct {
	mu              sync.Mutex
	state           *publishingTestState
	ownerRoute      ports.EndpointRoute
	station         valueobject.StationID
	failAfterCommit bool
}

func (u *publishingTestUnitOfWork) Execute(
	ctx context.Context,
	operation func(ports.Transaction) error,
) error {
	return u.execute(ctx, operation)
}

func (u *publishingTestUnitOfWork) ExecuteSerialized(
	ctx context.Context,
	_ string,
	operation func(ports.Transaction) error,
) error {
	return u.execute(ctx, operation)
}

func (u *publishingTestUnitOfWork) execute(
	ctx context.Context,
	operation func(ports.Transaction) error,
) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	candidate := u.state.clone()
	transaction := publishingTestTransaction(candidate, u.ownerRoute, u.station)
	if err := operation(transaction); err != nil {
		return err
	}
	u.state = candidate
	if u.failAfterCommit {
		u.failAfterCommit = false
		return errors.New("response lost after commit")
	}
	return nil
}

func (u *publishingTestUnitOfWork) snapshot() *publishingTestState {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.state.clone()
}

func (u *publishingTestUnitOfWork) mutate(
	operation func(*publishingTestState),
) {
	u.mu.Lock()
	defer u.mu.Unlock()
	operation(u.state)
}

func publishingTestTransaction(
	state *publishingTestState,
	ownerRoute ports.EndpointRoute,
	station valueobject.StationID,
) ports.Transaction {
	store := &publishingTestStore{state: state}
	return ports.Transaction{
		Repositories: repository.Repositories{
			Authority:      &publishingTestAuthorityRepository{state: state},
			Events:         &publishingTestEventRepository{state: state},
			Receipts:       &publishingTestReceiptRepository{state: state},
			AuthorityPlans: publishingTestPlanRepository{},
		},
		Identity:               publishingTestIdentity{route: ownerRoute},
		Federation:             publishingTestFederation{},
		SystemSender:           publishingTestSystemSender{state: state},
		Publishing:             store,
		PublishingObjects:      publishingTestObjects{state: state},
		ServiceNotifications:   publishingTestNotifications{state: state},
		LocalScope:             publishingTestLocalScope{station: station},
		DeviceInbox:            publishingTestInbox{state: state},
		FederationOutbox:       publishingTestOutbox{},
		DeliveryCommitments:    publishingTestCommitments{state: state},
		ObjectGrants:           publishingTestObjectGrants{},
		KeyPackageReservations: publishingTestKeyPackages{},
	}
}

type publishingTestStore struct {
	state *publishingTestState
}

func (s *publishingTestStore) GetGrant(
	_ context.Context,
	id string,
) (entity.PublishingGrant, error) {
	grant, ok := s.state.grants[id]
	if !ok {
		return entity.PublishingGrant{}, publishingTestNotFound("grant")
	}
	return grant, nil
}

func (s *publishingTestStore) CreateGrant(
	_ context.Context,
	grant entity.PublishingGrant,
) error {
	if _, found := s.state.grants[grant.ID]; found {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"test.create_grant",
			"publishing_id",
			"already exists",
		)
	}
	s.state.grants[grant.ID] = grant
	return nil
}

func (s *publishingTestStore) SaveGrant(
	_ context.Context,
	grant entity.PublishingGrant,
) error {
	s.state.grants[grant.ID] = grant
	return nil
}

func (s *publishingTestStore) ListGrants(
	_ context.Context,
	owner valueobject.PTID,
) ([]entity.PublishingGrant, error) {
	var result []entity.PublishingGrant
	for _, grant := range s.state.grants {
		if grant.Owner == owner {
			result = append(result, grant)
		}
	}
	return result, nil
}

func (s *publishingTestStore) GetPublication(
	_ context.Context,
	id string,
	commandID string,
) (entity.PublicationReceipt, bool, error) {
	receipt, found := s.state.publications[publicationKey(id, commandID)]
	return receipt, found, nil
}

func (s *publishingTestStore) RecordPublication(
	_ context.Context,
	receipt entity.PublicationReceipt,
) error {
	key := publicationKey(receipt.PublishingID, receipt.CommandID)
	if _, found := s.state.publications[key]; found {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"test.record_publication",
			"command_id",
			"already exists",
		)
	}
	s.state.publications[key] = receipt
	return nil
}

func (*publishingTestStore) CheckRate(
	context.Context,
	string,
	uint32,
	time.Time,
) error {
	return nil
}

func publicationKey(id, commandID string) string {
	return id + "\x00" + commandID
}

type publishingTestAuthorityRepository struct {
	state *publishingTestState
}

func (r *publishingTestAuthorityRepository) Create(
	_ context.Context,
	snapshot aggregate.Snapshot,
) error {
	if _, found := r.state.authorities[snapshot.ID]; found {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"test.authority.create",
			"conversation",
			"already exists",
		)
	}
	r.state.authorities[snapshot.ID] = snapshot
	return nil
}

func (r *publishingTestAuthorityRepository) LoadForUpdate(
	_ context.Context,
	id valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	snapshot, found := r.state.authorities[id]
	if !found {
		return aggregate.Snapshot{}, publishingTestNotFound("conversation")
	}
	return snapshot, nil
}

func (r *publishingTestAuthorityRepository) Get(
	ctx context.Context,
	id valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	return r.LoadForUpdate(ctx, id)
}

func (r *publishingTestAuthorityRepository) ListByActor(
	_ context.Context,
	_ valueobject.PTID,
) ([]aggregate.Snapshot, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (r *publishingTestAuthorityRepository) Save(
	_ context.Context,
	snapshot aggregate.Snapshot,
) error {
	r.state.authorities[snapshot.ID] = snapshot
	return nil
}

type publishingTestEventRepository struct {
	state *publishingTestState
}

func (r *publishingTestEventRepository) Append(
	_ context.Context,
	event domainevent.Record,
) error {
	r.state.events[event.ID] = event
	return nil
}

func (r *publishingTestEventRepository) GetByID(
	_ context.Context,
	id valueobject.EventID,
) (domainevent.Record, error) {
	event, found := r.state.events[id]
	if !found {
		return domainevent.Record{}, publishingTestNotFound("event")
	}
	return event, nil
}

func (r *publishingTestEventRepository) GetByCommand(
	_ context.Context,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) (domainevent.Record, error) {
	for _, event := range r.state.events {
		if event.ConversationID == conversationID && event.CommandID == commandID {
			return event, nil
		}
	}
	return domainevent.Record{}, publishingTestNotFound("event")
}

func (r *publishingTestEventRepository) GetBySequence(
	_ context.Context,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
) (domainevent.Record, error) {
	for _, event := range r.state.events {
		if event.ConversationID == conversationID && event.Sequence == sequence {
			return event, nil
		}
	}
	return domainevent.Record{}, publishingTestNotFound("event")
}

func (*publishingTestEventRepository) GetMessageIdentity(
	context.Context,
	valueobject.ConversationID,
	valueobject.MessageID,
) (repository.MessageIdentity, error) {
	return repository.MessageIdentity{}, publishingTestNotFound("message")
}

func (*publishingTestEventRepository) List(
	context.Context,
	valueobject.ConversationID,
	valueobject.Sequence,
	int,
) ([]domainevent.Record, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (*publishingTestEventRepository) ListMessages(
	context.Context,
	valueobject.ConversationID,
	valueobject.Sequence,
	int,
) ([]domainevent.Record, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (*publishingTestEventRepository) ListThreadMessages(
	context.Context,
	valueobject.ConversationID,
	valueobject.MessageID,
	valueobject.Sequence,
	int,
) ([]domainevent.Record, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (*publishingTestEventRepository) ThreadCounts(
	context.Context,
	valueobject.ConversationID,
	[]valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	return nil, errUnexpectedPublishingTestCall
}

type publishingTestReceiptRepository struct {
	state *publishingTestState
}

func (r *publishingTestReceiptRepository) Get(
	_ context.Context,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) (repository.CommandReceipt, error) {
	receipt, found := r.state.commandReceipts[commandReceiptKey(conversationID, commandID)]
	if !found {
		return repository.CommandReceipt{}, publishingTestNotFound("receipt")
	}
	return receipt, nil
}

func (r *publishingTestReceiptRepository) Create(
	_ context.Context,
	receipt repository.CommandReceipt,
) error {
	key := commandReceiptKey(receipt.ConversationID, receipt.CommandID)
	if _, found := r.state.commandReceipts[key]; found {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"test.receipt.create",
			"command_id",
			"already exists",
		)
	}
	r.state.commandReceipts[key] = receipt
	return nil
}

func commandReceiptKey(
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) string {
	return string(conversationID) + "\x00" + string(commandID)
}

type publishingTestPlanRepository struct{}

func (publishingTestPlanRepository) Create(context.Context, entity.AuthorityPlan) error {
	return errUnexpectedPublishingTestCall
}

func (publishingTestPlanRepository) LoadForUpdate(
	context.Context,
	valueobject.PlanID,
) (entity.AuthorityPlan, error) {
	return entity.AuthorityPlan{}, errUnexpectedPublishingTestCall
}

func (publishingTestPlanRepository) Save(context.Context, entity.AuthorityPlan) error {
	return errUnexpectedPublishingTestCall
}

type publishingTestIdentity struct {
	route ports.EndpointRoute
}

func (publishingTestIdentity) IsActive(
	context.Context,
	valueobject.Endpoint,
) (bool, error) {
	return true, nil
}

func (publishingTestIdentity) ActorIdentityPublicKey(
	context.Context,
	valueobject.PTID,
) ([]byte, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (publishingTestIdentity) VerifyDeviceSignature(
	context.Context,
	valueobject.Endpoint,
	string,
	[]byte,
	[]byte,
) (ports.DeviceSignatureVerification, error) {
	return ports.DeviceSignatureVerification{}, errUnexpectedPublishingTestCall
}

func (i publishingTestIdentity) ListActiveEndpoints(
	_ context.Context,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	if len(actors) != 1 || actors[0] != i.route.Endpoint.Actor {
		return nil, fmt.Errorf("unexpected route actors: %v", actors)
	}
	return []ports.EndpointRoute{i.route}, nil
}

type publishingTestFederation struct{}

func (publishingTestFederation) IsActiveStation(
	context.Context,
	valueobject.FederationID,
	valueobject.StationID,
) (bool, error) {
	return true, nil
}

type publishingTestSystemSender struct {
	state *publishingTestState
}

func (a publishingTestSystemSender) AuthorizeSystemMessage(
	_ context.Context,
	publishingID string,
	sender valueobject.PTID,
	conversationID valueobject.ConversationID,
	at time.Time,
) error {
	grant, found := a.state.grants[publishingID]
	if !found {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"test.system_sender",
			"publishing_id",
			"not authorized",
		)
	}
	return grant.Authorize(sender, conversationID, at)
}

type publishingTestObjects struct {
	state *publishingTestState
}

func (d publishingTestObjects) ValidateObject(
	_ context.Context,
	objectID string,
	_ valueobject.PTID,
	_ valueobject.ConversationID,
	_ time.Time,
) (ports.PublishedObject, error) {
	object, found := d.state.objects[objectID]
	if !found {
		return ports.PublishedObject{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"test.validate_object",
			"object_id",
			"not authorized",
		)
	}
	return object, nil
}

type publishingTestNotifications struct {
	state *publishingTestState
}

func (p publishingTestNotifications) ProduceInTx(
	_ context.Context,
	input ports.ServiceNotificationInput,
	_ time.Time,
) (ports.ServiceNotificationResult, error) {
	if p.state.notificationError != nil {
		return ports.ServiceNotificationResult{}, p.state.notificationError
	}
	if p.state.suppressNotification {
		return ports.ServiceNotificationResult{}, nil
	}
	p.state.notifications = append(p.state.notifications, input)
	return ports.ServiceNotificationResult{
		Produced:       true,
		NotificationID: fmt.Sprintf("notification-%d", len(p.state.notifications)),
	}, nil
}

type publishingTestLocalScope struct {
	station valueobject.StationID
}

func (s publishingTestLocalScope) LocalFederation(
	context.Context,
) (valueobject.FederationID, valueobject.AuthorityEpoch, error) {
	return "federation-local", 1, nil
}

type publishingTestInbox struct {
	state *publishingTestState
}

func (w publishingTestInbox) Enqueue(
	_ context.Context,
	intent ports.DeviceInboxIntent,
) error {
	w.state.inbox = append(w.state.inbox, intent)
	return nil
}

type publishingTestOutbox struct{}

func (publishingTestOutbox) Enqueue(
	context.Context,
	ports.FederationOutboxIntent,
) error {
	return errors.New("service plaintext must remain home-local")
}

type publishingTestCommitments struct {
	state *publishingTestState
}

func (w publishingTestCommitments) RecordCommitments(
	_ context.Context,
	commitments []ports.AuthorityDeliveryCommitment,
) error {
	w.state.commitments = append(w.state.commitments, commitments...)
	return nil
}

type publishingTestObjectGrants struct{}

func (publishingTestObjectGrants) GrantBatch(
	context.Context,
	ports.ObjectGrantBatch,
) error {
	return errUnexpectedPublishingTestCall
}

type publishingTestKeyPackages struct{}

func (publishingTestKeyPackages) Reserve(
	context.Context,
	valueobject.PlanID,
	[]ports.EndpointRoute,
	time.Time,
) ([]valueobject.KeyPackageReservation, error) {
	return nil, errUnexpectedPublishingTestCall
}

func (publishingTestKeyPackages) Consume(
	context.Context,
	[]valueobject.KeyPackageReservation,
	time.Time,
) error {
	return errUnexpectedPublishingTestCall
}

func (publishingTestKeyPackages) Release(
	context.Context,
	[]valueobject.KeyPackageReservation,
	time.Time,
) error {
	return errUnexpectedPublishingTestCall
}

func publishingTestNotFound(field string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeNotFound,
		"publishing.test",
		field,
		"not found",
	)
}

type publishingHarness struct {
	service      *Service
	unitOfWork   *publishingTestUnitOfWork
	grant        entity.PublishingGrant
	secret       string
	owner        valueobject.PTID
	sender       valueobject.PTID
	conversation valueobject.ConversationID
}

func newPublishingHarness(t *testing.T) *publishingHarness {
	t.Helper()
	now := time.Date(2026, time.October, 15, 2, 0, 0, 0, time.UTC)
	station := valueobject.StationID("station-one")
	owner := valueobject.PTID("ptid:owner-alice")
	sender := valueobject.PTID("ptid:service-ci")
	conversationID, err := valueobject.DirectConversationID(sender, owner)
	if err != nil {
		t.Fatalf("direct conversation ID: %v", err)
	}
	secret := "ptsec_test-live-credential"
	grant := entity.PublishingGrant{
		ID:              "publishing-ci",
		Owner:           owner,
		Sender:          sender,
		Name:            "CI Publisher",
		SourceNamespace: "ci.build",
		DefaultTarget:   conversationID,
		AllowedTargets:  []valueobject.ConversationID{conversationID},
		SecretHash:      credential.Hash(secret),
		SecretHint:      credential.Hint(secret),
		CreatedAt:       now.Add(-time.Hour),
		RatePerMinute:   DefaultRateLimitPerMinute,
	}
	state := newPublishingTestState()
	state.grants[grant.ID] = grant
	ownerEndpoint := valueobject.Endpoint{Actor: owner, Device: "alice-device"}
	unitOfWork := &publishingTestUnitOfWork{
		state: state,
		ownerRoute: ports.EndpointRoute{
			Endpoint:    ownerEndpoint,
			HomeStation: station,
		},
		station: station,
	}
	ids := &publishingTestIDs{}
	clock := publishingTestClock{now: now}
	commandService, err := command.NewService(
		unitOfWork,
		station,
		clock,
		ids,
		conversationhttp.ProtobufConversationStateEncoder{},
		conversationhttp.ProtobufDeviceEventEncoder{},
		conversationhttp.ProtobufReadCursorEncoder{},
		conversationhttp.ProtobufLeaveIntentSigningEncoder{},
		conversationhttp.ProtobufCommandProposalSigningEncoder{},
		nil,
		conversationhttp.ProtobufEventSealer{},
	)
	if err != nil {
		t.Fatalf("new command service: %v", err)
	}
	service, err := NewService(unitOfWork, commandService, clock, ids)
	if err != nil {
		t.Fatalf("new publishing service: %v", err)
	}
	return &publishingHarness{
		service:      service,
		unitOfWork:   unitOfWork,
		grant:        grant,
		secret:       secret,
		owner:        owner,
		sender:       sender,
		conversation: conversationID,
	}
}

func publishTextRequest(commandID, text string) *chat.PublishMessageRequest {
	request := textRequest("")
	request.CommandId = commandID
	request.Content.GetText().Text = text
	return request
}

func (h *publishingHarness) publish(
	t *testing.T,
	secret string,
	request *chat.PublishMessageRequest,
) (Result, error) {
	t.Helper()
	return h.service.Publish(
		context.Background(),
		h.grant.ID,
		secret,
		request.CommandId,
		request,
	)
}

func assertPublishingEffects(
	t *testing.T,
	state *publishingTestState,
	publications int,
	notifications int,
	inbox int,
) {
	t.Helper()
	if len(state.publications) != publications ||
		len(state.notifications) != notifications ||
		len(state.inbox) != inbox {
		t.Fatalf(
			"effects publications=%d notifications=%d inbox=%d, want %d/%d/%d",
			len(state.publications),
			len(state.notifications),
			len(state.inbox),
			publications,
			notifications,
			inbox,
		)
	}
}

func TestPublishReplayPreservesReceiptAcrossCredentialLifecycle(t *testing.T) {
	harness := newPublishingHarness(t)
	request := publishTextRequest("command-stable", "build passed")

	accepted, err := harness.publish(t, harness.secret, request)
	if err != nil {
		t.Fatalf("accepted publish: %v", err)
	}
	if accepted.Response.GetOutcome() !=
		chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_ACCEPTED {
		t.Fatalf("accepted outcome = %v", accepted.Response.GetOutcome())
	}
	if accepted.NotificationWake == nil {
		t.Fatal("accepted publish did not return its durable notification wake")
	}
	state := harness.unitOfWork.snapshot()
	assertPublishingEffects(t, state, 1, 1, 2)

	replayed, err := harness.publish(t, harness.secret, request)
	if err != nil {
		t.Fatalf("replay publish: %v", err)
	}
	if replayed.Response.GetOutcome() !=
		chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_REPLAYED {
		t.Fatalf("replay outcome = %v", replayed.Response.GetOutcome())
	}
	if !proto.Equal(
		accepted.Response,
		&chat.PublishMessageResponse{
			CommandId:           replayed.Response.CommandId,
			MessageId:           replayed.Response.MessageId,
			ConversationId:      replayed.Response.ConversationId,
			ConversationEventId: replayed.Response.ConversationEventId,
			EventSequence:       replayed.Response.EventSequence,
			Outcome:             accepted.Response.Outcome,
		},
	) {
		t.Fatalf(
			"replay changed committed identity: accepted=%v replayed=%v",
			accepted.Response,
			replayed.Response,
		)
	}
	assertPublishingEffects(t, harness.unitOfWork.snapshot(), 1, 1, 2)

	newSecret := "ptsec_rotated-credential"
	harness.unitOfWork.mutate(func(state *publishingTestState) {
		grant := state.grants[harness.grant.ID]
		grant.SecretHash = credential.Hash(newSecret)
		state.grants[grant.ID] = grant
	})
	if _, err := harness.publish(t, harness.secret, request); !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeUnauthorized,
	) {
		t.Fatalf("old credential error = %v, want unauthorized", err)
	}
	rotatedReplay, err := harness.publish(t, newSecret, request)
	if err != nil {
		t.Fatalf("rotated credential replay: %v", err)
	}
	if rotatedReplay.Response.MessageId != accepted.Response.MessageId ||
		rotatedReplay.Response.ConversationEventId != accepted.Response.ConversationEventId {
		t.Fatalf("rotated replay changed identity: %v", rotatedReplay.Response)
	}

	harness.unitOfWork.mutate(func(state *publishingTestState) {
		grant := state.grants[harness.grant.ID]
		grant.Revoked = true
		grant.SecretHash = ""
		state.grants[grant.ID] = grant
	})
	if _, err := harness.publish(t, newSecret, request); !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeUnauthorized,
	) {
		t.Fatalf("revoked credential replay error = %v, want unauthorized", err)
	}
	assertPublishingEffects(t, harness.unitOfWork.snapshot(), 1, 1, 2)
}

func TestPublishLostResponseAndConcurrentRetryConverge(t *testing.T) {
	harness := newPublishingHarness(t)
	request := publishTextRequest("command-lost-response", "artifact ready")
	harness.unitOfWork.failAfterCommit = true

	if _, err := harness.publish(t, harness.secret, request); err == nil {
		t.Fatal("first publish must simulate a lost response after commit")
	}
	replayed, err := harness.publish(t, harness.secret, request)
	if err != nil {
		t.Fatalf("retry after lost response: %v", err)
	}
	if replayed.Response.GetOutcome() !=
		chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_REPLAYED {
		t.Fatalf("retry outcome = %v", replayed.Response.GetOutcome())
	}
	assertPublishingEffects(t, harness.unitOfWork.snapshot(), 1, 1, 2)

	concurrent := newPublishingHarness(t)
	concurrentRequest := publishTextRequest("command-concurrent", "deploy complete")
	type outcome struct {
		result Result
		err    error
	}
	start := make(chan struct{})
	results := make(chan outcome, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			result, err := concurrent.service.Publish(
				context.Background(),
				concurrent.grant.ID,
				concurrent.secret,
				concurrentRequest.CommandId,
				concurrentRequest,
			)
			results <- outcome{result: result, err: err}
		}()
	}
	close(start)
	first := <-results
	second := <-results
	for _, result := range []outcome{first, second} {
		if result.err != nil {
			t.Fatalf("concurrent publish: %v", result.err)
		}
	}
	outcomes := map[chat.PublishMessageOutcome]int{
		first.result.Response.Outcome:  1,
		second.result.Response.Outcome: 1,
	}
	if outcomes[chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_ACCEPTED] != 1 ||
		outcomes[chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_REPLAYED] != 1 {
		t.Fatalf("concurrent outcomes = %v", outcomes)
	}
	if first.result.Response.MessageId != second.result.Response.MessageId ||
		first.result.Response.ConversationEventId != second.result.Response.ConversationEventId {
		t.Fatalf("concurrent identities diverged: %v / %v", first.result.Response, second.result.Response)
	}
	assertPublishingEffects(t, concurrent.unitOfWork.snapshot(), 1, 1, 2)
}

func TestPublishRejectsChangedReplayAndPreservesOriginalDefaultTarget(t *testing.T) {
	harness := newPublishingHarness(t)
	request := publishTextRequest("command-default", "first")
	accepted, err := harness.publish(t, harness.secret, request)
	if err != nil {
		t.Fatalf("accepted publish: %v", err)
	}

	changed := publishTextRequest(request.CommandId, "changed")
	if _, err := harness.publish(t, harness.secret, changed); !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeCommandConflict,
	) {
		t.Fatalf("changed replay error = %v, want conflict", err)
	}
	assertPublishingEffects(t, harness.unitOfWork.snapshot(), 1, 1, 2)

	otherTarget := valueobject.ConversationID("conversation-future-default")
	harness.unitOfWork.mutate(func(state *publishingTestState) {
		grant := state.grants[harness.grant.ID]
		grant.DefaultTarget = otherTarget
		grant.AllowedTargets = append(grant.AllowedTargets, otherTarget)
		state.grants[grant.ID] = grant
	})
	replayed, err := harness.publish(t, harness.secret, request)
	if err != nil {
		t.Fatalf("replay after default change: %v", err)
	}
	if replayed.Response.ConversationId != accepted.Response.ConversationId ||
		replayed.Response.ConversationId != string(harness.conversation) {
		t.Fatalf(
			"replay target = %q, want original %q",
			replayed.Response.ConversationId,
			harness.conversation,
		)
	}
}

func TestPublishNotificationSuppressionAndFailureRollback(t *testing.T) {
	suppressed := newPublishingHarness(t)
	suppressed.unitOfWork.mutate(func(state *publishingTestState) {
		state.suppressNotification = true
	})
	result, err := suppressed.publish(
		t,
		suppressed.secret,
		publishTextRequest("command-muted", "quiet update"),
	)
	if err != nil {
		t.Fatalf("suppressed publish: %v", err)
	}
	if result.NotificationWake != nil {
		t.Fatal("suppressed notification returned a wake")
	}
	assertPublishingEffects(t, suppressed.unitOfWork.snapshot(), 1, 0, 2)

	rolledBack := newPublishingHarness(t)
	rolledBack.unitOfWork.mutate(func(state *publishingTestState) {
		state.notificationError = errors.New("notification insert failed")
	})
	if _, err := rolledBack.publish(
		t,
		rolledBack.secret,
		publishTextRequest("command-rollback", "must rollback"),
	); err == nil {
		t.Fatal("notification failure must fail the publication transaction")
	}
	state := rolledBack.unitOfWork.snapshot()
	assertPublishingEffects(t, state, 0, 0, 0)
	if len(state.authorities) != 0 || len(state.events) != 0 ||
		len(state.commandReceipts) != 0 || len(state.commitments) != 0 {
		t.Fatalf("failed transaction leaked Conversation effects: %+v", state)
	}
}

func TestPublishCommitsSupportedContentAndAuthoritativeAttachmentMetadata(t *testing.T) {
	harness := newPublishingHarness(t)
	harness.unitOfWork.mutate(func(state *publishingTestState) {
		state.objects["object-report"] = ports.PublishedObject{
			ID:        "object-report",
			Filename:  "report.pdf",
			MediaType: "application/pdf",
			Size:      2048,
		}
	})
	eventRequest := &chat.PublishMessageRequest{
		CommandId: "command-event",
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Event{
				Event: &chat.StructuredEventContent{
					EventType: "ci.build.completed",
					Title:     "Build complete",
					Body:      "All checks passed",
					Severity:  chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_INFO,
					Subject: &chat.EventSubject{
						Kind:        "build",
						Id:          "build-42",
						ExecutionId: "execution-7",
					},
					Detail: &chat.StructuredEventContent_TaskState{
						TaskState: &chat.TaskStateUpdate{
							Revision: 1,
							State:    chat.ReportedTaskState_REPORTED_TASK_STATE_COMPLETED,
						},
					},
					Actions: []*chat.MessageOpenUrlAction{{
						Label: "Open build",
						Url:   "https://ci.example.test/build/42",
					}},
				},
			},
		},
	}
	eventResult, err := harness.publish(t, harness.secret, eventRequest)
	if err != nil {
		t.Fatalf("event publish: %v", err)
	}
	if eventResult.NotificationWake == nil ||
		eventResult.NotificationWake.NotificationType != NotificationTypeTaskEvent {
		t.Fatalf("event notification wake = %+v", eventResult.NotificationWake)
	}

	cardRequest := &chat.PublishMessageRequest{
		CommandId: "command-card",
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Card{
				Card: &chat.MessageCardContent{
					Title: "Review requested",
					Body:  "Change 123 is ready",
					Actions: []*chat.MessageOpenUrlAction{{
						Label: "Open review",
						Url:   "https://review.example.test/123",
					}},
				},
			},
		},
	}
	if _, err := harness.publish(t, harness.secret, cardRequest); err != nil {
		t.Fatalf("card publish: %v", err)
	}

	attachmentRequest := publishTextRequest("command-attachment", "report attached")
	attachmentRequest.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId:  "object-report",
		Filename:  "untrusted.txt",
		MediaType: "text/plain",
		Size:      1,
	}}
	if _, err := harness.publish(t, harness.secret, attachmentRequest); err != nil {
		t.Fatalf("attachment publish: %v", err)
	}

	state := harness.unitOfWork.snapshot()
	assertPublishingEffects(t, state, 3, 3, 4)
	var serviceDelivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(state.inbox[len(state.inbox)-1].OpaquePayload, &serviceDelivery); err != nil {
		t.Fatalf("decode service delivery: %v", err)
	}
	var payload chat.DirectServicePlaintextPayload
	if err := proto.Unmarshal(serviceDelivery.EndpointPayload, &payload); err != nil {
		t.Fatalf("decode service payload: %v", err)
	}
	attachment := payload.MessageContent.Attachments[0]
	if attachment.Filename != "report.pdf" ||
		attachment.MediaType != "application/pdf" ||
		attachment.Size != 2048 {
		t.Fatalf("attachment metadata = %+v, want authoritative object metadata", attachment)
	}

	before := harness.unitOfWork.snapshot()
	unauthorized := publishTextRequest("command-unauthorized-object", "private attachment")
	unauthorized.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId: "object-private",
	}}
	if _, err := harness.publish(t, harness.secret, unauthorized); !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeUnauthorized,
	) {
		t.Fatalf("unauthorized object error = %v", err)
	}
	after := harness.unitOfWork.snapshot()
	assertPublishingEffects(
		t,
		after,
		len(before.publications),
		len(before.notifications),
		len(before.inbox),
	)
}
