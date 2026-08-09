package httpinterface

import (
	"context"
	"errors"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type queueServiceSpy struct {
	calls int
	ptid  string
}

func (s *queueServiceSpy) Claim(
	_ context.Context,
	ptid string,
	_ *chat.ClaimDeviceQueueRequest,
) (*chat.ClaimDeviceQueueResponse, error) {
	s.calls++
	s.ptid = ptid
	return &chat.ClaimDeviceQueueResponse{}, nil
}

func (s *queueServiceSpy) Acknowledge(
	_ context.Context,
	ptid string,
	_ *chat.AcknowledgeDeviceQueueItemRequest,
) (*chat.AcknowledgeDeviceQueueItemResponse, error) {
	s.calls++
	s.ptid = ptid
	return &chat.AcknowledgeDeviceQueueItemResponse{}, nil
}

func (s *queueServiceSpy) Reject(
	_ context.Context,
	ptid string,
	_ *chat.RejectDeviceQueueItemRequest,
) (*chat.RejectDeviceQueueItemResponse, error) {
	s.calls++
	s.ptid = ptid
	return &chat.RejectDeviceQueueItemResponse{}, nil
}

func TestQueueHandlerBindsAuthenticatedEndpoint(t *testing.T) {
	spy := &queueServiceSpy{}
	handler, err := NewQueueHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := handler.Claim(
		context.Background(),
		"ptid:alice",
		"alice-device",
		&chat.ClaimDeviceQueueRequest{DeviceId: "alice-device"},
	); err != nil {
		t.Fatal(err)
	}
	if spy.calls != 1 || spy.ptid != "ptid:alice" {
		t.Fatalf("service calls=%d ptid=%q", spy.calls, spy.ptid)
	}
}

func TestQueueHandlerRejectsBodyDeviceMismatchBeforeService(t *testing.T) {
	spy := &queueServiceSpy{}
	handler, err := NewQueueHandler(spy)
	if err != nil {
		t.Fatal(err)
	}
	tests := []func() error{
		func() error {
			_, err := handler.Claim(
				context.Background(),
				"ptid:alice",
				"alice-device",
				&chat.ClaimDeviceQueueRequest{DeviceId: "mallory-device"},
			)
			return err
		},
		func() error {
			_, err := handler.Acknowledge(
				context.Background(),
				"ptid:alice",
				"alice-device",
				&chat.AcknowledgeDeviceQueueItemRequest{DeviceId: "mallory-device"},
			)
			return err
		},
		func() error {
			_, err := handler.Reject(
				context.Background(),
				"ptid:alice",
				"alice-device",
				&chat.RejectDeviceQueueItemRequest{DeviceId: "mallory-device"},
			)
			return err
		},
	}
	for index, run := range tests {
		if err := run(); !errors.Is(err, ErrEndpointBinding) {
			t.Fatalf("case %d error=%v, want ErrEndpointBinding", index, err)
		}
	}
	if spy.calls != 0 {
		t.Fatalf("mismatched endpoint reached service %d times", spy.calls)
	}
}
