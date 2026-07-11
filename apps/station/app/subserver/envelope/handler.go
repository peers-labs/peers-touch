package envelope

import (
	"context"

	auth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// --- Request/Response types ---

type submitRequest struct {
	Envelope *chat.StationEnvelope `json:"envelope"`
}

type submitResponse struct {
	EnvelopeId string `json:"envelope_id"`
}

type ackRequest struct {
	DeviceId    string `json:"device_id"`
	InboxItemId string `json:"inbox_item_id"`
}

type ackResponse struct{}

type resumeRequest struct {
	DeviceId    string `json:"device_id"`
	AfterCursor string `json:"after_cursor"`
}

type resumeResponse struct {
	Items []*chat.DeviceInboxItem `json:"items"`
}

type federationDeliverRequest struct {
	Envelope *chat.StationEnvelope `json:"envelope"`
}

type federationDeliverResponse struct{}

// --- Handlers ---

func (s *subServer) handleSubmit(ctx context.Context, req *submitRequest) (*submitResponse, error) {
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

	req.Envelope.SenderActorDid = subject.ID

	envID, err := s.service.Submit(ctx, req.Envelope)
	if err != nil {
		return nil, server.InternalErrorWithCause("submit failed", err)
	}
	return &submitResponse{EnvelopeId: envID}, nil
}

func (s *subServer) handleAck(ctx context.Context, req *ackRequest) (*ackResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.InboxItemId == "" {
		return nil, server.BadRequest("inbox_item_id is required")
	}
	if req.DeviceId == "" {
		return nil, server.BadRequest("device_id is required")
	}

	if err := s.service.Ack(ctx, subject.ID, req.DeviceId, req.InboxItemId); err != nil {
		return nil, server.InternalErrorWithCause("ack failed", err)
	}
	return &ackResponse{}, nil
}

func (s *subServer) handleResume(ctx context.Context, req *resumeRequest) (*resumeResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.DeviceId == "" {
		return nil, server.BadRequest("device_id is required")
	}

	items, err := s.service.Resume(ctx, subject.ID, req.DeviceId, req.AfterCursor)
	if err != nil {
		return nil, server.InternalErrorWithCause("resume failed", err)
	}
	return &resumeResponse{Items: items}, nil
}

func (s *subServer) handleFederationDeliver(ctx context.Context, req *federationDeliverRequest) (*federationDeliverResponse, error) {
	if req.Envelope == nil {
		return nil, server.BadRequest("envelope is required")
	}

	claims := &FederationClaims{
		AudienceStationPeerID: s.localStationID,
		SenderActorDID:        req.Envelope.SenderActorDid,
		ConversationID:        req.Envelope.ConversationId,
		IdempotencyKey:        req.Envelope.IdempotencyKey,
	}

	if err := s.service.Deliver(ctx, req.Envelope, claims); err != nil {
		return nil, server.InternalErrorWithCause("federation deliver failed", err)
	}
	return &federationDeliverResponse{}, nil
}
