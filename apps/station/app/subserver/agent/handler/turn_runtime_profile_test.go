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
			if !errors.As(err, &biz) ||
				biz.Code != errcode.AgentRuntimeUnavailable ||
				biz.Payload.GetErrorType() != string(errcode.AgentRuntimeUnavailable) ||
				biz.Payload.GetLocaleKey() != errcode.AgentRuntimeUnavailableLocaleKey ||
				!biz.Payload.GetRetryable() ||
				!biz.Payload.GetTerminal() ||
				biz.Payload.GetDetails()["runtime_kind"] != "direct_model" ||
				biz.Payload.GetDetails()["reason_code"] != "runtime_not_advertised" {
				t.Fatalf("unexpected runtime-unavailable payload: %T %+v", err, biz)
			}
		})
	}
}

func stringPointer(value string) *string {
	return &value
}
