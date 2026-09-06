package httpinterface

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type authorityServiceSpy struct {
	calls       int
	command     *chat.ChatCommand
	submitError error
	plan        *chat.PrepareMessagingSendResponse
	planError   error
	planRequest *chat.PrepareMessagingSendRequest
}

func (s *authorityServiceSpy) PrepareSend(
	_ context.Context,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	s.planRequest = request
	return s.plan, s.planError
}

func (s *authorityServiceSpy) Submit(
	_ context.Context,
	command *chat.ChatCommand,
) (*chat.ConversationEvent, error) {
	s.calls++
	s.command = command
	if s.submitError != nil {
		return nil, s.submitError
	}
	return &chat.ConversationEvent{EventId: "event-1"}, nil
}

func TestCommandHandlerBindsAuthenticatedEndpoint(t *testing.T) {
	spy := &authorityServiceSpy{}
	handler, err := NewCommandHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	command := &chat.ChatCommand{
		CommandId:      "command-1",
		ConversationId: "conversation-1",
		Sender: &chat.CryptoEndpoint{
			Ptid:     "ptid:alice",
			DeviceId: "alice-device",
		},
	}
	response, err := handler.Submit(
		context.Background(),
		"ptid:alice",
		"alice-device",
		&chat.SubmitMessagingCommandRequest{Command: command},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Event.EventId != "event-1" || spy.calls != 1 || spy.command != command {
		t.Fatalf("response=%+v calls=%d command=%p", response, spy.calls, spy.command)
	}
}

func TestCommandHandlerRejectsEndpointMismatchBeforeService(t *testing.T) {
	spy := &authorityServiceSpy{}
	handler, err := NewCommandHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	command := &chat.ChatCommand{
		CommandId:      "command-1",
		ConversationId: "conversation-1",
		Sender: &chat.CryptoEndpoint{
			Ptid:     "ptid:alice",
			DeviceId: "mallory-device",
		},
	}
	if _, err := handler.Submit(
		context.Background(),
		"ptid:alice",
		"alice-device",
		&chat.SubmitMessagingCommandRequest{Command: command},
	); !errors.Is(err, ErrEndpointBinding) {
		t.Fatalf("error=%v, want ErrEndpointBinding", err)
	}
	if spy.calls != 0 {
		t.Fatalf("mismatched endpoint reached service %d times", spy.calls)
	}
}

func TestCommandHandlerReturnsTypedStalePlanWithoutTransportError(t *testing.T) {
	plan := &chat.PrepareMessagingSendResponse{
		ConversationId:     "conversation-1",
		DeliveryPlanSha256: make([]byte, 32),
	}
	spy := &authorityServiceSpy{
		submitError: domain.ErrStaleDeliveryPlan,
		plan:        plan,
	}
	handler, err := NewCommandHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	response, err := handler.Submit(
		context.Background(),
		"ptid:alice",
		"alice-device",
		&chat.SubmitMessagingCommandRequest{Command: &chat.ChatCommand{
			CommandId:          "command-1",
			ConversationId:     "conversation-1",
			AuthorityStationId: "station-local",
			Sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "alice-device",
			},
		}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.RejectCode != chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_STALE_DELIVERY_PLAN ||
		response.CurrentSendPlan != plan {
		t.Fatalf("response=%+v, want typed stale plan", response)
	}
	if spy.planRequest == nil ||
		spy.planRequest.ConversationId != "conversation-1" ||
		spy.planRequest.AuthorityStationId != "station-local" ||
		spy.planRequest.Sender.GetPtid() != "ptid:alice" ||
		spy.planRequest.Sender.GetDeviceId() != "alice-device" {
		t.Fatalf("prepare request=%+v, want complete command identity", spy.planRequest)
	}
}

func TestCommandHandlerPropagatesStalePlanPreparationFailure(t *testing.T) {
	prepareError := errors.New("prepare current plan")
	spy := &authorityServiceSpy{
		submitError: domain.ErrStaleDeliveryPlan,
		planError:   prepareError,
	}
	handler, err := NewCommandHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	response, err := handler.Submit(
		context.Background(),
		"ptid:alice",
		"alice-device",
		&chat.SubmitMessagingCommandRequest{Command: &chat.ChatCommand{
			CommandId:          "command-1",
			ConversationId:     "conversation-1",
			AuthorityStationId: "station-local",
			Sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "alice-device",
			},
		}},
	)
	if !errors.Is(err, prepareError) || response != nil {
		t.Fatalf("response=%+v error=%v, want prepare error", response, err)
	}
}
