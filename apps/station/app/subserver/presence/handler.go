package presence

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model/presence"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("presence-heartbeat", "/presence/heartbeat", server.POST, s.handleHeartbeat, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("presence-offline", "/presence/offline", server.POST, s.handleOffline, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("presence-query", "/presence/query", server.POST, s.handleQuery, logIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleHeartbeat(ctx context.Context, _ *model.PresenceHeartbeatRequest) (*model.PresenceUpdateResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorPTID := subject.ID
	status, err := s.service.Heartbeat(actorPTID, subject.SessionID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to update presence heartbeat", err)
	}
	return updateResponse(actorPTID, subject.SessionID, status), nil
}

func (s *subServer) handleOffline(ctx context.Context, _ *model.PresenceOfflineRequest) (*model.PresenceUpdateResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorPTID := subject.ID
	status, err := s.service.Offline(actorPTID, subject.SessionID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to mark presence offline", err)
	}
	return updateResponse(actorPTID, subject.SessionID, status), nil
}

func (s *subServer) handleQuery(ctx context.Context, req *model.PresenceQueryRequest) (*model.PresenceQueryResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		return nil, server.BadRequest("presence query is required")
	}
	if _, err := normalizePresenceQueryActors(req.ActorPtids); err != nil {
		return nil, server.BadRequestWithCause("presence query is invalid", err)
	}
	statuses, err := s.query.Query(ctx, subject.ID, req.ActorPtids)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to query presence", err)
	}
	out := make([]*model.PresenceStatus, 0, len(statuses))
	for _, item := range statuses {
		out = append(out, statusResponse(item))
	}
	return &model.PresenceQueryResponse{Statuses: out}, nil
}

func updateResponse(actorPTID, sessionID string, status domain.Status) *model.PresenceUpdateResponse {
	return &model.PresenceUpdateResponse{
		ActorPtid:      actorPTID,
		SessionId:      sessionID,
		State:          model.PresenceState(status.State),
		LeaseExpiresAt: timestampOrNil(status.LeaseExpiresAt),
	}
}

func statusResponse(status domain.Status) *model.PresenceStatus {
	return &model.PresenceStatus{
		ActorPtid:      status.ActorPTID,
		State:          model.PresenceState(status.State),
		LastSeenAt:     timestampOrNil(status.LastSeenAt),
		LeaseExpiresAt: timestampOrNil(status.LeaseExpiresAt),
	}
}

func timestampOrNil(value time.Time) *timestamppb.Timestamp {
	if value.IsZero() {
		return nil
	}
	return timestamppb.New(value)
}
