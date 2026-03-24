package entity

import (
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type AuthSession struct {
	State      string
	SiteID     string
	Provider   valueobject.Provider
	ReturnTo   string
	Verifier   string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

func (s AuthSession) IsExpired(now time.Time) bool {
	return now.After(s.ExpiresAt)
}

func (s AuthSession) IsConsumed() bool {
	return s.ConsumedAt != nil
}
