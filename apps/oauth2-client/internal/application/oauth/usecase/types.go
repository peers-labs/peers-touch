package usecase

import (
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type SiteConfig struct {
	SiteID     string
	SuccessURL string
	ErrorURL   string
	Providers  map[valueobject.Provider]port.ProviderConfig
}

type SiteRegistry interface {
	Get(siteID string) (SiteConfig, bool)
}

type Clock interface {
	Now() time.Time
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }
