package server

import (
	"testing"
)

func TestContentNegotiator_GetRequestSerializer(t *testing.T) {
	negotiator := NewContentNegotiator()

	tests := []struct {
		name        string
		contentType string
		wantProto   bool
		wantJSON    bool
	}{
		{
			name:        "application/json",
			contentType: "application/json",
			wantJSON:    true,
		},
		{
			name:        "application/protobuf",
			contentType: "application/protobuf",
			wantProto:   true,
		},
		{
			name:        "application/x-protobuf",
			contentType: "application/x-protobuf",
			wantProto:   true,
		},
		{
			name:        "with charset",
			contentType: "application/json; charset=utf-8",
			wantJSON:    true,
		},
		{
			name:        "empty defaults to JSON",
			contentType: "",
			wantJSON:    true,
		},
		{
			name:        "unknown defaults to JSON",
			contentType: "application/xml",
			wantJSON:    true,
		},
		{
			name:        "case insensitive",
			contentType: "APPLICATION/PROTOBUF",
			wantProto:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			serializer := negotiator.GetRequestSerializer(tt.contentType)

			if tt.wantProto {
				if _, ok := serializer.(*ProtoSerializer); !ok {
					t.Errorf("Expected ProtoSerializer for %q, got %T", tt.contentType, serializer)
				}
			}

			if tt.wantJSON {
				if _, ok := serializer.(*JSONSerializer); !ok {
					t.Errorf("Expected JSONSerializer for %q, got %T", tt.contentType, serializer)
				}
			}
		})
	}
}

func TestContentNegotiator_GetResponseSerializer(t *testing.T) {
	negotiator := NewContentNegotiator()

	tests := []struct {
		name             string
		contentType      string
		responseType     Serializer
		wantProto        bool
		wantJSON         bool
	}{
		{
			name:        "Proto content type uses Proto",
			contentType: "application/protobuf",
			wantProto:   true,
		},
		{
			name:         "JSON content type with Proto response type uses response type",
			contentType:  "application/json",
			responseType: &ProtoSerializer{},
			wantProto:    true,
		},
		{
			name:        "No content type and no response type defaults to JSON",
			contentType: "",
			wantJSON:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			serializer := negotiator.GetResponseSerializer(tt.contentType, tt.responseType)

			if tt.wantProto {
				if _, ok := serializer.(*ProtoSerializer); !ok {
					t.Errorf("Expected ProtoSerializer, got %T", serializer)
				}
			}

			if tt.wantJSON {
				if _, ok := serializer.(*JSONSerializer); !ok {
					t.Errorf("Expected JSONSerializer, got %T", serializer)
				}
			}
		})
	}
}
