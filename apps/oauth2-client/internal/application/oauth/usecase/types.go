package usecase

import (
	"crypto/ed25519"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type SiteConfig struct {
	SiteID          string
	SuccessURL      string
	ErrorURL        string
	AllowedReturnTo []string
	Providers       map[valueobject.Provider]port.ProviderConfig

	// BridgeSecret is the shared HMAC key used to sign callback query params.
	// If empty, signing is skipped.
	BridgeSecret string

	OperatorLogin *OperatorLoginSiteConfig
}

type OperatorLoginSiteConfig struct {
	Audience          string
	CallbackURL       string
	SigningKeyID      string
	SigningPrivateKey ed25519.PrivateKey
	RedeemSecret      []byte
}

type SiteRegistry interface {
	Get(siteID string) (SiteConfig, bool)
}

type Clock interface {
	Now() time.Time
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }
