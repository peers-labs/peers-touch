package events

import (
	"context"
	"testing"
	"time"

	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

type callSignalTestSigner struct{}

func (callSignalTestSigner) KeyID() string {
	return "station-test-key"
}

func (callSignalTestSigner) Sign(
	context.Context,
	[]byte,
) ([]byte, error) {
	return []byte("station-signature"), nil
}

type callSignalTestRuntime struct {
	localStationPeerID string
	delivered          *delivery.Frame
	result             delivery.Result
}

func (*callSignalTestRuntime) RegisterReceivers(
	federationruntime.ReceiverRegistrar,
) error {
	return nil
}

func (r *callSignalTestRuntime) DeliverRealtimeCallSignal(
	_ context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	r.delivered = proto.Clone(frame).(*delivery.Frame)
	return r.result, nil
}

func (*callSignalTestRuntime) CallPeer(
	context.Context,
	federationruntime.PeerCall,
) error {
	return nil
}

func (*callSignalTestRuntime) Signer() delivery.Signer {
	return callSignalTestSigner{}
}

func (r *callSignalTestRuntime) LocalStationPeerID() string {
	return r.localStationPeerID
}

type callSignalTestActorHomes map[string]string

func (h callSignalTestActorHomes) ResolveActorHomeStationPeerID(
	_ context.Context,
	actorPTID string,
) (string, error) {
	return h[actorPTID], nil
}

type allowCallSignal struct{}

func (allowCallSignal) CanSignal(string, string) (bool, error) {
	return true, nil
}

func TestFederatedCallSignalSenderBuildsTypedSignedFrame(t *testing.T) {
	now := time.Date(2026, time.September, 23, 6, 0, 0, 0, time.UTC)
	runtime := &callSignalTestRuntime{
		localStationPeerID: "station-a",
		result:             delivery.AcceptedResult(),
	}
	sender, err := newFederatedCallSignalSender(runtime)
	if err != nil {
		t.Fatal(err)
	}
	sender.now = func() time.Time { return now }
	signal := &realtime.CallSignal{
		SessionUlid:   "conversation-1",
		FromActorPtid: "ptid:alice",
		Kind:          realtime.CallSignal_CALL_REQUEST,
		Payload:       []byte("sealed"),
		CallId:        testCallID(t, now),
	}
	result, err := sender.deliver(
		context.Background(),
		"station-b",
		&realtime.FederatedCallSignal{
			RecipientActorPtid: "ptid:bob",
			Signal:             signal,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != delivery.DispositionAccepted ||
		runtime.delivered == nil {
		t.Fatalf("delivery result = %#v frame=%#v", result, runtime.delivered)
	}
	if runtime.delivered.GetTargetStationPeerId() != "station-b" ||
		runtime.delivered.GetPayloadKind() !=
			delivery.PayloadKindRealtimeCallSignal ||
		len(runtime.delivered.GetStationSignature()) == 0 {
		t.Fatalf("delivered frame = %#v", runtime.delivered)
	}
	wire := &realtime.FederatedCallSignal{}
	if err := proto.Unmarshal(runtime.delivered.GetOpaquePayload(), wire); err != nil {
		t.Fatal(err)
	}
	if wire.GetRecipientActorPtid() != "ptid:bob" ||
		wire.GetSignal().GetCallId() != signal.GetCallId() ||
		wire.GetSignal().GetFromActorPtid() != "ptid:alice" {
		t.Fatalf("decoded payload = %#v", wire)
	}
}

func TestReceiveFederatedCallRequestCreatesResolutionAtCalleeHome(t *testing.T) {
	now := time.Date(2026, time.September, 23, 6, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	subserver := &eventsSubServer{
		bus:            newTestBus(t),
		callResolution: store,
		actorHomes: callSignalTestActorHomes{
			"ptid:alice": "station-a",
			"ptid:bob":   "station-b",
		},
		localStationPeerID: "station-b",
	}
	RegisterSignalAuthorizer(allowCallSignal{})
	t.Cleanup(func() {
		RegisterSignalAuthorizer(nil)
	})
	callID := testCallID(t, now)
	signal := &realtime.CallSignal{
		SessionUlid:   "conversation-1",
		FromActorPtid: "ptid:alice",
		Kind:          realtime.CallSignal_CALL_REQUEST,
		Payload:       []byte("sealed"),
		CallId:        callID,
	}
	wire := &realtime.FederatedCallSignal{
		RecipientActorPtid: "ptid:bob",
		Signal:             signal,
	}
	result, err := subserver.receiveFederatedCallSignal(
		context.Background(),
		wire,
		&delivery.Frame{
			SourceStationPeerId: "station-a",
			TargetStationPeerId: "station-b",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != delivery.DispositionAccepted {
		t.Fatalf("receiver result = %#v", result)
	}
	resolution, err := store.getForActor(
		context.Background(),
		"ptid:bob",
		callID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolution.record.State != callStateOpen ||
		resolution.record.CallerActorPTID != "ptid:alice" ||
		resolution.record.CalleeActorPTID != "ptid:bob" {
		t.Fatalf("resolution = %#v", resolution.record)
	}
}

func TestCallResolutionConflictRequiresTerminalDomainRejection(t *testing.T) {
	kind := realtime.CallSignal_CALL_REQUEST
	if !isTerminalCallResolutionRejection(
		delivery.TerminalResult(delivery.FrameErrorDomainRejected),
		kind,
	) {
		t.Fatal("terminal domain rejection must map to call conflict")
	}
	if isTerminalCallResolutionRejection(
		delivery.RetryableResult(delivery.FrameErrorDomainRejected),
		kind,
	) {
		t.Fatal("retryable domain rejection must not map to call conflict")
	}
	if isTerminalCallResolutionRejection(
		delivery.TerminalResult(delivery.FrameErrorDomainRejected),
		realtime.CallSignal_OFFER,
	) {
		t.Fatal("non-lifecycle signal must not map to call conflict")
	}
}

var _ realtimeFederationRuntime = (*callSignalTestRuntime)(nil)
var _ actorHomeStationResolver = callSignalTestActorHomes{}
var _ SignalAuthorizer = allowCallSignal{}
