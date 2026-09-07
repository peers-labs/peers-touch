package query

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestServiceMessageQueriesRequireActiveMembership(t *testing.T) {
	events := &queryEventRepository{}
	service := newMessageQueryService(t, "ptid:alice", events)

	if _, err := service.ListMessages(
		context.Background(),
		"conversation-1",
		"ptid:mallory",
		0,
		50,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("ListMessages() error = %v, want unauthorized", err)
	}
	if _, err := service.ListThreadMessages(
		context.Background(),
		"conversation-1",
		"ptid:mallory",
		"thread-1",
		0,
		50,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("ListThreadMessages() error = %v, want unauthorized", err)
	}
	if _, err := service.ThreadCounts(
		context.Background(),
		"conversation-1",
		"ptid:mallory",
		[]valueobject.MessageID{"thread-1"},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("ThreadCounts() error = %v, want unauthorized", err)
	}
	if events.calls != 0 {
		t.Fatalf("event repository calls = %d, want 0 before authorization", events.calls)
	}
}

func TestServiceMessageQueriesDelegateCanonicalParameters(t *testing.T) {
	events := &queryEventRepository{
		messages: []domainevent.Record{{Sequence: 7}, {Sequence: 8}},
		threadMessages: []domainevent.Record{
			{Sequence: 11, Fact: domainevent.Fact{MessageID: "reply-11"}},
			{Sequence: 12, Fact: domainevent.Fact{MessageID: "reply-12"}},
		},
		counts: []repository.ThreadCount{{RootMessageID: "thread-a", ReplyCount: 2}},
	}
	service := newMessageQueryService(t, "ptid:alice", events)
	ctx := context.Background()

	messages, err := service.ListMessages(ctx, "conversation-1", "ptid:alice", 5, 1)
	if err != nil {
		t.Fatalf("ListMessages() error = %v", err)
	}
	if len(messages.Events) != 1 || messages.Events[0].Sequence != 7 || !messages.HasMore ||
		events.messagesAfter != 5 || events.messagesLimit != 2 {
		t.Fatalf(
			"ListMessages() = %+v, after=%d repository limit=%d",
			messages,
			events.messagesAfter,
			events.messagesLimit,
		)
	}

	threadMessages, err := service.ListThreadMessages(
		ctx,
		"conversation-1",
		"ptid:alice",
		"thread-a",
		9,
		1,
	)
	if err != nil {
		t.Fatalf("ListThreadMessages() error = %v", err)
	}
	if len(threadMessages.Events) != 1 || threadMessages.Events[0].Sequence != 11 ||
		!threadMessages.HasMore || events.threadRoot != "thread-a" ||
		events.threadAfter != 9 || events.threadLimit != 2 {
		t.Fatalf(
			"ListThreadMessages() = %+v, root=%s after=%d repository limit=%d",
			threadMessages,
			events.threadRoot,
			events.threadAfter,
			events.threadLimit,
		)
	}

	counts, err := service.ThreadCounts(
		ctx,
		"conversation-1",
		"ptid:alice",
		[]valueobject.MessageID{"thread-b", "thread-a", "thread-b"},
	)
	if err != nil {
		t.Fatalf("ThreadCounts() error = %v", err)
	}
	if len(counts) != 1 || counts[0].RootMessageID != "thread-a" {
		t.Fatalf("ThreadCounts() = %+v", counts)
	}
	if len(events.countRoots) != 2 ||
		events.countRoots[0] != "thread-a" ||
		events.countRoots[1] != "thread-b" {
		t.Fatalf("ThreadCounts() roots = %v, want [thread-a thread-b]", events.countRoots)
	}
}

func TestPendingLeaveIntentsRequiresMembershipAndDelegatesBoundedQuery(
	t *testing.T,
) {
	intents := &queryLeaveIntentRepository{
		values: []repository.LeaveIntent{{ID: "leave-1"}},
	}
	service := newQueryService(t, "ptid:alice", &queryEventRepository{}, intents)

	if _, err := service.PendingLeaveIntents(
		context.Background(),
		"conversation-1",
		"ptid:mallory",
		100,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("PendingLeaveIntents() error = %v, want unauthorized", err)
	}
	if intents.calls != 0 {
		t.Fatalf("leave-intent repository calls = %d, want 0", intents.calls)
	}

	got, err := service.PendingLeaveIntents(
		context.Background(),
		"conversation-1",
		"ptid:alice",
		100,
	)
	if err != nil {
		t.Fatalf("PendingLeaveIntents() error = %v", err)
	}
	if len(got) != 1 || got[0].ID != "leave-1" ||
		intents.conversationID != "conversation-1" ||
		intents.actor != "ptid:alice" ||
		intents.limit != 100 {
		t.Fatalf("PendingLeaveIntents() = %+v, repository = %+v", got, intents)
	}
}

func newMessageQueryService(
	t *testing.T,
	member valueobject.PTID,
	events *queryEventRepository,
) *Service {
	return newQueryService(t, member, events, &queryLeaveIntentRepository{})
}

func newQueryService(
	t *testing.T,
	member valueobject.PTID,
	events *queryEventRepository,
	intents *queryLeaveIntentRepository,
) *Service {
	t.Helper()
	authority := &queryAuthorityRepository{snapshot: aggregate.Snapshot{
		ID: "conversation-1",
		Members: []entity.Member{{
			Actor:  member,
			Status: valueobject.MemberStatusActive,
		}},
	}}
	service, err := NewService(&queryUnitOfWork{transaction: ports.Transaction{
		Repositories: repository.Repositories{
			Authority: authority,
			Events:    events,
			Followers: &queryFollowerRepository{},
			LeaveIntents: intents,
		},
	}})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	return service
}

type queryUnitOfWork struct {
	ports.UnitOfWork
	transaction ports.Transaction
}

func (u *queryUnitOfWork) Execute(
	_ context.Context,
	fn func(ports.Transaction) error,
) error {
	return fn(u.transaction)
}

type queryAuthorityRepository struct {
	repository.AuthorityRepository
	snapshot aggregate.Snapshot
}

func (r *queryAuthorityRepository) Get(
	_ context.Context,
	_ valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	return r.snapshot, nil
}

type queryFollowerRepository struct {
	repository.FollowerRepository
}

func (*queryFollowerRepository) Get(
	_ context.Context,
	_ valueobject.ConversationID,
) (repository.FollowerProjection, error) {
	return repository.FollowerProjection{}, conversationdomain.NewError(
		conversationdomain.ErrorCodeNotFound,
		"test.get_follower",
		"conversation_id",
		"was not found",
	)
}

type queryEventRepository struct {
	repository.EventRepository
	calls          int
	messages       []domainevent.Record
	messagesAfter  valueobject.Sequence
	messagesLimit  int
	threadMessages []domainevent.Record
	threadRoot     valueobject.MessageID
	threadAfter    valueobject.Sequence
	threadLimit    int
	counts         []repository.ThreadCount
	countRoots     []valueobject.MessageID
}

func (r *queryEventRepository) ListMessages(
	_ context.Context,
	_ valueobject.ConversationID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	r.calls++
	r.messagesAfter = after
	r.messagesLimit = limit
	return append([]domainevent.Record(nil), r.messages...), nil
}

func (r *queryEventRepository) ListThreadMessages(
	_ context.Context,
	_ valueobject.ConversationID,
	threadRootID valueobject.MessageID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	r.calls++
	r.threadRoot = threadRootID
	r.threadAfter = after
	r.threadLimit = limit
	return append([]domainevent.Record(nil), r.threadMessages...), nil
}

func (r *queryEventRepository) ThreadCounts(
	_ context.Context,
	_ valueobject.ConversationID,
	rootIDs []valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	r.calls++
	r.countRoots = append([]valueobject.MessageID(nil), rootIDs...)
	return append([]repository.ThreadCount(nil), r.counts...), nil
}

type queryLeaveIntentRepository struct {
	repository.LeaveIntentRepository
	values         []repository.LeaveIntent
	calls          int
	conversationID valueobject.ConversationID
	actor          valueobject.PTID
	limit          int
}

func (r *queryLeaveIntentRepository) ListPending(
	_ context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	limit int,
) ([]repository.LeaveIntent, error) {
	r.calls++
	r.conversationID = conversationID
	r.actor = actor
	r.limit = limit

	return append([]repository.LeaveIntent(nil), r.values...), nil
}
