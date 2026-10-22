package handler

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"google.golang.org/protobuf/proto"
)

const maxOperatorLoginRequestBytes = 8 * 1024

func (h *OAuthHandler) RedeemOperatorLogin(
	w http.ResponseWriter,
	r *http.Request,
) {
	setOAuthSecurityHeaders(w.Header())
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(
			w,
			http.StatusMethodNotAllowed,
			map[string]string{"error": "method_not_allowed"},
		)
		return
	}
	if r.Header.Get("Content-Type") != "application/protobuf" {
		writeJSON(
			w,
			http.StatusUnsupportedMediaType,
			map[string]string{"error": "protobuf_required"},
		)
		return
	}
	body, err := io.ReadAll(
		io.LimitReader(r.Body, maxOperatorLoginRequestBytes+1),
	)
	if err != nil || len(body) == 0 || len(body) > maxOperatorLoginRequestBytes {
		writeJSON(
			w,
			http.StatusBadRequest,
			map[string]string{"error": "invalid_operator_login_request"},
		)
		return
	}
	request := &operatorlogin.RedeemOperatorLoginHandoffRequest{}
	if err := proto.Unmarshal(body, request); err != nil {
		writeJSON(
			w,
			http.StatusBadRequest,
			map[string]string{"error": "invalid_operator_login_request"},
		)
		return
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil || !bytes.Equal(canonical, body) {
		writeJSON(
			w,
			http.StatusBadRequest,
			map[string]string{"error": "invalid_operator_login_request"},
		)
		return
	}
	site, ok := h.Sites.Get(request.GetSiteId())
	if !ok ||
		site.OperatorLogin == nil ||
		!usecase.AuthenticateOperatorSite(
			site.OperatorLogin,
			bearerSecret(r.Header.Get("Authorization")),
		) {
		writeJSON(
			w,
			http.StatusUnauthorized,
			map[string]string{"error": "operator_login_unauthorized"},
		)
		return
	}
	assertion, err := h.OperatorLogin.Redeem(
		r.Context(),
		site.OperatorLogin,
		usecase.RedeemOperatorLoginInput{
			SiteID:           request.GetSiteId(),
			Audience:         request.GetAudience(),
			HandoffCode:      request.GetHandoffCode(),
			ReceiverVerifier: request.GetReceiverVerifier(),
		},
	)
	if err != nil {
		writeJSON(
			w,
			http.StatusUnauthorized,
			map[string]string{"error": usecase.PublicErrorCode(err)},
		)
		return
	}
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&operatorlogin.RedeemOperatorLoginHandoffResponse{
			Assertion: assertion,
		},
	)
	if err != nil {
		writeJSON(
			w,
			http.StatusServiceUnavailable,
			map[string]string{"error": "operator_login_unavailable"},
		)
		return
	}
	w.Header().Set("Content-Type", "application/protobuf")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(responseBytes)
}

func bearerSecret(value string) []byte {
	scheme, credential, ok := strings.Cut(strings.TrimSpace(value), " ")
	if !ok || scheme != "Bearer" || credential == "" {
		return nil
	}
	return []byte(credential)
}
