package notification

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("ntf-list", "/notification/list", server.GET, s.handleList, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-mark-read", "/notification/mark-read", server.POST, s.handleMarkRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-mark-all-read", "/notification/mark-all-read", server.POST, s.handleMarkAllRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-delete", "/notification/delete", server.POST, s.handleDelete, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-unread-counts", "/notification/unread-counts", server.GET, s.handleUnreadCounts, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-preferences", "/notification/preferences", server.GET, s.handleGetPreferences, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-preferences-update", "/notification/preferences/update", server.POST, s.handleUpdatePreference, logIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleList(ctx context.Context, req *pb.ListNotificationsRequest) (*pb.ListNotificationsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	items, totalCount, unreadCount, err := s.service.List(
		subject.ID,
		int32(req.Category),
		int32(req.Status),
		req.Cursor,
		limit+1,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list notifications", err)
	}

	nextCursor := ""
	if len(items) > limit {
		nextCursor = items[limit-1].ID
		items = items[:limit]
	}

	protoItems := make([]*pb.Notification, 0, len(items))
	for _, item := range items {
		protoItems = append(protoItems, notifToProto(item))
	}

	return &pb.ListNotificationsResponse{
		Notifications: protoItems,
		NextCursor:    nextCursor,
		TotalCount:    int32(totalCount),
		UnreadCount:   int32(unreadCount),
	}, nil
}

func (s *subServer) handleMarkRead(ctx context.Context, req *pb.MarkNotificationsReadRequest) (*pb.MarkNotificationsReadResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.NotificationIds) == 0 {
		return nil, server.BadRequest("notification_ids is required")
	}

	updated, err := s.service.MarkRead(subject.ID, req.NotificationIds)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to mark notifications read", err)
	}
	return &pb.MarkNotificationsReadResponse{UpdatedCount: int32(updated)}, nil
}

func (s *subServer) handleMarkAllRead(ctx context.Context, req *pb.MarkAllNotificationsReadRequest) (*pb.MarkAllNotificationsReadResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	updated, err := s.service.MarkAllRead(subject.ID, int32(req.Category))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to mark all notifications read", err)
	}
	return &pb.MarkAllNotificationsReadResponse{UpdatedCount: int32(updated)}, nil
}

func (s *subServer) handleDelete(ctx context.Context, req *pb.DeleteNotificationsRequest) (*pb.DeleteNotificationsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.NotificationIds) == 0 {
		return nil, server.BadRequest("notification_ids is required")
	}

	deleted, err := s.service.Delete(subject.ID, req.NotificationIds)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to delete notifications", err)
	}
	return &pb.DeleteNotificationsResponse{DeletedCount: int32(deleted)}, nil
}

func (s *subServer) handleUnreadCounts(ctx context.Context, _ *pb.GetUnreadCountsRequest) (*pb.GetUnreadCountsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	counts, err := s.service.GetUnreadCounts(subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get unread counts", err)
	}

	byCategory := make(map[int32]int32, len(counts.ByCategory))
	for k, v := range counts.ByCategory {
		byCategory[k] = v
	}
	return &pb.GetUnreadCountsResponse{
		Total:      counts.Total,
		ByCategory: byCategory,
	}, nil
}

func (s *subServer) handleGetPreferences(ctx context.Context, _ *pb.GetNotificationPreferencesRequest) (*pb.GetNotificationPreferencesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	prefs, err := s.service.GetPreferences(subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get preferences", err)
	}

	protoPrefs := make([]*pb.NotificationPreference, 0, len(prefs))
	for _, p := range prefs {
		protoPrefs = append(protoPrefs, &pb.NotificationPreference{
			ActorId:      p.ActorID,
			Category:     pb.NotificationCategory(p.Category),
			Enabled:      p.Enabled,
			PushEnabled:  p.PushEnabled,
			SoundEnabled: p.SoundEnabled,
			UpdatedAt:    timestamppb.New(p.UpdatedAt),
		})
	}
	return &pb.GetNotificationPreferencesResponse{Preferences: protoPrefs}, nil
}

func (s *subServer) handleUpdatePreference(ctx context.Context, req *pb.UpdateNotificationPreferenceRequest) (*pb.UpdateNotificationPreferenceResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Category == pb.NotificationCategory_NOTIFICATION_CATEGORY_UNSPECIFIED {
		return nil, server.BadRequest("category is required")
	}

	pref, err := s.service.UpsertPreference(domain.NotificationPreference{
		ActorID:      subject.ID,
		Category:     int32(req.Category),
		Enabled:      req.Enabled,
		PushEnabled:  req.PushEnabled,
		SoundEnabled: req.SoundEnabled,
	})
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to update preference", err)
	}
	return &pb.UpdateNotificationPreferenceResponse{
		Preference: &pb.NotificationPreference{
			ActorId:      pref.ActorID,
			Category:     pb.NotificationCategory(pref.Category),
			Enabled:      pref.Enabled,
			PushEnabled:  pref.PushEnabled,
			SoundEnabled: pref.SoundEnabled,
			UpdatedAt:    timestamppb.New(pref.UpdatedAt),
		},
	}, nil
}

// ============================================================================
// Mapping helpers
// ============================================================================

func notifToProto(n domain.Notification) *pb.Notification {
	p := &pb.Notification{
		Id:          n.ID,
		RecipientId: n.RecipientID,
		ActorId:     n.ActorID,
		Type:        pb.NotificationType(n.Type),
		Category:    pb.NotificationCategory(n.Category),
		Status:      pb.NotificationStatus(n.Status),
		TargetType:  n.TargetType,
		TargetId:    n.TargetID,
		Title:       n.Title,
		Body:        n.Body,
		GroupKey:    n.GroupKey,
		Metadata:    n.Metadata,
		CreatedAt:   timestamppb.New(n.CreatedAt),
	}
	if n.ReadAt != nil {
		p.ReadAt = timestamppb.New(*n.ReadAt)
	}
	return p
}
