package postgre

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"gorm.io/driver/postgres"
)

func init() {
	// register sqlite driver
	store.RegisterDriver("postgres", postgres.Open)
}
