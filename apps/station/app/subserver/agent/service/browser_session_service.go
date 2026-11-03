package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	browserStatusActive  = "active"
	browserStatusClosed  = "closed"
	browserStatusUnknown = "unknown"
	browserLeaseAgent    = "agent"
	browserLeaseHuman    = "human"
)

// BrowserSessionService persists device browser session metadata. The
// browser process and all page state stay on the Desktop worker; Station
// never stores page content, cookies or credentials.
type BrowserSessionService struct {
	db  *gorm.DB
	now func() time.Time
}

func NewBrowserSessionService() *BrowserSessionService {
	return &BrowserSessionService{now: func() time.Time { return time.Now().UTC() }}
}

func (s *BrowserSessionService) SetDB(db *gorm.DB) { s.db = db }

func (s *BrowserSessionService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "open Agent database", nil)
	}
	return db, nil
}

var browserSessionIDPattern = regexp.MustCompile(`^brows-[0-9A-Z]{26}$`)

func (s *BrowserSessionService) validateSessionID(sessionID string) error {
	if !browserSessionIDPattern.MatchString(sessionID) {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "valid session_id is required", nil)
	}
	return nil
}

// Create records a browser session the local worker spawned. The request
// carries the worker-generated session id, which becomes the row primary
// key. The call is idempotent per (actor, session id) so a retried request
// after a transport timeout neither duplicates the row nor implies the
// browser should be killed.
func (s *BrowserSessionService) Create(
	ctx context.Context,
	actorID string,
	req *model.CreateBrowserSessionRequest,
) (*persistence.BrowserSession, error) {
	actorID = strings.TrimSpace(actorID)
	sessionID := strings.TrimSpace(req.GetSessionId())
	conversationID := strings.TrimSpace(req.GetConversationId())
	deviceID := strings.TrimSpace(req.GetDeviceId())
	if actorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor is required", nil)
	}
	if err := s.validateSessionID(sessionID); err != nil {
		return nil, err
	}
	if deviceID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "device_id is required", nil)
	}
	if strings.TrimSpace(req.GetEngine()) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "engine is required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var row persistence.BrowserSession
	err = db.Transaction(func(tx *gorm.DB) error {
		// A session started from a still-draft topic has no Station
		// conversation yet; it is stored unbound.
		if conversationID != "" && !strings.HasPrefix(conversationID, "draft:") {
			if _, lockErr := s.ownedConversationTx(tx, actorID, conversationID); lockErr != nil {
				return lockErr
			}
		}
		row = persistence.BrowserSession{
			ID:             sessionID,
			ConversationID: conversationID,
			TurnID:         strings.TrimSpace(req.GetTurnId()),
			DeviceID:       deviceID,
			ActorPTID:      actorID,
			Engine:         strings.TrimSpace(req.GetEngine()),
			Status:         browserStatusActive,
			Lease:          browserLeaseAgent,
			TabsJSON:       "[]",
			CreatedAt:      now,
		}
		if createErr := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoNothing: true,
		}).Create(&row).Error; createErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create browser session", nil)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Update applies a worker lifecycle/lease/tab report.
func (s *BrowserSessionService) Update(
	ctx context.Context,
	actorID string,
	req *model.UpdateBrowserSessionRequest,
) (*persistence.BrowserSession, error) {
	actorID = strings.TrimSpace(actorID)
	status := browserSessionStatusFromString(req.GetStatus())
	lease := browserLeaseFromString(req.GetLease())
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var saved persistence.BrowserSession
	err = db.Transaction(func(tx *gorm.DB) error {
		row, ownedErr := s.getOwnedTx(tx, actorID, req.GetSessionId())
		if ownedErr != nil {
			return ownedErr
		}
		tabsJSON, marshalErr := json.Marshal(browserTabsFromProto(req.GetTabs()))
		if marshalErr != nil {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid tabs", nil)
		}
		updates := map[string]interface{}{
			"status":    status,
			"lease":     lease,
			"tabs_json": string(tabsJSON),
		}
		if status == browserStatusClosed {
			updates["ended_at"] = now
		}
		if updateErr := tx.Model(&persistence.BrowserSession{}).
			Where("id = ?", row.ID).
			Updates(updates).Error; updateErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "update browser session", nil)
		}
		if findErr := tx.Where("id = ?", row.ID).First(&saved).Error; findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reload browser session", nil)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

// List returns the sessions bound to one conversation.
func (s *BrowserSessionService) List(
	ctx context.Context,
	actorID string,
	conversationID string,
) ([]persistence.BrowserSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.BrowserSession
	if err := db.
		Where("actor_ptid = ? AND conversation_id = ?", strings.TrimSpace(actorID), strings.TrimSpace(conversationID)).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list browser sessions", nil)
	}
	return rows, nil
}

// Reconcile downgrades every ACTIVE session of this device that the worker
// cannot currently prove alive to UNKNOWN. A fresh worker proves nothing:
// browsers do not survive an app restart, and the UI must never advertise a
// controllable page that nobody holds.
func (s *BrowserSessionService) Reconcile(
	ctx context.Context,
	actorID string,
	req *model.ReconcileBrowserSessionsRequest,
) ([]persistence.BrowserSession, error) {
	deviceID := strings.TrimSpace(req.GetDeviceId())
	if deviceID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "device_id is required", nil)
	}
	live := make(map[string]struct{}, len(req.GetLiveSessionIds()))
	for _, id := range req.GetLiveSessionIds() {
		id = strings.TrimSpace(id)
		if id != "" {
			live[id] = struct{}{}
		}
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var deviceRows []persistence.BrowserSession
	err = db.Transaction(func(tx *gorm.DB) error {
		findErr := tx.
			Where("actor_ptid = ? AND device_id = ?", strings.TrimSpace(actorID), deviceID).
			Order("created_at DESC").
			Find(&deviceRows).Error
		if findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load browser sessions", nil)
		}
		staleIDs := make([]string, 0)
		for i := range deviceRows {
			if deviceRows[i].Status == browserStatusActive {
				if _, proven := live[deviceRows[i].ID]; !proven {
					staleIDs = append(staleIDs, deviceRows[i].ID)
				}
			}
		}
		if len(staleIDs) > 0 {
			if updateErr := tx.Model(&persistence.BrowserSession{}).
				Where("id IN ?", staleIDs).
				Updates(map[string]interface{}{"status": browserStatusUnknown}).Error; updateErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reconcile browser sessions", nil)
			}
			if findErr = tx.
				Where("actor_ptid = ? AND device_id = ?", strings.TrimSpace(actorID), deviceID).
				Order("created_at DESC").
				Find(&deviceRows).Error; findErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reload browser sessions", nil)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deviceRows, nil
}

// Remove deletes metadata for a browser session after the worker tore the
// browser down.
func (s *BrowserSessionService) Remove(
	ctx context.Context,
	actorID string,
	sessionID string,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		row, ownedErr := s.getOwnedTx(tx, actorID, sessionID)
		if ownedErr != nil {
			return ownedErr
		}
		if deleteErr := tx.Delete(&persistence.BrowserSession{}, "id = ?", row.ID).Error; deleteErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "remove browser session", nil)
		}
		return nil
	})
}

func (s *BrowserSessionService) getOwnedTx(
	tx *gorm.DB,
	actorID string,
	sessionID string,
) (*persistence.BrowserSession, error) {
	var row persistence.BrowserSession
	if err := tx.
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(sessionID), strings.TrimSpace(actorID)).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "browser session not found", nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load browser session", nil)
	}
	return &row, nil
}

func (s *BrowserSessionService) ownedConversationTx(
	tx *gorm.DB,
	actorID string,
	conversationID string,
) (*persistence.Conversation, error) {
	var conversation persistence.Conversation
	if err := tx.
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(conversationID), strings.TrimSpace(actorID)).
		First(&conversation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load conversation", nil)
	}
	if conversation.Status != string(domain.ConversationStatusActive) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, "conversation is not active", nil)
	}
	return &conversation, nil
}

func browserSessionStatusToString(status model.BrowserSessionStatus) string {
	switch status {
	case model.BrowserSessionStatus_BROWSER_SESSION_STATUS_ACTIVE:
		return browserStatusActive
	case model.BrowserSessionStatus_BROWSER_SESSION_STATUS_CLOSED:
		return browserStatusClosed
	case model.BrowserSessionStatus_BROWSER_SESSION_STATUS_UNKNOWN:
		return browserStatusUnknown
	default:
		return ""
	}
}

func browserSessionStatusFromString(status model.BrowserSessionStatus) string {
	if value := browserSessionStatusToString(status); value != "" {
		return value
	}
	return browserStatusUnknown
}

func browserLeaseFromString(lease model.BrowserControlLease) string {
	switch lease {
	case model.BrowserControlLease_BROWSER_CONTROL_LEASE_HUMAN:
		return browserLeaseHuman
	case model.BrowserControlLease_BROWSER_CONTROL_LEASE_AGENT:
		return browserLeaseAgent
	default:
		return browserLeaseAgent
	}
}

// BrowserSessionProto maps the persisted row to the contract.
func BrowserSessionProto(row *persistence.BrowserSession) *model.BrowserSession {
	protoRow := &model.BrowserSession{
		SessionId:      row.ID,
		ConversationId: row.ConversationID,
		TurnId:         row.TurnID,
		DeviceId:       row.DeviceID,
		Engine:         row.Engine,
		Status:         browserSessionStatusToProto(row.Status),
		Lease:          browserLeaseToProto(row.Lease),
		Tabs:           browserTabsProto(row.TabsJSON),
		CreatedAt:      timestamppb.New(row.CreatedAt),
	}
	if row.EndedAt != nil {
		protoRow.EndedAt = timestamppb.New(*row.EndedAt)
	}
	return protoRow
}

func browserSessionStatusToProto(status string) model.BrowserSessionStatus {
	switch status {
	case browserStatusActive:
		return model.BrowserSessionStatus_BROWSER_SESSION_STATUS_ACTIVE
	case browserStatusClosed:
		return model.BrowserSessionStatus_BROWSER_SESSION_STATUS_CLOSED
	case browserStatusUnknown:
		return model.BrowserSessionStatus_BROWSER_SESSION_STATUS_UNKNOWN
	default:
		return model.BrowserSessionStatus_BROWSER_SESSION_STATUS_UNSPECIFIED
	}
}

func browserLeaseToProto(lease string) model.BrowserControlLease {
	if lease == browserLeaseHuman {
		return model.BrowserControlLease_BROWSER_CONTROL_LEASE_HUMAN
	}
	return model.BrowserControlLease_BROWSER_CONTROL_LEASE_AGENT
}

type storedBrowserTab struct {
	TabID      string `json:"tabId"`
	Generation uint64 `json:"generation"`
	URL        string `json:"url"`
	Title      string `json:"title"`
}

func browserTabsFromProto(tabs []*model.BrowserTab) []storedBrowserTab {
	out := make([]storedBrowserTab, 0, len(tabs))
	for _, tab := range tabs {
		out = append(out, storedBrowserTab{
			TabID:      tab.GetTabId(),
			Generation: tab.GetGeneration(),
			URL:        tab.GetUrl(),
			Title:      tab.GetTitle(),
		})
	}
	return out
}

func browserTabsProto(tabsJSON string) []*model.BrowserTab {
	if strings.TrimSpace(tabsJSON) == "" {
		return nil
	}
	var stored []storedBrowserTab
	if err := json.Unmarshal([]byte(tabsJSON), &stored); err != nil {
		return nil
	}
	out := make([]*model.BrowserTab, 0, len(stored))
	for _, tab := range stored {
		out = append(out, &model.BrowserTab{
			TabId:      tab.TabID,
			Generation: tab.Generation,
			Url:        tab.URL,
			Title:      tab.Title,
		})
	}
	return out
}
