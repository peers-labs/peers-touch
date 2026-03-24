package shared

import (
	"sync"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
)

var (
	once      sync.Once
	container *bootstrap.Container
	buildErr  error
)

func Container() (*bootstrap.Container, error) {
	once.Do(func() {
		container, buildErr = bootstrap.BuildContainer()
	})
	return container, buildErr
}
