package bridge

import (
	"net/http"
	"sync"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	oauthhandler "github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
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

func Healthz(w http.ResponseWriter, r *http.Request) {
	c, err := Container()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	c.Handler.Healthz(w, r)
}

func Start(w http.ResponseWriter, r *http.Request, providerName string) {
	provider, ok := valueobject.ParseProvider(providerName)
	if !ok {
		http.Error(w, "unsupported provider", http.StatusNotFound)
		return
	}
	c, err := Container()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	c.Handler.StartWithProvider(w, r, provider)
}

func Callback(w http.ResponseWriter, r *http.Request, providerName string) {
	provider, ok := valueobject.ParseProvider(providerName)
	if !ok {
		http.Error(w, "unsupported provider", http.StatusNotFound)
		return
	}
	c, err := Container()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	c.Handler.CallbackWithProvider(w, r, provider)
}

func AdminPage(w http.ResponseWriter, r *http.Request) {
	c, err := Container()
	if err != nil {
		oauthhandler.WriteAdminUnavailable(w)
		return
	}
	c.Admin.Page(w, r)
}

func AdminData(w http.ResponseWriter, r *http.Request) {
	c, err := Container()
	if err != nil {
		oauthhandler.WriteAdminUnavailable(w)
		return
	}
	c.Admin.Data(w, r)
}
