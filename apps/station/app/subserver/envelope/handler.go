package envelope

import (
	"context"
	"strings"

	auth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// --- Handlers ---

func (s *subServer) handleSubmit(ctx context.Context, req *chat.SubmitEnvelopeRequest) (*chat.SubmitEnvelopeResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Envelope == nil {
		return nil, server.BadRequest("envelope is required")
	}
	if req.Envelope.IdempotencyKey == "" {
		return nil, server.BadRequest("idempotency_key is required")
	}
	if req.Envelope.PayloadType ==
		chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE {
		return nil, server.BadRequest("direct key exchange must use /dkx/send")
	}

	req.Envelope.SenderPtid = subject.ID
	if deviceID := serverwrapper.GetDeviceID(ctx); deviceID != "" {
		req.Envelope.SenderDeviceId = deviceID
	}
	if idemKey := serverwrapper.GetIdempotencyKey(ctx); idemKey != "" {
		req.Envelope.IdempotencyKey = idemKey
	}

	envID, err := s.service.Submit(ctx, req.Envelope)
	if err != nil {
		return nil, server.InternalErrorWithCause("submit failed", err)
	}
	return &chat.SubmitEnvelopeResponse{EnvelopeId: envID}, nil
}

func (s *subServer) handleAck(ctx context.Context, req *chat.AckEnvelopeRequest) (*chat.AckEnvelopeResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.InboxItemId == "" {
		return nil, server.BadRequest("inbox_item_id is required")
	}

	deviceID, err := authenticatedEnvelopeDeviceID(ctx, req.DeviceId)
	if err != nil {
		return nil, err
	}

	if err := s.service.Ack(ctx, subject.ID, deviceID, req.InboxItemId); err != nil {
		return nil, server.InternalErrorWithCause("ack failed", err)
	}
	return &chat.AckEnvelopeResponse{}, nil
}

func (s *subServer) handleResume(ctx context.Context, req *chat.ResumeEnvelopesRequest) (*chat.ResumeEnvelopesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	deviceID, err := authenticatedEnvelopeDeviceID(ctx, req.DeviceId)
	if err != nil {
		return nil, err
	}

	items, err := s.service.Resume(ctx, subject.ID, deviceID, req.AfterCursor)
	if err != nil {
		return nil, server.InternalErrorWithCause("resume failed", err)
	}
	return &chat.ResumeEnvelopesResponse{Items: items}, nil
}

func (s *subServer) handleFederationDeliver(ctx context.Context, req *chat.FederationDeliverEnvelopeRequest) (*chat.FederationDeliverEnvelopeResponse, error) {
	if req.Envelope == nil {
		return nil, server.BadRequest("envelope is required")
	}

	verified := httpadapter.GetVerifiedClaims(ctx)
	if verified == nil {
		return nil, server.Unauthorized("federation token required")
	}

	claims := &FederationClaims{
		IssuerStationPeerID:   verified.Issuer,
		AudienceStationPeerID: verified.Audience,
		SenderPtid:            verified.Subject,
		ConversationID:        verified.Custom["conversation_id"],
		IdempotencyKey:        verified.Custom["idempotency_key"],
		IssuedAt:              verified.IssuedAt,
		ExpiresAt:             verified.ExpiresAt,
	}

	if err := s.service.Deliver(ctx, req.Envelope, claims); err != nil {
		return nil, server.InternalErrorWithCause("federation deliver failed", err)
	}
	return &chat.FederationDeliverEnvelopeResponse{}, nil
}

func authenticatedEnvelopeDeviceID(ctx context.Context, requestedDeviceID string) (string, error) {
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", server.BadRequest("X-Device-ID is required")
	}
	if requestedDeviceID = strings.TrimSpace(requestedDeviceID); requestedDeviceID != "" &&
		requestedDeviceID != deviceID {
		return "", server.BadRequest("device_id does not match authenticated X-Device-ID")
	}
	return deviceID, nil
}
