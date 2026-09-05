package application_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	mpW14CAuthorityStation = "station:authority"
	mpW14CLocalStation     = "station:follower"
	mpW14CAuthorityKey     = "authority-key"
	mpW14CConversationID   = "conversation-mp-w14-c"
)

type mpW14CReplayClient struct {
	fetch func(
		context.Context,
		string,
		string,
		*chat.GetMessagingFollowerEventsRequest,
	) (*chat.MessagingFollowerEventsPage, error)
}

func (c mpW14CReplayClient) FetchFollowerEvents(
	ctx context.Context,
	authorityStationID string,
	expectedSigningKeyID string,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	if c.fetch != nil {
		return c.fetch(ctx, authorityStationID, expectedSigningKeyID, request)
	}
	return &chat.MessagingFollowerEventsPage{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		AuthorityStationId:  authorityStationID,
		TargetHomeStationId: request.TargetHomeStationId,
		ConversationId:      request.ConversationId,
		RequestNonce:        append([]byte(nil), request.RequestNonce...),
		NextSequence:        request.AfterSequence,
	}, nil
}

type mpW14CObservingInboxUOW struct {
	delegate  messaging.FederationInboxUnitOfWork
	beforeACK func(
		*chat.MessagingFederationFrame,
		messaging.FederationInboxRepositories,
	)
}

func (u *mpW14CObservingInboxUOW) MatchFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) (bool, error) {
	return u.delegate.MatchFederationFrame(ctx, frame)
}

func (u *mpW14CObservingInboxUOW) IngestFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	receivedAt time.Time,
	fn func(messaging.FederationInboxRepositories) (messaging.FederationInboxMutation, error),
) (bool, bool, error) {
	return u.delegate.IngestFederationFrame(
		ctx,
		frame,
		receivedAt,
		func(repositories messaging.FederationInboxRepositories) (
			messaging.FederationInboxMutation,
			error,
		) {
			mutation, err := fn(repositories)
			if err == nil && mutation.Acknowledge && u.beforeACK != nil {
				u.beforeACK(frame, repositories)
			}
			return mutation, err
		},
	)
}

func (u *mpW14CObservingInboxUOW) ExecuteFollower(
	ctx context.Context,
	fn func(messaging.FollowerRepository) error,
) error {
	return u.delegate.ExecuteFollower(ctx, fn)
}

type mpW14CHeadConflictRepository struct {
	messaging.FollowerRepository
	remaining *int
}

func (r *mpW14CHeadConflictRepository) AdvanceConversationHead(
	ctx context.Context,
	expectedSequence int64,
	expectedEventHash []byte,
	next *messaging.FollowerConversation,
) error {
	if r.remaining != nil && *r.remaining > 0 {
		*r.remaining = *r.remaining - 1
		return messaging.ErrFollowerHeadConflict
	}
	return r.FollowerRepository.AdvanceConversationHead(
		ctx,
		expectedSequence,
		expectedEventHash,
		next,
	)
}

type mpW14CHeadConflictUOW struct {
	delegate               messaging.FederationInboxUnitOfWork
	ingestAdvanceConflicts int
	replayAdvanceConflicts int
}

func (u *mpW14CHeadConflictUOW) MatchFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) (bool, error) {
	return u.delegate.MatchFederationFrame(ctx, frame)
}

func (u *mpW14CHeadConflictUOW) IngestFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	receivedAt time.Time,
	fn func(messaging.FederationInboxRepositories) (messaging.FederationInboxMutation, error),
) (bool, bool, error) {
	return u.delegate.IngestFederationFrame(
		ctx,
		frame,
		receivedAt,
		func(repositories messaging.FederationInboxRepositories) (
			messaging.FederationInboxMutation,
			error,
		) {
			repositories.Follower = &mpW14CHeadConflictRepository{
				FollowerRepository: repositories.Follower,
				remaining:          &u.ingestAdvanceConflicts,
			}
			return fn(repositories)
		},
	)
}

func (u *mpW14CHeadConflictUOW) ExecuteFollower(
	ctx context.Context,
	fn func(messaging.FollowerRepository) error,
) error {
	return u.delegate.ExecuteFollower(
		ctx,
		func(repository messaging.FollowerRepository) error {
			return fn(&mpW14CHeadConflictRepository{
				FollowerRepository: repository,
				remaining:          &u.replayAdvanceConflicts,
			})
		},
	)
}

type mpW14CProjectionFixture struct {
	db         *gorm.DB
	repository *infrastructure.FollowerRepository
	unitOfWork messaging.FederationInboxUnitOfWork
	service    *application.FollowerProjectionService
	now        time.Time
}

func newMPW14CProjectionFixture(
	t *testing.T,
	replayClient messaging.FollowerReplayClient,
	beforeACK func(
		*chat.MessagingFederationFrame,
		messaging.FederationInboxRepositories,
	),
	decorators ...func(
		messaging.FederationInboxUnitOfWork,
	) messaging.FederationInboxUnitOfWork,
) *mpW14CProjectionFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:mp-w14-c-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	baseUOW := infrastructure.NewFederationInboxUnitOfWork(
		db,
		messaging.QueueLimits{
			MaxUnackedItems: 1_000,
			MaxUnackedBytes: 64 << 20,
		},
	)
	if err := baseUOW.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	repository, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	var unitOfWork messaging.FederationInboxUnitOfWork = baseUOW
	for _, decorate := range decorators {
		unitOfWork = decorate(unitOfWork)
	}
	if beforeACK != nil {
		unitOfWork = &mpW14CObservingInboxUOW{
			delegate:  unitOfWork,
			beforeACK: beforeACK,
		}
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	service := mpW14CNewProjectionService(
		t,
		unitOfWork,
		repository,
		replayClient,
		now,
	)
	return &mpW14CProjectionFixture{
		db:         db,
		repository: repository,
		unitOfWork: unitOfWork,
		service:    service,
		now:        now,
	}
}

func mpW14CNewProjectionService(
	t *testing.T,
	unitOfWork messaging.FederationInboxUnitOfWork,
	repository messaging.FollowerRepository,
	replayClient messaging.FollowerReplayClient,
	now time.Time,
) *application.FollowerProjectionService {
	t.Helper()
	return mpW14CNewProjectionServiceWithTrust(
		t,
		unitOfWork,
		repository,
		replayClient,
		messaging.FederationPeerTrustResolveFunc(
			func(context.Context, string, string) error {
				return nil
			},
		),
		now,
	)
}

func mpW14CNewProjectionServiceWithTrust(
	t *testing.T,
	unitOfWork messaging.FederationInboxUnitOfWork,
	repository messaging.FollowerRepository,
	replayClient messaging.FollowerReplayClient,
	peerTrust messaging.FederationPeerTrustResolver,
	now time.Time,
) *application.FollowerProjectionService {
	t.Helper()
	if replayClient == nil {
		replayClient = mpW14CReplayClient{}
	}
	service, err := application.NewFollowerProjectionService(
		unitOfWork,
		repository,
		replayClient,
		peerTrust,
		mpW14CLocalStation,
		application.FollowerProjectionPolicy{
			MaxPendingEvents: 128,
			MaxPendingBytes:  4 << 20,
			PendingTTL:       10 * time.Minute,
			ReplayPageLimit:  128,
		},
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func TestFollowerProjectionServiceDeliverProjection(t *testing.T) {
	t.Run("create apply ordinary event and exact duplicate", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		createFrame := mpW14CProjectionFrame(t, created, "frame:create")

		response, err := fixture.service.DeliverProjection(
			context.Background(),
			createFrame,
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || response.Duplicate {
			t.Fatalf("create response = %+v", response)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		members := mpW14CRequireMembers(t, fixture.repository)
		if conversation.CurrentSequence != 1 ||
			conversation.State != messaging.FollowerConversationStateActive ||
			len(members) != 2 ||
			!mpW14CMemberActive(members, "ptid:bob") {
			t.Fatalf("created projection: conversation=%+v members=%+v", conversation, members)
		}

		updated := mpW14COrdinaryEvent(t, 2, created.EventHash, fixture.now)
		updateFrame := mpW14CProjectionFrame(t, updated, "frame:update")
		response, err = fixture.service.DeliverProjection(
			context.Background(),
			updateFrame,
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || response.Duplicate {
			t.Fatalf("ordinary response = %+v", response)
		}
		conversation = mpW14CRequireConversation(t, fixture.repository)
		if conversation.CurrentSequence != 2 ||
			!bytes.Equal(conversation.CurrentEventHash, updated.EventHash) {
			t.Fatalf("ordinary event did not advance follower head: %+v", conversation)
		}

		response, err = fixture.service.DeliverProjection(
			context.Background(),
			updateFrame,
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || !response.Duplicate {
			t.Fatalf("duplicate response = %+v", response)
		}
	})

	t.Run("gap buffers and drains in authority order", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		second := mpW14COrdinaryEvent(t, 2, created.EventHash, fixture.now)
		third := mpW14COrdinaryEvent(t, 3, second.EventHash, fixture.now)

		mpW14CDeliverProjection(t, fixture.service, third, "frame:third", fixture.now)
		conversation := mpW14CRequireConversation(t, fixture.repository)
		pending, err := fixture.repository.ListPendingEvents(
			context.Background(),
			mpW14CConversationID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if conversation.CurrentSequence != 1 ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync ||
			len(pending) != 1 ||
			pending[0].EventID != third.EventId {
			t.Fatalf("gap state: conversation=%+v pending=%+v", conversation, pending)
		}

		mpW14CDeliverProjection(t, fixture.service, second, "frame:second", fixture.now)
		conversation = mpW14CRequireConversation(t, fixture.repository)
		pending, err = fixture.repository.ListPendingEvents(
			context.Background(),
			mpW14CConversationID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if conversation.CurrentSequence != 3 ||
			!bytes.Equal(conversation.CurrentEventHash, third.EventHash) ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync ||
			len(pending) != 0 {
			t.Fatalf("drained state: conversation=%+v pending=%+v", conversation, pending)
		}
		if err := fixture.service.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		); err != nil {
			t.Fatal(err)
		}
		conversation = mpW14CRequireConversation(t, fixture.repository)
		if conversation.State != messaging.FollowerConversationStateActive {
			t.Fatalf("replay completion state = %q", conversation.State)
		}
	})

	t.Run("sequence collision enters fork protection without ACK", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		conflict := mpW14CCreatedEvent(t, fixture.now)
		conflict.EventId = "event:conflict"
		conflict.CommandId = "command:conflict"
		mpW14CSealEvent(t, conflict)

		_, err := fixture.service.DeliverProjection(
			context.Background(),
			mpW14CProjectionFrame(t, conflict, "frame:conflict"),
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if !errors.Is(err, messaging.ErrFollowerFork) {
			t.Fatalf("fork error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conversation.State != messaging.FollowerConversationStateForkProtectedReadOnly {
			t.Fatalf("fork state = %q", conversation.State)
		}
		if count := mpW14CInboxCount(t, fixture.db); count != 1 {
			t.Fatalf("acknowledged inbox rows = %d, want 1", count)
		}
	})

	t.Run("removal is durable before frame acknowledgement", func(t *testing.T) {
		var observed bool
		var observationErr error
		fixture := newMPW14CProjectionFixture(
			t,
			nil,
			func(
				frame *chat.MessagingFederationFrame,
				repositories messaging.FederationInboxRepositories,
			) {
				if frame.EventId != "event:remove" {
					return
				}
				members, err := repositories.Follower.ListMembers(
					context.Background(),
					mpW14CConversationID,
				)
				if err != nil {
					observationErr = err
					return
				}
				observed = !mpW14CMemberActive(members, "ptid:bob")
			},
		)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		removed := mpW14CRemovalEvent(t, created.EventHash, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, removed, "frame:remove", fixture.now)

		if observationErr != nil {
			t.Fatal(observationErr)
		}
		if !observed {
			t.Fatal("removed member was still active when ACK became eligible")
		}
		members := mpW14CRequireMembers(t, fixture.repository)
		if mpW14CMemberActive(members, "ptid:bob") {
			t.Fatalf("removed member remained active: %+v", members)
		}
	})

	t.Run("gapped removal waits for durable revocation before acknowledgement", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		second := mpW14COrdinaryEvent(t, 2, created.EventHash, fixture.now)
		removed := mpW14CRemovalEventAt(t, 3, second.EventHash, fixture.now)
		removalFrame := mpW14CProjectionFrame(t, removed, "frame:remove")

		if _, err := fixture.service.DeliverProjection(
			context.Background(),
			removalFrame,
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		); !errors.Is(err, messaging.ErrFollowerGap) {
			t.Fatalf("gapped removal error = %v", err)
		}
		if !mpW14CMemberActive(mpW14CRequireMembers(t, fixture.repository), "ptid:bob") {
			t.Fatal("gapped removal revoked membership before its predecessor")
		}
		if count := mpW14CInboxCount(t, fixture.db); count != 1 {
			t.Fatalf("gapped removal inbox count = %d, want only create ACK", count)
		}

		mpW14CDeliverProjection(
			t,
			fixture.service,
			second,
			"frame:second",
			fixture.now,
		)
		if mpW14CMemberActive(mpW14CRequireMembers(t, fixture.repository), "ptid:bob") {
			t.Fatal("pending removal was not applied after its predecessor")
		}
		response, err := fixture.service.DeliverProjection(
			context.Background(),
			removalFrame,
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || response.Duplicate {
			t.Fatalf("removal retry response = %+v", response)
		}
	})

	t.Run("live head staleness reloads instead of forking", func(t *testing.T) {
		conflicts := &mpW14CHeadConflictUOW{ingestAdvanceConflicts: 1}
		fixture := newMPW14CProjectionFixture(
			t,
			nil,
			nil,
			func(
				delegate messaging.FederationInboxUnitOfWork,
			) messaging.FederationInboxUnitOfWork {
				conflicts.delegate = delegate
				return conflicts
			},
		)
		created := mpW14CCreatedEvent(t, fixture.now)

		mpW14CDeliverProjection(
			t,
			fixture.service,
			created,
			"frame:create",
			fixture.now,
		)
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conflicts.ingestAdvanceConflicts != 0 ||
			conversation.State != messaging.FollowerConversationStateActive ||
			conversation.CurrentSequence != created.Sequence {
			t.Fatalf(
				"live stale retry: conflicts=%d conversation=%+v",
				conflicts.ingestAdvanceConflicts,
				conversation,
			)
		}
	})

	t.Run("event quota rejects an additional future event", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		mpW14CSeedPending(t, fixture.repository, 128, []byte("pending"), fixture.now.Add(time.Hour))
		future := mpW14COrdinaryEvent(
			t,
			1_000,
			bytes.Repeat([]byte{9}, sha256.Size),
			fixture.now,
		)

		_, err := fixture.service.DeliverProjection(
			context.Background(),
			mpW14CProjectionFrame(t, future, "frame:event-quota"),
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if !errors.Is(err, messaging.ErrFollowerBufferOverloaded) {
			t.Fatalf("event quota error = %v", err)
		}
	})

	t.Run("byte quota rejects an additional future event", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		mpW14CSeedPending(
			t,
			fixture.repository,
			1,
			bytes.Repeat([]byte{1}, 4<<20),
			fixture.now.Add(time.Hour),
		)
		future := mpW14COrdinaryEvent(
			t,
			1_000,
			bytes.Repeat([]byte{9}, sha256.Size),
			fixture.now,
		)

		_, err := fixture.service.DeliverProjection(
			context.Background(),
			mpW14CProjectionFrame(t, future, "frame:byte-quota"),
			make(ed25519.PublicKey, ed25519.PublicKeySize),
			fixture.now,
		)
		if !errors.Is(err, messaging.ErrFollowerBufferOverloaded) {
			t.Fatalf("byte quota error = %v", err)
		}
	})

	t.Run("expired entries are removed before quota admission", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		mpW14CSeedPending(t, fixture.repository, 128, []byte("expired"), fixture.now)
		future := mpW14COrdinaryEvent(
			t,
			1_000,
			bytes.Repeat([]byte{9}, sha256.Size),
			fixture.now,
		)

		mpW14CDeliverProjection(
			t,
			fixture.service,
			future,
			"frame:expiry-cleanup",
			fixture.now,
		)
		pending, err := fixture.repository.ListPendingEvents(
			context.Background(),
			mpW14CConversationID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(pending) != 1 || pending[0].EventID != future.EventId {
			t.Fatalf("pending after expiry cleanup = %+v", pending)
		}
	})
}

func TestFollowerProjectionServiceIngestDeviceEventFrame(t *testing.T) {
	t.Run("device first persists no follower authority state", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		event := mpW14CCreatedEvent(t, fixture.now)
		deviceFrame := mpW14CRawFrame(event, "frame:device")
		enqueueCalls := 0
		enqueue := func(messaging.FederationInboxRepositories) error {
			enqueueCalls++
			return nil
		}

		if _, err := fixture.service.IngestDeviceEventFrame(
			context.Background(),
			deviceFrame,
			event,
			enqueue,
			fixture.now,
		); !errors.Is(err, messaging.ErrFollowerGap) {
			t.Fatalf("device-before-projection error = %v", err)
		}
		if enqueueCalls != 0 || mpW14CInboxCount(t, fixture.db) != 0 {
			t.Fatalf(
				"device-before-projection committed: enqueue=%d inbox=%d",
				enqueueCalls,
				mpW14CInboxCount(t, fixture.db),
			)
		}
		if _, err := fixture.repository.GetConversation(
			context.Background(),
			event.ConversationId,
		); !errors.Is(err, messaging.ErrNotFound) {
			t.Fatalf("device-first follower conversation error = %v", err)
		}

		mpW14CDeliverProjection(
			t,
			fixture.service,
			event,
			"frame:projection",
			fixture.now,
		)
		response, err := fixture.service.IngestDeviceEventFrame(
			context.Background(),
			deviceFrame,
			event,
			enqueue,
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || response.Duplicate || enqueueCalls != 1 {
			t.Fatalf("device retry response=%+v enqueue=%d", response, enqueueCalls)
		}

		response, err = fixture.service.IngestDeviceEventFrame(
			context.Background(),
			deviceFrame,
			event,
			enqueue,
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !response.Accepted || !response.Duplicate || enqueueCalls != 1 {
			t.Fatalf("device duplicate response=%+v enqueue=%d", response, enqueueCalls)
		}
	})

	t.Run("device initial checkpoint cannot bypass independent authority trust", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		trustErr := errors.New("authority owner trust rejected")
		service := mpW14CNewProjectionServiceWithTrust(
			t,
			fixture.unitOfWork,
			fixture.repository,
			nil,
			messaging.FederationPeerTrustResolveFunc(
				func(context.Context, string, string) error {
					return trustErr
				},
			),
			fixture.now,
		)
		future := mpW14COrdinaryEvent(
			t,
			2,
			bytes.Repeat([]byte{9}, sha256.Size),
			fixture.now,
		)
		mpW14CDeliverProjection(
			t,
			service,
			future,
			"frame:future-before-device",
			fixture.now,
		)
		created := mpW14CCreatedEvent(t, fixture.now)
		enqueueCalls := 0

		if _, err := service.IngestDeviceEventFrame(
			context.Background(),
			mpW14CRawFrame(created, "frame:device-create"),
			created,
			func(messaging.FederationInboxRepositories) error {
				enqueueCalls++
				return nil
			},
			fixture.now,
		); !errors.Is(err, trustErr) {
			t.Fatalf("device initial checkpoint trust error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if enqueueCalls != 0 ||
			conversation.CurrentSequence != 0 ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync {
			t.Fatalf(
				"device bypassed authority trust: enqueue=%d conversation=%+v",
				enqueueCalls,
				conversation,
			)
		}
	})

	t.Run("exact next applies public event and opaque queue row atomically", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		next := mpW14COrdinaryEvent(t, 2, created.EventHash, fixture.now)
		deviceFrame := mpW14CRawFrame(next, "frame:device-next")
		privatePayload := []byte{0xff, 0x00, 0xfe}
		privatePayloadHash := sha256.Sum256(privatePayload)

		response, err := fixture.service.IngestDeviceEventFrame(
			context.Background(),
			deviceFrame,
			next,
			func(repositories messaging.FederationInboxRepositories) error {
				_, err := repositories.Queue.Enqueue(
					context.Background(),
					&chat.DeviceQueueItem{
						Recipient: &chat.CryptoEndpoint{
							Ptid:     "ptid:bob",
							DeviceId: "device:bob",
						},
						EventId:        next.EventId,
						ConversationId: next.ConversationId,
						IdempotencyKey: "device-next:ptid:bob:device:bob",
						PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_CONVERSATION_EVENT,
						OpaquePayload:  privatePayload,
						PayloadSha256:  privatePayloadHash[:],
					},
				)
				return err
			},
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if !response.Accepted ||
			conversation.CurrentSequence != next.Sequence ||
			!bytes.Equal(conversation.CurrentEventHash, next.EventHash) {
			t.Fatalf("exact-next response=%+v conversation=%+v", response, conversation)
		}
		var queueRows []infrastructure.DeviceQueueItemModel
		if err := fixture.db.Find(&queueRows).Error; err != nil {
			t.Fatal(err)
		}
		if len(queueRows) != 1 ||
			!bytes.Equal(queueRows[0].OpaquePayload, privatePayload) {
			t.Fatalf("opaque queue rows = %+v", queueRows)
		}
	})

	t.Run("exact next rolls back public event when queue write fails", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(t, nil, nil)
		created := mpW14CCreatedEvent(t, fixture.now)
		mpW14CDeliverProjection(t, fixture.service, created, "frame:create", fixture.now)
		next := mpW14COrdinaryEvent(t, 2, created.EventHash, fixture.now)
		enqueueErr := errors.New("queue write failed")

		if _, err := fixture.service.IngestDeviceEventFrame(
			context.Background(),
			mpW14CRawFrame(next, "frame:device-next"),
			next,
			func(messaging.FederationInboxRepositories) error {
				return enqueueErr
			},
			fixture.now,
		); !errors.Is(err, enqueueErr) {
			t.Fatalf("queue failure error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conversation.CurrentSequence != created.Sequence ||
			!bytes.Equal(conversation.CurrentEventHash, created.EventHash) {
			t.Fatalf("public event escaped queue rollback: %+v", conversation)
		}
		if _, err := fixture.repository.GetEventReceipt(
			context.Background(),
			next.ConversationId,
			next.Sequence,
		); !errors.Is(err, messaging.ErrNotFound) {
			t.Fatalf("rolled-back event receipt error = %v", err)
		}
	})
}

func TestFollowerProjectionServiceReconcileConversation(t *testing.T) {
	t.Run("source unavailable stays read only", func(t *testing.T) {
		fixture := newMPW14CProjectionFixture(
			t,
			mpW14CReplayClient{
				fetch: func(
					context.Context,
					string,
					string,
					*chat.GetMessagingFollowerEventsRequest,
				) (*chat.MessagingFollowerEventsPage, error) {
					return nil, messaging.ErrFollowerReplayUnavailable
				},
			},
			nil,
		)
		future := mpW14COrdinaryEvent(
			t,
			2,
			bytes.Repeat([]byte{9}, sha256.Size),
			fixture.now,
		)
		mpW14CDeliverProjection(
			t,
			fixture.service,
			future,
			"frame:future",
			fixture.now,
		)

		err := fixture.service.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		)
		if !errors.Is(err, messaging.ErrFollowerReplayUnavailable) {
			t.Fatalf("reconcile error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conversation.State != messaging.FollowerConversationStateResyncUnavailableReadOnly {
			t.Fatalf("source-loss state = %q", conversation.State)
		}
	})

	t.Run("pagination stays closed across interruption and restart", func(t *testing.T) {
		interrupted := errors.New("simulated replay interruption")
		created := mpW14CCreatedEvent(t, time.Unix(1_800_000_000, 0).UTC())
		second := mpW14COrdinaryEvent(t, 2, created.EventHash, created.CommittedAt.AsTime())
		calls := 0
		var fixture *mpW14CProjectionFixture
		fixture = newMPW14CProjectionFixture(
			t,
			mpW14CReplayClient{
				fetch: func(
					_ context.Context,
					_ string,
					_ string,
					request *chat.GetMessagingFollowerEventsRequest,
				) (*chat.MessagingFollowerEventsPage, error) {
					calls++
					if calls == 1 {
						return mpW14CReplayPage(request, true, created), nil
					}
					conversation := mpW14CRequireConversation(t, fixture.repository)
					if conversation.State !=
						messaging.FollowerConversationStateGapWaitingResync {
						t.Fatalf("state between replay pages = %q", conversation.State)
					}
					return nil, interrupted
				},
			},
			nil,
		)
		mpW14CSeedGapConversation(t, fixture.repository, fixture.now)

		if err := fixture.service.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		); !errors.Is(err, interrupted) {
			t.Fatalf("interrupted replay error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conversation.CurrentSequence != created.Sequence ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync {
			t.Fatalf("interrupted replay state = %+v", conversation)
		}
		third := mpW14COrdinaryEvent(t, 3, second.EventHash, fixture.now)
		mpW14CStorePendingEvent(
			t,
			fixture.repository,
			third,
			fixture.now.Add(time.Hour),
		)
		response, err := fixture.service.IngestDeviceEventFrame(
			context.Background(),
			mpW14CRawFrame(second, "frame:device-second"),
			second,
			func(messaging.FederationInboxRepositories) error { return nil },
			fixture.now,
		)
		if err != nil {
			t.Fatal(err)
		}
		conversation = mpW14CRequireConversation(t, fixture.repository)
		if !response.Accepted ||
			conversation.CurrentSequence != third.Sequence ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync {
			t.Fatalf(
				"device interleave response=%+v conversation=%+v",
				response,
				conversation,
			)
		}

		restarted := mpW14CNewProjectionService(
			t,
			fixture.unitOfWork,
			fixture.repository,
			mpW14CReplayClient{
				fetch: func(
					_ context.Context,
					_ string,
					_ string,
					request *chat.GetMessagingFollowerEventsRequest,
				) (*chat.MessagingFollowerEventsPage, error) {
					if request.AfterSequence != third.Sequence ||
						!bytes.Equal(request.AfterEventHash, third.EventHash) {
						t.Fatalf("restart replay request = %+v", request)
					}
					return mpW14CReplayPage(request, false), nil
				},
			},
			fixture.now,
		)
		if err := restarted.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		); err != nil {
			t.Fatal(err)
		}
		conversation = mpW14CRequireConversation(t, fixture.repository)
		pending, err := fixture.repository.ListPendingEvents(
			context.Background(),
			mpW14CConversationID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if conversation.CurrentSequence != third.Sequence ||
			conversation.State != messaging.FollowerConversationStateActive ||
			len(pending) != 0 {
			t.Fatalf(
				"restart convergence: conversation=%+v pending=%+v",
				conversation,
				pending,
			)
		}
	})

	t.Run("final page remains closed when pending cannot drain", func(t *testing.T) {
		created := mpW14CCreatedEvent(t, time.Unix(1_800_000_000, 0).UTC())
		fixture := newMPW14CProjectionFixture(
			t,
			mpW14CReplayClient{
				fetch: func(
					_ context.Context,
					_ string,
					_ string,
					request *chat.GetMessagingFollowerEventsRequest,
				) (*chat.MessagingFollowerEventsPage, error) {
					return mpW14CReplayPage(request, false, created), nil
				},
			},
			nil,
		)
		mpW14CSeedGapConversation(t, fixture.repository, fixture.now)
		third := mpW14COrdinaryEvent(
			t,
			3,
			bytes.Repeat([]byte{3}, sha256.Size),
			fixture.now,
		)
		mpW14CStorePendingEvent(
			t,
			fixture.repository,
			third,
			fixture.now.Add(time.Hour),
		)

		if err := fixture.service.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		); !errors.Is(err, messaging.ErrFollowerGap) {
			t.Fatalf("undrained final-page error = %v", err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if conversation.State != messaging.FollowerConversationStateGapWaitingResync {
			t.Fatalf("undrained final-page state = %q", conversation.State)
		}
	})

	t.Run("replay head staleness reloads instead of forking", func(t *testing.T) {
		created := mpW14CCreatedEvent(t, time.Unix(1_800_000_000, 0).UTC())
		conflicts := &mpW14CHeadConflictUOW{replayAdvanceConflicts: 1}
		fetchCalls := 0
		fixture := newMPW14CProjectionFixture(
			t,
			mpW14CReplayClient{
				fetch: func(
					_ context.Context,
					_ string,
					_ string,
					request *chat.GetMessagingFollowerEventsRequest,
				) (*chat.MessagingFollowerEventsPage, error) {
					fetchCalls++
					return mpW14CReplayPage(request, false, created), nil
				},
			},
			nil,
			func(
				delegate messaging.FederationInboxUnitOfWork,
			) messaging.FederationInboxUnitOfWork {
				conflicts.delegate = delegate
				return conflicts
			},
		)
		mpW14CSeedGapConversation(t, fixture.repository, fixture.now)

		if err := fixture.service.ReconcileConversation(
			context.Background(),
			mpW14CConversationID,
		); err != nil {
			t.Fatal(err)
		}
		conversation := mpW14CRequireConversation(t, fixture.repository)
		if fetchCalls != 2 ||
			conflicts.replayAdvanceConflicts != 0 ||
			conversation.State != messaging.FollowerConversationStateActive {
			t.Fatalf(
				"replay stale retry: fetches=%d conflicts=%d conversation=%+v",
				fetchCalls,
				conflicts.replayAdvanceConflicts,
				conversation,
			)
		}
	})
}

func mpW14CDeliverProjection(
	t *testing.T,
	service *application.FollowerProjectionService,
	event *chat.ConversationEvent,
	frameID string,
	now time.Time,
) {
	t.Helper()
	response, err := service.DeliverProjection(
		context.Background(),
		mpW14CProjectionFrame(t, event, frameID),
		make(ed25519.PublicKey, ed25519.PublicKeySize),
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Accepted {
		t.Fatalf("projection response = %+v", response)
	}
}

func mpW14CCreatedEvent(t *testing.T, now time.Time) *chat.ConversationEvent {
	t.Helper()
	event := &chat.ConversationEvent{
		EventId:        "event:create",
		ConversationId: mpW14CConversationID,
		Sequence:       1,
		CommandId:      "command:create",
		Actor: &chat.CryptoEndpoint{
			Ptid:     "ptid:alice",
			DeviceId: "device:alice",
		},
		CommittedAt:        timestamppb.New(now),
		MembershipEpoch:    1,
		MlsEpoch:           1,
		AuthorityStationId: mpW14CAuthorityStation,
		Payload: &chat.ConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedFact{
				Kind:      chat.ConversationKind_CONVERSATION_KIND_GROUP,
				Name:      "MP-W14-C",
				OwnerPtid: "ptid:alice",
				Members: []*chat.ConversationAuthorityMember{
					{
						Ptid:          "ptid:alice",
						Role:          "owner",
						HomeStationId: mpW14CAuthorityStation,
					},
					{
						Ptid:          "ptid:bob",
						Role:          "member",
						HomeStationId: mpW14CLocalStation,
					},
				},
			},
		},
	}
	mpW14CSealEvent(t, event)
	return event
}

func mpW14COrdinaryEvent(
	t *testing.T,
	sequence int64,
	previousHash []byte,
	now time.Time,
) *chat.ConversationEvent {
	t.Helper()
	event := &chat.ConversationEvent{
		EventId:        fmt.Sprintf("event:%d", sequence),
		ConversationId: mpW14CConversationID,
		Sequence:       sequence,
		CommandId:      fmt.Sprintf("command:%d", sequence),
		Actor: &chat.CryptoEndpoint{
			Ptid:     "ptid:alice",
			DeviceId: "device:alice",
		},
		PreviousHash:       append([]byte(nil), previousHash...),
		CommittedAt:        timestamppb.New(now.Add(time.Duration(sequence) * time.Second)),
		MembershipEpoch:    1,
		MlsEpoch:           1,
		AuthorityStationId: mpW14CAuthorityStation,
		Payload: &chat.ConversationEvent_ConversationUpdated{
			ConversationUpdated: &chat.ConversationUpdatedFact{},
		},
	}
	mpW14CSealEvent(t, event)
	return event
}

func mpW14CRemovalEvent(
	t *testing.T,
	previousHash []byte,
	now time.Time,
) *chat.ConversationEvent {
	t.Helper()
	return mpW14CRemovalEventAt(t, 2, previousHash, now)
}

func mpW14CRemovalEventAt(
	t *testing.T,
	sequence int64,
	previousHash []byte,
	now time.Time,
) *chat.ConversationEvent {
	t.Helper()
	event := &chat.ConversationEvent{
		EventId:        "event:remove",
		ConversationId: mpW14CConversationID,
		Sequence:       sequence,
		CommandId:      "command:remove",
		Actor: &chat.CryptoEndpoint{
			Ptid:     "ptid:alice",
			DeviceId: "device:alice",
		},
		PreviousHash:       append([]byte(nil), previousHash...),
		CommittedAt:        timestamppb.New(now.Add(time.Duration(sequence) * time.Second)),
		MembershipEpoch:    2,
		MlsEpoch:           2,
		AuthorityStationId: mpW14CAuthorityStation,
		Payload: &chat.ConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedFact{
				TransitionId:        "transition:remove",
				FromMembershipEpoch: 1,
				ToMembershipEpoch:   2,
				FromMlsEpoch:        1,
				ToMlsEpoch:          2,
				Changes: []*chat.MessagingMembershipChangeCommitted{
					{
						Action:        chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR,
						Ptid:          "ptid:bob",
						HomeStationId: mpW14CLocalStation,
						Role:          "member",
					},
				},
				PostState: &chat.ConversationAuthoritySnapshot{
					Kind:      chat.ConversationKind_CONVERSATION_KIND_GROUP,
					Name:      "MP-W14-C",
					OwnerPtid: "ptid:alice",
					ActiveMembers: []*chat.ConversationAuthorityMember{
						{
							Ptid:          "ptid:alice",
							Role:          "owner",
							HomeStationId: mpW14CAuthorityStation,
						},
					},
					MembershipEpoch: 2,
					MlsEpoch:        2,
				},
			},
		},
	}
	mpW14CSealEvent(t, event)
	return event
}

func mpW14CReplayPage(
	request *chat.GetMessagingFollowerEventsRequest,
	hasMore bool,
	events ...*chat.ConversationEvent,
) *chat.MessagingFollowerEventsPage {
	grants := make([]*chat.MessagingEventProjectionGrant, 0, len(events))
	nextSequence := request.AfterSequence
	for _, event := range events {
		grants = append(grants, &chat.MessagingEventProjectionGrant{
			EventId:             event.EventId,
			TargetHomeStationId: request.TargetHomeStationId,
			EntitlementReason:   "member",
		})
		nextSequence = event.Sequence
	}
	return &chat.MessagingFollowerEventsPage{
		FormatVersion:         application.MessagingFollowerReplayFormatVersion,
		AuthorityStationId:    request.AuthorityStationId,
		TargetHomeStationId:   request.TargetHomeStationId,
		ConversationId:        request.ConversationId,
		RequestNonce:          append([]byte(nil), request.RequestNonce...),
		ConversationEvents:    events,
		EventProjectionGrants: grants,
		NextSequence:          nextSequence,
		HasMore:               hasMore,
	}
}

func mpW14CSeedGapConversation(
	t *testing.T,
	repository *infrastructure.FollowerRepository,
	now time.Time,
) {
	t.Helper()
	created, err := repository.CreateConversation(
		context.Background(),
		&messaging.FollowerConversation{
			ConversationID:        mpW14CConversationID,
			AuthorityStationID:    mpW14CAuthorityStation,
			AuthoritySigningKeyID: mpW14CAuthorityKey,
			State:                 messaging.FollowerConversationStateGapWaitingResync,
			UpdatedAt:             now,
		},
	)
	if err != nil || !created {
		t.Fatalf("seed gap conversation: created=%v err=%v", created, err)
	}
}

func mpW14CStorePendingEvent(
	t *testing.T,
	repository *infrastructure.FollowerRepository,
	event *chat.ConversationEvent,
	expiresAt time.Time,
) {
	t.Helper()
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.StorePendingEvent(
		context.Background(),
		&messaging.FollowerPendingEvent{
			ConversationID:   event.ConversationId,
			Sequence:         event.Sequence,
			EventID:          event.EventId,
			EventHash:        append([]byte(nil), event.EventHash...),
			PreviousHash:     append([]byte(nil), event.PreviousHash...),
			PublicEventBytes: eventBytes,
			ExpiresAt:        expiresAt,
		},
	); err != nil {
		t.Fatal(err)
	}
}

func mpW14CSealEvent(t *testing.T, event *chat.ConversationEvent) {
	t.Helper()
	input := proto.Clone(event).(*chat.ConversationEvent)
	input.EventHash = nil
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(eventBytes)
	event.EventHash = digest[:]
}

func mpW14CProjectionFrame(
	t *testing.T,
	event *chat.ConversationEvent,
	frameID string,
) *chat.MessagingFederationFrame {
	t.Helper()
	projectionBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.MessagingFollowerProjection{
			FormatVersion:       application.MessagingFollowerProjectionFormatVersion,
			AuthorityStationId:  mpW14CAuthorityStation,
			TargetHomeStationId: mpW14CLocalStation,
			ConversationEvent:   event,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	frame := mpW14CRawFrame(event, frameID)
	frame.PayloadType =
		chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION
	frame.OpaquePayload = projectionBytes
	payloadHash := sha256.Sum256(projectionBytes)
	frame.PayloadSha256 = payloadHash[:]
	return frame
}

func mpW14CRawFrame(
	event *chat.ConversationEvent,
	frameID string,
) *chat.MessagingFederationFrame {
	return &chat.MessagingFederationFrame{
		FormatVersion:     application.MessagingFederationFrameFormatVersion,
		FrameId:           frameID,
		SourceStationId:   mpW14CAuthorityStation,
		TargetStationId:   mpW14CLocalStation,
		IdempotencyKey:    frameID + ":idempotency",
		ConversationId:    event.ConversationId,
		EventId:           event.EventId,
		AuthoritySequence: event.Sequence,
		OpaquePayload:     []byte(frameID),
		PayloadSha256:     bytes.Repeat([]byte{1}, sha256.Size),
		SigningKeyId:      mpW14CAuthorityKey,
	}
}

func mpW14CRequireConversation(
	t *testing.T,
	repository *infrastructure.FollowerRepository,
) *messaging.FollowerConversation {
	t.Helper()
	conversation, err := repository.GetConversation(
		context.Background(),
		mpW14CConversationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	return conversation
}

func mpW14CRequireMembers(
	t *testing.T,
	repository *infrastructure.FollowerRepository,
) []messaging.FollowerMember {
	t.Helper()
	members, err := repository.ListMembers(
		context.Background(),
		mpW14CConversationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	return members
}

func mpW14CMemberActive(
	members []messaging.FollowerMember,
	ptid string,
) bool {
	for _, member := range members {
		if member.PTID == ptid {
			return member.Active
		}
	}
	return false
}

func mpW14CInboxCount(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&infrastructure.FederationInboxModel{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

func mpW14CSeedPending(
	t *testing.T,
	repository *infrastructure.FollowerRepository,
	count int,
	publicEventBytes []byte,
	expiresAt time.Time,
) {
	t.Helper()
	for index := 0; index < count; index++ {
		sequence := int64(index + 10)
		if err := repository.StorePendingEvent(
			context.Background(),
			&messaging.FollowerPendingEvent{
				ConversationID:   mpW14CConversationID,
				Sequence:         sequence,
				EventID:          fmt.Sprintf("pending:%d", index),
				EventHash:        bytes.Repeat([]byte{byte(index%251 + 1)}, sha256.Size),
				PreviousHash:     bytes.Repeat([]byte{byte((index+1)%251 + 1)}, sha256.Size),
				PublicEventBytes: append([]byte(nil), publicEventBytes...),
				ExpiresAt:        expiresAt,
			},
		); err != nil {
			t.Fatal(err)
		}
	}
}
