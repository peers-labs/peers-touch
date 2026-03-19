package server

import (
	"reflect"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestJSONSerializer(t *testing.T) {
	serializer := &JSONSerializer{}

	t.Run("ContentType", func(t *testing.T) {
		if got := serializer.ContentType(); got != "application/json" {
			t.Errorf("ContentType() = %v, want %v", got, "application/json")
		}
	})

	t.Run("Marshal and Unmarshal", func(t *testing.T) {
		type TestStruct struct {
			Name  string `json:"name"`
			Age   int    `json:"age"`
			Email string `json:"email"`
		}

		original := &TestStruct{
			Name:  "Alice",
			Age:   30,
			Email: "alice@example.com",
		}

		// Marshal
		data, err := serializer.Marshal(original)
		if err != nil {
			t.Fatalf("Marshal() error = %v", err)
		}

		// Unmarshal
		var decoded TestStruct
		if err := serializer.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}

		if !reflect.DeepEqual(original, &decoded) {
			t.Errorf("Marshal/Unmarshal mismatch: got %+v, want %+v", decoded, original)
		}
	})
}

func TestProtoSerializer(t *testing.T) {
	serializer := &ProtoSerializer{}

	t.Run("ContentType", func(t *testing.T) {
		if got := serializer.ContentType(); got != "application/protobuf" {
			t.Errorf("ContentType() = %v, want %v", got, "application/protobuf")
		}
	})

	t.Run("Marshal and Unmarshal", func(t *testing.T) {
		original := &chat.FriendChatMessage{
			Ulid:        "01TEST000000000000TEST",
			SessionUlid: "01SESSION00000000000",
			SenderDid:   "did:sender:123",
			ReceiverDid: "did:receiver:456",
			Content:     "Hello World",
			Type:        chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT,
		}

		// Marshal
		data, err := serializer.Marshal(original)
		if err != nil {
			t.Fatalf("Marshal() error = %v", err)
		}

		// Unmarshal
		decoded := &chat.FriendChatMessage{}
		if err := serializer.Unmarshal(data, decoded); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}

		if decoded.Ulid != original.Ulid || decoded.Content != original.Content {
			t.Errorf("Marshal/Unmarshal mismatch: got %+v, want %+v", decoded, original)
		}
	})

	t.Run("Marshal non-proto type should error", func(t *testing.T) {
		type NonProto struct {
			Field string
		}
		_, err := serializer.Marshal(&NonProto{Field: "test"})
		if err == nil {
			t.Error("Marshal() expected error for non-proto type, got nil")
		}
	})
}

func TestGetSerializerForType(t *testing.T) {
	tests := []struct {
		name          string
		typ           reflect.Type
		wantProto     bool
		wantJSON      bool
	}{
		{
			name:      "Proto message type",
			typ:       reflect.TypeOf(&chat.FriendChatMessage{}),
			wantProto: true,
		},
		{
			name:     "Regular struct type",
			typ:      reflect.TypeOf(&struct{ Name string }{}),
			wantJSON: true,
		},
		{
			name:     "Map type",
			typ:      reflect.TypeOf(map[string]interface{}{}),
			wantJSON: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			serializer := GetSerializerForType(tt.typ)
			
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
