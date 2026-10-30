package application

import (
	"context"
	"sync"
	"testing"
	"time"

	notification "github.com/peers-labs/peers-touch/station/app/subserver/notification"
	notificationapp "github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	notificationinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// The notification Bridge is process-global, so tests share one
// migrated service (and its sqlite database) and use distinct recipient
// ids instead of swapping registrations while detached goroutines run.
var (
	sharedNotificationOnce    sync.Once
	sharedNotificationService *notificationapp.Service
)

func newTestNotificationBridge(t *testing.T) *notificationapp.Service {
	t.Helper()
	sharedNotificationOnce.Do(func() {
		// Shared-cache in-memory sqlite: otherwise each pooled
		// connection sees a different empty database and detached
		// delivery races against the AutoMigrate connection.
		db, err := gorm.Open(
			sqlite.Open("file:social_mention_notifier_test?mode=memory&cache=shared"),
			&gorm.Config{},
		)
		if err != nil {
			t.Fatalf("open sqlite: %v", err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatalf("open sql db: %v", err)
		}
		sqlDB.SetMaxOpenConns(1)
		repo := notificationinfra.NewGormRepo(db)
		if err := repo.AutoMigrate(); err != nil {
			t.Fatalf("migrate notification schema: %v", err)
		}
		protector, err := notificationinfra.NewPushCredentialProtector("social-mention-test-secret")
		if err != nil {
			t.Fatalf("create push protector: %v", err)
		}
		sharedNotificationService = notificationapp.NewService(repo, protector)
	})
	notification.RegisterService(sharedNotificationService)
	return sharedNotificationService
}

func waitNotificationCount(
	t *testing.T,
	service *notificationapp.Service,
	recipientPTID string,
	want int,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		items, _, _, err := service.List(recipientPTID, 0, 0, "", 50)
		if err != nil {
			t.Fatalf("list notifications: %v", err)
		}
		if len(items) >= want {
			if len(items) != want {
				t.Fatalf("expected %d notifications, got %d", want, len(items))
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %d notifications, got %d", want, len(items))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCommentMentionNotifierProducesIDsOnlyNotification(t *testing.T) {
	service := newTestNotificationBridge(t)
	notification.RegisterService(service)
	notifier := NewCommentMentionNotifier(func(
		_ context.Context, _ uint64, viewerPTID string,
	) bool {
		return viewerPTID == "ptid:readable"
	})

	notifier.NotifyPublicCommentMentions(
		context.Background(), 42, 99, "ptid:author",
		[]*model.Mention{
			{ActorPtid: "ptid:readable", Offset: 0, Length: 4, Display: "@rea"},
			{ActorPtid: "ptid:blocked", Offset: 6, Length: 4, Display: "@blo"},
			{ActorPtid: "ptid:author", Offset: 11, Length: 7, Display: "@author"},
		},
	)

	waitNotificationCount(t, service, "ptid:readable", 1)
	items, _, _, _ := service.List("ptid:readable", 0, 0, "", 50)
	item := items[0]
	if item.Title != "" || item.Body != "" {
		t.Fatalf("notification must not carry title/body, got %q %q", item.Title, item.Body)
	}
	if item.TargetType != socialCommentMentionTargetType || item.TargetID != "99" {
		t.Fatalf("unexpected target: %s %s", item.TargetType, item.TargetID)
	}
	if item.Metadata[socialCommentMentionMetadataPostID] != "42" ||
		item.Metadata[socialCommentMentionMetadataActorPTID] != "ptid:author" ||
		item.Metadata[socialCommentMentionMetadataCommentID] != "99" {
		t.Fatalf("metadata must carry static IDs only: %+v", item.Metadata)
	}

	// Unreadable and self recipients never receive a notification.
	blocked, _, _, _ := service.List("ptid:blocked", 0, 0, "", 50)
	if len(blocked) != 0 {
		t.Fatalf("unreadable recipient must not be notified, got %d", len(blocked))
	}
	self, _, _, _ := service.List("ptid:author", 0, 0, "", 50)
	if len(self) != 0 {
		t.Fatalf("self mention must not notify the author, got %d", len(self))
	}
}

// Private comments carry opaque ULID string ids (not numeric ULIDs).
// They must flow verbatim into target/metadata/groupKey without any
// decimal parse/zeroing.
func TestCommentMentionNotifierPrivateUsesOpaqueULIDStrings(t *testing.T) {
	service := newTestNotificationBridge(t)
	notification.RegisterService(service)
	notifier := NewCommentMentionNotifier(nil)

	postULID := "01J9PRA0V4EXAMPLEPOST0001"
	commentULID := "01J9PRA0V7EXAMPLECMT00002"
	notifier.NotifyPrivateCommentMentions(
		context.Background(),
		postULID,
		commentULID,
		"ptid:author",
		[]string{
			"ptid:mention-1",
			"ptid:mention-1", // duplicate is deduped
			"ptid:author",    // self is skipped
			"ptid:mention-2",
		},
	)

	waitNotificationCount(t, service, "ptid:mention-1", 1)
	items, _, _, _ := service.List("ptid:mention-1", 0, 0, "", 50)
	item := items[0]
	if item.TargetType != socialCommentMentionTargetType {
		t.Fatalf("unexpected target type %q", item.TargetType)
	}
	if item.TargetID != commentULID {
		t.Fatalf("target must preserve raw comment ULID, got %q", item.TargetID)
	}
	if item.Metadata[socialCommentMentionMetadataPostID] != postULID {
		t.Fatalf("metadata post_id must preserve raw ULID, got %q",
			item.Metadata[socialCommentMentionMetadataPostID])
	}
	if item.Metadata[socialCommentMentionMetadataCommentID] != commentULID {
		t.Fatalf("metadata comment_id must preserve raw ULID, got %q",
			item.Metadata[socialCommentMentionMetadataCommentID])
	}
	if item.GroupKey != socialCommentMentionTargetType+":"+commentULID {
		t.Fatalf("group key must use raw ULID, got %q", item.GroupKey)
	}
	if item.Title != "" || item.Body != "" {
		t.Fatalf("private notification must stay IDs-only, got %q %q", item.Title, item.Body)
	}

	waitNotificationCount(t, service, "ptid:mention-2", 1)
}

// Fan-out is detached: Notify returns before delivery completes and
// never blocks the write request on a slow notification SubServer.
func TestCommentMentionNotifierDoesNotBlockCaller(t *testing.T) {
	service := newTestNotificationBridge(t)
	notification.RegisterService(service)
	notifier := NewCommentMentionNotifier(func(
		_ context.Context, _ uint64, _ string,
	) bool {
		return true
	})

	done := make(chan struct{})
	go func() {
		notifier.NotifyPublicCommentMentions(
			context.Background(), 7, 8, "ptid:author",
			[]*model.Mention{{
				ActorPtid: "ptid:async-recipient",
				Offset:    0,
				Length:    4,
				Display:   "@asy",
			}},
		)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("notify must return without waiting for delivery")
	}
	waitNotificationCount(t, service, "ptid:async-recipient", 1)
}
