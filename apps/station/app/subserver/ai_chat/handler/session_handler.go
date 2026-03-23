package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/service"
)

type SessionHandlers struct{}

func NewSessionHandlers() *SessionHandlers {
	return &SessionHandlers{}
}

func (h *SessionHandlers) HandleCreateSession(ctx context.Context, req *model.CreateSessionRequest) (*model.CreateSessionResponse, error) {
	session, err := service.CreateSession(ctx, req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateSessionResponse{Session: session}, nil
}

func (h *SessionHandlers) HandleListSessions(ctx context.Context, req *model.ListSessionsRequest) (*model.ListSessionsResponse, error) {
	sessions, err := service.ListSessions(ctx, req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListSessionsResponse{Sessions: sessions}, nil
}

func (h *SessionHandlers) HandleGetSession(ctx context.Context, req *model.GetSessionRequest) (*model.GetSessionResponse, error) {
	session, err := service.GetSession(ctx, req.GetSessionId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetSessionResponse{Session: session}, nil
}

func (h *SessionHandlers) HandleUpdateSession(ctx context.Context, req *model.UpdateSessionRequest) (*model.UpdateSessionResponse, error) {
	session, err := service.UpdateSession(ctx, req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateSessionResponse{Session: session}, nil
}

func (h *SessionHandlers) HandleDeleteSession(ctx context.Context, req *model.DeleteSessionRequest) (*model.DeleteSessionResponse, error) {
	if err := service.DeleteSession(ctx, req.GetSessionId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteSessionResponse{Success: true}, nil
}
