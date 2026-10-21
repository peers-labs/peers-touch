package httpinterface

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/x-config/internal/application/admin"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
)

const maxAdminRequestBytes = 512 * 1024

type AdminHandler struct {
	Auth    operatorauthService
	Service admin.Service
}

type operatorauthService interface {
	Authenticate(
		ctx context.Context,
		sessionToken string,
		csrfToken string,
		requireCSRF bool,
	) (*operator.Session, error)
}

type saveDraftRequest struct {
	BaseRevision string          `json:"base_revision"`
	Catalog      catalog.Catalog `json:"catalog"`
}

type publishInput struct {
	Channel            string `json:"channel"`
	BaseRevision       string `json:"base_revision"`
	AcknowledgedDigest string `json:"acknowledged_digest"`
}

type restoreRequest struct {
	Channel            string `json:"channel"`
	HistoricalRevision string `json:"historical_revision"`
	CurrentRevision    string `json:"current_revision"`
}

func (h *AdminHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	session, ok := h.authorize(w, r, r.Method != http.MethodGet)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		draft, err := h.Service.LoadDraft(
			r.Context(),
			strings.TrimSpace(r.URL.Query().Get("channel")),
		)
		if err != nil {
			writeAdminError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, draft)
	case http.MethodPut:
		var input saveDraftRequest
		if !decodeAdminJSON(w, r, &input) {
			return
		}
		draft, findings, err := h.Service.SaveDraft(
			r.Context(),
			input.BaseRevision,
			input.Catalog,
		)
		if err != nil {
			if len(findings) > 0 {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
					"error":    "catalog_validation_failed",
					"findings": findings,
				})
				return
			}
			writeAdminError(w, err)
			return
		}
		_ = session
		writeJSON(w, http.StatusOK, draft)
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}

func (h *AdminHandler) ValidateCatalog(
	w http.ResponseWriter,
	r *http.Request,
) {
	setSecurityHeaders(w.Header())
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var value catalog.Catalog
	if !decodeAdminJSON(w, r, &value) {
		return
	}
	result := h.Service.Validate(r.Context(), value)
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) Publications(
	w http.ResponseWriter,
	r *http.Request,
) {
	setSecurityHeaders(w.Header())
	session, ok := h.authorize(w, r, r.Method != http.MethodGet)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		publications, err := h.Service.ListPublications(
			r.Context(),
			r.URL.Query().Get("channel"),
			limit,
		)
		if err != nil {
			writeAdminError(w, err)
			return
		}
		writeJSON(
			w,
			http.StatusOK,
			map[string]any{"publications": publications},
		)
	case http.MethodPost:
		var input publishInput
		if !decodeAdminJSON(w, r, &input) {
			return
		}
		publication, err := h.Service.Publish(
			r.Context(),
			input.Channel,
			input.BaseRevision,
			input.AcknowledgedDigest,
			session.Provider+":"+session.ProviderSubject,
		)
		if err != nil {
			writeAdminError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, publication)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (h *AdminHandler) Restore(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var input restoreRequest
	if !decodeAdminJSON(w, r, &input) {
		return
	}
	draft, findings, err := h.Service.RestoreAsNew(
		r.Context(),
		input.Channel,
		input.HistoricalRevision,
		input.CurrentRevision,
	)
	if err != nil {
		if len(findings) > 0 {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":    "catalog_validation_failed",
				"findings": findings,
			})
			return
		}
		writeAdminError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (h *AdminHandler) authorize(
	w http.ResponseWriter,
	r *http.Request,
	requireCSRF bool,
) (*operator.Session, bool) {
	sessionCookieValue, err := r.Cookie(sessionCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "operator_session_required")
		return nil, false
	}
	csrfToken := ""
	if requireCSRF {
		csrfCookieValue, err := r.Cookie(csrfCookie)
		headerCSRF := r.Header.Get("X-CSRF-Token")
		if err != nil ||
			headerCSRF == "" ||
			len(headerCSRF) != len(csrfCookieValue.Value) ||
			subtle.ConstantTimeCompare(
				[]byte(headerCSRF),
				[]byte(csrfCookieValue.Value),
			) != 1 {
			writeError(w, http.StatusForbidden, "operator_csrf_invalid")
			return nil, false
		}
		csrfToken = headerCSRF
	}
	session, err := h.Auth.Authenticate(
		r.Context(),
		sessionCookieValue.Value,
		csrfToken,
		requireCSRF,
	)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "operator_session_required")
		return nil, false
	}
	return session, true
}

func decodeAdminJSON(
	w http.ResponseWriter,
	r *http.Request,
	output any,
) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "json_required")
		return false
	}
	decoder := json.NewDecoder(
		io.LimitReader(r.Body, maxAdminRequestBytes+1),
	)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	return true
}

func writeAdminError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, catalog.ErrDraftNotFound),
		errors.Is(err, catalog.ErrPublicationNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	case errors.Is(err, catalog.ErrDraftConflict):
		writeError(w, http.StatusConflict, "draft_conflict")
	case errors.Is(err, catalog.ErrValidationFailed):
		writeError(w, http.StatusUnprocessableEntity, "catalog_validation_failed")
	default:
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
	}
}
