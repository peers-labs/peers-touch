package notification

import (
	"context"
	"errors"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler("ntf-list", "/notification/list", server.GET, s.handleList, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-mark-read", "/notification/mark-read", server.POST, s.handleMarkRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-mark-all-read", "/notification/mark-all-read", server.POST, s.handleMarkAllRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-delete", "/notification/delete", server.POST, s.handleDelete, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-unread-counts", "/notification/unread-counts", server.GET, s.handleUnreadCounts, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-preferences", "/notification/preferences", server.GET, s.handleGetPreferences, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ntf-preferences-update", "/notification/preferences", server.POST, s.handleUpdatePreferences, logIDWrapper, s.jwtWrapper),
		server.NewStrictTypedHandler("ntf-push-register", "/notification/push/register", server.POST, s.handleRegisterPush, logIDWrapper, s.jwtWrapper, deviceIDWrapper),
		server.NewStrictTypedHandler("ntf-push-unregister", "/notification/push/unregister", server.POST, s.handleUnregisterPush, logIDWrapper, s.jwtWrapper, deviceIDWrapper),
		server.NewStrictTypedHandler("ntf-push-devices", "/notification/push/devices", server.GET, s.handleListPushDevices, logIDWrapper, s.jwtWrapper),
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

	snapshot, err := s.service.GetPreferences(subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get preferences", err)
	}

	return &pb.GetNotificationPreferencesResponse{
		Snapshot: preferenceSnapshotToProto(snapshot),
	}, nil
}

func (s *subServer) handleUpdatePreferences(ctx context.Context, req *pb.UpdateNotificationPreferencesRequest) (*pb.UpdateNotificationPreferencesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	updates := make([]domain.NotificationPreferencePatch, 0, len(req.Updates))
	for _, update := range req.Updates {
		if update == nil {
			return nil, server.BadRequest("notification preference update is required")
		}
		updates = append(updates, domain.NotificationPreferencePatch{
			Category:     int32(update.Category),
			Enabled:      update.Enabled,
			PushEnabled:  update.PushEnabled,
			SoundEnabled: update.SoundEnabled,
		})
	}

	result, err := s.service.UpdatePreferences(subject.ID, req.ObservedRevision, updates)
	if err != nil {
		if errors.Is(err, application.ErrPreferenceRevisionRequired) ||
			errors.Is(err, application.ErrEmptyPreferenceMutation) ||
			errors.Is(err, application.ErrInvalidPreferenceCategory) ||
			errors.Is(err, application.ErrDuplicatePreferenceCategory) {
			return nil, server.BadRequest(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to update preference", err)
	}
	return &pb.UpdateNotificationPreferencesResponse{
		Outcome:  preferenceUpdateOutcomeToProto(result.Outcome),
		Snapshot: preferenceSnapshotToProto(result.Snapshot),
	}, nil
}

func preferenceSnapshotToProto(snapshot domain.NotificationPreferencesSnapshot) *pb.NotificationPreferencesSnapshot {
	preferences := make([]*pb.NotificationPreference, 0, len(snapshot.Preferences))
	for _, preference := range snapshot.Preferences {
		item := &pb.NotificationPreference{
			ActorPtid:    preference.ActorPTID,
			Category:     pb.NotificationCategory(preference.Category),
			Enabled:      preference.Enabled,
			PushEnabled:  preference.PushEnabled,
			SoundEnabled: preference.SoundEnabled,
		}
		if !preference.UpdatedAt.IsZero() {
			item.UpdatedAt = timestamppb.New(preference.UpdatedAt)
		}
		preferences = append(preferences, item)
	}
	return &pb.NotificationPreferencesSnapshot{
		Preferences:                     preferences,
		NotificationPreferencesRevision: snapshot.Revision,
	}
}

func preferenceUpdateOutcomeToProto(
	outcome domain.NotificationPreferencesUpdateOutcome,
) pb.NotificationPreferencesUpdateOutcome {
	switch outcome {
	case domain.NotificationPreferencesUpdateOutcomeApplied:
		return pb.NotificationPreferencesUpdateOutcome_NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED
	case domain.NotificationPreferencesUpdateOutcomeUnchanged:
		return pb.NotificationPreferencesUpdateOutcome_NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNCHANGED
	case domain.NotificationPreferencesUpdateOutcomeConflict:
		return pb.NotificationPreferencesUpdateOutcome_NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT
	default:
		return pb.NotificationPreferencesUpdateOutcome_NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNSPECIFIED
	}
}

func (s *subServer) handleRegisterPush(
	ctx context.Context,
	req *pb.RegisterPushDeviceRequest,
) (*pb.RegisterPushDeviceResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID, err := verifiedSessionDeviceID(ctx, subject, req.DeviceId)
	if err != nil {
		return nil, err
	}
	binding, err := pushBindingFromProto(req)
	if err != nil {
		return nil, server.BadRequest(err.Error())
	}
	result, err := s.service.RegisterPush(
		deviceID,
		domain.RegisterPushDeviceInput{
			RequestID:             req.RequestId,
			ActorPTID:             subject.ID,
			DeviceID:              req.DeviceId,
			LifecycleGeneration:   req.LifecycleGeneration,
			AppInstallEpochSHA256: append([]byte(nil), req.AppInstallEpochSha256...),
			Environment:           domain.PushEnvironment(req.Environment),
			Binding:               binding,
		},
	)
	if err != nil {
		return nil, pushMutationError("register push device", err)
	}
	return &pb.RegisterPushDeviceResponse{
		RequestId:    result.RequestID,
		Outcome:      registerPushOutcomeToProto(result.Outcome),
		Registration: pushRegistrationToProto(result.Registration),
	}, nil
}

func (s *subServer) handleUnregisterPush(
	ctx context.Context,
	req *pb.UnregisterPushDeviceRequest,
) (*pb.UnregisterPushDeviceResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID, err := verifiedSessionDeviceID(ctx, subject, req.DeviceId)
	if err != nil {
		return nil, err
	}
	result, err := s.service.UnregisterPush(
		deviceID,
		domain.UnregisterPushDeviceInput{
			RequestID:             req.RequestId,
			ActorPTID:             subject.ID,
			DeviceID:              req.DeviceId,
			LifecycleGeneration:   req.LifecycleGeneration,
			RegistrationID:        req.RegistrationId,
			AppInstallEpochSHA256: append([]byte(nil), req.AppInstallEpochSha256...),
		},
	)
	if err != nil {
		return nil, pushMutationError("unregister push device", err)
	}
	return &pb.UnregisterPushDeviceResponse{
		RequestId: result.RequestID,
		Outcome:   unregisterPushOutcomeToProto(result.Outcome),
	}, nil
}

func (s *subServer) handleListPushDevices(
	ctx context.Context,
	_ *pb.ListPushDevicesRequest,
) (*pb.ListPushDevicesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	registrations, err := s.service.ListPushRegistrations(subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("list push devices", err)
	}
	result := make([]*pb.PushRegistration, 0, len(registrations))
	for _, registration := range registrations {
		result = append(result, pushRegistrationToProto(registration))
	}
	return &pb.ListPushDevicesResponse{Registrations: result}, nil
}

func verifiedSessionDeviceID(
	ctx context.Context,
	subject *auth.Subject,
	requestDeviceID string,
) (string, error) {
	asserted := serverwrapper.GetDeviceID(ctx)
	if asserted == "" ||
		requestDeviceID == "" ||
		subject.SessionID == "" {
		return "", server.NewHandlerError(
			http.StatusUnauthorized,
			"authenticated device binding is required",
		)
	}
	resolver, ok := auth.GetGlobalSessionValidator().(auth.SessionDeviceIDResolver)
	if !ok {
		return "", server.NewHandlerError(
			http.StatusServiceUnavailable,
			"session device binding is unavailable",
		)
	}
	persisted := resolver.ResolveSessionDeviceID(ctx, subject.SessionID)
	if persisted == "" {
		return "", server.NewHandlerError(
			http.StatusUnauthorized,
			"authenticated device binding is unavailable",
		)
	}
	if asserted != persisted || requestDeviceID != persisted {
		return "", server.NewHandlerError(
			http.StatusForbidden,
			"authenticated device binding mismatch",
		)
	}
	return persisted, nil
}

func pushBindingFromProto(req *pb.RegisterPushDeviceRequest) (domain.PushProviderBinding, error) {
	switch binding := req.ProviderBinding.(type) {
	case *pb.RegisterPushDeviceRequest_Apns:
		if binding.Apns == nil {
			return domain.PushProviderBinding{}, application.ErrPushRequestInvalid
		}
		return domain.PushProviderBinding{
			Channel:   domain.PushChannelAPNS,
			APNSToken: append([]byte(nil), binding.Apns.Token...),
			APNSTopic: binding.Apns.Topic,
		}, nil
	case *pb.RegisterPushDeviceRequest_Fcm:
		if binding.Fcm == nil {
			return domain.PushProviderBinding{}, application.ErrPushRequestInvalid
		}
		return domain.PushProviderBinding{
			Channel:  domain.PushChannelFCM,
			FCMToken: binding.Fcm.Token,
		}, nil
	case *pb.RegisterPushDeviceRequest_UnifiedPush:
		if binding.UnifiedPush == nil {
			return domain.PushProviderBinding{}, application.ErrPushRequestInvalid
		}
		return domain.PushProviderBinding{
			Channel:         domain.PushChannelUnifiedPush,
			UnifiedEndpoint: binding.UnifiedPush.Endpoint,
			UnifiedP256DH:   append([]byte(nil), binding.UnifiedPush.P256DhKey...),
			UnifiedAuth:     append([]byte(nil), binding.UnifiedPush.AuthSecret...),
		}, nil
	default:
		return domain.PushProviderBinding{}, application.ErrPushRequestInvalid
	}
}

func pushMutationError(operation string, err error) error {
	switch {
	case errors.Is(err, application.ErrPushRequestInvalid):
		return server.BadRequest(err.Error())
	case errors.Is(err, application.ErrPushDeviceMismatch):
		return server.NewHandlerErrorWithCause(http.StatusForbidden, err.Error(), err)
	case errors.Is(err, domain.ErrPushIdempotencyConflict),
		errors.Is(err, domain.ErrPushProviderConflict),
		errors.Is(err, domain.ErrPushInstallConflict):
		return server.NewHandlerErrorWithCause(http.StatusConflict, err.Error(), err)
	case errors.Is(err, application.ErrPushCredentialUnavailable):
		return server.NewHandlerErrorWithCause(http.StatusServiceUnavailable, err.Error(), err)
	default:
		return server.InternalErrorWithCause(operation, err)
	}
}

func pushRegistrationToProto(registration domain.PushRegistration) *pb.PushRegistration {
	result := &pb.PushRegistration{
		RegistrationId: registration.RegistrationID,
		ActorDevice: &pb.ActorDeviceRef{
			ActorPtid: registration.ActorPTID,
			DeviceId:  registration.DeviceID,
		},
		Channel:               pb.PushChannel(registration.Channel),
		Environment:           pb.PushEnvironment(registration.Environment),
		AppInstallEpochSha256: append([]byte(nil), registration.AppInstallEpochSHA256...),
		ProviderBindingSha256: append([]byte(nil), registration.ProviderBindingSHA256...),
		CreatedAt:             timestamppb.New(registration.CreatedAt),
		UpdatedAt:             timestamppb.New(registration.UpdatedAt),
	}
	if registration.LastSuccessAt != nil {
		result.LastSuccessAt = timestamppb.New(*registration.LastSuccessAt)
	}
	return result
}

func registerPushOutcomeToProto(
	outcome domain.RegisterPushDeviceOutcome,
) pb.RegisterPushDeviceOutcome {
	switch outcome {
	case domain.RegisterPushDeviceOutcomeCreated:
		return pb.RegisterPushDeviceOutcome_REGISTER_PUSH_DEVICE_OUTCOME_CREATED
	case domain.RegisterPushDeviceOutcomeRotated:
		return pb.RegisterPushDeviceOutcome_REGISTER_PUSH_DEVICE_OUTCOME_ROTATED
	case domain.RegisterPushDeviceOutcomeUnchanged:
		return pb.RegisterPushDeviceOutcome_REGISTER_PUSH_DEVICE_OUTCOME_UNCHANGED
	default:
		return pb.RegisterPushDeviceOutcome_REGISTER_PUSH_DEVICE_OUTCOME_UNSPECIFIED
	}
}

func unregisterPushOutcomeToProto(
	outcome domain.UnregisterPushDeviceOutcome,
) pb.UnregisterPushDeviceOutcome {
	switch outcome {
	case domain.UnregisterPushDeviceOutcomeRemoved:
		return pb.UnregisterPushDeviceOutcome_UNREGISTER_PUSH_DEVICE_OUTCOME_REMOVED
	case domain.UnregisterPushDeviceOutcomeAlreadyAbsent:
		return pb.UnregisterPushDeviceOutcome_UNREGISTER_PUSH_DEVICE_OUTCOME_ALREADY_ABSENT
	default:
		return pb.UnregisterPushDeviceOutcome_UNREGISTER_PUSH_DEVICE_OUTCOME_UNSPECIFIED
	}
}

// ============================================================================
// Mapping helpers
// ============================================================================

func notifToProto(n domain.Notification) *pb.Notification {
	p := &pb.Notification{
		Id:            n.ID,
		RecipientPtid: n.RecipientPTID,
		ActorPtid:     n.ActorPTID,
		Type:          pb.NotificationType(n.Type),
		Category:      pb.NotificationCategory(n.Category),
		Status:        pb.NotificationStatus(n.Status),
		TargetType:    n.TargetType,
		TargetId:      n.TargetID,
		Title:         n.Title,
		Body:          n.Body,
		GroupKey:      n.GroupKey,
		Metadata:      n.Metadata,
		CreatedAt:     timestamppb.New(n.CreatedAt),
	}
	if n.ReadAt != nil {
		p.ReadAt = timestamppb.New(*n.ReadAt)
	}
	return p
}
