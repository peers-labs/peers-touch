package sqlite

import (
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
)

func init() {
	// register sqlite driver
	store.RegisterDriver("sqlite", sqlite.Open)
}
