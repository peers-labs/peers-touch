package handler

import (
	"net/http"

	shared "github.com/peers-labs/peers-touch/oauth2-client/bridge"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	shared.Callback(w, r, "google")
}
