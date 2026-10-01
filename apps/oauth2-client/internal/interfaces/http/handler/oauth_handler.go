package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type OAuthHandler struct {
	StartAuth      usecase.StartAuthUseCase
	HandleCallback usecase.HandleCallbackUseCase
	Sites          usecase.SiteRegistry
}

func (h *OAuthHandler) StartWithProvider(w http.ResponseWriter, r *http.Request, provider valueobject.Provider) {
	siteID := strings.TrimSpace(r.URL.Query().Get("site_id"))
	if siteID == "" {
		siteID = "default"
	}
	redirectURL, err := h.StartAuth.Execute(r.Context(), usecase.StartAuthInput{
		SiteID:   siteID,
		Provider: provider,
		ReturnTo: r.URL.Query().Get("return_to"),
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (h *OAuthHandler) CallbackWithProvider(w http.ResponseWriter, r *http.Request, provider valueobject.Provider) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	providerError := strings.TrimSpace(r.URL.Query().Get("error"))
	if state == "" || (code == "" && providerError == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_callback_result_or_state"})
		return
	}
	out, err := h.HandleCallback.Execute(r.Context(), usecase.HandleCallbackInput{
		Provider:      provider,
		State:         state,
		Code:          code,
		ProviderError: providerError,
	})
	if err != nil {
		if out != nil && out.RedirectURL != "" {
			http.Redirect(w, r, out.RedirectURL, http.StatusFound)
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": usecase.PublicErrorCode(err)})
		return
	}
	http.Redirect(w, r, out.RedirectURL, http.StatusFound)
}

func (h *OAuthHandler) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
