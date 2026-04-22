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

// GetRequestSerializer returns the appropriate serializer based on Content-Type header.
//
// Priority:
//  1. If the request Content-Type is protobuf → ProtoSerializer (binary protobuf)
//  2. Otherwise → ProtoJSONSerializer (accepts both snake_case and camelCase for
//     proto.Message fields via protojson, falls back to encoding/json for non-proto types)
//
// Using ProtoJSONSerializer as the default JSON deserializer ensures that JSON
// clients talking to proto-typed handlers can send either snake_case or camelCase
// field names — symmetric with GetResponseSerializer's behavior.
func (n *ContentNegotiator) GetRequestSerializer(contentType string) Serializer {
	contentType = strings.ToLower(strings.TrimSpace(contentType))

	// Remove charset and other parameters
	if idx := strings.Index(contentType, ";"); idx != -1 {
		contentType = strings.TrimSpace(contentType[:idx])
	}

	switch contentType {
	case "application/protobuf", "application/x-protobuf":
		return &ProtoSerializer{}
	default:
		return &ProtoJSONSerializer{}
	}
}

// GetResponseSerializer determines response serializer using HTTP content negotiation.
//
// Priority:
//  1. If the request Content-Type is protobuf → ProtoSerializer (binary protobuf)
//  2. If the request Content-Type is JSON (or empty/unknown) and the response type
//     is a proto.Message → ProtoJSONSerializer (protojson-encoded JSON)
//  3. Otherwise → the default JSONSerializer
//
// This ensures that a JSON client always receives valid JSON even when the
// handler returns proto.Message values, and protobuf clients receive binary.
func (n *ContentNegotiator) GetResponseSerializer(contentType string, responseTypeSerializer Serializer) Serializer {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if idx := strings.Index(contentType, ";"); idx != -1 {
		contentType = strings.TrimSpace(contentType[:idx])
	}

	if contentType == "application/protobuf" || contentType == "application/x-protobuf" {
		return &ProtoSerializer{}
	}

	// Non-protobuf request: if the response type is proto.Message, use ProtoJSONSerializer
	// so that protojson produces correct JSON field names & well-known type handling.
	if _, isProto := responseTypeSerializer.(*ProtoSerializer); isProto {
		return &ProtoJSONSerializer{}
	}

	if responseTypeSerializer != nil {
		return responseTypeSerializer
	}

	return n.defaultSerializer
}
