package conversation

import (
	"context"

	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	"gorm.io/gorm"
)

type postgresTransitionUnitOfWork struct {
	db *gorm.DB
}

func NewPostgresTransitionUnitOfWork(db *gorm.DB) TransitionUnitOfWork {
	return &postgresTransitionUnitOfWork{db: db}
}

func (u *postgresTransitionUnitOfWork) Execute(
	ctx context.Context,
	fn func(TransitionRepositories) error,
) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(TransitionRepositories{
			Conversation: newPostgresConversationRepo(tx),
			Envelope:     envinf.NewPostgresRepository(tx),
			LeaveIntents: newPostgresLeaveIntentRepository(tx),
		})
	})
}
