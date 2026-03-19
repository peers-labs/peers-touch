package auth

import (
	"context"
	"testing"
)

func TestSubjectContext(t *testing.T) {
	t.Run("WithSubject and GetSubject", func(t *testing.T) {
		ctx := context.Background()
		subject := &Subject{
			ID: "user123",
			Attributes: map[string]string{
				"role":  "admin",
				"email": "alice@example.com",
			},
		}

		// Add subject to context
		ctx = WithSubject(ctx, subject)

		// Retrieve subject
		retrieved := GetSubject(ctx)
		if retrieved == nil {
			t.Fatal("GetSubject() returned nil")
		}

		if retrieved.ID != subject.ID {
			t.Errorf("ID = %v, want %v", retrieved.ID, subject.ID)
		}
		if retrieved.Attributes["role"] != "admin" {
			t.Errorf("Attributes[role] = %v, want admin", retrieved.Attributes["role"])
		}
	})

	t.Run("GetSubject returns nil when no subject", func(t *testing.T) {
		ctx := context.Background()
		retrieved := GetSubject(ctx)
		if retrieved != nil {
			t.Errorf("GetSubject() = %v, want nil", retrieved)
		}
	})

	t.Run("MustGetSubject panics when no subject", func(t *testing.T) {
		ctx := context.Background()
		
		defer func() {
			if r := recover(); r == nil {
				t.Error("MustGetSubject() should panic when no subject found")
			}
		}()
		
		MustGetSubject(ctx)
	})

	t.Run("MustGetSubject returns subject when present", func(t *testing.T) {
		ctx := context.Background()
		subject := &Subject{
			ID: "user123",
		}
		ctx = WithSubject(ctx, subject)

		retrieved := MustGetSubject(ctx)
		if retrieved.ID != subject.ID {
			t.Errorf("ID = %v, want %v", retrieved.ID, subject.ID)
		}
	})

	t.Run("HasSubject", func(t *testing.T) {
		ctx := context.Background()
		
		if HasSubject(ctx) {
			t.Error("HasSubject() = true, want false for empty context")
		}
		
		subject := &Subject{ID: "user123"}
		ctx = WithSubject(ctx, subject)
		
		if !HasSubject(ctx) {
			t.Error("HasSubject() = false, want true after WithSubject")
		}
	})
}
