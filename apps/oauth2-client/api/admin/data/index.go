package handler

import (
	"net/http"

	"github.com/peers-labs/peers-touch/oauth2-client/api/shared"
	oauthhandler "github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	c, err := shared.Container()
	if err != nil {
		oauthhandler.WriteAdminUnavailable(w)
		return
	}
	c.Admin.Data(w, r)
}
