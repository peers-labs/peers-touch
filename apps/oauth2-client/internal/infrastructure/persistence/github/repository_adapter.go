package githubstore

import (
	"context"
	"errors"
	"net/http"

	githubrepository "github.com/peers-labs/peers-touch/github-repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
)

const maxGitHubResponseBytes = githubrepository.MaxResponseBytes

type AppAuthenticator = githubrepository.AppAuthenticator

type Client struct {
	inner      *githubrepository.Client
	maxRetries int
}

type Snapshot struct {
	inner *githubrepository.Snapshot
}

type Mutation func(snapshot *Snapshot) (map[string][]byte, error)

func NewAppAuthenticator(
	apiBase string,
	appID string,
	installationID int64,
	privateKeyPEM []byte,
	client *http.Client,
) (*AppAuthenticator, error) {
	return githubrepository.NewAppAuthenticator(
		apiBase,
		appID,
		installationID,
		privateKeyPEM,
		client,
	)
}

func NewClient(
	apiBase string,
	owner string,
	repositoryName string,
	branch string,
	auth *AppAuthenticator,
	httpClient *http.Client,
) (*Client, error) {
	client, err := githubrepository.NewClient(
		apiBase,
		owner,
		repositoryName,
		branch,
		auth,
		httpClient,
	)
	if err != nil {
		return nil, err
	}
	return &Client{inner: client, maxRetries: 3}, nil
}

func (c *Client) Read(
	ctx context.Context,
	recordPath string,
) ([]byte, bool, error) {
	value, found, err := c.inner.Read(ctx, recordPath)
	return value, found, mapRepositoryError(err)
}

func (c *Client) View(
	ctx context.Context,
	view func(*Snapshot) error,
) error {
	err := c.inner.View(ctx, func(snapshot *githubrepository.Snapshot) error {
		return mapDomainError(view(&Snapshot{inner: snapshot}))
	})
	return mapRepositoryError(err)
}

func (c *Client) Update(
	ctx context.Context,
	message string,
	mutation Mutation,
) error {
	err := c.inner.Update(
		ctx,
		message,
		func(snapshot *githubrepository.Snapshot) (map[string][]byte, error) {
			changes, err := mutation(&Snapshot{inner: snapshot})
			return changes, mapDomainError(err)
		},
	)
	return mapRepositoryError(err)
}

func (s *Snapshot) Read(
	ctx context.Context,
	recordPath string,
) ([]byte, bool, error) {
	value, found, err := s.inner.Read(ctx, recordPath)
	return value, found, mapRepositoryError(err)
}

func (s *Snapshot) Paths(prefix string) []string {
	return s.inner.Paths(prefix)
}

func NewDefaultHTTPClient() *http.Client {
	return githubrepository.NewDefaultHTTPClient()
}

func mapRepositoryError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, githubrepository.ErrConflict):
		return repository.ErrStorageConflict
	case errors.Is(err, githubrepository.ErrCorrupt):
		return repository.ErrRecordCorrupt
	case errors.Is(err, githubrepository.ErrUnavailable):
		return repository.ErrStorageUnavailable
	default:
		return err
	}
}

func mapDomainError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, repository.ErrStorageConflict):
		return githubrepository.ErrConflict
	case errors.Is(err, repository.ErrStorageUnavailable):
		return githubrepository.ErrUnavailable
	case errors.Is(err, repository.ErrRecordCorrupt):
		return githubrepository.ErrCorrupt
	default:
		return err
	}
}
