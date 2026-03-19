package server

import (
	"encoding/json"
	"fmt"
	"reflect"

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

// GetSerializerForType returns the appropriate serializer for a given type
// Returns ProtoSerializer if type implements proto.Message, otherwise JSONSerializer
func GetSerializerForType(t reflect.Type) Serializer {
	if isProtoMessage(t) {
		return &ProtoSerializer{}
	}
	return &JSONSerializer{}
}
