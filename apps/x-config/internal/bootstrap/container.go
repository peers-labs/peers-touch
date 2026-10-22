package bootstrap

import (
	"errors"
	"net/http"
	"time"

	githubrepository "github.com/peers-labs/peers-touch/github-repository"
	"github.com/peers-labs/peers-touch/x-config/internal/application/admin"
	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/catalogrepo"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/endpointvalidator"
	oauthinfra "github.com/peers-labs/peers-touch/x-config/internal/infrastructure/oauth"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/operatorstore"
	httpinterface "github.com/peers-labs/peers-touch/x-config/internal/interfaces/http"
	"github.com/peers-labs/peers-touch/x-config/internal/publication"
)

type Container struct {
	Auth   *httpinterface.AuthHandler
	Admin  *httpinterface.AdminHandler
	Public *httpinterface.PublicHandler
	close  func() error
}

func (c *Container) Close() error {
	if c == nil || c.close == nil {
		return nil
	}
	return c.close()
}

func BuildContainer(config Config) (*Container, error) {
	if config.CatalogStorageDriver != "github" ||
		config.OperatorStorageDriver != "sqlite" {
		return nil, errors.New("invalid_x_config_storage_composition")
	}
	auth, err := githubrepository.NewAppAuthenticator(
		config.GitHubAPIBase,
		config.GitHubAppID,
		config.GitHubInstallationID,
		config.GitHubPrivateKeyPEM,
		nil,
	)
	if err != nil {
		return nil, err
	}
	repository, err := githubrepository.NewClient(
		config.GitHubAPIBase,
		config.GitHubOwner,
		config.GitHubRepository,
		config.GitHubBranch,
		auth,
		nil,
	)
	if err != nil {
		return nil, err
	}
	catalogRepository, err := catalogrepo.NewGitRepository(repository)
	if err != nil {
		return nil, err
	}
	operatorStore, err := operatorstore.NewSQLiteStore(
		config.OperatorSQLitePath,
		config.RecordKey,
	)
	if err != nil {
		return nil, err
	}
	closeStore := true
	defer func() {
		if closeStore {
			_ = operatorStore.Close()
		}
	}()
	var store operator.Store = operatorStore
	redeemer, err := oauthinfra.NewRedeemer(
		config.OAuthRedeemURL,
		config.OAuthRedeemSecret,
		nil,
	)
	if err != nil {
		return nil, err
	}
	signer, err := publication.NewEd25519Signer(
		config.SigningKeyID,
		config.SigningPrivateKey,
	)
	if err != nil {
		return nil, err
	}
	service := operatorauth.Service{
		Config:   config.Operator,
		Store:    store,
		Redeemer: redeemer,
		Clock:    operatorauth.RealClock{},
	}
	adminService := admin.Service{
		Repository: catalogRepository,
		Validator: endpointvalidator.Validator{
			Timeout: 5 * time.Second,
		},
		Signer: signer,
		Clock:  admin.RealClock{},
	}
	container := &Container{
		Auth: &httpinterface.AuthHandler{Service: service},
		Admin: &httpinterface.AdminHandler{
			Auth:    service,
			Service: adminService,
		},
		Public: &httpinterface.PublicHandler{
			Repository: catalogRepository,
		},
		close: operatorStore.Close,
	}
	closeStore = false
	return container, nil
}

func BuildFromEnvironment() (*Container, error) {
	config, err := LoadConfig()
	if err != nil {
		return nil, err
	}
	return BuildContainer(config)
}

func DefaultHTTPClient() *http.Client {
	return githubrepository.NewDefaultHTTPClient()
}
