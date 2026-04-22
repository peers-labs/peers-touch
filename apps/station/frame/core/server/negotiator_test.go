package server

import (
	"testing"
)

func TestContentNegotiator_GetRequestSerializer(t *testing.T) {
	negotiator := NewContentNegotiator()

	tests := []struct {
		name        string
		contentType string
		wantType    string // "proto", "protojson"
	}{
		{
			name:        "application/json → ProtoJSONSerializer",
			contentType: "application/json",
			wantType:    "protojson",
		},
		{
			name:        "application/protobuf → ProtoSerializer",
			contentType: "application/protobuf",
			wantType:    "proto",
		},
		{
			name:        "application/x-protobuf → ProtoSerializer",
			contentType: "application/x-protobuf",
			wantType:    "proto",
		},
		{
			name:        "JSON with charset → ProtoJSONSerializer",
			contentType: "application/json; charset=utf-8",
			wantType:    "protojson",
		},
		{
			name:        "empty defaults to ProtoJSONSerializer",
			contentType: "",
			wantType:    "protojson",
		},
		{
			name:        "unknown defaults to ProtoJSONSerializer",
			contentType: "application/xml",
			wantType:    "protojson",
		},
		{
			name:        "case insensitive protobuf",
			contentType: "APPLICATION/PROTOBUF",
			wantType:    "proto",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			serializer := negotiator.GetRequestSerializer(tt.contentType)

			switch tt.wantType {
			case "proto":
				if _, ok := serializer.(*ProtoSerializer); !ok {
					t.Errorf("Expected ProtoSerializer for %q, got %T", tt.contentType, serializer)
				}
			case "protojson":
				if _, ok := serializer.(*ProtoJSONSerializer); !ok {
					t.Errorf("Expected ProtoJSONSerializer for %q, got %T", tt.contentType, serializer)
				}
			}
		})
	}
}

func TestContentNegotiator_GetResponseSerializer(t *testing.T) {
	negotiator := NewContentNegotiator()

	tests := []struct {
		name         string
		contentType  string
		responseType Serializer
		wantType     string // "proto", "json", "protojson"
	}{
		{
			name:        "Proto content type → ProtoSerializer",
			contentType: "application/protobuf",
			wantType:    "proto",
		},
		{
			name:         "JSON content + proto response type → ProtoJSONSerializer",
			contentType:  "application/json",
			responseType: &ProtoSerializer{},
			wantType:     "protojson",
		},
		{
			name:        "No content type and no response type → default JSONSerializer",
			contentType: "",
			wantType:    "json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			serializer := negotiator.GetResponseSerializer(tt.contentType, tt.responseType)

			switch tt.wantType {
			case "proto":
				if _, ok := serializer.(*ProtoSerializer); !ok {
					t.Errorf("Expected ProtoSerializer, got %T", serializer)
				}
			case "json":
				if _, ok := serializer.(*JSONSerializer); !ok {
					t.Errorf("Expected JSONSerializer, got %T", serializer)
				}
			case "protojson":
				if _, ok := serializer.(*ProtoJSONSerializer); !ok {
					t.Errorf("Expected ProtoJSONSerializer, got %T", serializer)
				}
			}
		})
	}
}
