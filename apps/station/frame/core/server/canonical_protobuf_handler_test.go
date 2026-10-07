package server

import (
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protowire"
)

func TestCanonicalProtobufHandlerRejectsNonCanonicalWire(t *testing.T) {
	called := false
	handler := newCanonicalTestHandler(t, 1024, func(
		context.Context,
		*chat.ChatMessage,
	) (*chat.ChatMessage, error) {
		called = true
		return &chat.ChatMessage{}, nil
	})
	body := protowire.AppendTag(nil, 1, protowire.BytesType)
	body = protowire.AppendString(body, "")
	response := executeCanonicalTestHandler(handler, body, "/test")

	if called || response.status != http.StatusBadRequest {
		t.Fatalf(
			"noncanonical request called=%t status=%d, want false/400",
			called,
			response.status,
		)
	}
	if got := projectedTestCode(response.body); got != 20005 {
		t.Fatalf("error code = %d, want 20005", got)
	}
}

func TestCanonicalProtobufHandlerEnforcesRouteBodyLimit(t *testing.T) {
	handler := newCanonicalTestHandler(t, 1, func(
		context.Context,
		*chat.ChatMessage,
	) (*chat.ChatMessage, error) {
		t.Fatal("oversized request reached handler")
		return nil, nil
	})
	response := executeCanonicalTestHandler(handler, []byte{0x0a, 0x00}, "/test")
	if response.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", response.status)
	}
	if got := projectedTestCode(response.body); got != 30207 {
		t.Fatalf("error code = %d, want 30207", got)
	}
}

func TestCanonicalProtobufHandlerRequiresExactContentTypeAndNoQuery(t *testing.T) {
	handler := newCanonicalTestHandler(t, 1024, func(
		context.Context,
		*chat.ChatMessage,
	) (*chat.ChatMessage, error) {
		t.Fatal("invalid transport request reached handler")
		return nil, nil
	})
	for _, testCase := range []struct {
		name        string
		contentType string
		path        string
		status      int
		code        int32
	}{
		{
			name:        "protobuf alias",
			contentType: "application/x-protobuf",
			path:        "/test",
			status:      http.StatusUnsupportedMediaType,
			code:        20004,
		},
		{
			name:        "protobuf parameter",
			contentType: "application/protobuf; charset=binary",
			path:        "/test",
			status:      http.StatusUnsupportedMediaType,
			code:        20004,
		},
		{
			name:        "query",
			contentType: CanonicalProtobufContentType,
			path:        "/test?alias=1",
			status:      http.StatusBadRequest,
			code:        20003,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			response := &typedHandlerTestResponse{headers: map[string]string{}}
			request := &typedHandlerTestRequest{
				headers: map[string]string{"Content-Type": testCase.contentType},
				body:    []byte{0x0a, 0x01, 'x'},
				path:    testCase.path,
			}
			if err := handler.Handler()(
				context.Background(),
				request,
				response,
			); err != nil {
				t.Fatal(err)
			}
			if response.status != testCase.status ||
				projectedTestCode(response.body) != testCase.code {
				t.Fatalf("unexpected response: %+v", response)
			}
		})
	}
}

func TestCanonicalProtobufHandlerProjectsStructuredAuthFailure(t *testing.T) {
	handler := newCanonicalTestHandler(t, 1024, func(
		context.Context,
		*chat.ChatMessage,
	) (*chat.ChatMessage, error) {
		t.Fatal("unauthorized request reached handler")
		return nil, nil
	})
	endpoint := handler.Handler()
	response := &typedHandlerTestResponse{headers: map[string]string{}}
	ctx := WithRouteFailure(context.Background(), RouteError{
		Status:  http.StatusUnauthorized,
		Message: "unauthorized",
	})
	request := &typedHandlerTestRequest{}
	if err := endpoint(ctx, request, response); err != nil {
		t.Fatal(err)
	}
	if response.status != http.StatusUnauthorized ||
		response.headers["Content-Type"] != CanonicalProtobufContentType ||
		projectedTestCode(response.body) != 20001 {
		t.Fatalf("unexpected projected auth response: %+v", response)
	}
}

func TestCanonicalProtobufHandlerProjectsStreamingReadTimeout(t *testing.T) {
	handler := newCanonicalTestHandler(t, 1024, func(
		context.Context,
		*chat.ChatMessage,
	) (*chat.ChatMessage, error) {
		t.Fatal("timed out request reached handler")
		return nil, nil
	})
	request := &canonicalTimeoutRequest{
		typedHandlerTestRequest: typedHandlerTestRequest{
			headers: map[string]string{
				"Content-Type": CanonicalProtobufContentType,
			},
		},
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}
	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if response.status != http.StatusRequestTimeout ||
		projectedTestCode(response.body) != 20006 {
		t.Fatalf("unexpected timeout response: %+v", response)
	}
}

type canonicalTimeoutRequest struct {
	typedHandlerTestRequest
}

func (*canonicalTimeoutRequest) BodyStream() io.Reader {
	return canonicalTimeoutReader{}
}

type canonicalTimeoutReader struct{}

func (canonicalTimeoutReader) Read([]byte) (int, error) {
	return 0, canonicalTimeoutError{}
}

type canonicalTimeoutError struct{}

func (canonicalTimeoutError) Error() string   { return "read timeout" }
func (canonicalTimeoutError) Timeout() bool   { return true }
func (canonicalTimeoutError) Temporary() bool { return true }

func newCanonicalTestHandler(
	t *testing.T,
	limit int64,
	handle CanonicalProtobufHandler[
		*chat.ChatMessage,
		*chat.ChatMessage,
	],
) Handler {
	t.Helper()
	return NewCanonicalProtobufHandler(
		"canonical-test",
		"/test",
		POST,
		func() *chat.ChatMessage { return &chat.ChatMessage{} },
		handle,
		CanonicalProtobufHandlerOptions{
			MaxBodyBytes: limit,
			ErrorCodes: CanonicalProtobufErrorCodes{
				Unauthorized:           20001,
				InvalidQueryParameters: 20003,
				InvalidRequestBody:     20004,
				InvalidProtobuf:        20005,
				FailedToReadBody:       20006,
				PayloadTooLarge:        30207,
				InternalServer:         20008,
			},
			ProjectError: func(failure RouteError) ([]byte, error) {
				body := make([]byte, 4)
				binary.BigEndian.PutUint32(body, uint32(failure.StableCode))
				return body, nil
			},
		},
	)
}

func executeCanonicalTestHandler(
	handler Handler,
	body []byte,
	path string,
) *typedHandlerTestResponse {
	response := &typedHandlerTestResponse{headers: map[string]string{}}
	request := &typedHandlerTestRequest{
		headers: map[string]string{
			"Content-Type": CanonicalProtobufContentType,
		},
		body: body,
		path: path,
	}
	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		panic(err)
	}
	return response
}

func projectedTestCode(body []byte) int32 {
	if len(body) != 4 {
		return 0
	}
	return int32(binary.BigEndian.Uint32(body))
}
