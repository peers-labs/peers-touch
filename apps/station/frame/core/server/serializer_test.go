package server

import (
	"reflect"
	"testing"

	social "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
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
		original := &chat.ActorReadCursor{
			ConversationId:   "01TEST000000000000TEST",
			ReaderPtid:       "did:reader:123",
			LastReadSequence: 42,
		}

		// Marshal
		data, err := serializer.Marshal(original)
		if err != nil {
			t.Fatalf("Marshal() error = %v", err)
		}

		// Unmarshal
		decoded := &chat.ActorReadCursor{}
		if err := serializer.Unmarshal(data, decoded); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}

		if decoded.ConversationId != original.ConversationId || decoded.ReaderPtid != original.ReaderPtid {
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

	strict := &ProtoSerializer{RejectDuplicateSingular: true}
	t.Run("strict rejects duplicate singular field", func(t *testing.T) {
		wire := protowire.AppendString(
			protowire.AppendTag(nil, 1, protowire.BytesType),
			"first",
		)
		wire = protowire.AppendString(
			protowire.AppendTag(wire, 1, protowire.BytesType),
			"second",
		)
		if err := strict.Unmarshal(wire, &chat.ActorReadCursor{}); err == nil {
			t.Fatal("strict protobuf accepted a duplicate singular field")
		}
	})

	t.Run("strict rejects duplicate nested singular field", func(t *testing.T) {
		inner := protowire.AppendString(
			protowire.AppendTag(nil, 1, protowire.BytesType),
			"first",
		)
		inner = protowire.AppendString(
			protowire.AppendTag(inner, 1, protowire.BytesType),
			"second",
		)
		wire := protowire.AppendBytes(
			protowire.AppendTag(nil, 4, protowire.BytesType),
			inner,
		)
		if err := strict.Unmarshal(wire, &chat.DeviceConsumptionReceipt{}); err == nil {
			t.Fatal("strict protobuf accepted a nested duplicate singular field")
		}
	})

	t.Run("strict accepts repeated message fields", func(t *testing.T) {
		wire, err := proto.Marshal(&chat.GetConversationMembersResponse{
			Members: []*chat.ConversationMember{
				{ConversationId: "first"},
				{ConversationId: "second"},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		decoded := &chat.GetConversationMembersResponse{}
		if err := strict.Unmarshal(wire, decoded); err != nil {
			t.Fatal(err)
		}
		if len(decoded.GetMembers()) != 2 {
			t.Fatalf("members = %d, want 2", len(decoded.GetMembers()))
		}
	})

	t.Run("strict rejects multiple oneof alternatives", func(t *testing.T) {
		wire := protowire.AppendBytes(
			protowire.AppendTag(nil, 10, protowire.BytesType),
			nil,
		)
		wire = protowire.AppendBytes(
			protowire.AppendTag(wire, 11, protowire.BytesType),
			nil,
		)
		if err := strict.Unmarshal(wire, &social.CreatePostRequest{}); err == nil {
			t.Fatal("strict protobuf accepted multiple oneof alternatives")
		}
	})
}

func TestGetSerializerForType(t *testing.T) {
	tests := []struct {
		name      string
		typ       reflect.Type
		wantProto bool
		wantJSON  bool
	}{
		{
			name:      "Proto message type",
			typ:       reflect.TypeOf(&chat.ActorReadCursor{}),
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
