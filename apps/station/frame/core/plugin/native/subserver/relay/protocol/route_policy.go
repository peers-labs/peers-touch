package protocol

import (
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	SocialPrivateObjectReadRoutePrefix = "/federation/social/private/objects/"
	socialPrivateObjectReadRouteSuffix = "/read"
	SocialPrivateObjectReadRoute       = "social-private-object-read"

	PeerHopRequestIDHeader = "X-Request-ID"

	RouteLogOutcomeAccepted    = "accepted"
	RouteLogOutcomeRejected    = "rejected"
	RouteLogOutcomeInterrupted = "interrupted"
	RouteLogOutcomeRetryable   = "retryable"

	MaxPrivateObjectRequestBodyLen       = 4 * 1024
	MaxPrivateObjectResponseBodyLen      = 1024 * 1024
	MaxPrivateObjectResponseHeadersLen   = 8 * 1024
	MaxPrivateObjectResponseMetadataLen  = 69
	MaxPrivateObjectResponseMetadataText = 92
	MaxPrivateObjectResponsePayloadLen   = MaxPrivateObjectResponseBodyLen +
		MaxPrivateObjectResponseHeadersLen + 12

	PrivateObjectMetadataHeader = "X-Peers-Social-Object-Metadata"
)

// RoutePolicy describes the bounded Relay framing contract for a target route.
type RoutePolicy struct {
	Category              string
	MaxRequestBodyLen     uint32
	MaxResponseBodyLen    uint32
	MaxResponseHeadersLen uint32
	MaxResponsePayloadLen uint32
}

// RouteLogContext is the complete set of request-derived fields permitted in
// private-object Relay logs.
type RouteLogContext struct {
	Category  string
	Method    string
	RequestID string
}

var privateObjectReadPolicy = RoutePolicy{
	Category:              SocialPrivateObjectReadRoute,
	MaxRequestBodyLen:     MaxPrivateObjectRequestBodyLen,
	MaxResponseBodyLen:    MaxPrivateObjectResponseBodyLen,
	MaxResponseHeadersLen: MaxPrivateObjectResponseHeadersLen,
	MaxResponsePayloadLen: MaxPrivateObjectResponsePayloadLen,
}

// RoutePolicyForPath returns the route-specific limits for a bound target path.
func RoutePolicyForPath(path string) (RoutePolicy, bool) {
	path, _, _ = strings.Cut(path, "?")
	if !strings.HasPrefix(path, SocialPrivateObjectReadRoutePrefix) ||
		!strings.HasSuffix(path, socialPrivateObjectReadRouteSuffix) {
		return RoutePolicy{}, false
	}
	objectID := strings.TrimSuffix(
		strings.TrimPrefix(path, SocialPrivateObjectReadRoutePrefix),
		socialPrivateObjectReadRouteSuffix,
	)
	if objectID == "" || strings.Contains(objectID, "/") {
		return RoutePolicy{}, false
	}
	return privateObjectReadPolicy, true
}

// PrivateObjectRouteLogContext classifies and sanitizes the only request
// fields that may survive into private-object Relay logs.
func PrivateObjectRouteLogContext(
	method string,
	path string,
	headers map[string]string,
) (RouteLogContext, bool) {
	policy, ok := RoutePolicyForPath(path)
	if !ok {
		return RouteLogContext{}, false
	}
	requestID, _ := headerValue(headers, PeerHopRequestIDHeader)
	return RouteLogContext{
		Category:  policy.Category,
		Method:    sanitizeLogMethod(method),
		RequestID: SanitizePeerHopRequestID(requestID),
	}, true
}

// SanitizePeerHopRequestID accepts only canonical unpadded base64url text.
func SanitizePeerHopRequestID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return "invalid"
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return "invalid"
	}
	return value
}

func sanitizeLogMethod(method string) string {
	if method == "" || len(method) > MaxMethodLen {
		return "invalid"
	}
	for _, character := range method {
		if character < 'A' || character > 'Z' {
			return "invalid"
		}
	}
	return method
}

// ValidateResponse enforces the route-specific response bounds before a frame
// is constructed. Successful partial-content responses also require strict
// metadata encoding; canonical protobuf validation remains owned by Social.
func (p RoutePolicy) ValidateResponse(
	statusCode uint32,
	headers map[string]string,
	body []byte,
) error {
	if uint64(len(body)) > uint64(p.MaxResponseBodyLen) {
		return fmt.Errorf(
			"response body too large: %d > %d",
			len(body),
			p.MaxResponseBodyLen,
		)
	}
	headersBytes, err := MarshalHeaders(headers)
	if err != nil {
		return fmt.Errorf("marshal response headers: %w", err)
	}
	if uint64(len(headersBytes)) > uint64(p.MaxResponseHeadersLen) {
		return fmt.Errorf(
			"response headers too large: %d > %d",
			len(headersBytes),
			p.MaxResponseHeadersLen,
		)
	}
	payloadLen := uint64(len(body)) + uint64(len(headersBytes)) + 12
	if payloadLen > uint64(p.MaxResponsePayloadLen) {
		return fmt.Errorf(
			"response payload too large: %d > %d",
			payloadLen,
			p.MaxResponsePayloadLen,
		)
	}
	if statusCode == 206 {
		metadata, ok := headerValue(headers, PrivateObjectMetadataHeader)
		if !ok {
			return fmt.Errorf("response metadata header is required")
		}
		if err := validatePrivateObjectMetadata(metadata); err != nil {
			return err
		}
	}
	return nil
}

func validatePrivateObjectMetadata(value string) error {
	if value == "" || len(value) > MaxPrivateObjectResponseMetadataText {
		return fmt.Errorf(
			"response metadata length is invalid: %d",
			len(value),
		)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return fmt.Errorf("response metadata is not strict unpadded base64url: %w", err)
	}
	if len(decoded) > MaxPrivateObjectResponseMetadataLen {
		return fmt.Errorf(
			"response metadata decoded length is invalid: %d",
			len(decoded),
		)
	}
	if base64.RawURLEncoding.EncodeToString(decoded) != value {
		return fmt.Errorf("response metadata is not canonical unpadded base64url")
	}
	return nil
}

func headerValue(headers map[string]string, name string) (string, bool) {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value, true
		}
	}
	return "", false
}
