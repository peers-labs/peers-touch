package postgres

import (
	"github.com/peers-touch/peers-touch-go/core/store"
	"gorm.io/driver/postgres"
)

func init() {
	// register sqlite driver
	store.RegisterDriver("postgres", postgres.Open)
}
