package sqlite

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"gorm.io/driver/sqlite"
)

func init() {
	// register sqlite driver
	store.RegisterDriver("sqlite", sqlite.Open)
}
