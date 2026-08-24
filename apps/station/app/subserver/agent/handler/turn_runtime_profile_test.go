package handler

import (
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestValidateFrozenDirectModelRequest(t *testing.T) {
	if err := validateFrozenDirectModelRequest(&model.ExecuteTurnRequest{
		AgentId:   "agent-1",
		UserInput: "hello",
	}); err != nil {
		t.Fatalf("direct model request rejected: %v", err)
	}

	for name, request := range map[string]*model.ExecuteTurnRequest{
		"provider": {
			Provider:  stringPointer("trae-cli"),
			AgentId:   "agent-1",
			UserInput: "hello",
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := validateFrozenDirectModelRequest(request)
			var biz *errcode.BizError
			if !errors.As(err, &biz) || biz.Code != errcode.AgentInvalidRequest {
				t.Fatalf("expected invalid request, got %T: %v", err, err)
			}
		})
	}
}

func stringPointer(value string) *string {
	return &value
}
