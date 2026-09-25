package application

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

var (
	ErrPreferenceRevisionRequired  = errors.New("notification preference observed revision is required")
	ErrEmptyPreferenceMutation     = errors.New("notification preference mutation is empty")
	ErrInvalidPreferenceCategory   = errors.New("notification preference category is invalid")
	ErrDuplicatePreferenceCategory = errors.New("notification preference category is duplicated")
	ErrPushRequestInvalid          = errors.New("push registration request is invalid")
	ErrPushDeviceMismatch          = errors.New("push registration device does not match authenticated device")
	ErrPushCredentialUnavailable   = errors.New("push credential protection is unavailable")
)

type Repository interface {
	Create(n domain.Notification) (domain.Notification, error)
	List(recipientPTID string, category, status int32, cursor string, limit int) ([]domain.Notification, error)
	CountByRecipient(recipientPTID string, category, status int32) (int, error)
	MarkRead(recipientPTID string, notifIDs []string) (int, error)
	MarkAllRead(recipientPTID string, category int32) (int, error)
	Delete(recipientPTID string, notifIDs []string) (int, error)
	GetUnreadCounts(recipientPTID string) (domain.UnreadCounts, error)
	GetPreferencesSnapshot(actorPTID string) (domain.NotificationPreferencesSnapshot, error)
	GetPreference(actorPTID string, category int32) (*domain.NotificationPreference, error)
	UpdatePreferences(
		actorPTID string,
		observedRevision uint64,
		updates []domain.NotificationPreferencePatch,
	) (domain.NotificationPreferencesUpdateResult, error)
	RegisterPush(
		input domain.RegisterPushDeviceInput,
		protected domain.ProtectedPushBinding,
		requestSHA256 []byte,
	) (domain.RegisterPushDeviceResult, error)
	UnregisterPush(
		input domain.UnregisterPushDeviceInput,
		requestSHA256 []byte,
	) (domain.UnregisterPushDeviceResult, error)
	ListPushRegistrations(actorPTID string) ([]domain.PushRegistration, error)
}

type PushCredentialProtector interface {
	Protect(
		actorPTID string,
		deviceID string,
		channel domain.PushChannel,
		environment domain.PushEnvironment,
		appInstallEpochSHA256 []byte,
		plaintext []byte,
	) (domain.ProtectedPushBinding, error)
}

type Service struct {
	repo      Repository
	protector PushCredentialProtector
}

func NewService(repo Repository, protector PushCredentialProtector) *Service {
	return &Service{repo: repo, protector: protector}
}

// Produce creates a notification from a domain event.
// Self-notification guard: actor cannot notify themselves.
// Preference check: skip if the recipient has disabled notifications for this category.
func (s *Service) Produce(recipientPTID, actorPTID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) (*domain.Notification, error) {
	if recipientPTID == actorPTID {
		return nil, nil
	}

	pref, err := s.repo.GetPreference(recipientPTID, category)
	if err != nil {
		logger.Error(nil, "notification: failed to check preference", "recipient_ptid", recipientPTID, "error", err)
	}
	if pref != nil && !pref.Enabled {
		return nil, nil
	}

	n := domain.Notification{
		RecipientPTID: recipientPTID,
		ActorPTID:     actorPTID,
		Type:          notifType,
		Category:      category,
		Status:        domain.StatusUnread,
		TargetType:    targetType,
		TargetID:      targetID,
		Title:         title,
		Body:          body,
		GroupKey:      groupKey,
		Metadata:      metadata,
	}

	created, err := s.repo.Create(n)
	if err != nil {
		return nil, err
	}

	logger.Info(nil, "notification: produced",
		"id", created.ID,
		"recipient_ptid", recipientPTID,
		"type", notifType,
		"category", category,
	)

	return &created, nil
}

func (s *Service) List(recipientPTID string, category, status int32, cursor string, limit int) ([]domain.Notification, int, int, error) {
	items, err := s.repo.List(recipientPTID, category, status, cursor, limit)
	if err != nil {
		return nil, 0, 0, err
	}
	totalCount, err := s.repo.CountByRecipient(recipientPTID, category, 0)
	if err != nil {
		return nil, 0, 0, err
	}
	unreadCount, err := s.repo.CountByRecipient(recipientPTID, category, domain.StatusUnread)
	if err != nil {
		return nil, 0, 0, err
	}
	return items, totalCount, unreadCount, nil
}

func (s *Service) MarkRead(recipientPTID string, notifIDs []string) (int, error) {
	return s.repo.MarkRead(recipientPTID, notifIDs)
}

func (s *Service) MarkAllRead(recipientPTID string, category int32) (int, error) {
	return s.repo.MarkAllRead(recipientPTID, category)
}

func (s *Service) Delete(recipientPTID string, notifIDs []string) (int, error) {
	return s.repo.Delete(recipientPTID, notifIDs)
}

func (s *Service) GetUnreadCounts(recipientPTID string) (domain.UnreadCounts, error) {
	return s.repo.GetUnreadCounts(recipientPTID)
}

func (s *Service) GetPreferences(actorPTID string) (domain.NotificationPreferencesSnapshot, error) {
	return s.repo.GetPreferencesSnapshot(actorPTID)
}

func (s *Service) UpdatePreferences(
	actorPTID string,
	observedRevision uint64,
	updates []domain.NotificationPreferencePatch,
) (domain.NotificationPreferencesUpdateResult, error) {
	if observedRevision == 0 {
		return domain.NotificationPreferencesUpdateResult{}, ErrPreferenceRevisionRequired
	}
	if len(updates) == 0 {
		return domain.NotificationPreferencesUpdateResult{}, ErrEmptyPreferenceMutation
	}
	categories := make(map[int32]struct{}, len(updates))
	for _, update := range updates {
		if update.Category < domain.CategorySocial || update.Category > domain.CategoryTask {
			return domain.NotificationPreferencesUpdateResult{}, ErrInvalidPreferenceCategory
		}
		if _, exists := categories[update.Category]; exists {
			return domain.NotificationPreferencesUpdateResult{}, ErrDuplicatePreferenceCategory
		}
		categories[update.Category] = struct{}{}
	}
	return s.repo.UpdatePreferences(actorPTID, observedRevision, updates)
}

func (s *Service) RegisterPush(
	authenticatedDeviceID string,
	input domain.RegisterPushDeviceInput,
) (domain.RegisterPushDeviceResult, error) {
	if err := validatePushMutationIdentity(
		input.RequestID,
		input.ActorPTID,
		input.DeviceID,
		authenticatedDeviceID,
		input.LifecycleGeneration,
		input.AppInstallEpochSHA256,
	); err != nil {
		return domain.RegisterPushDeviceResult{}, err
	}
	bindingBytes, err := canonicalPushBinding(input.Binding)
	if err != nil {
		return domain.RegisterPushDeviceResult{}, err
	}
	defer clear(bindingBytes)
	if input.Environment != domain.PushEnvironmentDevelopment &&
		input.Environment != domain.PushEnvironmentProduction {
		return domain.RegisterPushDeviceResult{}, ErrPushRequestInvalid
	}
	if s.protector == nil {
		return domain.RegisterPushDeviceResult{}, ErrPushCredentialUnavailable
	}
	protected, err := s.protector.Protect(
		input.ActorPTID,
		input.DeviceID,
		input.Binding.Channel,
		input.Environment,
		input.AppInstallEpochSHA256,
		bindingBytes,
	)
	if err != nil {
		return domain.RegisterPushDeviceResult{}, fmt.Errorf(
			"%w: %v",
			ErrPushCredentialUnavailable,
			err,
		)
	}
	requestSHA256 := registerPushRequestSHA256(input, bindingBytes)
	return s.repo.RegisterPush(input, protected, requestSHA256[:])
}

func (s *Service) UnregisterPush(
	authenticatedDeviceID string,
	input domain.UnregisterPushDeviceInput,
) (domain.UnregisterPushDeviceResult, error) {
	if err := validatePushMutationIdentity(
		input.RequestID,
		input.ActorPTID,
		input.DeviceID,
		authenticatedDeviceID,
		input.LifecycleGeneration,
		input.AppInstallEpochSHA256,
	); err != nil {
		return domain.UnregisterPushDeviceResult{}, err
	}
	if !validBoundedValue(input.RegistrationID, 64) {
		return domain.UnregisterPushDeviceResult{}, ErrPushRequestInvalid
	}
	requestSHA256 := unregisterPushRequestSHA256(input)
	return s.repo.UnregisterPush(input, requestSHA256[:])
}

func (s *Service) ListPushRegistrations(actorPTID string) ([]domain.PushRegistration, error) {
	if !validBoundedValue(actorPTID, 255) {
		return nil, ErrPushRequestInvalid
	}
	return s.repo.ListPushRegistrations(actorPTID)
}

func validatePushMutationIdentity(
	requestID string,
	actorPTID string,
	deviceID string,
	authenticatedDeviceID string,
	lifecycleGeneration uint64,
	appInstallEpochSHA256 []byte,
) error {
	if !validBoundedValue(actorPTID, 255) ||
		!validBoundedValue(deviceID, 128) ||
		!validBoundedValue(authenticatedDeviceID, 128) ||
		deviceID != authenticatedDeviceID {
		return ErrPushDeviceMismatch
	}
	if !validBoundedValue(requestID, 64) {
		return ErrPushRequestInvalid
	}
	if _, err := ulid.ParseStrict(requestID); err != nil {
		return ErrPushRequestInvalid
	}
	if lifecycleGeneration == 0 || len(appInstallEpochSHA256) != sha256.Size {
		return ErrPushRequestInvalid
	}
	return nil
}

func canonicalPushBinding(binding domain.PushProviderBinding) ([]byte, error) {
	var fields [][]byte
	switch binding.Channel {
	case domain.PushChannelAPNS:
		if len(binding.APNSToken) != 32 ||
			!validBoundedValue(binding.APNSTopic, 255) ||
			binding.FCMToken != "" ||
			binding.UnifiedEndpoint != "" ||
			len(binding.UnifiedP256DH) != 0 ||
			len(binding.UnifiedAuth) != 0 {
			return nil, ErrPushRequestInvalid
		}
		fields = [][]byte{binding.APNSToken, []byte(binding.APNSTopic)}
	case domain.PushChannelFCM:
		if !validBoundedValue(binding.FCMToken, 4096) ||
			len(binding.APNSToken) != 0 ||
			binding.APNSTopic != "" ||
			binding.UnifiedEndpoint != "" ||
			len(binding.UnifiedP256DH) != 0 ||
			len(binding.UnifiedAuth) != 0 {
			return nil, ErrPushRequestInvalid
		}
		fields = [][]byte{[]byte(binding.FCMToken)}
	case domain.PushChannelUnifiedPush:
		endpoint, err := url.Parse(binding.UnifiedEndpoint)
		if err != nil ||
			endpoint.Scheme != "https" ||
			endpoint.Host == "" ||
			len(binding.UnifiedEndpoint) > 4096 ||
			len(binding.UnifiedP256DH) != 65 ||
			len(binding.UnifiedAuth) != 16 ||
			len(binding.APNSToken) != 0 ||
			binding.APNSTopic != "" ||
			binding.FCMToken != "" {
			return nil, ErrPushRequestInvalid
		}
		fields = [][]byte{
			[]byte(binding.UnifiedEndpoint),
			binding.UnifiedP256DH,
			binding.UnifiedAuth,
		}
	default:
		return nil, ErrPushRequestInvalid
	}

	result := make([]byte, 4)
	binary.BigEndian.PutUint32(result, uint32(binding.Channel))
	for _, field := range fields {
		if len(field) > 4096 {
			return nil, ErrPushRequestInvalid
		}
		result = appendLengthPrefixed(result, field)
	}
	return result, nil
}

func registerPushRequestSHA256(
	input domain.RegisterPushDeviceInput,
	binding []byte,
) [sha256.Size]byte {
	canonical := make([]byte, 0, 256+len(binding))
	canonical = appendLengthPrefixed(canonical, []byte("register-push/v1"))
	canonical = appendLengthPrefixed(canonical, []byte(input.RequestID))
	canonical = appendLengthPrefixed(canonical, []byte(input.ActorPTID))
	canonical = appendLengthPrefixed(canonical, []byte(input.DeviceID))
	canonical = appendUint64(canonical, input.LifecycleGeneration)
	canonical = appendLengthPrefixed(canonical, input.AppInstallEpochSHA256)
	canonical = appendUint64(canonical, uint64(input.Environment))
	canonical = appendLengthPrefixed(canonical, binding)
	return sha256.Sum256(canonical)
}

func unregisterPushRequestSHA256(
	input domain.UnregisterPushDeviceInput,
) [sha256.Size]byte {
	canonical := make([]byte, 0, 256)
	canonical = appendLengthPrefixed(canonical, []byte("unregister-push/v1"))
	canonical = appendLengthPrefixed(canonical, []byte(input.RequestID))
	canonical = appendLengthPrefixed(canonical, []byte(input.ActorPTID))
	canonical = appendLengthPrefixed(canonical, []byte(input.DeviceID))
	canonical = appendUint64(canonical, input.LifecycleGeneration)
	canonical = appendLengthPrefixed(canonical, []byte(input.RegistrationID))
	canonical = appendLengthPrefixed(canonical, input.AppInstallEpochSHA256)
	return sha256.Sum256(canonical)
}

func appendLengthPrefixed(target []byte, value []byte) []byte {
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(value)))
	target = append(target, size[:]...)
	return append(target, value...)
}

func appendUint64(target []byte, value uint64) []byte {
	var encoded [8]byte
	binary.BigEndian.PutUint64(encoded[:], value)
	return append(target, encoded[:]...)
}

func validBoundedValue(value string, limit int) bool {
	return value != "" &&
		len(value) <= limit &&
		strings.TrimSpace(value) == value
}
