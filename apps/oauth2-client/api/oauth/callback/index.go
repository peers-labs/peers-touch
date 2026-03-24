package handler

import (
	"net/http"

	"github.com/peers-labs/peers-touch/oauth2-client/api/shared"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	c, err := shared.Container()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	c.Handler.Callback(w, r)
}
