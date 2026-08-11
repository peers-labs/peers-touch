package server

import (
	"context"
	"net/http"
	"testing"
)

type typedHandlerTestRequest struct {
	headers map[string]string
	body    []byte
}

func (r *typedHandlerTestRequest) Context() context.Context  { return context.Background() }
func (r *typedHandlerTestRequest) Header() map[string]string { return r.headers }
func (r *typedHandlerTestRequest) Method() Method            { return POST }
func (r *typedHandlerTestRequest) Path() string              { return "/test" }
func (r *typedHandlerTestRequest) Body() []byte              { return r.body }

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
