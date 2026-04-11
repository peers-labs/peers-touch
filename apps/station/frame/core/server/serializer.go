package server

import (
	"encoding/json"
	"fmt"
	"reflect"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Serializer defines the interface for encoding/decoding data
type Serializer interface {
	Marshal(v interface{}) ([]byte, error)
	Unmarshal(data []byte, v interface{}) error
	ContentType() string
}

// JSONSerializer implements JSON serialization
type JSONSerializer struct{}

func (s *JSONSerializer) Marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func (s *JSONSerializer) Unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

func (s *JSONSerializer) ContentType() string {
	return "application/json"
}

// ProtoSerializer implements Protocol Buffers serialization
type ProtoSerializer struct{}

func (s *ProtoSerializer) Marshal(v interface{}) ([]byte, error) {
	msg, ok := v.(proto.Message)
	if !ok {
		return nil, fmt.Errorf("value is not a proto.Message, got %T", v)
	}
	return proto.Marshal(msg)
}

func (s *ProtoSerializer) Unmarshal(data []byte, v interface{}) error {
	msg, ok := v.(proto.Message)
	if !ok {
		return fmt.Errorf("value is not a proto.Message, got %T", v)
	}
	return proto.Unmarshal(data, msg)
}

func (s *ProtoSerializer) ContentType() string {
	return "application/protobuf"
}

// isProtoMessage checks if a type implements proto.Message
func isProtoMessage(t reflect.Type) bool {
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	
	// Check if the type implements proto.Message interface
	protoMessageType := reflect.TypeOf((*proto.Message)(nil)).Elem()
	return reflect.PtrTo(t).Implements(protoMessageType)
}

// ProtoJSONSerializer serializes proto.Message values to JSON using protojson,
// which respects proto field naming conventions and handles well-known types.
// For non-proto values it falls back to standard encoding/json.
type ProtoJSONSerializer struct{}

var protoJSONMarshalOpts = protojson.MarshalOptions{EmitUnpopulated: true, UseProtoNames: true}
var protoJSONUnmarshalOpts = protojson.UnmarshalOptions{DiscardUnknown: true}

func (s *ProtoJSONSerializer) Marshal(v interface{}) ([]byte, error) {
	if msg, ok := v.(proto.Message); ok {
		return protoJSONMarshalOpts.Marshal(msg)
	}
	return json.Marshal(v)
}

func (s *ProtoJSONSerializer) Unmarshal(data []byte, v interface{}) error {
	if msg, ok := v.(proto.Message); ok {
		return protoJSONUnmarshalOpts.Unmarshal(data, msg)
	}
	return json.Unmarshal(data, v)
}

func (s *ProtoJSONSerializer) ContentType() string {
	return "application/json"
}

// GetSerializerForType returns the appropriate serializer for a given type.
// Returns ProtoSerializer if type implements proto.Message, otherwise JSONSerializer.
// NOTE: This is used as the *default* response serializer at handler registration time.
// The ContentNegotiator may override it at runtime based on request Content-Type.
func GetSerializerForType(t reflect.Type) Serializer {
	if isProtoMessage(t) {
		return &ProtoSerializer{}
	}
	return &JSONSerializer{}
}
