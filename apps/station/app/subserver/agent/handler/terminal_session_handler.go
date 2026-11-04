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

// HandleResolveActiveSandboxes is read-only: it lists the actor's current
// sandbox allocations so the Desktop can place a terminal without typing a
// sandbox_ref. It never allocates or starts a container.
func (h *TerminalSessionHandlers) HandleResolveActiveSandboxes(
	ctx context.Context,
	_ *model.ResolveActiveSandboxesRequest,
) (*model.ResolveActiveSandboxesResponse, error) {
	resp, err := h.sessions.ResolveActiveSandboxes(ctx, subjectActorID(ctx))
	if err != nil {
		return nil, toHandlerError(err)
	}
	return resp, nil
}

func (h *TerminalSessionHandlers) HandleSandboxPtyWrite(
	ctx context.Context,
	req *model.SandboxPtyWriteRequest,
) (*model.SandboxPtyWriteResponse, error) {
	if err := h.sessions.SandboxPtyWrite(ctx, subjectActorID(ctx), req); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SandboxPtyWriteResponse{BytesWritten: uint64(len(req.GetData()))}, nil
}

func (h *TerminalSessionHandlers) HandleSandboxPtyRead(
	ctx context.Context,
	req *model.SandboxPtyReadRequest,
) (*model.SandboxPtyReadResponse, error) {
	return h.sessions.SandboxPtyRead(ctx, subjectActorID(ctx), req)
}

func (h *TerminalSessionHandlers) HandleSandboxPtyResize(
	ctx context.Context,
	req *model.SandboxPtyResizeRequest,
) (*model.SandboxPtyResizeResponse, error) {
	if err := h.sessions.SandboxPtyResize(ctx, subjectActorID(ctx), req); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SandboxPtyResizeResponse{}, nil
}

func (h *TerminalSessionHandlers) HandleSandboxPtySignal(
	ctx context.Context,
	req *model.SandboxPtySignalRequest,
) (*model.SandboxPtySignalResponse, error) {
	if err := h.sessions.SandboxPtySignal(ctx, subjectActorID(ctx), req); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SandboxPtySignalResponse{}, nil
}
