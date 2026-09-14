package social

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestRecoverablePrivateContentRoute(t *testing.T) {
	fixture := newHandlerFixture(t)
	fixture.subserver.commonWrapper = func(
		next server.EndpointHandler,
	) server.EndpointHandler {
		return next
	}
	fixture.subserver.jwtWrapper = func(
		next server.EndpointHandler,
	) server.EndpointHandler {
		return next
	}
	handler := socialHandlerByName(
		t,
		fixture.subserver.Handlers(),
		"social-list-recoverable-private-content",
	)
	if handler.Method() != server.GET ||
		handler.Path() != routeSocialRecoverablePrivateContent {
		t.Fatalf(
			"recovery route = %s %s",
			handler.Method(),
			handler.Path(),
		)
	}

	t.Run("requires authenticated actor", func(t *testing.T) {
		request := httptest.NewRequest(
			http.MethodGet,
			routeSocialRecoverablePrivateContent+"?limit=1",
			nil,
		)
		response := &socialHTTPResponse{writer: httptest.NewRecorder()}
		if err := handler.Handler()(
			context.Background(),
			&socialHTTPRequest{request: request},
			response,
		); err != nil {
			t.Fatal(err)
		}
		if response.Status() != http.StatusUnauthorized {
			t.Fatalf(
				"unauthenticated recovery status = %d, want %d",
				response.Status(),
				http.StatusUnauthorized,
			)
		}
	})

	t.Run("rejects unknown query field", func(t *testing.T) {
		request := httptest.NewRequest(
			http.MethodGet,
			routeSocialRecoverablePrivateContent+"?limit=1&unknown=value",
			nil,
		)
		response := &socialHTTPResponse{writer: httptest.NewRecorder()}
		if err := handler.Handler()(
			coreauth.WithSubject(
				context.Background(),
				&coreauth.Subject{ID: "ptid:bob"},
			),
			&socialHTTPRequest{request: request},
			response,
		); err != nil {
			t.Fatal(err)
		}
		if response.Status() != http.StatusBadRequest {
			t.Fatalf(
				"unknown recovery query status = %d, want %d",
				response.Status(),
				http.StatusBadRequest,
			)
		}
	})

	t.Run("rejects GET body", func(t *testing.T) {
		request := httptest.NewRequest(
			http.MethodGet,
			routeSocialRecoverablePrivateContent,
			nil,
		)
		response := &socialHTTPResponse{writer: httptest.NewRecorder()}
		endpoint := handler.Handler()
		for _, wrapper := range handler.Wrappers() {
			endpoint = wrapper(endpoint)
		}
		err := endpoint(
			context.Background(),
			&socialHTTPRequest{
				request: request,
				body:    []byte(`{"limit":1}`),
			},
			response,
		)
		handlerError, ok := err.(*server.HandlerError)
		if !ok {
			t.Fatalf("GET body error = %T %v", err, err)
		}
		if handlerError.Code != http.StatusBadRequest {
			t.Fatalf(
				"recovery GET body status = %d, want %d",
				handlerError.Code,
				http.StatusBadRequest,
			)
		}
	})
}
