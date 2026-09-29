package bootstrap

import (
	"crypto/rand"
	"net/http"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	providergithub "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/github"
	providergoogle "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/google"
	providerweixin "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/weixin"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

type Container struct {
	Handler     *handler.OAuthHandler
	Admin       *handler.AdminHandler
	Store       repository.OAuthStore
	Maintenance repository.OAuthMaintenanceStore
}

func BuildContainer() (*Container, error) {
	sites, err := LoadSiteRegistry()
	if err != nil {
		return nil, err
	}
	storageConfig, err := LoadStorageConfig()
	if err != nil {
		return nil, err
	}
	store, maintenance, err := BuildOAuthStore(storageConfig, http.DefaultClient)
	if err != nil {
		return nil, err
	}
	adminAuth, err := LoadAdminAuthenticator()
	if err != nil {
		return nil, err
	}
	auditKey := storageConfig.AuditHMACKey
	if len(auditKey) == 0 {
		auditKey = make([]byte, 32)
		if _, err := rand.Read(auditKey); err != nil {
			return nil, err
		}
	}
	providers := map[valueobject.Provider]port.ProviderGateway{
		valueobject.ProviderGitHub: providergithub.New(),
		valueobject.ProviderGoogle: providergoogle.New(),
		valueobject.ProviderWeixin: providerweixin.New(),
	}
	startUC := usecase.StartAuthUseCase{
		Sites:     sites,
		Store:     store,
		Providers: providers,
		Clock:     usecase.RealClock{},
	}
	callbackUC := usecase.HandleCallbackUseCase{
		Sites:         sites,
		Store:         store,
		Providers:     providers,
		Fingerprinter: recordcrypto.NewFingerprinter(auditKey),
		Clock:         usecase.RealClock{},
	}
	return &Container{
		Handler: &handler.OAuthHandler{
			StartAuth:      startUC,
			HandleCallback: callbackUC,
		},
		Admin: &handler.AdminHandler{
			Store: store,
			Auth:  adminAuth,
		},
		Store:       store,
		Maintenance: maintenance,
	}, nil
}
