package server

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

type typedHandlerTestRequest struct {
	headers       map[string]string
	body          []byte
	path          string
	nativeContext interface{}
}

func (r *typedHandlerTestRequest) Context() context.Context  { return context.Background() }
func (r *typedHandlerTestRequest) Header() map[string]string { return r.headers }
func (r *typedHandlerTestRequest) Method() Method            { return POST }
func (r *typedHandlerTestRequest) Path() string {
	if r.path != "" {
		return r.path
	}
	return "/test"
}
func (r *typedHandlerTestRequest) Body() []byte { return r.body }
func (r *typedHandlerTestRequest) GetHertzContext() interface{} {
	return r.nativeContext
}

type typedHandlerTestNativeContext struct {
	params map[string]string
}

func (c *typedHandlerTestNativeContext) Param(name string) string {
	return c.params[name]
}

type typedHandlerTestResponse struct {
	headers map[string]string
	body    []byte
	status  int
}

func (r *typedHandlerTestResponse) Header() map[string]string { return r.headers }
func (r *typedHandlerTestResponse) SetHeader(key, value string) {
	r.headers[key] = value
}
func (r *typedHandlerTestResponse) Write(body []byte) (int, error) {
	r.body = append(r.body, body...)
	return len(body), nil
}
func (r *typedHandlerTestResponse) Flush() error           { return nil }
func (r *typedHandlerTestResponse) WriteHeader(status int) { r.status = status }
func (r *typedHandlerTestResponse) Status() int            { return r.status }

func TestTypedHandlerQueryBindingUsesSnakeCaseJSONFields(t *testing.T) {
	type request struct {
		ConversationID string `json:"conversation_id" query:"conversation_id"`
		AfterSeq       int64  `json:"after_seq,string" query:"after_seq"`
		Limit          int    `json:"limit,string" query:"limit"`
	}

	queryJSON, ok := queryParamsToJSON(
		"/conversation/messages?conversation_id=direct-1&after_seq=7&limit=20",
	)
	if !ok {
		t.Fatal("queryParamsToJSON did not recognize valid query parameters")
	}

	var got request
	if err := (&ProtoJSONSerializer{}).Unmarshal(queryJSON, &got); err != nil {
		t.Fatalf("query unmarshal failed: %v", err)
	}
	if got.ConversationID != "direct-1" || got.AfterSeq != 7 || got.Limit != 20 {
		t.Fatalf("unexpected bound request: %+v", got)
	}
}

func TestTypedHandlerBindsRoutePathParamsIntoProtoRequest(t *testing.T) {
	var got string
	handler := NewTypedHandler(
		"path-request",
		"/federations/:federation_id",
		GET,
		func(
			_ context.Context,
			request *chat.Conversation,
		) (*chat.Conversation, error) {
			got = request.FederationId

			return &chat.Conversation{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		path: "/federations/01ROUTE",
		nativeContext: &typedHandlerTestNativeContext{
			params: map[string]string{"federation_id": "01ROUTE"},
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
	if got != "01ROUTE" {
		t.Fatalf("bound federation_id = %q, want route value", got)
	}
	if response.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.status)
	}
}

func TestTypedHandlerPathParamsOverrideProtobufBodyAndPreservePayload(t *testing.T) {
	body, err := proto.Marshal(&chat.Conversation{
		FederationId: "01BODY",
		Name:         "preserve me",
	})
	if err != nil {
		t.Fatal(err)
	}

	var got *chat.Conversation
	handler := NewTypedHandler(
		"path-body-request",
		"/federations/:federation_id",
		POST,
		func(
			_ context.Context,
			request *chat.Conversation,
		) (*chat.Conversation, error) {
			got = proto.Clone(request).(*chat.Conversation)

			return &chat.Conversation{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		headers: map[string]string{"Content-Type": "application/protobuf"},
		body:    body,
		path:    "/federations/01ROUTE",
		nativeContext: &typedHandlerTestNativeContext{
			params: map[string]string{"federation_id": "01ROUTE"},
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
	if got == nil || got.FederationId != "01ROUTE" || got.Name != "preserve me" {
		t.Fatalf("unexpected bound request: %+v", got)
	}
}

func TestTypedHandlerRejectsPathAndQueryParamConflict(t *testing.T) {
	called := false
	handler := NewTypedHandler(
		"path-query-conflict",
		"/federations/:federation_id",
		GET,
		func(
			_ context.Context,
			_ *chat.Conversation,
		) (*chat.Conversation, error) {
			called = true

			return &chat.Conversation{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		path: "/federations/01ROUTE?federation_id=01QUERY",
		nativeContext: &typedHandlerTestNativeContext{
			params: map[string]string{"federation_id": "01ROUTE"},
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
	if called {
		t.Fatal("typed handler accepted conflicting path and query values")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.status)
	}
}

func TestTypedHandlerRejectsRouteParamMissingFromRequestType(t *testing.T) {
	called := false
	handler := NewTypedHandler(
		"unknown-path-param",
		"/federations/:missing_id",
		GET,
		func(
			_ context.Context,
			_ *chat.Conversation,
		) (*chat.Conversation, error) {
			called = true

			return &chat.Conversation{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		path: "/federations/01ROUTE",
		nativeContext: &typedHandlerTestNativeContext{
			params: map[string]string{"missing_id": "01ROUTE"},
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
	if called {
		t.Fatal("typed handler accepted a route parameter absent from the request")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.status)
	}
}

func TestTypedHandlerWritesStructuredHandlerError(t *testing.T) {
	expectedBody := []byte{1, 2, 3}
	handler := NewTypedHandler(
		"structured-error",
		"/test",
		POST,
		func(context.Context, *struct{}) (*struct{}, error) {
			return nil, NewHandlerErrorWithResponse(
				http.StatusTooManyRequests,
				"retry later",
				"application/x-protobuf",
				expectedBody,
				map[string]string{"Retry-After": "2"},
			)
		},
	)
	request := &typedHandlerTestRequest{
		headers: map[string]string{"Content-Type": "application/x-protobuf"},
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(context.Background(), request, response); err != nil {
		t.Fatal(err)
	}
	if response.status != http.StatusTooManyRequests ||
		response.headers["Content-Type"] != "application/x-protobuf" ||
		response.headers["Retry-After"] != "2" ||
		string(response.body) != string(expectedBody) {
		t.Fatalf("unexpected structured response: %+v", response)
	}
}

func TestStrictTypedHandlerRejectsUnknownJSONFields(t *testing.T) {
	called := false
	handler := NewStrictTypedHandler(
		"strict-request",
		"/test",
		POST,
		func(
			context.Context,
			*chat.ChatMessage,
		) (*chat.ChatMessage, error) {
			called = true
			return &chat.ChatMessage{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		headers: map[string]string{"Content-Type": "application/json"},
		body: []byte(
			`{"ulid":"01TEST000000000000TEST","unknown_field":"forbidden"}`,
		),
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("strict typed handler invoked business logic for an unknown field")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("strict typed status = %d, want 400", response.status)
	}
}

func TestStrictTypedHandlerRejectsUnknownProtobufFields(t *testing.T) {
	called := false
	handler := NewStrictTypedHandler(
		"strict-protobuf-request",
		"/test",
		POST,
		func(
			context.Context,
			*chat.ChatMessage,
		) (*chat.ChatMessage, error) {
			called = true
			return &chat.ChatMessage{}, nil
		},
	)
	body, err := proto.Marshal(&chat.ChatMessage{
		Id: "01TEST000000000000TEST",
	})
	if err != nil {
		t.Fatal(err)
	}
	body = protowire.AppendTag(body, 999, protowire.VarintType)
	body = protowire.AppendVarint(body, 1)
	request := &typedHandlerTestRequest{
		headers: map[string]string{"Content-Type": "application/protobuf"},
		body:    body,
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("strict typed handler invoked business logic for unknown protobuf")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("strict typed status = %d, want 400", response.status)
	}
}

func TestStrictTypedHandlerRejectsUnknownQueryFields(t *testing.T) {
	called := false
	handler := NewStrictTypedHandler(
		"strict-query-request",
		"/test",
		GET,
		func(
			context.Context,
			*chat.ChatMessage,
		) (*chat.ChatMessage, error) {
			called = true
			return &chat.ChatMessage{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		path: "/test?ulid=01TEST000000000000TEST&unknown_field=forbidden",
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("strict typed handler invoked business logic for unknown query")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("strict typed status = %d, want 400", response.status)
	}
}

func TestStrictTypedHandlerRejectsQueryAlongsideBody(t *testing.T) {
	called := false
	handler := NewStrictTypedHandler(
		"strict-body-query-request",
		"/test",
		POST,
		func(
			context.Context,
			*chat.ChatMessage,
		) (*chat.ChatMessage, error) {
			called = true
			return &chat.ChatMessage{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		headers: map[string]string{"Content-Type": "application/json"},
		body:    []byte(`{"ulid":"01TEST000000000000TEST"}`),
		path:    "/test?unknown_field=forbidden",
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("strict typed handler ignored query data beside the body")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("strict typed status = %d, want 400", response.status)
	}
}

func TestStrictTypedHandlerRejectsQueryOnlyPost(t *testing.T) {
	called := false
	handler := NewStrictTypedHandler(
		"strict-query-only-post",
		"/test",
		POST,
		func(
			context.Context,
			*chat.ChatMessage,
		) (*chat.ChatMessage, error) {
			called = true
			return &chat.ChatMessage{}, nil
		},
	)
	request := &typedHandlerTestRequest{
		path: "/test?ulid=01TEST000000000000TEST",
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}

	if err := handler.Handler()(
		context.Background(),
		request,
		response,
	); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("strict POST accepted a query-only control message")
	}
	if response.status != http.StatusBadRequest {
		t.Fatalf("strict typed status = %d, want 400", response.status)
	}
}

func TestHTTPWrapperAdapterPreservesStreamingBody(t *testing.T) {
	streaming := &typedStreamingRequest{
		typedHandlerTestRequest: &typedHandlerTestRequest{
			headers: map[string]string{"Content-Length": "4"},
		},
		reader: bytes.NewBufferString("body"),
	}
	response := &typedHandlerTestResponse{headers: map[string]string{}}
	wrapper := HTTPWrapperAdapter(func(
		_ context.Context,
		next http.Handler,
	) http.Handler {
		return next
	})
	endpoint := wrapper(func(
		_ context.Context,
		request Request,
		_ Response,
	) error {
		body, err := io.ReadAll(request.(StreamingRequest).BodyStream())
		if err != nil {
			return err
		}
		if string(body) != "body" {
			t.Fatalf("streamed body = %q", body)
		}
		return nil
	})

	if err := endpoint(context.Background(), streaming, response); err != nil {
		t.Fatal(err)
	}
	if streaming.bodyCalled {
		t.Fatal("HTTP wrapper buffered the streaming request through Body")
	}
}

type typedStreamingRequest struct {
	*typedHandlerTestRequest
	reader     io.Reader
	bodyCalled bool
}

func (r *typedStreamingRequest) Body() []byte {
	r.bodyCalled = true
	return nil
}

func (r *typedStreamingRequest) BodyStream() io.Reader {
	return r.reader
}
