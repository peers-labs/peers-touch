package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const maxTypedRequestBodyBytes int64 = 64 << 20

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
	return newTypedHandler(name, path, method, handler, false, wrappers...)
}

// NewStrictTypedHandler is the canonical typed surface for security-sensitive
// control messages. It rejects unknown JSON, query, and protobuf fields instead
// of silently normalizing distinct requests to the same command.
func NewStrictTypedHandler[Req, Resp any](
	name, path string,
	method Method,
	handler TypedHandler[Req, Resp],
	wrappers ...Wrapper,
) Handler {
	return newTypedHandler(name, path, method, handler, true, wrappers...)
}

func newTypedHandler[Req, Resp any](
	name, path string,
	method Method,
	handler TypedHandler[Req, Resp],
	strict bool,
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
		if strict {
			switch requestSerializer.(type) {
			case *ProtoJSONSerializer:
				requestSerializer = &ProtoJSONSerializer{RejectUnknown: true}
			case *ProtoSerializer:
				requestSerializer = &ProtoSerializer{
					RejectDuplicateSingular: true,
				}
			}
		}

		// 2. Deserialize request
		var request Req
		reqValue := reflect.ValueOf(&request)
		if reqValue.Elem().Kind() == reflect.Ptr {
			// If Req is a pointer type, create a new instance
			reqValue.Elem().Set(reflect.New(reqValue.Elem().Type().Elem()))
		}

		body, readErr := readBoundedTypedRequestBody(req)
		if readErr != nil {
			if strict {
				writeTypedRequestError(
					resp,
					http.StatusRequestEntityTooLarge,
					"Request body is too large",
				)
				return nil
			}
			return &HandlerError{
				Code:    http.StatusRequestEntityTooLarge,
				Message: "Request body is too large",
				Err:     readErr,
			}
		}
		queryValues, hasQuery, queryErr := queryParams(req.Path())
		if queryErr != nil {
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		pathValues, pathErr := routePathParams(path, req)
		if pathErr != nil {
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		for name := range pathValues {
			if _, exists := queryValues[name]; exists {
				writeTypedRequestError(
					resp,
					http.StatusBadRequest,
					"Invalid request format",
				)
				return nil
			}
		}
		queryJSON, queryMarshalErr := json.Marshal(queryValues)
		if queryMarshalErr != nil {
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		rawQuery := ""
		if index := strings.Index(req.Path(), "?"); index >= 0 {
			rawQuery = req.Path()[index+1:]
		}
		if strict && method != GET && rawQuery != "" {
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		if strict && len(body) > 0 && rawQuery != "" {
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		if len(body) > 0 {
			if err := requestSerializer.Unmarshal(body, &request); err != nil {
				logger.Error(ctx, "Failed to deserialize request", "error", err, "contentType", contentType)
				if strict {
					writeTypedRequestError(
						resp,
						http.StatusBadRequest,
						"Invalid request format",
					)
					return nil
				}
				return &HandlerError{
					Code:    http.StatusBadRequest,
					Message: "Invalid request format",
					Err:     err,
				}
			}
		} else {
			if hasQuery {
				// For requests with no body (typically GET), populate the typed
				// request from URL query params before authoritative path binding.
				querySerializer := &ProtoJSONSerializer{RejectUnknown: strict}
				if err := querySerializer.Unmarshal(queryJSON, &request); err != nil {
					if strict {
						writeTypedRequestError(
							resp,
							http.StatusBadRequest,
							"Invalid request format",
						)
						return nil
					}
					logger.Warn(ctx, "Failed to deserialize query params into request", "error", err, "path", req.Path())
				}
			} else if strict && rawQuery != "" {
				writeTypedRequestError(
					resp,
					http.StatusBadRequest,
					"Invalid request format",
				)
				return nil
			}
		}
		if err := bindTypedPathParams(pathValues, &request); err != nil {
			logger.Warn(ctx, "Failed to bind path params into request", "error", err, "path", req.Path())
			writeTypedRequestError(
				resp,
				http.StatusBadRequest,
				"Invalid request format",
			)
			return nil
		}
		if strict {
			if message, ok := any(&request).(proto.Message); ok &&
				len(message.ProtoReflect().GetUnknown()) != 0 {
				writeTypedRequestError(
					resp,
					http.StatusBadRequest,
					"Invalid request format",
				)
				return nil
			}
		}

		// 3. Call the typed handler
		response, err := handler(ctx, &request)
		if err != nil {
			// Check if it's a HandlerError
			if handlerErr, ok := err.(*HandlerError); ok {
				for name, value := range handlerErr.Headers {
					resp.SetHeader(name, value)
				}
				if len(handlerErr.Body) > 0 {
					if handlerErr.ContentType != "" {
						resp.SetHeader("Content-Type", handlerErr.ContentType)
					}
					resp.WriteHeader(handlerErr.Code)
					_, _ = resp.Write(handlerErr.Body)
					return nil
				}

				// Write error message in the same format as request
				respSerializer := negotiator.GetResponseSerializer(contentType, responseSerializer)
				errorResp := map[string]interface{}{
					"error": handlerErr.Message,
					"code":  handlerErr.Code,
				}

				errorData, _ := respSerializer.Marshal(errorResp)
				resp.SetHeader("Content-Type", respSerializer.ContentType())
				resp.WriteHeader(handlerErr.Code)
				_, _ = resp.Write(errorData)
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

func writeTypedRequestError(
	response Response,
	status int,
	message string,
) {
	body, _ := json.Marshal(map[string]any{
		"error": message,
		"code":  status,
	})
	response.SetHeader("Content-Type", "application/json")
	response.WriteHeader(status)
	_, _ = response.Write(body)
}

func readBoundedTypedRequestBody(request Request) ([]byte, error) {
	var reader io.Reader
	if streaming, ok := request.(StreamingRequest); ok {
		reader = streaming.BodyStream()
	} else {
		body := request.Body()
		if int64(len(body)) > maxTypedRequestBodyBytes {
			return nil, fmt.Errorf(
				"typed request body exceeds %d bytes",
				maxTypedRequestBodyBytes,
			)
		}
		return body, nil
	}
	body, err := io.ReadAll(
		io.LimitReader(reader, maxTypedRequestBodyBytes+1),
	)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxTypedRequestBodyBytes {
		return nil, fmt.Errorf(
			"typed request body exceeds %d bytes",
			maxTypedRequestBodyBytes,
		)
	}
	return body, nil
}

type nativeRequestContextGetter interface {
	GetHertzContext() interface{}
}

type routePathParamReader interface {
	Param(string) string
}

func routePathParams(routePath string, request Request) (map[string]interface{}, error) {
	names := routePathParamNames(routePath)
	if len(names) == 0 {
		return map[string]interface{}{}, nil
	}

	contextGetter, ok := request.(nativeRequestContextGetter)
	if !ok {
		return nil, errors.New("request adapter does not expose route parameters")
	}
	nativeContext := contextGetter.GetHertzContext()
	if nativeContext == nil {
		return nil, errors.New("request adapter does not expose route parameters")
	}
	paramReader, ok := nativeContext.(routePathParamReader)
	if !ok {
		return nil, errors.New("request adapter context does not expose route parameters")
	}

	values := make(map[string]interface{}, len(names))
	for _, name := range names {
		if _, exists := values[name]; exists {
			return nil, fmt.Errorf("route parameter %q is duplicated", name)
		}
		value := paramReader.Param(name)
		if value == "" {
			return nil, fmt.Errorf("route parameter %q is missing", name)
		}
		values[name] = value
	}

	return values, nil
}

func routePathParamNames(routePath string) []string {
	segments := strings.Split(routePath, "/")
	names := make([]string, 0, len(segments))
	for _, segment := range segments {
		if strings.HasPrefix(segment, ":") && len(segment) > 1 {
			names = append(names, segment[1:])
		}
	}

	return names
}

func bindTypedPathParams(values map[string]interface{}, request interface{}) error {
	if len(values) == 0 {
		return nil
	}
	data, err := json.Marshal(values)
	if err != nil {
		return err
	}

	message, ok := request.(proto.Message)
	if !ok {
		decoder := json.NewDecoder(strings.NewReader(string(data)))
		decoder.DisallowUnknownFields()

		return decoder.Decode(request)
	}

	target := message.ProtoReflect()
	pathMessage := target.Type().New()
	if err := (&ProtoJSONSerializer{RejectUnknown: true}).Unmarshal(
		data,
		pathMessage.Interface(),
	); err != nil {
		return err
	}
	fields := target.Descriptor().Fields()
	for name := range values {
		var field protoreflect.FieldDescriptor
		for index := 0; index < fields.Len(); index++ {
			candidate := fields.Get(index)
			if string(candidate.Name()) == name || candidate.JSONName() == name {
				field = candidate
				break
			}
		}
		if field == nil || field.IsList() || field.IsMap() ||
			field.Message() != nil {
			return fmt.Errorf("route parameter %q is not a scalar request field", name)
		}
		target.Set(field, pathMessage.Get(field))
	}

	return nil
}

// queryParamsToJSON extracts URL query parameters and encodes them as a JSON object.
// This enables TypedHandler to populate typed request structs from GET query strings
// via ProtoJSONSerializer, which accepts proto field names (snake_case).
func queryParamsToJSON(path string) ([]byte, bool) {
	values, ok, err := queryParams(path)
	if err != nil || !ok {
		return nil, false
	}
	data, err := json.Marshal(values)
	if err != nil {
		return nil, false
	}

	return data, true
}

func queryParams(path string) (map[string]interface{}, bool, error) {
	idx := strings.Index(path, "?")
	if idx == -1 {
		return map[string]interface{}{}, false, nil
	}
	values, err := url.ParseQuery(path[idx+1:])
	if err != nil {
		return nil, false, err
	}
	if len(values) == 0 {
		return map[string]interface{}{}, false, nil
	}
	m := make(map[string]interface{}, len(values))
	for k, v := range values {
		if len(v) == 1 {
			m[k] = v[0]
		} else {
			m[k] = v
		}
	}

	return m, true, nil
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
				for name, value := range handlerErr.Headers {
					resp.SetHeader(name, value)
				}
				if len(handlerErr.Body) > 0 {
					if handlerErr.ContentType != "" {
						resp.SetHeader("Content-Type", handlerErr.ContentType)
					}
					resp.WriteHeader(handlerErr.Code)
					_, _ = resp.Write(handlerErr.Body)
					return nil
				}

				errorResp := map[string]interface{}{
					"error": handlerErr.Message,
					"code":  handlerErr.Code,
				}

				serializer := &JSONSerializer{}
				errorData, _ := serializer.Marshal(errorResp)
				resp.SetHeader("Content-Type", "application/json")
				resp.WriteHeader(handlerErr.Code)
				_, _ = resp.Write(errorData)
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
