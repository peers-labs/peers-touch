package events

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const federatedCallSignalLifetime = time.Minute

type realtimeFederationRuntime interface {
	RegisterReceivers(federationruntime.ReceiverRegistrar) error
	DeliverRealtimeCallSignal(
		context.Context,
		*delivery.Frame,
	) (delivery.Result, error)
	CallPeer(context.Context, federationruntime.PeerCall) error
	Signer() delivery.Signer
	LocalStationPeerID() string
}

type actorHomeStationResolver interface {
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
}

type federatedCallSignalSender struct {
	runtime realtimeFederationRuntime
	now     func() time.Time
}

func newFederatedCallSignalSender(
	runtime realtimeFederationRuntime,
) (*federatedCallSignalSender, error) {
	if runtime == nil ||
		runtime.Signer() == nil ||
		strings.TrimSpace(runtime.LocalStationPeerID()) == "" {
		return nil, errors.New(
			"events: Federation call-signal dependencies are unavailable",
		)
	}
	return &federatedCallSignalSender{
		runtime: runtime,
		now:     func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *federatedCallSignalSender) deliver(
	ctx context.Context,
	targetStationPeerID string,
	payload *realtime.FederatedCallSignal,
) (delivery.Result, error) {
	if s == nil || s.runtime == nil || payload == nil ||
		strings.TrimSpace(targetStationPeerID) == "" {
		return delivery.Result{}, errors.New(
			"events: complete Federation call-signal route is required",
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return delivery.Result{}, fmt.Errorf(
			"events: encode Federation call signal: %w",
			err,
		)
	}
	signal := payload.GetSignal()
	if signal == nil {
		return delivery.Result{}, errors.New(
			"events: Federation call signal is required",
		)
	}
	issuedAt := s.now()
	identity := callSignalFrameIdentity(
		s.runtime.LocalStationPeerID(),
		targetStationPeerID,
		payload.GetRecipientActorPtid(),
		signal,
	)
	orderingIdentity := signal.GetCallId()
	if orderingIdentity == "" {
		orderingIdentity = signal.GetSessionUlid()
	}
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "realtime-call-frame:" + identity,
		SourceStationPeerId: s.runtime.LocalStationPeerID(),
		TargetStationPeerId: targetStationPeerID,
		IdempotencyKey:      "realtime-call:" + identity,
		PayloadKind:         delivery.PayloadKindRealtimeCallSignal,
		PayloadId:           identity,
		OrderingKey:         "realtime-call:" + orderingIdentity,
		OpaquePayload:       encoded,
		IssuedAt:            timestamppb.New(issuedAt),
		ExpiresAt:           timestamppb.New(issuedAt.Add(federatedCallSignalLifetime)),
	}
	if err := delivery.SignFrame(
		ctx,
		frame,
		delivery.DefaultFramePolicy(targetStationPeerID),
		s.runtime.Signer(),
	); err != nil {
		return delivery.Result{}, err
	}
	return s.runtime.DeliverRealtimeCallSignal(ctx, frame)
}

func callSignalFrameIdentity(
	sourceStationPeerID string,
	targetStationPeerID string,
	recipientActorPTID string,
	signal *realtime.CallSignal,
) string {
	hash := sha256.New()
	for _, value := range []string{
		sourceStationPeerID,
		targetStationPeerID,
		recipientActorPTID,
		signal.GetFromActorPtid(),
		signal.GetSessionUlid(),
		signal.GetCallId(),
		signal.GetKind().String(),
		signal.GetWinningDeviceId(),
	} {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	_, _ = hash.Write(signal.GetPayload())
	return hex.EncodeToString(hash.Sum(nil))
}

func (s *eventsSubServer) bindFederation() error {
	federationInstance := server.GetOptions().SubserverInstances["federation"]
	federationProvider, ok := federationInstance.(federationruntime.RuntimeProvider)
	if !ok || federationProvider == nil {
		return errors.New("events: Federation runtime provider is unavailable")
	}
	runtime := federationProvider.FederationDeliveryRuntime()
	sender, err := newFederatedCallSignalSender(runtime)
	if err != nil {
		return err
	}
	actorInstance := server.GetOptions().SubserverInstances["actor_identity"]
	actorHomes, ok := actorInstance.(actorHomeStationResolver)
	if !ok || actorHomes == nil {
		return errors.New("events: Actor Home Station resolver is unavailable")
	}
	if err := runtime.RegisterReceivers(
		func(registry *delivery.Registry) error {
			return delivery.RegisterEphemeralProtoReceiver(
				registry,
				delivery.PayloadKindRealtimeCallSignal,
				func() *realtime.FederatedCallSignal {
					return &realtime.FederatedCallSignal{}
				},
				s.receiveFederatedCallSignal,
			)
		},
	); err != nil {
		return fmt.Errorf(
			"events: register Federation call-signal receiver: %w",
			err,
		)
	}
	s.federation = runtime
	s.actorHomes = actorHomes
	s.federatedCallSignals = sender
	s.localStationPeerID = runtime.LocalStationPeerID()
	return nil
}

func (s *eventsSubServer) receiveFederatedCallSignal(
	ctx context.Context,
	payload *realtime.FederatedCallSignal,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if payload == nil || frame == nil || s.actorHomes == nil ||
		s.callResolution == nil || s.bus == nil {
		return delivery.RetryableResult(delivery.FrameErrorOverloaded), nil
	}
	recipientActorPTID := strings.TrimSpace(payload.GetRecipientActorPtid())
	signal := payload.GetSignal()
	if err := validateFederatedCallSignal(recipientActorPTID, signal); err != nil {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	recipientHome, err := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		recipientActorPTID,
	)
	if err != nil {
		return delivery.RetryableResult(delivery.FrameErrorDomainRejected), nil
	}
	sourceHome, err := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		signal.GetFromActorPtid(),
	)
	if err != nil {
		return delivery.RetryableResult(delivery.FrameErrorDomainRejected), nil
	}
	if recipientHome != s.localStationPeerID ||
		sourceHome != frame.GetSourceStationPeerId() ||
		frame.GetTargetStationPeerId() != s.localStationPeerID {
		return delivery.TerminalResult(delivery.FrameErrorWrongTarget), nil
	}
	if signal.GetFromActorPtid() != recipientActorPTID {
		authorizer := getSignalAuthorizer()
		if authorizer == nil {
			return delivery.RetryableResult(delivery.FrameErrorDomainRejected), nil
		}
		allowed, err := authorizer.CanSignal(
			signal.GetFromActorPtid(),
			recipientActorPTID,
		)
		if err != nil {
			return delivery.RetryableResult(delivery.FrameErrorDomainRejected), nil
		}
		if !allowed {
			return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
		}
	}
	if signal.GetKind() == realtime.CallSignal_CALL_REQUEST {
		result, err := s.callResolution.open(
			ctx,
			signal.GetFromActorPtid(),
			recipientActorPTID,
			signal.GetSessionUlid(),
			signal.GetCallId(),
			callRequestDigest(
				signal.GetFromActorPtid(),
				recipientActorPTID,
				signal.GetSessionUlid(),
				signal.GetCallId(),
				signal.GetPayload(),
			),
		)
		if err != nil {
			if errors.Is(err, errCallResolutionConflict) ||
				errors.Is(err, errCallResolutionExpired) {
				return delivery.TerminalResult(
					delivery.FrameErrorDomainRejected,
				), nil
			}
			return delivery.RetryableResult(
				delivery.FrameErrorDomainRejected,
			), nil
		}
		if result.idempotent {
			return delivery.DuplicateResult(), nil
		}
	}
	if _, err := s.bus.Publish(
		recipientActorPTID,
		streamEventForSignal(signal),
	); err != nil {
		return delivery.RetryableResult(delivery.FrameErrorOverloaded), nil
	}
	return delivery.AcceptedResult(), nil
}

func validateFederatedCallSignal(
	recipientActorPTID string,
	signal *realtime.CallSignal,
) error {
	if recipientActorPTID == "" || signal == nil ||
		strings.TrimSpace(signal.GetSessionUlid()) == "" ||
		strings.TrimSpace(signal.GetFromActorPtid()) == "" ||
		signal.GetKind() == realtime.CallSignal_KIND_UNSPECIFIED ||
		len(signal.GetPayload()) > signalIngressMaxPayloadBytes {
		return errors.New("events: invalid Federation call signal")
	}
	if isCallLifecycleSignal(signal.GetKind()) &&
		strings.TrimSpace(signal.GetCallId()) == "" {
		return errors.New("events: call lifecycle signal requires call_id")
	}
	if signal.GetKind() == realtime.CallSignal_CALL_NO_ANSWER {
		if len(signal.GetPayload()) != 0 ||
			signal.GetWinningDeviceId() != "" {
			return errors.New("events: invalid no-answer signal")
		}
	}
	return nil
}

func streamEventForSignal(signal *realtime.CallSignal) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Signaling{
			Signaling: proto.Clone(signal).(*realtime.CallSignal),
		},
	}
}

func (s *eventsSubServer) dispatchFederatedSignal(
	ctx context.Context,
	recipientActorPTID string,
	signal *realtime.CallSignal,
) (delivery.Result, error) {
	if s.actorHomes == nil || s.federatedCallSignals == nil {
		return delivery.Result{}, errors.New(
			"events: Federation call-signal routing is unavailable",
		)
	}
	targetStationPeerID, err := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		recipientActorPTID,
	)
	if err != nil {
		return delivery.Result{}, fmt.Errorf(
			"events: resolve recipient Home Station: %w",
			err,
		)
	}
	return s.federatedCallSignals.deliver(
		ctx,
		targetStationPeerID,
		&realtime.FederatedCallSignal{
			RecipientActorPtid: recipientActorPTID,
			Signal:             proto.Clone(signal).(*realtime.CallSignal),
		},
	)
}

func (s *eventsSubServer) readCallResolution(
	ctx context.Context,
	requestingActorPTID string,
	peerActorPTID string,
	callID string,
) (callResolutionModel, error) {
	result, err := s.callResolution.getForActor(
		ctx,
		requestingActorPTID,
		callID,
	)
	if err == nil {
		if !callResolutionParticipantsMatch(
			result.record,
			requestingActorPTID,
			peerActorPTID,
		) {
			return callResolutionModel{}, errCallResolutionNotFound
		}
		if result.becameNoAnswer {
			s.fanOutNoAnswer(ctx, result.record)
		}
		return result.record, nil
	}
	if !errors.Is(err, errCallResolutionNotFound) ||
		s.actorHomes == nil ||
		s.federation == nil ||
		strings.TrimSpace(peerActorPTID) == "" {
		return callResolutionModel{}, err
	}
	targetStationPeerID, resolveErr := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		peerActorPTID,
	)
	if resolveErr != nil {
		return callResolutionModel{}, fmt.Errorf(
			"events: resolve call owner Home Station: %w",
			resolveErr,
		)
	}
	if targetStationPeerID == s.localStationPeerID {
		return callResolutionModel{}, errCallResolutionNotFound
	}
	request := &realtime.GetFederatedCallResolutionRequest{
		RequestingActorPtid: requestingActorPTID,
		CallId:              callID,
		PeerActorPtid:       peerActorPTID,
	}
	response := &realtime.GetFederatedCallResolutionResponse{}
	if callErr := s.federation.CallPeer(
		ctx,
		federationruntime.PeerCall{
			TargetStationPeerID: targetStationPeerID,
			Route:               federationruntime.PeerRouteRealtimeCallResolution,
			Subject:             requestingActorPTID,
			Claims: map[string]string{
				federationruntime.ClaimActorPTID:           requestingActorPTID,
				federationruntime.ClaimCallID:              callID,
				federationruntime.ClaimSourceStationPeerID: s.localStationPeerID,
				federationruntime.ClaimTargetStationPeerID: targetStationPeerID,
			},
			Request:  request,
			Response: response,
		},
	); callErr != nil {
		return callResolutionModel{}, callErr
	}
	return callResolutionModelFromProto(response), nil
}

// ResolveFederatedCallResolution handles a signed caller readback at the
// callee Home Station.
func (s *eventsSubServer) ResolveFederatedCallResolution(
	ctx context.Context,
	sourceStationPeerID string,
	request *realtime.GetFederatedCallResolutionRequest,
) (*realtime.GetFederatedCallResolutionResponse, error) {
	if request == nil || s.actorHomes == nil || s.callResolution == nil {
		return nil, errors.New(
			"events: Federation call-resolution dependencies are unavailable",
		)
	}
	requestingActorPTID := strings.TrimSpace(
		request.GetRequestingActorPtid(),
	)
	callID := strings.TrimSpace(request.GetCallId())
	peerActorPTID := strings.TrimSpace(request.GetPeerActorPtid())
	if requestingActorPTID == "" || peerActorPTID == "" || callID == "" {
		return nil, errors.New(
			"events: Federation call-resolution request is incomplete",
		)
	}
	requesterHome, err := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		requestingActorPTID,
	)
	if err != nil {
		return nil, err
	}
	if requesterHome != sourceStationPeerID {
		return nil, errors.New(
			"events: requesting actor does not belong to source Station",
		)
	}
	result, err := s.callResolution.getForActor(
		ctx,
		requestingActorPTID,
		callID,
	)
	if err != nil {
		return nil, err
	}
	record := result.record
	if !callResolutionParticipantsMatch(
		record,
		requestingActorPTID,
		peerActorPTID,
	) {
		return nil, errCallResolutionNotFound
	}
	if result.becameNoAnswer {
		s.fanOutNoAnswer(ctx, record)
	}
	return callResolutionProtoFromModel(record), nil
}

func callResolutionParticipantsMatch(
	record callResolutionModel,
	firstActorPTID string,
	secondActorPTID string,
) bool {
	return (record.CallerActorPTID == firstActorPTID &&
		record.CalleeActorPTID == secondActorPTID) ||
		(record.CallerActorPTID == secondActorPTID &&
			record.CalleeActorPTID == firstActorPTID)
}

func callResolutionProtoFromModel(
	record callResolutionModel,
) *realtime.GetFederatedCallResolutionResponse {
	var resolvedAt int64
	if record.ResolvedAt != nil {
		resolvedAt = record.ResolvedAt.UnixMilli()
	}
	return &realtime.GetFederatedCallResolutionResponse{
		CallId:             record.CallID,
		State:              record.State,
		WinningDeviceId:    record.WinningDeviceID,
		TerminalAction:     record.TerminalAction,
		RingDeadlineUnixMs: record.RingDeadline.UnixMilli(),
		ResolvedAtUnixMs:   resolvedAt,
		ExpiresAtUnixMs:    record.ExpiresAt.UnixMilli(),
	}
}

func callResolutionModelFromProto(
	response *realtime.GetFederatedCallResolutionResponse,
) callResolutionModel {
	record := callResolutionModel{
		CallID:          response.GetCallId(),
		State:           response.GetState(),
		WinningDeviceID: response.GetWinningDeviceId(),
		TerminalAction:  response.GetTerminalAction(),
		RingDeadline:    time.UnixMilli(response.GetRingDeadlineUnixMs()).UTC(),
		ExpiresAt:       time.UnixMilli(response.GetExpiresAtUnixMs()).UTC(),
	}
	if response.GetResolvedAtUnixMs() > 0 {
		resolvedAt := time.UnixMilli(response.GetResolvedAtUnixMs()).UTC()
		record.ResolvedAt = &resolvedAt
	}
	return record
}

func (s *eventsSubServer) fanOutNoAnswer(
	ctx context.Context,
	record callResolutionModel,
) {
	signal := &realtime.CallSignal{
		SessionUlid:   record.SessionULID,
		FromActorPtid: record.CalleeActorPTID,
		Kind:          realtime.CallSignal_CALL_NO_ANSWER,
		CallId:        record.CallID,
	}
	if s.bus != nil {
		if _, err := s.bus.Publish(
			record.CalleeActorPTID,
			streamEventForSignal(signal),
		); err != nil {
			logger.DefaultHelper.Warnf(
				"events: no-answer fan-out failed call_id=%s actor_ptid=%s: %v",
				record.CallID,
				record.CalleeActorPTID,
				err,
			)
		}
	}
	if record.CallerActorPTID == record.CalleeActorPTID {
		return
	}
	if _, err := s.dispatchFederatedSignal(
		ctx,
		record.CallerActorPTID,
		signal,
	); err != nil {
		logger.DefaultHelper.Warnf(
			"events: no-answer fan-out failed call_id=%s actor_ptid=%s: %v",
			record.CallID,
			record.CallerActorPTID,
			err,
		)
	}
}
