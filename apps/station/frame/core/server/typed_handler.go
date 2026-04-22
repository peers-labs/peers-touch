package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// TypedHandler is a handler function that takes a typed request and returns a typed response
type TypedHandler[Req, Resp any] func(context.Context, *Req) (*Resp, error)

// NewTypedHandler creates a new typed handler with automatic serialization/deserialization
// It supports both JSON and Protocol Buffers based on Content-Type header
func NewTypedHandler[Req, Resp any](
	name, path string,
	method Method,
	handler TypedHandler[Req, Resp],
	wrappers ...Wrapper,
) Handler {
	negotiator := NewContentNegotiator()

	// Determine response type serializer at registration time
	var respInstance Resp
	respType := reflect.TypeOf(respInstance)
	responseSerializer := GetSerializerForType(respType)

	// Wrap the typed handler into EndpointHandler
	endpointHandler := func(ctx context.Context, req Request, resp Response) error {
		contentType := ""
		if headers := req.Header(); headers != nil {
			contentType = headers["Content-Type"]
		}

		// 1. Get request serializer based on Content-Type
		requestSerializer := negotiator.GetRequestSerializer(contentType)

		// 2. Deserialize request
		var request Req
		reqValue := reflect.ValueOf(&request)
		if reqValue.Elem().Kind() == reflect.Ptr {
			// If Req is a pointer type, create a new instance
			reqValue.Elem().Set(reflect.New(reqValue.Elem().Type().Elem()))
		}

		if len(req.Body()) > 0 {
			if err := requestSerializer.Unmarshal(req.Body(), &request); err != nil {
				logger.Error(ctx, "Failed to deserialize request", "error", err, "contentType", contentType)
				return &HandlerError{
					Code:    http.StatusBadRequest,
					Message: "Invalid request format",
					Err:     err,
				}
			}
		} else if queryJSON, ok := queryParamsToJSON(req.Path()); ok {
			// For requests with no body (typically GET), populate the typed request
			// from URL query params via ProtoJSONSerializer (accepts snake_case field names).
			querySerializer := &ProtoJSONSerializer{}
			if err := querySerializer.Unmarshal(queryJSON, &request); err != nil {
				logger.Warn(ctx, "Failed to deserialize query params into request", "error", err, "path", req.Path())
			}
		}

		// 3. Call the typed handler
		response, err := handler(ctx, &request)
		if err != nil {
			// Check if it's a HandlerError
			if handlerErr, ok := err.(*HandlerError); ok {
				resp.WriteHeader(handlerErr.Code)

				// Write error message in the same format as request
				respSerializer := negotiator.GetResponseSerializer(contentType, responseSerializer)
				errorResp := map[string]interface{}{
					"error": handlerErr.Message,
					"code":  handlerErr.Code,
				}

				errorData, _ := respSerializer.Marshal(errorResp)
				resp.SetHeader("Content-Type", respSerializer.ContentType())
				resp.Write(errorData)
				return nil
			}

			// Generic error
			logger.Error(ctx, "Handler error", "error", err)
			resp.WriteHeader(http.StatusInternalServerError)
			return err
		}

		// 4. Serialize response
		respSerializer := negotiator.GetResponseSerializer(contentType, responseSerializer)
		data, err := respSerializer.Marshal(response)
		if err != nil {
			logger.Error(ctx, "Failed to serialize response", "error", err)
			return &HandlerError{
				Code:    http.StatusInternalServerError,
				Message: "Failed to serialize response",
				Err:     err,
			}
		}

		resp.SetHeader("Content-Type", respSerializer.ContentType())
		resp.WriteHeader(http.StatusOK)
		resp.Write(data)

		return nil
	}

	return NewHTTPHandler(name, path, method, endpointHandler, wrappers...)
}

// queryParamsToJSON extracts URL query parameters and encodes them as a JSON object.
// This enables TypedHandler to populate typed request structs from GET query strings
// via ProtoJSONSerializer, which accepts proto field names (snake_case).
func queryParamsToJSON(path string) ([]byte, bool) {
	idx := strings.Index(path, "?")
	if idx == -1 {
		return nil, false
	}
	values, err := url.ParseQuery(path[idx+1:])
	if err != nil || len(values) == 0 {
		return nil, false
	}
	m := make(map[string]interface{}, len(values))
	for k, v := range values {
		if len(v) == 1 {
			m[k] = v[0]
		} else {
			m[k] = v
		}
	}
	data, err := json.Marshal(m)
	if err != nil {
		return nil, false
	}
	return data, true
}

// TypedHandlerFunc is a convenience type for handlers that don't need typed request/response
// but want automatic error handling
type TypedHandlerFunc func(context.Context, Request, Response) error

// NewSimpleHandler creates a handler with automatic error handling but no serialization
func NewSimpleHandler(
	name, path string,
	method Method,
	handler TypedHandlerFunc,
	wrappers ...Wrapper,
) Handler {
	endpointHandler := func(ctx context.Context, req Request, resp Response) error {
		err := handler(ctx, req, resp)
		if err != nil {
			if handlerErr, ok := err.(*HandlerError); ok {
				resp.WriteHeader(handlerErr.Code)

				errorResp := map[string]interface{}{
					"error": handlerErr.Message,
					"code":  handlerErr.Code,
				}

				serializer := &JSONSerializer{}
				errorData, _ := serializer.Marshal(errorResp)
				resp.SetHeader("Content-Type", "application/json")
				resp.Write(errorData)
				return nil
			}

			logger.Error(ctx, "Handler error", "error", err)
			resp.WriteHeader(http.StatusInternalServerError)
			http.Error(nil, fmt.Sprintf("Internal server error: %v", err), http.StatusInternalServerError)
		}
		return err
	}

	return NewHTTPHandler(name, path, method, endpointHandler, wrappers...)
}
