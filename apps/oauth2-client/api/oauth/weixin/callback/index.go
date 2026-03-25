package handler

import (
	"net/http"

	"github.com/peers-labs/peers-touch/oauth2-client/api/shared"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	c, err := shared.Container()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	c.Handler.CallbackWithProvider(w, r, valueobject.ProviderWeixin)
}
