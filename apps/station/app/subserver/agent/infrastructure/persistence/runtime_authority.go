package persistence

import (
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
)

func MarshalConversationRuntimeBinding(binding *model.ConversationRuntimeBinding) ([]byte, error) {
	if binding == nil {
		return nil, fmt.Errorf("conversation runtime binding is required")
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(binding)
	if err != nil {
		return nil, fmt.Errorf("marshal conversation runtime binding: %w", err)
	}
	return encoded, nil
}

func UnmarshalConversationRuntimeBinding(encoded []byte) (*model.ConversationRuntimeBinding, error) {
	if len(encoded) == 0 {
		return nil, nil
	}
	binding := &model.ConversationRuntimeBinding{}
	if err := proto.Unmarshal(encoded, binding); err != nil {
		return nil, fmt.Errorf("unmarshal conversation runtime binding: %w", err)
	}
	return binding, nil
}

func MarshalRuntimeSnapshot(snapshot *model.RuntimeSnapshot) ([]byte, error) {
	if snapshot == nil {
		return nil, fmt.Errorf("runtime snapshot is required")
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal runtime snapshot: %w", err)
	}
	return encoded, nil
}

func UnmarshalRuntimeSnapshot(encoded []byte) (*model.RuntimeSnapshot, error) {
	if len(encoded) == 0 {
		return nil, nil
	}
	snapshot := &model.RuntimeSnapshot{}
	if err := proto.Unmarshal(encoded, snapshot); err != nil {
		return nil, fmt.Errorf("unmarshal runtime snapshot: %w", err)
	}
	return snapshot, nil
}
