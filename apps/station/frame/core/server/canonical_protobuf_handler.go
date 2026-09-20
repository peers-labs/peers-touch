package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const CanonicalProtobufContentType = "application/protobuf"

type CanonicalProtobufErrorCodes struct {
	Unauthorized           int32
	InvalidQueryParameters int32
	InvalidRequestBody     int32
	InvalidProtobuf        int32
	FailedToReadBody       int32
	PayloadTooLarge        int32
	InternalServer         int32
}

type RouteError struct {
	Status     int
	StableCode int32
	Message    string
	RetryAfter time.Duration
	Cause      error
}

func (e *RouteError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *RouteError) Unwrap() error {
	return e.Cause
}

type RouteErrorProjector func(RouteError) ([]byte, error)

type CanonicalProtobufHandlerOptions struct {
	MaxBodyBytes int64
	ErrorCodes   CanonicalProtobufErrorCodes
	ProjectError RouteErrorProjector
}

type CanonicalProtobufHandler[
	RequestMessage proto.Message,
	ResponseMessage proto.Message,
] func(
	context.Context,
	RequestMessage,
) (ResponseMessage, error)

type routeFailureContextKey struct{}

func WithRouteFailure(ctx context.Context, failure RouteError) context.Context {
	return context.WithValue(ctx, routeFailureContextKey{}, failure)
}

func RouteFailureFromContext(ctx context.Context) (RouteError, bool) {
	failure, ok := ctx.Value(routeFailureContextKey{}).(RouteError)
	return failure, ok
}

func NewCanonicalProtobufHandler[
	RequestMessage proto.Message,
	ResponseMessage proto.Message,
](
	name string,
	path string,
	method Method,
	newRequest func() RequestMessage,
	handler CanonicalProtobufHandler[RequestMessage, ResponseMessage],
	options CanonicalProtobufHandlerOptions,
	wrappers ...Wrapper,
) Handler {
	if newRequest == nil || handler == nil {
		panic("server: canonical protobuf handler requires request factory and handler")
	}
	if options.MaxBodyBytes <= 0 || options.ProjectError == nil {
		panic("server: canonical protobuf handler requires body limit and error projector")
	}

	endpoint := func(
		ctx context.Context,
		request Request,
		response Response,
	) error {
		if failure, ok := RouteFailureFromContext(ctx); ok {
			if failure.StableCode == 0 {
				failure.StableCode = options.ErrorCodes.Unauthorized
			}
			return writeProjectedRouteError(response, options.ProjectError, failure)
		}
		if rawQuery(request.Path()) != "" {
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     http.StatusBadRequest,
				StableCode: options.ErrorCodes.InvalidQueryParameters,
				Message:    "invalid query parameters",
			})
		}
		if !isCanonicalProtobufContentType(request.Header()) {
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     http.StatusUnsupportedMediaType,
				StableCode: options.ErrorCodes.InvalidRequestBody,
				Message:    "invalid request body",
			})
		}

		body, err := readCanonicalProtobufBody(request, options.MaxBodyBytes)
		if err != nil {
			status := http.StatusBadRequest
			code := options.ErrorCodes.FailedToReadBody
			message := "failed to read body"
			var tooLarge *canonicalProtobufBodyTooLargeError
			if errors.As(err, &tooLarge) {
				status = http.StatusRequestEntityTooLarge
				code = options.ErrorCodes.PayloadTooLarge
				message = "payload too large"
			} else if isCanonicalProtobufReadTimeout(err) ||
				errors.Is(request.Context().Err(), context.DeadlineExceeded) {
				status = http.StatusRequestTimeout
			}
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     status,
				StableCode: code,
				Message:    message,
				Cause:      err,
			})
		}
		if len(body) == 0 {
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     http.StatusBadRequest,
				StableCode: options.ErrorCodes.InvalidRequestBody,
				Message:    "invalid request body",
			})
		}

		decoded := newRequest()
		if err := decodeCanonicalProtobuf(body, decoded); err != nil {
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     http.StatusBadRequest,
				StableCode: options.ErrorCodes.InvalidProtobuf,
				Message:    "invalid protobuf",
				Cause:      err,
			})
		}
		result, err := handler(ctx, decoded)
		if err != nil {
			var routeError *RouteError
			if !errors.As(err, &routeError) {
				logger.Error(ctx, "Canonical protobuf handler failed", "error", err)
				routeError = &RouteError{
					Status:     http.StatusInternalServerError,
					StableCode: options.ErrorCodes.InternalServer,
					Message:    "internal server error",
					Cause:      err,
				}
			}
			return writeProjectedRouteError(response, options.ProjectError, *routeError)
		}

		body, err = proto.MarshalOptions{Deterministic: true}.Marshal(result)
		if err != nil {
			return writeProjectedRouteError(response, options.ProjectError, RouteError{
				Status:     http.StatusInternalServerError,
				StableCode: options.ErrorCodes.InternalServer,
				Message:    "internal server error",
				Cause:      err,
			})
		}
		response.SetHeader("Content-Type", CanonicalProtobufContentType)
		response.WriteHeader(http.StatusOK)
		_, err = response.Write(body)
		return err
	}

	return NewHTTPHandler(name, path, method, endpoint, wrappers...)
}

func isCanonicalProtobufReadTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var networkError net.Error
	return errors.As(err, &networkError) && networkError.Timeout()
}

func NewRouteError(
	status int,
	stableCode int32,
	message string,
	cause error,
) *RouteError {
	return &RouteError{
		Status:     status,
		StableCode: stableCode,
		Message:    message,
		Cause:      cause,
	}
}

func writeProjectedRouteError(
	response Response,
	project RouteErrorProjector,
	failure RouteError,
) error {
	body, err := project(failure)
	if err != nil {
		return fmt.Errorf("project route error: %w", err)
	}
	response.SetHeader("Content-Type", CanonicalProtobufContentType)
	if failure.RetryAfter > 0 {
		seconds := int64(failure.RetryAfter / time.Second)
		if seconds < 1 {
			seconds = 1
		}
		if seconds > 300 {
			seconds = 300
		}
		response.SetHeader("Retry-After", fmt.Sprintf("%d", seconds))
	}
	response.WriteHeader(failure.Status)
	_, err = response.Write(body)
	return err
}

func rawQuery(path string) string {
	if index := strings.IndexByte(path, '?'); index >= 0 {
		return path[index+1:]
	}
	return ""
}

func isCanonicalProtobufContentType(headers map[string]string) bool {
	for name, value := range headers {
		if !strings.EqualFold(name, "Content-Type") {
			continue
		}
		mediaType, parameters, err := mime.ParseMediaType(value)
		return err == nil &&
			len(parameters) == 0 &&
			mediaType == CanonicalProtobufContentType
	}
	return false
}

type canonicalProtobufBodyTooLargeError struct {
	limit int64
}

func (e *canonicalProtobufBodyTooLargeError) Error() string {
	return fmt.Sprintf("canonical protobuf body exceeds %d bytes", e.limit)
}

func readCanonicalProtobufBody(request Request, limit int64) ([]byte, error) {
	if streaming, ok := request.(StreamingRequest); ok {
		body, err := io.ReadAll(io.LimitReader(streaming.BodyStream(), limit+1))
		if err != nil {
			return nil, err
		}
		if int64(len(body)) > limit {
			return nil, &canonicalProtobufBodyTooLargeError{limit: limit}
		}
		return body, nil
	}
	body := request.Body()
	if int64(len(body)) > limit {
		return nil, &canonicalProtobufBodyTooLargeError{limit: limit}
	}
	return body, nil
}

func decodeCanonicalProtobuf(body []byte, message proto.Message) error {
	if err := rejectDuplicateProtoFields(
		body,
		message.ProtoReflect().Descriptor(),
		100,
	); err != nil {
		return err
	}
	if err := (proto.UnmarshalOptions{
		DiscardUnknown: false,
		RecursionLimit: 100,
	}).Unmarshal(body, message); err != nil {
		return err
	}
	if err := rejectRecursiveUnknownFields(message.ProtoReflect(), 100); err != nil {
		return err
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, body) {
		return errors.New("protobuf request is not in canonical deterministic form")
	}
	return nil
}

func rejectRecursiveUnknownFields(
	message protoreflect.Message,
	depth int,
) error {
	if depth <= 0 {
		return errors.New("protobuf recursion limit exceeded")
	}
	if len(message.GetUnknown()) != 0 {
		return errors.New("protobuf message contains unknown fields")
	}
	var nestedError error
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Message() == nil {
			return true
		}
		switch {
		case field.IsMap() && field.MapValue().Message() != nil:
			value.Map().Range(func(_ protoreflect.MapKey, item protoreflect.Value) bool {
				if nestedError = rejectRecursiveUnknownFields(
					item.Message(),
					depth-1,
				); nestedError != nil {
					return false
				}
				return true
			})
		case field.IsList():
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				if nestedError = rejectRecursiveUnknownFields(
					list.Get(index).Message(),
					depth-1,
				); nestedError != nil {
					return false
				}
			}
		default:
			if nestedError = rejectRecursiveUnknownFields(
				value.Message(),
				depth-1,
			); nestedError != nil {
				return false
			}
		}
		return nestedError == nil
	})
	return nestedError
}
