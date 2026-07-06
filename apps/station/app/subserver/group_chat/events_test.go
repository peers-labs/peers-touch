package group_chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	events_subserver "github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var (
	groupChatEventsStoreOnce sync.Once
	groupChatEventsStoreErr  error
)

type groupChatEventsTestStore struct {
	db *gorm.DB
}

func (s groupChatEventsTestStore) Init(ctx context.Context, opts ...option.Option) error {
	return nil
}

func (s groupChatEventsTestStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	return s.db, nil
}

func (s groupChatEventsTestStore) Name() string {
	return "group_chat_events_test"
}

func startGroupChatEventsSubServer(t *testing.T) events_subserver.EventBus {
	t.Helper()

	groupChatEventsStoreOnce.Do(func() {
		db, err := gorm.Open(sqlite.Open("file:group_chat_events_test?mode=memory&cache=shared"), &gorm.Config{})
		if err != nil {
			groupChatEventsStoreErr = err
			return
		}
		err = store.InjectStore(context.Background(), groupChatEventsTestStore{db: db})
		if err != nil && !errors.Is(err, store.ErrStoreAlreadyInjected) {
			groupChatEventsStoreErr = err
		}
	})
	if groupChatEventsStoreErr != nil {
		t.Fatalf("init test store: %v", groupChatEventsStoreErr)
	}

	eventsServer := events_subserver.NewEventsSubServer()
	if err := eventsServer.Init(context.Background()); err != nil {
		t.Fatalf("init events subserver: %v", err)
	}
	t.Cleanup(func() {
		if err := eventsServer.Stop(context.Background()); err != nil {
			t.Fatalf("stop events subserver: %v", err)
		}
	})
	bus := events_subserver.GetBus()
	if bus == nil {
		t.Fatal("expected realtime event bus")
	}
	return bus
}
