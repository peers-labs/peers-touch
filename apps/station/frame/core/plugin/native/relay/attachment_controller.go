package relay

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrAttachmentNotFound    = errors.New("Relay attachment not found")
	ErrAttachmentExists      = errors.New("Relay attachment already exists")
	ErrInvalidInvitation     = errors.New("Relay invitation is invalid")
	ErrInvitationForStation  = errors.New("Relay invitation targets another Station")
	ErrAttachmentUnavailable = errors.New("Relay attachment runtime is unavailable")
)

const (
	// AttachmentStateAttaching indicates desired intent without a live route.
	AttachmentStateAttaching      = "attaching"
	AttachmentStateActive         = "active"
	AttachmentStateRecovering     = "recovering"
	AttachmentStateCleanupPending = "cleanup_pending"
	AttachmentStateDetached       = "detached"

	attachmentSourceInvitation = "invitation"
	attachmentSourceBootstrap  = "bootstrap"
)

// InvitationPackage carries the one-time enrollment material issued by a Relay.
type InvitationPackage struct {
	SchemaVersion         int      `json:"schema_version"`
	RelayPeerID           string   `json:"relay_peer_id"`
	ControlOrigin         string   `json:"control_origin"`
	DialAddresses         []string `json:"dial_addresses"`
	InviteToken           string   `json:"invite_token"`
	IntendedStationPeerID string   `json:"intended_station_peer_id,omitempty"`
	Label                 string   `json:"label,omitempty"`
	MaxClients            int32    `json:"max_clients,omitempty"`
	BandwidthLimit        int64    `json:"bandwidth_limit,omitempty"`
}

// RelayAttachment projects durable attachment intent and current route state.
type RelayAttachment struct {
	RelayPeerID      string    `json:"relay_peer_id"`
	ControlOrigin    string    `json:"control_origin"`
	DialAddresses    []string  `json:"dial_addresses"`
	Label            string    `json:"label,omitempty"`
	State            string    `json:"state"`
	Enabled          bool      `json:"enabled"`
	CleanupPending   bool      `json:"cleanup_pending"`
	LastError        string    `json:"last_error,omitempty"`
	RouteGeneration  uint64    `json:"route_generation,omitempty"`
	RouteExpiresAt   time.Time `json:"route_expires_at,omitempty"`
	CredentialExpiry time.Time `json:"credential_expires_at,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// AttachmentService owns Station Relay attachment lifecycle operations.
type AttachmentService interface {
	ListAttachments(context.Context) ([]RelayAttachment, error)
	ImportAttachment(
		context.Context,
		InvitationPackage,
	) (*RelayAttachment, error)
	DeleteAttachment(context.Context, string) (*RelayAttachment, error)
	RetryAttachment(context.Context, string) (*RelayAttachment, error)
}

type attachmentServiceHolder struct {
	service AttachmentService
}

var activeAttachmentService atomic.Value

// RegisterAttachmentService publishes the active Station attachment service.
func RegisterAttachmentService(service AttachmentService) {
	activeAttachmentService.Store(attachmentServiceHolder{service: service})
}

// AttachmentServiceSnapshot returns the currently registered attachment service.
func AttachmentServiceSnapshot() AttachmentService {
	value := activeAttachmentService.Load()
	if value == nil {
		return nil
	}
	holder, ok := value.(attachmentServiceHolder)
	if !ok {
		return nil
	}
	return holder.service
}

type relayAttachmentPO struct {
	StationPeerID       string   `gorm:"primaryKey;size:255"`
	NodePeerID          string   `gorm:"primaryKey;size:255"`
	RelayPeerID         string   `gorm:"primaryKey;size:255"`
	ControlOrigin       string   `gorm:"size:2048;not null"`
	DialAddresses       []string `gorm:"serializer:json;not null"`
	Label               string   `gorm:"size:255"`
	CredentialFile      string   `gorm:"size:4096;not null"`
	TLSCAFile           string   `gorm:"size:4096"`
	Source              string   `gorm:"size:32;not null"`
	Enabled             bool     `gorm:"not null"`
	CleanupPending      bool     `gorm:"not null"`
	RetirementConfirmed bool     `gorm:"not null;default:false"`
	LastError           string   `gorm:"size:4096"`
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (*relayAttachmentPO) TableName() string {
	return "station_relay_attachment"
}

// AttachmentController reconciles durable attachment intent with Relay runtime state.
type AttachmentController struct {
	db             *gorm.DB
	runtime        *Runtime
	stationPeerID  string
	nodePeerID     string
	credentialRoot string
	lock           sync.Mutex
}

// NewAttachmentController binds durable attachment state to one Station and Node.
func NewAttachmentController(
	db *gorm.DB,
	runtime *Runtime,
	stationPeerID string,
	credentialRoot string,
) (*AttachmentController, error) {
	if db == nil || runtime == nil || runtime.manager == nil ||
		runtime.control == nil || runtime.host == nil || strings.TrimSpace(stationPeerID) == "" ||
		strings.TrimSpace(credentialRoot) == "" {
		return nil, ErrAttachmentUnavailable
	}
	if _, err := peer.Decode(strings.TrimSpace(stationPeerID)); err != nil {
		return nil, fmt.Errorf("%w: invalid Station PeerID", ErrAttachmentUnavailable)
	}
	return &AttachmentController{
		db:            db,
		runtime:       runtime,
		stationPeerID: strings.TrimSpace(stationPeerID),
		nodePeerID:    runtime.host.ID().String(),
		credentialRoot: filepath.Join(filepath.Clean(credentialRoot),
			strings.TrimSpace(stationPeerID), runtime.host.ID().String()),
	}, nil
}

// Initialize migrates, scopes, and restores the controller's durable intent.
func (c *AttachmentController) Initialize(ctx context.Context) error {
	c.lock.Lock()
	defer c.lock.Unlock()
	if err := os.MkdirAll(c.credentialRoot, 0o700); err != nil {
		return fmt.Errorf("create Relay credential directory: %w", err)
	}
	if err := migrateAttachmentScope(c.db.WithContext(ctx)); err != nil {
		return fmt.Errorf("migrate Station Relay attachments: %w", err)
	}
	for _, target := range c.runtime.targets() {
		if err := c.importBootstrapTarget(ctx, target); err != nil {
			return err
		}
	}
	var storedAttachments []relayAttachmentPO
	if err := c.ownedDB(ctx).
		Order("created_at ASC").
		Find(&storedAttachments).Error; err != nil {
		return fmt.Errorf("load Station Relay attachments: %w", err)
	}
	liveTargets := make(map[peer.ID]struct{})
	for _, target := range c.runtime.targets() {
		liveTargets[target.RelayPeerID] = struct{}{}
	}
	for _, stored := range storedAttachments {
		target, err := targetFromAttachmentPO(stored)
		if err != nil {
			return err
		}
		if stored.Enabled || stored.CleanupPending {
			target, err = c.scopeStoredTarget(ctx, &stored, target)
			if err != nil {
				return err
			}
		}
		_, exists := liveTargets[target.RelayPeerID]
		if !stored.Enabled {
			if exists {
				if err := c.runtime.manager.RemoveTarget(
					target.RelayPeerID,
				); err != nil {
					return err
				}
				delete(liveTargets, target.RelayPeerID)
			}
			if c.controlHasTarget(target.RelayPeerID) {
				if err := c.runtime.control.RemoveTarget(
					target.RelayPeerID,
				); err != nil {
					return err
				}
			}
			continue
		}
		if exists {
			// Boot configuration is an import hint. The durable intent owns all
			// target metadata after the first import, including credentials.
			if stored.Source == attachmentSourceBootstrap {
				for _, bootstrap := range c.runtime.targets() {
					if bootstrap.RelayPeerID == target.RelayPeerID {
						target.InviteToken = bootstrap.InviteToken
					}
				}
			}
			if err := c.runtime.disableTarget(target.RelayPeerID); err != nil {
				return err
			}
		}
		if err := c.runtime.restoreTarget(target); err != nil {
			_ = c.setLastError(ctx, stored.RelayPeerID, err)
			return fmt.Errorf(
				"restore Relay attachment %s: %w",
				stored.RelayPeerID,
				err,
			)
		}
		liveTargets[target.RelayPeerID] = struct{}{}
	}
	return nil
}

// ImportAttachment enrolls and activates one invitation-backed Relay target.
func (c *AttachmentController) ImportAttachment(
	ctx context.Context,
	invitation InvitationPackage,
) (*RelayAttachment, error) {
	c.lock.Lock()
	defer c.lock.Unlock()
	target, err := c.targetFromInvitation(invitation)
	if err != nil {
		return nil, err
	}
	var existing relayAttachmentPO
	findErr := c.ownedDB(ctx).
		Where("relay_peer_id = ?", target.RelayPeerID.String()).
		First(&existing).Error
	if findErr == nil && (existing.Enabled || existing.CleanupPending) {
		return nil, ErrAttachmentExists
	}
	if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return nil, findErr
	}

	prepared, credential, err := c.runtime.prepareTarget(ctx, target)
	if err != nil {
		return nil, fmt.Errorf("enroll Relay attachment: %w", err)
	}
	stored := relayAttachmentPO{
		StationPeerID:  c.stationPeerID,
		NodePeerID:     c.nodePeerID,
		RelayPeerID:    prepared.RelayPeerID.String(),
		ControlOrigin:  prepared.ControlOrigin,
		DialAddresses:  append([]string(nil), prepared.Addresses...),
		Label:          prepared.Label,
		CredentialFile: prepared.CredentialFile,
		Source:         attachmentSourceInvitation,
		Enabled:        true,
		CleanupPending: false,
	}
	if err := c.upsertDesired(ctx, &stored); err != nil {
		_ = c.runtime.retireTarget(ctx, prepared)
		_ = c.runtime.forgetTarget(prepared.RelayPeerID)
		_ = os.Remove(prepared.CredentialFile)
		return nil, err
	}
	if err := c.ownedDB(ctx).
		Where("relay_peer_id = ?", stored.RelayPeerID).
		First(&stored).Error; err != nil {
		return nil, err
	}
	if err := c.runtime.activatePreparedTarget(prepared); err != nil {
		_ = c.setLastError(ctx, stored.RelayPeerID, err)
		return nil, fmt.Errorf("activate Relay attachment: %w", err)
	}
	attachment := attachmentFromPO(stored)
	attachment.CredentialExpiry = credential.ExpiresAt
	return c.projectAttachment(attachment), nil
}

// ListAttachments returns visible attachment projections for this Station Node.
func (c *AttachmentController) ListAttachments(
	ctx context.Context,
) ([]RelayAttachment, error) {
	var stored []relayAttachmentPO
	if err := c.ownedDB(ctx).
		Where("(enabled = ? OR cleanup_pending = ?)", true, true).
		Order("created_at ASC").
		Find(&stored).Error; err != nil {
		return nil, err
	}
	snapshots := c.snapshotMap()
	attachments := make([]RelayAttachment, 0, len(stored))
	for _, row := range stored {
		attachment := attachmentFromPO(row)
		attachments = append(
			attachments,
			projectAttachmentWithSnapshot(attachment, snapshots[row.RelayPeerID]),
		)
	}
	sort.Slice(attachments, func(left, right int) bool {
		return attachments[left].RelayPeerID < attachments[right].RelayPeerID
	})
	return attachments, nil
}

// DeleteAttachment disables local use and retires the remote enrollment.
func (c *AttachmentController) DeleteAttachment(
	ctx context.Context,
	relayPeerID string,
) (*RelayAttachment, error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	stored, target, err := c.loadScopedTarget(ctx, relayPeerID)
	if err != nil {
		return nil, err
	}
	if !stored.Enabled && !stored.CleanupPending {
		return c.projectAttachment(attachmentFromPO(stored)), nil
	}
	if err := c.ownedDB(ctx).
		Model(&relayAttachmentPO{}).
		Where("relay_peer_id = ?", stored.RelayPeerID).
		Updates(map[string]interface{}{
			"enabled":         false,
			"cleanup_pending": true,
			"last_error":      "",
		}).Error; err != nil {
		return nil, err
	}
	stored.Enabled = false
	stored.CleanupPending = true
	stored.LastError = ""

	if c.runtimeHasTarget(target.RelayPeerID) {
		if err := c.runtime.disableTarget(target.RelayPeerID); err != nil {
			_ = c.setLastError(ctx, stored.RelayPeerID, err)
			stored.LastError = err.Error()
			return c.projectAttachment(attachmentFromPO(stored)), err
		}
	}
	if err := c.retireAndForget(ctx, stored, target); err != nil {
		_ = c.setLastError(ctx, stored.RelayPeerID, err)
		stored.LastError = err.Error()
		return c.projectAttachment(attachmentFromPO(stored)), nil
	}
	if err := c.completeCleanup(ctx, stored.RelayPeerID); err != nil {
		return nil, err
	}
	stored.CleanupPending = false
	return c.projectAttachment(attachmentFromPO(stored)), nil
}

// RetryAttachment retries pending cleanup or active route reconciliation.
func (c *AttachmentController) RetryAttachment(
	ctx context.Context,
	relayPeerID string,
) (*RelayAttachment, error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	stored, target, err := c.loadScopedTarget(ctx, relayPeerID)
	if err != nil {
		return nil, err
	}
	if stored.CleanupPending {
		if err := c.retireAndForget(ctx, stored, target); err != nil {
			_ = c.setLastError(ctx, stored.RelayPeerID, err)
			stored.LastError = err.Error()
			return c.projectAttachment(attachmentFromPO(stored)), nil
		}
		if err := c.completeCleanup(ctx, stored.RelayPeerID); err != nil {
			return nil, err
		}
		stored.CleanupPending = false
		stored.LastError = ""
		return c.projectAttachment(attachmentFromPO(stored)), nil
	}
	if !stored.Enabled {
		return nil, ErrAttachmentNotFound
	}
	if !c.runtimeHasTarget(target.RelayPeerID) {
		if err := c.runtime.restoreTarget(target); err != nil {
			_ = c.setLastError(ctx, stored.RelayPeerID, err)
			return nil, err
		}
	} else if err := c.runtime.retryTarget(target.RelayPeerID); err != nil {
		_ = c.setLastError(ctx, stored.RelayPeerID, err)
		return nil, err
	}
	if err := c.setLastError(ctx, stored.RelayPeerID, nil); err != nil {
		return nil, err
	}
	stored.LastError = ""
	return c.projectAttachment(attachmentFromPO(stored)), nil
}

func (c *AttachmentController) targetFromInvitation(
	invitation InvitationPackage,
) (Target, error) {
	if invitation.SchemaVersion != 1 ||
		invitation.RelayPeerID != strings.TrimSpace(invitation.RelayPeerID) ||
		invitation.InviteToken == "" ||
		invitation.InviteToken != strings.TrimSpace(invitation.InviteToken) ||
		len(invitation.DialAddresses) == 0 ||
		len(invitation.Label) > 255 {
		return Target{}, ErrInvalidInvitation
	}
	if invitation.IntendedStationPeerID != "" &&
		invitation.IntendedStationPeerID != c.stationPeerID {
		return Target{}, ErrInvitationForStation
	}
	relayPeerID, err := peer.Decode(invitation.RelayPeerID)
	if err != nil {
		return Target{}, ErrInvalidInvitation
	}
	controlOrigin := strings.TrimRight(
		strings.TrimSpace(invitation.ControlOrigin),
		"/",
	)
	parsedOrigin, err := url.Parse(controlOrigin)
	if err != nil || parsedOrigin.Hostname() == "" ||
		parsedOrigin.User != nil || parsedOrigin.RawQuery != "" ||
		parsedOrigin.Fragment != "" ||
		(parsedOrigin.Path != "" && parsedOrigin.Path != "/") ||
		(parsedOrigin.Scheme != "https" &&
			(parsedOrigin.Scheme != "http" ||
				!isLoopbackRelayHost(parsedOrigin.Hostname()))) {
		return Target{}, ErrInvalidInvitation
	}
	target := Target{
		RelayPeerID:   relayPeerID,
		Addresses:     append([]string(nil), invitation.DialAddresses...),
		ControlOrigin: controlOrigin,
		InviteToken:   invitation.InviteToken,
		CredentialFile: filepath.Join(
			c.credentialRoot,
			relayPeerID.String()+".json",
		),
		Label: strings.TrimSpace(invitation.Label),
	}
	if _, err := targetAddrInfo(target); err != nil {
		return Target{}, fmt.Errorf("%w: %v", ErrInvalidInvitation, err)
	}
	return target, nil
}

func (c *AttachmentController) importBootstrapTarget(
	ctx context.Context,
	target Target,
) error {
	var count int64
	if err := c.ownedDB(ctx).
		Model(&relayAttachmentPO{}).
		Where("relay_peer_id = ?", target.RelayPeerID.String()).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return nil
	}
	if err := c.db.WithContext(ctx).Model(&relayAttachmentPO{}).
		Where("station_peer_id = ? AND node_peer_id = ? AND relay_peer_id = ?",
			"", "", target.RelayPeerID.String()).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		// An unresolved legacy row cannot become fresh boot intent just because
		// its credential is missing. Only an explicit new invitation can attach.
		return c.runtime.disableTarget(target.RelayPeerID)
	}
	target, err := c.scopeCredentialTarget(target)
	if err != nil {
		return err
	}
	stored := relayAttachmentPO{
		StationPeerID:  c.stationPeerID,
		NodePeerID:     c.nodePeerID,
		RelayPeerID:    target.RelayPeerID.String(),
		ControlOrigin:  target.ControlOrigin,
		DialAddresses:  append([]string(nil), target.Addresses...),
		Label:          target.Label,
		CredentialFile: target.CredentialFile,
		TLSCAFile:      target.TLSCAFile,
		Source:         attachmentSourceBootstrap,
		Enabled:        true,
	}
	return c.db.WithContext(ctx).Create(&stored).Error
}

func (c *AttachmentController) upsertDesired(
	ctx context.Context,
	stored *relayAttachmentPO,
) error {
	return c.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "station_peer_id"},
			{Name: "node_peer_id"},
			{Name: "relay_peer_id"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"control_origin",
			"dial_addresses",
			"label",
			"credential_file",
			"tls_ca_file",
			"source",
			"enabled",
			"cleanup_pending",
			"retirement_confirmed",
			"last_error",
			"updated_at",
		}),
	}).Create(stored).Error
}

func (c *AttachmentController) loadScopedTarget(
	ctx context.Context,
	relayPeerID string,
) (relayAttachmentPO, Target, error) {
	decoded, err := peer.Decode(strings.TrimSpace(relayPeerID))
	if err != nil {
		return relayAttachmentPO{}, Target{}, ErrAttachmentNotFound
	}
	var stored relayAttachmentPO
	if err := c.ownedDB(ctx).
		Where("relay_peer_id = ?", decoded.String()).
		First(&stored).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return relayAttachmentPO{}, Target{}, ErrAttachmentNotFound
		}
		return relayAttachmentPO{}, Target{}, fmt.Errorf(
			"load Relay attachment %s: %w",
			decoded,
			err,
		)
	}

	target, err := targetFromAttachmentPO(stored)
	if err == nil && (stored.Enabled || stored.CleanupPending) {
		target, err = c.scopeStoredTarget(ctx, &stored, target)
	}

	return stored, target, err
}

func (c *AttachmentController) scopeStoredTarget(
	ctx context.Context,
	stored *relayAttachmentPO,
	target Target,
) (Target, error) {
	scoped, err := c.scopeCredentialTarget(target)
	if err != nil {
		return Target{}, fmt.Errorf(
			"scope Relay %s credential: %w",
			stored.RelayPeerID,
			err,
		)
	}

	if scoped.CredentialFile != stored.CredentialFile {
		if err := c.ownedDB(ctx).Model(&relayAttachmentPO{}).
			Where("relay_peer_id = ?", stored.RelayPeerID).
			Update("credential_file", scoped.CredentialFile).Error; err != nil {
			return Target{}, fmt.Errorf(
				"persist scoped credential path for Relay %s: %w",
				stored.RelayPeerID,
				err,
			)
		}
		stored.CredentialFile = scoped.CredentialFile
	}

	return scoped, nil
}

func targetFromAttachmentPO(stored relayAttachmentPO) (Target, error) {
	relayPeerID, err := peer.Decode(stored.RelayPeerID)
	if err != nil {
		return Target{}, fmt.Errorf(
			"stored Relay attachment %q has invalid PeerID: %w",
			stored.RelayPeerID,
			err,
		)
	}
	target := Target{
		RelayPeerID:    relayPeerID,
		Addresses:      append([]string(nil), stored.DialAddresses...),
		ControlOrigin:  stored.ControlOrigin,
		CredentialFile: stored.CredentialFile,
		TLSCAFile:      stored.TLSCAFile,
		Label:          stored.Label,
	}
	if _, err := targetAddrInfo(target); err != nil {
		return Target{}, fmt.Errorf(
			"stored Relay attachment %s is invalid: %w",
			stored.RelayPeerID,
			err,
		)
	}
	return target, nil
}

func (c *AttachmentController) retireAndForget(
	ctx context.Context,
	stored relayAttachmentPO,
	target Target,
) error {
	if !stored.RetirementConfirmed {
		if err := c.runtime.retireTarget(ctx, target); err != nil {
			return fmt.Errorf(
				"retire Relay %s enrollment: %w",
				stored.RelayPeerID,
				err,
			)
		}

		// Retain the credential until remote acknowledgement is durable.
		if err := c.ownedDB(ctx).Model(&relayAttachmentPO{}).
			Where("relay_peer_id = ?", stored.RelayPeerID).
			Update("retirement_confirmed", true).Error; err != nil {
			return fmt.Errorf(
				"persist Relay %s retirement confirmation: %w",
				stored.RelayPeerID,
				err,
			)
		}
	}

	if err := os.Remove(target.CredentialFile); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf(
			"remove managed credential for Relay %s: %w",
			stored.RelayPeerID,
			err,
		)
	}

	return nil
}

func (c *AttachmentController) completeCleanup(
	ctx context.Context,
	relayPeerID string,
) error {
	return c.ownedDB(ctx).
		Model(&relayAttachmentPO{}).
		Where("relay_peer_id = ?", relayPeerID).
		Updates(map[string]interface{}{
			"cleanup_pending": false,
			"last_error":      "",
		}).Error
}

func (c *AttachmentController) setLastError(
	ctx context.Context,
	relayPeerID string,
	err error,
) error {
	message := ""
	if err != nil {
		message = err.Error()
	}
	return c.ownedDB(ctx).
		Model(&relayAttachmentPO{}).
		Where("relay_peer_id = ?", relayPeerID).
		Update("last_error", message).Error
}

func attachmentFromPO(stored relayAttachmentPO) RelayAttachment {
	return RelayAttachment{
		RelayPeerID:    stored.RelayPeerID,
		ControlOrigin:  stored.ControlOrigin,
		DialAddresses:  append([]string(nil), stored.DialAddresses...),
		Label:          stored.Label,
		Enabled:        stored.Enabled,
		CleanupPending: stored.CleanupPending,
		LastError:      stored.LastError,
		CreatedAt:      stored.CreatedAt,
		UpdatedAt:      stored.UpdatedAt,
	}
}

func (c *AttachmentController) ownedDB(ctx context.Context) *gorm.DB {
	return c.db.WithContext(ctx).Where(
		"station_peer_id = ? AND node_peer_id = ?",
		c.stationPeerID,
		c.nodePeerID,
	)
}

func (c *AttachmentController) scopeCredentialTarget(target Target) (Target, error) {
	destination := filepath.Join(c.credentialRoot, target.RelayPeerID.String()+".json")
	if target.CredentialFile == destination {
		return target, nil
	}
	credential, err := loadRelayCredential(target.CredentialFile)
	if err == nil {
		station, node, err := attachmentCredentialOwner(relayAttachmentPO{
			RelayPeerID:    target.RelayPeerID.String(),
			CredentialFile: target.CredentialFile,
		})
		if err != nil || station != c.stationPeerID || node != c.nodePeerID {
			return Target{}, fmt.Errorf("bootstrap Relay credential belongs to an unverified Station/Node")
		}
		if err := persistRelayCredential(destination, credential); err != nil {
			return Target{}, fmt.Errorf(
				"copy managed credential for Relay %s: %w",
				target.RelayPeerID,
				err,
			)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Target{}, fmt.Errorf(
			"load source credential for Relay %s: %w",
			target.RelayPeerID,
			err,
		)
	}

	target.CredentialFile = destination

	return target, nil
}

func (c *AttachmentController) projectAttachment(
	attachment RelayAttachment,
) *RelayAttachment {
	snapshots := c.snapshotMap()
	projected := projectAttachmentWithSnapshot(
		attachment,
		snapshots[attachment.RelayPeerID],
	)
	return &projected
}

func (c *AttachmentController) snapshotMap() map[string]ReservationSnapshot {
	snapshots := c.runtime.reservationSnapshots()
	result := make(map[string]ReservationSnapshot, len(snapshots))
	for _, snapshot := range snapshots {
		result[snapshot.Target.RelayPeerID.String()] = snapshot
	}
	return result
}

func projectAttachmentWithSnapshot(
	attachment RelayAttachment,
	snapshot ReservationSnapshot,
) RelayAttachment {
	switch {
	case attachment.CleanupPending:
		attachment.State = AttachmentStateCleanupPending
	case !attachment.Enabled:
		attachment.State = AttachmentStateDetached
	case snapshot.Route != nil &&
		snapshot.Route.ExpiresAt.After(time.Now().UTC()):
		attachment.State = AttachmentStateActive
		attachment.RouteGeneration = snapshot.Route.RouteGeneration
		attachment.RouteExpiresAt = snapshot.Route.ExpiresAt
	case snapshot.LastError != nil:
		attachment.State = AttachmentStateRecovering
		if attachment.LastError == "" {
			attachment.LastError = snapshot.LastError.Error()
		}
	default:
		attachment.State = AttachmentStateAttaching
	}
	return attachment
}

func (c *AttachmentController) runtimeHasTarget(relayPeerID peer.ID) bool {
	for _, target := range c.runtime.targets() {
		if target.RelayPeerID == relayPeerID {
			return true
		}
	}
	return false
}

func (c *AttachmentController) controlHasTarget(relayPeerID peer.ID) bool {
	c.runtime.control.lock.Lock()
	defer c.runtime.control.lock.Unlock()
	_, exists := c.runtime.control.targets[relayPeerID]
	return exists
}
