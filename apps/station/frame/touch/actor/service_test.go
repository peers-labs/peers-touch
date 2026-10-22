package actor

import (
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGetActorByEmailQueryPreservesRecordNotFound(t *testing.T) {
	rds, err := gorm.Open(
		sqlite.Open("file:get_actor_by_email_not_found?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := rds.AutoMigrate(&db.Actor{}); err != nil {
		t.Fatal(err)
	}

	_, err = getActorByEmail(rds, "missing@example.test")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing actor error=%v, want gorm.ErrRecordNotFound", err)
	}
}
