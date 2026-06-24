package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/application"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/infrastructure"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestServiceLifecycleWithGormRepository(t *testing.T) {
	ctx := context.Background()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := infrastructure.NewGormRepository(db)
	if err := repo.AutoMigrate(ctx); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := application.NewServiceWithClock(repo, func() time.Time {
		return time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC)
	})

	created, err := svc.Create(ctx, "actor-1", &model.CreateNoteRequest{
		Title:   "First Note",
		Content: "body",
	})
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	if created.GetItem().GetNoteId() == "" {
		t.Fatal("create note returned empty note id")
	}

	listed, err := svc.List(ctx, "actor-1", &model.ListNotesRequest{})
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	if len(listed.GetItems()) != 1 {
		t.Fatalf("list notes count = %d, want 1", len(listed.GetItems()))
	}

	searched, err := svc.Search(ctx, "actor-1", &model.SearchNotesRequest{Query: "first"})
	if err != nil {
		t.Fatalf("search notes: %v", err)
	}
	if len(searched.GetItems()) != 1 {
		t.Fatalf("search notes count = %d, want 1", len(searched.GetItems()))
	}

	newTitle := "Updated Note"
	updated, err := svc.Update(ctx, "actor-1", &model.UpdateNoteRequest{
		NoteId: created.GetItem().GetNoteId(),
		Title:  &newTitle,
	})
	if err != nil {
		t.Fatalf("update note: %v", err)
	}
	if updated.GetItem().GetTitle() != newTitle {
		t.Fatalf("updated title = %q, want %q", updated.GetItem().GetTitle(), newTitle)
	}

	deleted, err := svc.Delete(ctx, "actor-1", &model.DeleteNoteRequest{NoteId: created.GetItem().GetNoteId()})
	if err != nil {
		t.Fatalf("delete note: %v", err)
	}
	if !deleted.GetDeleted() {
		t.Fatal("delete note returned deleted=false")
	}

	afterDelete, err := svc.List(ctx, "actor-1", &model.ListNotesRequest{})
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(afterDelete.GetItems()) != 0 {
		t.Fatalf("list after delete count = %d, want 0", len(afterDelete.GetItems()))
	}

	restored, err := svc.Restore(ctx, "actor-1", &model.RestoreNoteRequest{NoteId: created.GetItem().GetNoteId()})
	if err != nil {
		t.Fatalf("restore note: %v", err)
	}
	if restored.GetItem().GetDeletedAt() != nil {
		t.Fatal("restored note still has deleted_at")
	}
}
