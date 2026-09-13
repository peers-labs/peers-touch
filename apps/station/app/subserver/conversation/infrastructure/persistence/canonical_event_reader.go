package persistence

import (
	"context"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
)

// ReadCanonicalEvent verifies and returns one existing authority event without mutation.
func ReadCanonicalEvent(
	ctx context.Context,
	db *gorm.DB,
	sealer domainevent.Sealer,
	eventID valueobject.EventID,
) (domainevent.Record, error) {
	return newEventRepository(db, sealer).GetByID(ctx, eventID)
}
