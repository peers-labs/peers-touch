package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// TerminalSessionHandlers exposes TW-D6 device browser session metadata
// endpoints. Process and page state live on the Desktop worker.
type BrowserSessionHandlers struct {
	sessions *service.BrowserSessionService
}

func NewBrowserSessionHandlers(sessions *service.BrowserSessionService) *BrowserSessionHandlers {
	return &BrowserSessionHandlers{sessions: sessions}
}

func (h *BrowserSessionHandlers) HandleCreateBrowserSession(
	ctx context.Context,
	req *model.CreateBrowserSessionRequest,
) (*model.CreateBrowserSessionResponse, error) {
	row, err := h.sessions.Create(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateBrowserSessionResponse{Session: service.BrowserSessionProto(row)}, nil
}

func (h *BrowserSessionHandlers) HandleUpdateBrowserSession(
	ctx context.Context,
	req *model.UpdateBrowserSessionRequest,
) (*model.UpdateBrowserSessionResponse, error) {
	row, err := h.sessions.Update(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateBrowserSessionResponse{Session: service.BrowserSessionProto(row)}, nil
}

func (h *BrowserSessionHandlers) HandleListBrowserSessions(
	ctx context.Context,
	req *model.ListBrowserSessionsRequest,
) (*model.ListBrowserSessionsResponse, error) {
	rows, err := h.sessions.List(ctx, subjectActorID(ctx), req.GetConversationId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	sessions := make([]*model.BrowserSession, 0, len(rows))
	for i := range rows {
		sessions = append(sessions, service.BrowserSessionProto(&rows[i]))
	}
	return &model.ListBrowserSessionsResponse{Sessions: sessions}, nil
}

func (h *BrowserSessionHandlers) HandleReconcileBrowserSessions(
	ctx context.Context,
	req *model.ReconcileBrowserSessionsRequest,
) (*model.ReconcileBrowserSessionsResponse, error) {
	rows, err := h.sessions.Reconcile(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	sessions := make([]*model.BrowserSession, 0, len(rows))
	for i := range rows {
		sessions = append(sessions, service.BrowserSessionProto(&rows[i]))
	}
	return &model.ReconcileBrowserSessionsResponse{Sessions: sessions}, nil
}

func (h *BrowserSessionHandlers) HandleRemoveBrowserSession(
	ctx context.Context,
	req *model.RemoveBrowserSessionRequest,
) (*model.RemoveBrowserSessionResponse, error) {
	if err := h.sessions.Remove(ctx, subjectActorID(ctx), req.GetSessionId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RemoveBrowserSessionResponse{Removed: true}, nil
}
