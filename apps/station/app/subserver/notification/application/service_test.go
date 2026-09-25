package application_test

import (
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUpdatePreferencesRejectsInvalidBatchBeforeMutation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate notification schema: %v", err)
	}
	protector, err := infrastructure.NewPushCredentialProtector("notification-test-secret")
	if err != nil {
		t.Fatalf("create push protector: %v", err)
	}
	service := application.NewService(repo, protector)

	cases := []struct {
		name     string
		revision uint64
		updates  []domain.NotificationPreferencePatch
		want     error
	}{
		{
			name:     "missing revision",
			revision: 0,
			updates:  []domain.NotificationPreferencePatch{{Category: domain.CategorySocial}},
			want:     application.ErrPreferenceRevisionRequired,
		},
		{
			name:     "empty batch",
			revision: 1,
			want:     application.ErrEmptyPreferenceMutation,
		},
		{
			name:     "invalid category",
			revision: 1,
			updates:  []domain.NotificationPreferencePatch{{Category: domain.CategoryUnspecified}},
			want:     application.ErrInvalidPreferenceCategory,
		},
		{
			name:     "duplicate category",
			revision: 1,
			updates: []domain.NotificationPreferencePatch{
				{Category: domain.CategorySocial},
				{Category: domain.CategorySocial},
			},
			want: application.ErrDuplicatePreferenceCategory,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.UpdatePreferences("ptid:alice", tc.revision, tc.updates)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
			snapshot, snapshotErr := service.GetPreferences("ptid:alice")
			if snapshotErr != nil {
				t.Fatalf("get snapshot: %v", snapshotErr)
			}
			if snapshot.Revision != 1 {
				t.Fatalf("revision = %d, want 1", snapshot.Revision)
			}
		})
	}
}
