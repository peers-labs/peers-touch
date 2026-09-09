package delivery

import (
	"context"

	"google.golang.org/protobuf/proto"
)

// Transport submits one immutable frame and returns the receiver disposition.
type Transport interface {
	Deliver(ctx context.Context, frame *Frame) (Result, error)
}

// TransportFunc adapts a function to Transport.
type TransportFunc func(context.Context, *Frame) (Result, error)

// Deliver invokes f.
func (f TransportFunc) Deliver(ctx context.Context, frame *Frame) (Result, error) {
	return f(ctx, frame)
}

// LocalTransport routes same-Station frames through the exact authenticated receiver path.
type LocalTransport struct {
	receiver FrameReceiver
}

// NewLocalTransport creates a same-Station transport without a weaker fast path.
func NewLocalTransport(receiver FrameReceiver) (*LocalTransport, error) {
	if isNil(receiver) {
		return nil, NewError(FailureInvalidArgument, "create local transport", errorsText("receiver is nil"))
	}
	return &LocalTransport{receiver: receiver}, nil
}

// Deliver clones the frame before invoking the shared receiver.
func (t *LocalTransport) Deliver(ctx context.Context, frame *Frame) (Result, error) {
	if frame == nil {
		return Result{}, NewError(FailureInvalidFrame, "deliver local frame", errorsText("frame is nil"))
	}
	if frame.SourceStationPeerId != frame.TargetStationPeerId {
		return TerminalResult(FrameErrorWrongTarget), nil
	}
	return t.receiver.Receive(ctx, proto.Clone(frame).(*Frame))
}

var _ Transport = (*LocalTransport)(nil)
