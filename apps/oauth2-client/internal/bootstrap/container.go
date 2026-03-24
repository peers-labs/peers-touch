package bootstrap

import (
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
	providergithub "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/github"
	providergoogle "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/google"
	providerweixin "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/weixin"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

type Container struct {
	Handler *handler.OAuthHandler
}

func BuildContainer() (*Container, error) {
	sites, err := LoadSiteRegistry()
	if err != nil {
		return nil, err
	}
	sessionStore := memory.NewSessionStore()
	providers := map[valueobject.Provider]port.ProviderGateway{
		valueobject.ProviderGitHub: providergithub.New(),
		valueobject.ProviderGoogle: providergoogle.New(),
		valueobject.ProviderWeixin: providerweixin.New(),
	}
	startUC := usecase.StartAuthUseCase{
		Sites:     sites,
		Sessions:  sessionStore,
		Providers: providers,
		Clock:     usecase.RealClock{},
	}
	callbackUC := usecase.HandleCallbackUseCase{
		Sites:     sites,
		Sessions:  sessionStore,
		Providers: providers,
		Clock:     usecase.RealClock{},
	}
	return &Container{
		Handler: &handler.OAuthHandler{
			StartAuth:      startUC,
			HandleCallback: callbackUC,
			Sites:          sites,
		},
	}, nil
}
