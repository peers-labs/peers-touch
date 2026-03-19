package server

import (
	"strings"
)

// ContentNegotiator handles content negotiation between client and server
type ContentNegotiator struct {
	defaultSerializer Serializer
}

// NewContentNegotiator creates a new ContentNegotiator with JSON as default
func NewContentNegotiator() *ContentNegotiator {
	return &ContentNegotiator{
		defaultSerializer: &JSONSerializer{},
	}
}

// GetRequestSerializer returns the appropriate serializer based on Content-Type header
func (n *ContentNegotiator) GetRequestSerializer(contentType string) Serializer {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	
	// Remove charset and other parameters
	if idx := strings.Index(contentType, ";"); idx != -1 {
		contentType = strings.TrimSpace(contentType[:idx])
	}
	
	switch contentType {
	case "application/protobuf", "application/x-protobuf":
		return &ProtoSerializer{}
	case "application/json", "":
		return &JSONSerializer{}
	default:
		// Default to JSON for unknown content types
		return n.defaultSerializer
	}
}

// GetResponseSerializer returns the appropriate serializer based on request Content-Type
// For typed handlers, we use the same format for response as request
func (n *ContentNegotiator) GetResponseSerializer(contentType string, responseType Serializer) Serializer {
	// If Content-Type indicates protobuf, use protobuf for response
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if idx := strings.Index(contentType, ";"); idx != -1 {
		contentType = strings.TrimSpace(contentType[:idx])
	}
	
	if contentType == "application/protobuf" || contentType == "application/x-protobuf" {
		return &ProtoSerializer{}
	}
	
	// Otherwise use the serializer determined by response type
	if responseType != nil {
		return responseType
	}
	
	return n.defaultSerializer
}
