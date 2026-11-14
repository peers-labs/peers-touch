package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func assertProviderErrorResponse(t *testing.T, route server.Handler, ctx context.Context, body string, status int) {
	t.Helper()
	response := &fakeStreamResponse{}
	if err := route.Handler()(ctx, &fakeTurnRequest{body: []byte(body)}, response); err != nil {
		t.Fatalf("domain error escaped the HTTP boundary: %v", err)
	}
	if response.status != status || response.Header()["Content-Type"] != "application/json" {
		t.Fatalf("error response = %d %+v", response.status, response.Header())
	}
	var envelope struct {
		Code  int    `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.body.Bytes(), &envelope); err != nil ||
		envelope.Code != status || strings.TrimSpace(envelope.Error) == "" {
		t.Fatalf("unreadable error response: %q %v", response.body.String(), err)
	}
}

func TestProviderRuntimeDefaultRejectionsReachHTTPClient(t *testing.T) {
	t.Setenv("PATH", "")
	handlers, _, ctx := newControlPlaneHandlers(t)
	route := server.NewTypedHandler("default", "/default", server.POST, handlers.HandleSetRuntimeDefault)
	for _, body := range []string{`{}`, `{"provider_id":"codex-cli","model_id":"default"}`} {
		assertProviderErrorResponse(t, route, ctx, body, http.StatusBadRequest)
	}
}

func TestProviderQuickCompletionRejectionsReachHTTPClient(t *testing.T) {
	handlers := NewTurnHandlers(&service.TurnService{}, service.NewToolRegistryService(nil, nil), nil, nil)
	route := server.NewTypedHandler("completion", "/completion", server.POST, handlers.HandleQuickCompletion)
	assertProviderErrorResponse(t, route, context.Background(), `{}`, http.StatusBadRequest)
	assertProviderErrorResponse(t, route, context.Background(), `{"prompt":"hello"}`, http.StatusForbidden)
}

func TestProviderMappedErrorBodyDoesNotExposeCause(t *testing.T) {
	for _, failure := range []error{
		errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "selection unavailable", errors.New("private-credential-value")),
		errors.New("private-credential-value"),
	} {
		route := server.NewTypedHandler("error", "/error", server.POST,
			func(context.Context, *model.GetRuntimeDefaultRequest) (*model.GetRuntimeDefaultResponse, error) {
				return nil, toHandlerError(failure)
			})
		status := http.StatusInternalServerError
		var business *errcode.BizError
		if errors.As(failure, &business) {
			status = business.HTTPStatus
		}
		assertProviderErrorResponse(t, route, context.Background(), `{}`, status)
		response := &fakeStreamResponse{}
		if err := route.Handler()(context.Background(), &fakeTurnRequest{body: []byte(`{}`)}, response); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(response.body.String(), "private-credential-value") {
			t.Fatal("internal cause escaped into the client error body")
		}
	}
}
