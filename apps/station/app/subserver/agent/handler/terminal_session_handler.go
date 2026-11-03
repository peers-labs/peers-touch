package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// TerminalSessionHandlers exposes the TW-D5 device terminal metadata
// contract. Process ownership stays in the Desktop Rust worker.
type TerminalSessionHandlers struct {
	sessions *service.TerminalSessionService
}

func NewTerminalSessionHandlers(sessions *service.TerminalSessionService) *TerminalSessionHandlers {
	return &TerminalSessionHandlers{sessions: sessions}
}

func (h *TerminalSessionHandlers) HandleCreateTerminalSession(
	ctx context.Context,
	req *model.CreateTerminalSessionRequest,
) (*model.CreateTerminalSessionResponse, error) {
	row, err := h.sessions.Create(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateTerminalSessionResponse{Session: service.TerminalSessionProto(row)}, nil
}

func (h *TerminalSessionHandlers) HandleUpdateTerminalSession(
	ctx context.Context,
	req *model.UpdateTerminalSessionRequest,
) (*model.UpdateTerminalSessionResponse, error) {
	row, err := h.sessions.Update(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateTerminalSessionResponse{Session: service.TerminalSessionProto(row)}, nil
}

func (h *TerminalSessionHandlers) HandleListTerminalSessions(
	ctx context.Context,
	req *model.ListTerminalSessionsRequest,
) (*model.ListTerminalSessionsResponse, error) {
	rows, err := h.sessions.List(ctx, subjectActorID(ctx), req.GetConversationId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	sessions := make([]*model.TerminalSession, 0, len(rows))
	for i := range rows {
		sessions = append(sessions, service.TerminalSessionProto(&rows[i]))
	}
	return &model.ListTerminalSessionsResponse{Sessions: sessions}, nil
}

func (h *TerminalSessionHandlers) HandleReconcileTerminalSessions(
	ctx context.Context,
	req *model.ReconcileTerminalSessionsRequest,
) (*model.ReconcileTerminalSessionsResponse, error) {
	rows, err := h.sessions.Reconcile(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	sessions := make([]*model.TerminalSession, 0, len(rows))
	for i := range rows {
		sessions = append(sessions, service.TerminalSessionProto(&rows[i]))
	}
	return &model.ReconcileTerminalSessionsResponse{Sessions: sessions}, nil
}

func (h *TerminalSessionHandlers) HandleRemoveTerminalSession(
	ctx context.Context,
	req *model.RemoveTerminalSessionRequest,
) (*model.RemoveTerminalSessionResponse, error) {
	if err := h.sessions.Remove(ctx, subjectActorID(ctx), req.GetSessionId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RemoveTerminalSessionResponse{Removed: true}, nil
}
