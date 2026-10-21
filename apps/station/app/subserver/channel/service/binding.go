package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
)

// Observed connection states (projection of plugin reports).
const (
	BindingStateStopped      = "stopped"
	BindingStateConnecting   = "connecting"
	BindingStateConnected    = "connected"
	BindingStateReconnecting = "reconnecting"
	BindingStateUnauthorized = "unauthorized"
	BindingStateFailed       = "failed"
)

// Errors.
var (
	ErrBindingNotFound      = errors.New("channel binding not found")
	ErrInvalidBinding       = errors.New("invalid channel binding")
	ErrPermanentDelivery    = errors.New("permanent delivery failure")
	ErrDeliveryUnauthorized = errors.New("delivery unauthorized")
)

// BindingView is the non-sensitive binding projection.
type BindingView struct {
	ID                        string
	ActorPTID                 string
	PluginID                  string
	ProviderKind              string
	ProviderAppID             string
	Domain                    string
	Name                      string
	Description               string
	Region                    string
	AppMode                   string
	IsDefault                 bool
	Enabled                   bool
	AgentID                   string
	GroupResponseMode         string
	ThreadIsolation           bool
	OutputMode                string
	AccessMode                string
	OwnerProviderUserID       string
	PersonalOAuthConnectionID string
	PersonalOAuthStatus       string
	ConnectionState           string
	LastError                 string
	BotOpenID                 string
	TenantKey                 string
	RouteCount                int32
	AutomationCount           int32
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

// CreateBindingInput carries a new binding and its credential payload.
type CreateBindingInput struct {
	ActorPTID           string
	PluginID            string
	ProviderKind        string
	ProviderAppID       string
	Domain              string
	AgentID             string
	Enabled             bool
	Name                string
	Description         string
	Region              string
	AppMode             string
	AccessMode          string
	OwnerProviderUserID string
	// AppSecret is sealed into the vault and never persisted on the binding.
	AppSecret string
}

// BindingService owns binding records and the credential lifecycle.
type BindingService struct {
	db      *gorm.DB
	secrets *secret.Service
}

func NewBindingService(db *gorm.DB, secrets *secret.Service) *BindingService {
	return &BindingService{db: db, secrets: secrets}
}

// Create seals the credential and inserts the binding in one transaction.
func (s *BindingService) Create(ctx context.Context, in CreateBindingInput) (BindingView, error) {
	if err := validateBindingInput(in); err != nil {
		return BindingView{}, err
	}
	now := time.Now().UTC()
	bindingID := newBindingID()
	secretName := bindingSecretName(in.ProviderKind, in.ProviderAppID)

	// The vault is a separate service and must not be called inside the
	// binding transaction: seal first, then insert, and remove the sealed
	// secret when the row write fails so no orphan credential remains.
	if s.secrets == nil {
		return BindingView{}, fmt.Errorf("%w: credential vault unavailable", ErrInvalidBinding)
	}
	var conflict int64
	if err := s.db.WithContext(ctx).Model(&persistence.ChannelBinding{}).
		Where("actor_ptid = ? AND provider_kind = ? AND provider_app_id = ? AND domain = ?",
			in.ActorPTID, in.ProviderKind, in.ProviderAppID, strings.TrimSpace(in.Domain)).
		Count(&conflict).Error; err != nil {
		return BindingView{}, fmt.Errorf("check binding identity: %w", err)
	}
	if conflict > 0 {
		return BindingView{}, fmt.Errorf("%w: binding for this application already exists", ErrInvalidBinding)
	}
	secretID, err := s.secrets.Put(ctx, secret.PutInput{
		ActorPTID: in.ActorPTID,
		Purpose:   secret.PurposeChannel,
		Name:      secretName,
		Plaintext: encodeCredentialPayload(in.ProviderAppID, in.AppSecret),
	})
	if err != nil {
		return BindingView{}, fmt.Errorf("seal binding credential: %w", err)
	}
	record := persistence.ChannelBinding{
		ID:                  bindingID,
		ActorPTID:           in.ActorPTID,
		PluginID:            in.PluginID,
		ProviderKind:        in.ProviderKind,
		ProviderAppID:       in.ProviderAppID,
		Domain:              strings.TrimSpace(in.Domain),
		Name:                strings.TrimSpace(in.Name),
		Description:         strings.TrimSpace(in.Description),
		Region:              normalizedRegion(in.Region, in.Domain),
		AppMode:             normalizedAppMode(in.AppMode),
		Enabled:             in.Enabled,
		AgentID:             strings.TrimSpace(in.AgentID),
		GroupResponseMode:   "mention",
		ThreadIsolation:     true,
		OutputMode:          "concise",
		AccessMode:          normalizedAccessMode(in.AccessMode),
		OwnerProviderUserID: strings.TrimSpace(in.OwnerProviderUserID),
		CredentialSecretID:  secretID,
		ConnectionState:     BindingStateStopped,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if record.Name == "" {
		record.Name = defaultBindingName(record.ProviderKind)
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&persistence.ChannelBinding{}).
			Where("actor_ptid = ?", record.ActorPTID).
			Count(&existing).Error; err != nil {
			return err
		}
		record.IsDefault = existing == 0
		return tx.Create(&record).Error
	}); err != nil {
		if delErr := s.secrets.Delete(ctx, in.ActorPTID, secret.PurposeChannel, secretID); delErr != nil {
			return BindingView{}, fmt.Errorf("create binding: %w (cleanup: %v)", err, delErr)
		}
		return BindingView{}, fmt.Errorf("create binding: %w", err)
	}
	return s.Get(ctx, in.ActorPTID, bindingID)
}

// UpdateInput changes mutable binding fields. A non-nil AppSecret re-seals
// the credential and signals the RuntimeHost to restart the generation.
type UpdateInput struct {
	AgentID           *string
	Enabled           *bool
	AppSecret         *string
	Name              *string
	Description       *string
	GroupResponseMode *string
	ThreadIsolation   *bool
	OutputMode        *string
	AccessMode        *string
}

// Update applies binding mutations and returns whether the runtime identity
// changed (credentials rotated), which requires a stop/start generation.
func (s *BindingService) Update(ctx context.Context, actorPTID, id string, in UpdateInput) (BindingView, bool, error) {
	record, err := s.loadForActor(actorPTID, id)
	if err != nil {
		return BindingView{}, false, err
	}
	rotated := false
	now := time.Now().UTC()
	if in.AppSecret != nil && strings.TrimSpace(*in.AppSecret) != "" {
		if s.secrets == nil {
			return BindingView{}, false, fmt.Errorf("%w: credential vault unavailable", ErrInvalidBinding)
		}
		// Rotate the sealed credential before flipping the row; the host
		// reconciles the generation after observing the new binding.
		if _, err := s.secrets.Put(ctx, secret.PutInput{
			ActorPTID: record.ActorPTID,
			Purpose:   secret.PurposeChannel,
			Name:      bindingSecretName(record.ProviderKind, record.ProviderAppID),
			Plaintext: encodeCredentialPayload(record.ProviderAppID, *in.AppSecret),
		}); err != nil {
			return BindingView{}, false, fmt.Errorf("reseal binding credential: %w", err)
		}
		rotated = true
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{"updated_at": now}
		if in.AgentID != nil {
			updates["agent_id"] = strings.TrimSpace(*in.AgentID)
		}
		if in.Enabled != nil {
			updates["enabled"] = *in.Enabled
			if !*in.Enabled {
				updates["connection_state"] = BindingStateStopped
				updates["last_error"] = ""
			}
		}
		if in.Name != nil {
			name := strings.TrimSpace(*in.Name)
			if name == "" {
				return fmt.Errorf("%w: binding name is required", ErrInvalidBinding)
			}
			updates["name"] = name
		}
		if in.Description != nil {
			updates["description"] = strings.TrimSpace(*in.Description)
		}
		if in.GroupResponseMode != nil {
			mode := strings.TrimSpace(*in.GroupResponseMode)
			if mode != "mention" && mode != "all" && mode != "off" {
				return fmt.Errorf("%w: invalid group response mode", ErrInvalidBinding)
			}
			updates["group_response_mode"] = mode
		}
		if in.ThreadIsolation != nil {
			updates["thread_isolation"] = *in.ThreadIsolation
		}
		if in.OutputMode != nil {
			mode := strings.TrimSpace(*in.OutputMode)
			if mode != "concise" && mode != "detailed" {
				return fmt.Errorf("%w: invalid output mode", ErrInvalidBinding)
			}
			updates["output_mode"] = mode
		}
		if in.AccessMode != nil {
			mode := normalizedAccessMode(*in.AccessMode)
			if strings.TrimSpace(*in.AccessMode) != mode {
				return fmt.Errorf("%w: invalid access mode", ErrInvalidBinding)
			}
			updates["access_mode"] = mode
		}
		if err := tx.Model(&persistence.ChannelBinding{}).
			Where("id = ? AND actor_ptid = ?", id, actorPTID).
			Updates(updates).Error; err != nil {
			return fmt.Errorf("update binding: %w", err)
		}
		return nil
	})
	if err != nil {
		return BindingView{}, false, err
	}
	view, err := s.Get(ctx, actorPTID, id)
	return view, rotated, err
}

// Delete removes the binding and its sealed credential.
func (s *BindingService) Delete(ctx context.Context, actorPTID, id string) error {
	record, err := s.loadForActor(actorPTID, id)
	if err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		automationIDs := tx.Model(&persistence.ChannelAutomation{}).
			Select("id").
			Where("binding_id = ?", id)
		if err := tx.Where("automation_id IN (?)", automationIDs).
			Delete(&persistence.ChannelAutomationRun{}).Error; err != nil {
			return fmt.Errorf("delete binding automation runs: %w", err)
		}
		for _, owned := range []any{
			&persistence.ChannelDeliveryIntent{},
			&persistence.ChannelInboundEvent{},
			&persistence.ChannelConversationLink{},
			&persistence.ChannelRoute{},
			&persistence.ChannelAutomation{},
			&persistence.ChannelMemberAccess{},
			&persistence.ChannelChat{},
			&persistence.ChannelCardAction{},
			&persistence.ChannelDiagnosticEvent{},
			&persistence.ChannelRequesterAuthorization{},
			&persistence.ChannelProvisioningJob{},
		} {
			if err := tx.Where("binding_id = ?", id).Delete(owned).Error; err != nil {
				return fmt.Errorf("delete binding-owned records: %w", err)
			}
		}
		result := tx.Where("id = ? AND actor_ptid = ?", id, actorPTID).
			Delete(&persistence.ChannelBinding{})
		if result.Error != nil {
			return fmt.Errorf("delete binding: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return ErrBindingNotFound
		}
		if record.IsDefault {
			var replacement persistence.ChannelBinding
			err := tx.Where("actor_ptid = ? AND id <> ?", actorPTID, id).
				Order("enabled DESC, created_at ASC").
				First(&replacement).Error
			if err == nil {
				if err := tx.Model(&persistence.ChannelBinding{}).
					Where("id = ?", replacement.ID).
					Update("is_default", true).Error; err != nil {
					return fmt.Errorf("promote default binding: %w", err)
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("select default binding: %w", err)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	if s.secrets != nil {
		if err := s.secrets.Delete(ctx, record.ActorPTID, secret.PurposeChannel, record.CredentialSecretID); err != nil {
			return fmt.Errorf("delete binding credential: %w", err)
		}
	}
	return nil
}

// Get returns one actor-scoped binding.
func (s *BindingService) Get(_ context.Context, actorPTID, id string) (BindingView, error) {
	record, err := s.loadForActor(actorPTID, id)
	if err != nil {
		return BindingView{}, err
	}
	return toBindingView(*record), nil
}

// List returns every binding for one actor.
func (s *BindingService) List(_ context.Context, actorPTID string) ([]BindingView, error) {
	var records []persistence.ChannelBinding
	if err := s.db.Where("actor_ptid = ?", actorPTID).
		Order("created_at DESC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list bindings: %w", err)
	}
	views := make([]BindingView, 0, len(records))
	for _, r := range records {
		view := toBindingView(r)
		var routeCount int64
		var automationCount int64
		_ = s.db.Model(&persistence.ChannelRoute{}).
			Where("binding_id = ?", r.ID).Count(&routeCount).Error
		_ = s.db.Model(&persistence.ChannelAutomation{}).
			Where("binding_id = ?", r.ID).Count(&automationCount).Error
		view.RouteCount = int32(routeCount)
		view.AutomationCount = int32(automationCount)
		views = append(views, view)
	}
	return views, nil
}

// SetDefault atomically makes one actor-owned binding the only default.
func (s *BindingService) SetDefault(ctx context.Context, actorPTID, id string) (BindingView, error) {
	if _, err := s.loadForActor(actorPTID, id); err != nil {
		return BindingView{}, err
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ChannelBinding{}).
			Where("actor_ptid = ?", actorPTID).
			Update("is_default", false).Error; err != nil {
			return err
		}
		result := tx.Model(&persistence.ChannelBinding{}).
			Where("id = ? AND actor_ptid = ?", id, actorPTID).
			Update("is_default", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBindingNotFound
		}
		return nil
	}); err != nil {
		return BindingView{}, fmt.Errorf("set default binding: %w", err)
	}
	return s.Get(ctx, actorPTID, id)
}

// ListEnabledByPlugin returns enabled bindings reconciled by one plugin.
func (s *BindingService) ListEnabledByPlugin(_ context.Context, pluginID string) ([]persistence.ChannelBinding, error) {
	var records []persistence.ChannelBinding
	if err := s.db.Where("plugin_id = ? AND enabled = ?", pluginID, true).
		Order("created_at ASC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list enabled bindings: %w", err)
	}
	return records, nil
}

// GetRecord returns the persistence record for one binding. Host-internal
// callers resolve the actor from the record itself.
func (s *BindingService) GetRecord(ctx context.Context, id string) (*persistence.ChannelBinding, error) {
	return s.loadRecord(ctx, id)
}

// CredentialForBinding decrypts the sealed application credential referenced
// by one binding. The plaintext exists only for the lifetime of the request.
func (s *BindingService) CredentialForBinding(ctx context.Context, bindingID string) (CredentialPayload, error) {
	record, err := s.loadRecord(ctx, bindingID)
	if err != nil {
		return CredentialPayload{}, err
	}
	if s.secrets == nil {
		return CredentialPayload{}, fmt.Errorf("%w: credential vault unavailable", ErrInvalidBinding)
	}
	raw, err := s.secrets.Get(ctx, record.ActorPTID, secret.PurposeChannel, record.CredentialSecretID)
	if err != nil {
		return CredentialPayload{}, err
	}
	var payload CredentialPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return CredentialPayload{}, fmt.Errorf("decode binding credential: %w", err)
	}
	if strings.TrimSpace(payload.AppID) == "" || strings.TrimSpace(payload.AppSecret) == "" {
		return CredentialPayload{}, fmt.Errorf("%w: binding credential is incomplete", ErrInvalidBinding)
	}
	return payload, nil
}

// loadRecord returns one binding by id without actor scoping. Callers are
// host-internal components that resolve the actor from the binding itself.
func (s *BindingService) loadRecord(_ context.Context, id string) (*persistence.ChannelBinding, error) {
	record := &persistence.ChannelBinding{}
	err := s.db.Where("id = ?", id).Take(record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBindingNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load binding: %w", err)
	}
	return record, nil
}

// SetConnectionState records the observed connection projection for a binding.
func (s *BindingService) SetConnectionState(_ context.Context, bindingID, state, reason string) error {
	if !knownBindingState(state) {
		return fmt.Errorf("%w: unknown connection state %q", ErrInvalidBinding, state)
	}
	res := s.db.Model(&persistence.ChannelBinding{}).Where("id = ?", bindingID).
		Updates(map[string]any{
			"connection_state": state,
			"last_error":       strings.TrimSpace(reason),
			"updated_at":       time.Now().UTC(),
		})
	if res.Error != nil {
		return fmt.Errorf("update binding state: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return ErrBindingNotFound
	}
	return nil
}

// SetConnectionIdentity stores provider-observed bot and tenant identity.
func (s *BindingService) SetConnectionIdentity(ctx context.Context, bindingID, botOpenID, tenantKey string) error {
	result := s.db.WithContext(ctx).Model(&persistence.ChannelBinding{}).
		Where("id = ?", bindingID).
		Updates(map[string]any{
			"bot_open_id": strings.TrimSpace(botOpenID),
			"tenant_key":  strings.TrimSpace(tenantKey),
			"updated_at":  time.Now().UTC(),
		})
	if result.Error != nil {
		return fmt.Errorf("update connection identity: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return ErrBindingNotFound
	}
	return nil
}

// ResolveConversation returns the Station conversation linked to one
// provider scope, creating the link with newConversationID when absent.
func (s *BindingService) ResolveConversation(
	ctx context.Context,
	bindingID, scopeKey, chatID, chatType, rootID, threadID, newConversationID string,
) (string, error) {
	if strings.TrimSpace(bindingID) == "" || strings.TrimSpace(scopeKey) == "" ||
		strings.TrimSpace(chatID) == "" || strings.TrimSpace(newConversationID) == "" {
		return "", fmt.Errorf("%w: binding, scope, chat and conversation are required", ErrInvalidBinding)
	}
	var link persistence.ChannelConversationLink
	err := s.db.WithContext(ctx).
		Where("binding_id = ? AND scope_key = ?", bindingID, scopeKey).
		Take(&link).Error
	if err == nil {
		return link.ConversationID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load conversation link: %w", err)
	}
	link = persistence.ChannelConversationLink{
		ID:             newBindingID(),
		BindingID:      bindingID,
		ScopeKey:       scopeKey,
		ChatID:         chatID,
		ChatType:       chatType,
		RootID:         rootID,
		ThreadID:       threadID,
		ConversationID: newConversationID,
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	if err := s.db.WithContext(ctx).Create(&link).Error; err != nil {
		// Concurrent first-write wins.
		var existing persistence.ChannelConversationLink
		if getErr := s.db.WithContext(ctx).
			Where("binding_id = ? AND scope_key = ?", bindingID, scopeKey).
			Take(&existing).Error; getErr == nil {
			return existing.ConversationID, nil
		}
		return "", fmt.Errorf("create conversation link: %w", err)
	}
	return link.ConversationID, nil
}

func (s *BindingService) loadForActor(actorPTID, id string) (*persistence.ChannelBinding, error) {
	record := &persistence.ChannelBinding{}
	err := s.db.Where("id = ? AND actor_ptid = ?", id, actorPTID).Take(record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBindingNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load binding: %w", err)
	}
	return record, nil
}

func validateBindingInput(in CreateBindingInput) error {
	switch {
	case strings.TrimSpace(in.ActorPTID) == "":
		return fmt.Errorf("%w: empty actor", ErrInvalidBinding)
	case strings.TrimSpace(in.PluginID) == "":
		return fmt.Errorf("%w: empty plugin", ErrInvalidBinding)
	case strings.TrimSpace(in.ProviderKind) == "":
		return fmt.Errorf("%w: empty provider kind", ErrInvalidBinding)
	case strings.TrimSpace(in.ProviderAppID) == "":
		return fmt.Errorf("%w: empty provider app id", ErrInvalidBinding)
	case strings.TrimSpace(in.AppSecret) == "":
		return fmt.Errorf("%w: empty app secret", ErrInvalidBinding)
	}
	return nil
}

func knownBindingState(state string) bool {
	switch state {
	case BindingStateStopped, BindingStateConnecting, BindingStateConnected,
		BindingStateReconnecting, BindingStateUnauthorized, BindingStateFailed:
		return true
	}
	return false
}

func toBindingView(r persistence.ChannelBinding) BindingView {
	return BindingView{
		ID:                        r.ID,
		ActorPTID:                 r.ActorPTID,
		PluginID:                  r.PluginID,
		ProviderKind:              r.ProviderKind,
		ProviderAppID:             r.ProviderAppID,
		Domain:                    r.Domain,
		Name:                      r.Name,
		Description:               r.Description,
		Region:                    r.Region,
		AppMode:                   r.AppMode,
		IsDefault:                 r.IsDefault,
		Enabled:                   r.Enabled,
		AgentID:                   r.AgentID,
		GroupResponseMode:         r.GroupResponseMode,
		ThreadIsolation:           r.ThreadIsolation,
		OutputMode:                r.OutputMode,
		AccessMode:                r.AccessMode,
		OwnerProviderUserID:       r.OwnerProviderUserID,
		PersonalOAuthConnectionID: r.PersonalOAuthConnectionID,
		PersonalOAuthStatus:       r.PersonalOAuthStatus,
		ConnectionState:           r.ConnectionState,
		LastError:                 r.LastError,
		BotOpenID:                 r.BotOpenID,
		TenantKey:                 r.TenantKey,
		CreatedAt:                 r.CreatedAt,
		UpdatedAt:                 r.UpdatedAt,
	}
}

// CredentialPayload is the sealed fp-00 secret content for one Lark binding.
type CredentialPayload struct {
	AppID     string `json:"app_id"`
	AppSecret string `json:"app_secret"`
}

func encodeCredentialPayload(appID, appSecret string) []byte {
	return []byte(fmt.Sprintf(`{"app_id":%q,"app_secret":%q}`, appID, appSecret))
}

func bindingSecretName(providerKind, appID string) string {
	return strings.TrimSpace(providerKind) + ":" + strings.TrimSpace(appID)
}

func newBindingID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func normalizedRegion(region, domain string) string {
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "lark" || strings.Contains(strings.ToLower(domain), "larksuite") {
		return "lark"
	}
	return "feishu"
}

func normalizedAppMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "managed") {
		return "managed"
	}
	return "custom"
}

func normalizedAccessMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case AccessModeOwner:
		return AccessModeOwner
	case AccessModeAllowlist:
		return AccessModeAllowlist
	case AccessModeOpen:
		return AccessModeOpen
	default:
		return AccessModeApproval
	}
}

func defaultBindingName(providerKind string) string {
	if strings.EqualFold(strings.TrimSpace(providerKind), "lark") {
		return "Lark connection"
	}
	return "Channel connection"
}
