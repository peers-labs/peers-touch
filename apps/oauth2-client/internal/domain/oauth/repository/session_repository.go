package repository

import (
	"context"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

type SessionRepository interface {
	Save(ctx context.Context, session entity.AuthSession) error
	FindByState(ctx context.Context, state string) (*entity.AuthSession, error)
	MarkConsumed(ctx context.Context, state string) error
}
