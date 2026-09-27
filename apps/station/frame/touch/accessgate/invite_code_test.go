package accessgate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRedeemInviteCodeWithDBIsAttemptIdempotent(t *testing.T) {
	database := newInviteCodeTestDB(t)
	attempt := seedInviteCodeTestRows(t, database)

	if err := redeemInviteCodeWithDB(
		context.Background(),
		database,
		attempt.ID,
		"INVITE-ONE",
	); err != nil {
		t.Fatalf("redeem invite code: %v", err)
	}
	if err := redeemInviteCodeWithDB(
		context.Background(),
		database,
		attempt.ID,
		"DIFFERENT-CODE",
	); err != nil {
		t.Fatalf("replay completed attempt: %v", err)
	}

	assertInviteRedemptionState(t, database, attempt.ID, 1, true)
}

func TestRedeemInviteCodeWithDBRollsBackUsageWhenAttemptUpdateFails(t *testing.T) {
	database := newInviteCodeTestDB(t)
	attempt := seedInviteCodeTestRows(t, database)
	updateErr := errors.New("attempt update failed")
	if err := database.Callback().Update().Before("gorm:update").
		Register("test:reject_attempt_update", func(tx *gorm.DB) {
			if tx.Statement.Table == (&dbmodel.AccessAttempt{}).TableName() {
				tx.AddError(updateErr)
			}
		}); err != nil {
		t.Fatalf("register update callback: %v", err)
	}

	err := redeemInviteCodeWithDB(
		context.Background(),
		database,
		attempt.ID,
		"INVITE-ONE",
	)
	if !errors.Is(err, updateErr) {
		t.Fatalf("redeem error = %v, want %v", err, updateErr)
	}

	assertInviteRedemptionState(t, database, attempt.ID, 0, false)
}

func newInviteCodeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := strings.ReplaceAll(t.Name(), "/", "-")
	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", name)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := database.AutoMigrate(
		&dbmodel.AccessAttempt{},
		&dbmodel.AccessInviteCode{},
	); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return database
}

func seedInviteCodeTestRows(
	t *testing.T,
	database *gorm.DB,
) *dbmodel.AccessAttempt {
	t.Helper()
	attempt := &dbmodel.AccessAttempt{
		ID:            "attempt-1",
		Status:        attemptStatusActionRequired,
		StationPeerID: "station-1",
		ExpiresAt:     time.Now().Add(time.Minute),
	}
	if err := database.Create(attempt).Error; err != nil {
		t.Fatalf("create access attempt: %v", err)
	}
	if err := database.Create(&dbmodel.AccessInviteCode{
		ID:      "invite-1",
		Code:    "INVITE-ONE",
		MaxUses: 1,
	}).Error; err != nil {
		t.Fatalf("create invite code: %v", err)
	}
	return attempt
}

func assertInviteRedemptionState(
	t *testing.T,
	database *gorm.DB,
	attemptID string,
	wantUsedCount int,
	wantPassed bool,
) {
	t.Helper()
	var invite dbmodel.AccessInviteCode
	if err := database.Where("id = ?", "invite-1").First(&invite).Error; err != nil {
		t.Fatalf("read invite code: %v", err)
	}
	if invite.UsedCount != wantUsedCount {
		t.Fatalf("invite used_count = %d, want %d", invite.UsedCount, wantUsedCount)
	}
	var attempt dbmodel.AccessAttempt
	if err := database.Where("id = ?", attemptID).First(&attempt).Error; err != nil {
		t.Fatalf("read access attempt: %v", err)
	}
	if attempt.InvitePassed != wantPassed {
		t.Fatalf("attempt invite_passed = %v, want %v", attempt.InvitePassed, wantPassed)
	}
}
