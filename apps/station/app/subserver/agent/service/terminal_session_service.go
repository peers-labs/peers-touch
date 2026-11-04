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

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/sandbox"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	terminalStatusRunning = "running"
	terminalStatusExited  = "exited"
	terminalStatusKilled  = "killed"
	terminalStatusUnknown = "unknown"

	// Persisted execution-target vocabulary.
	terminalTargetDesktop = "desktop_device"
	terminalTargetSandbox = "workspace_sandbox"
)

// TerminalSessionService persists device-held terminal session metadata
// (TW-D5). It never stores process output or environment: the PTY and its
// bounded ring stay in the Desktop worker.
type TerminalSessionService struct {
	db  *gorm.DB
	now func() time.Time
	// Optional WORKSPACE_SANDBOX PTY proxy. When nil, sandbox-terminal RPCs
	// fail closed (SANDBOX_UNAVAILABLE) instead of executing locally.
	sandboxPTY SandboxPtyBridge
}

// SandboxPtyBridge is the subset of the sandbox TerminalBridge the terminal
// service needs (open is triggered from Create).
type SandboxPtyBridge interface {
	Open(ctx context.Context, in sandbox.PtySessionOpen) error
	Write(ctx context.Context, sandboxRef, ptyID string, data []byte) error
	Read(ctx context.Context, sandboxRef, ptyID string, cursor uint64, maxBytes uint32) (*sandbox.PtyRead, error)
	Resize(ctx context.Context, sandboxRef, ptyID string, cols, rows uint32) error
	Signal(ctx context.Context, sandboxRef, ptyID string, signal int) error
	Close(ctx context.Context, sandboxRef, ptyID string) error
}

func (s *TerminalSessionService) SetSandboxPtyBridge(b SandboxPtyBridge) { s.sandboxPTY = b }

func NewTerminalSessionService() *TerminalSessionService {
	return &TerminalSessionService{now: func() time.Time { return time.Now().UTC() }}
}

func (s *TerminalSessionService) SetDB(db *gorm.DB) { s.db = db }

func (s *TerminalSessionService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "open Agent database", err)
	}
	return db, nil
}

func terminalSessionStatusToString(status model.TerminalSessionStatus) string {
	switch status {
	case model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_RUNNING:
		return terminalStatusRunning
	case model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_EXITED:
		return terminalStatusExited
	case model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_KILLED:
		return terminalStatusKilled
	case model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_UNKNOWN:
		return terminalStatusUnknown
	}
	return ""
}

func terminalSessionStatusFromString(status string) model.TerminalSessionStatus {
	switch status {
	case terminalStatusRunning:
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_RUNNING
	case terminalStatusExited:
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_EXITED
	case terminalStatusKilled:
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_KILLED
	case terminalStatusUnknown:
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_UNKNOWN
	}
	return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_UNSPECIFIED
}

// TerminalSessionProto maps the persisted row to the proto contract.
func TerminalSessionProto(row *persistence.TerminalSession) *model.TerminalSession {
	if row == nil {
		return nil
	}
	proto := &model.TerminalSession{
		SessionId:      row.ID,
		ConversationId: row.ConversationID,
		TurnId:         row.TurnID,
		DeviceId:       row.DeviceID,
		Cwd:            row.CWD,
		Command:        row.Command,
		Pid:            row.PID,
		Status:         terminalSessionStatusFromString(row.Status),
		ExitCode:       row.ExitCode,
		OutputBytes:    row.OutputBytes,
		CreatedAt:      timestamppb.New(row.CreatedAt),
	}
	var args []string
	if strings.TrimSpace(row.ArgsJSON) != "" {
		if err := json.Unmarshal([]byte(row.ArgsJSON), &args); err != nil {
			args = nil
		}
	}
	proto.Args = args
	if row.EndedAt != nil {
		proto.EndedAt = timestamppb.New(*row.EndedAt)
	}
	switch strings.TrimSpace(row.ExecutionTarget) {
	case terminalTargetSandbox:
		proto.ExecutionTarget = model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX
	default:
		proto.ExecutionTarget = model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE
	}
	proto.SandboxRef = row.SandboxRef
	return proto
}

func (s *TerminalSessionService) ownedConversationTx(
	tx *gorm.DB,
	actorID string,
	conversationID string,
) (*persistence.Conversation, error) {
	var conversation persistence.Conversation
	if err := tx.
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(conversationID), strings.TrimSpace(actorID)).
		First(&conversation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load terminal conversation", err)
	}
	if conversation.Status != string(domain.ConversationStatusActive) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, "conversation is not active", nil)
	}
	return &conversation, nil
}

// terminalSessionIDPattern anchors the worker-minted resource id
// ("terms-" + 26-char Crockford Base32 ULID). Station never mints terminal
// session ids: the same id addresses the worker handle and the Station row.
var terminalSessionIDPattern = regexp.MustCompile(`^terms-[0-9A-Z]{26}$`)

// Create records a session the local worker just spawned. The request carries
// the worker-generated session id, which becomes the row primary key. The
// call is idempotent per (actor, session id) so a retried request after a
// transport timeout neither duplicates the row nor kills the live process.
func (s *TerminalSessionService) Create(
	ctx context.Context,
	actorID string,
	req *model.CreateTerminalSessionRequest,
) (*persistence.TerminalSession, error) {
	actorID = strings.TrimSpace(actorID)
	sessionID := strings.TrimSpace(req.GetSessionId())
	if actorID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor is required", nil)
	}
	if !terminalSessionIDPattern.MatchString(sessionID) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "valid session_id is required", nil)
	}
	conversationID := strings.TrimSpace(req.GetConversationId())
	// A session started from a still-draft topic has no Station conversation
	// yet; it is stored unbound and attached to a task conversation later.
	if conversationID == "" || strings.HasPrefix(conversationID, "draft:") {
		conversationID = ""
	}
	command := strings.TrimSpace(req.GetCommand())
	if command == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "command is required", nil)
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	sandboxRef := strings.TrimSpace(req.GetSandboxRef())
	target := terminalTargetDesktop
	if req.GetExecutionTarget() == model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX {
		target = terminalTargetSandbox
	}
	if target == terminalTargetDesktop && deviceID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "device_id is required", nil)
	}
	if target == terminalTargetSandbox && sandboxRef == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "sandbox_ref is required", nil)
	}
	if target == terminalTargetSandbox && deviceID != "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "sandbox session must not bind a device", nil)
	}
	argsJSON, err := json.Marshal(req.GetArgs())
	if err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid session args", err)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var row persistence.TerminalSession
	err = db.Transaction(func(tx *gorm.DB) error {
		var existing persistence.TerminalSession
		findErr := tx.
			Where("id = ? AND actor_ptid = ?", sessionID, actorID).
			First(&existing).Error
		if findErr == nil {
			if existing.DeviceID != deviceID {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "session id already bound to another device", nil)
			}
			row = existing
			return nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load terminal session", findErr)
		}
		if conversationID != "" {
			if _, lockErr := s.ownedConversationTx(tx, actorID, conversationID); lockErr != nil {
				return lockErr
			}
		}
		row = persistence.TerminalSession{
			ID:              sessionID,
			ConversationID:  conversationID,
			TurnID:          strings.TrimSpace(req.GetTurnId()),
			DeviceID:        deviceID,
			ActorPTID:       actorID,
			CWD:             strings.TrimSpace(req.GetCwd()),
			Command:         command,
			ArgsJSON:        string(argsJSON),
			PID:             req.GetPid(),
			Status:          terminalStatusRunning,
			ExecutionTarget: target,
			SandboxRef:      sandboxRef,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if createErr := tx.Create(&row).Error; createErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create terminal session", createErr)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// For WORKSPACE_SANDBOX, Station owns the process: open the PTY in the
	// provisioner right after persisting metadata. Failure fails closed and
	// removes the half-created row; there is no desktop fallback.
	if target == terminalTargetSandbox {
		if s.sandboxPTY == nil {
			_ = s.removeRow(ctx, actorID, sessionID)
			return nil, errcode.New(errcode.AgentSandboxUnavailable, http.StatusServiceUnavailable,
				errcode.AgentSandboxUnavailableLocaleKey, nil)
		}
		openErr := s.sandboxPTY.Open(ctx, sandbox.PtySessionOpen{
			SandboxRef: sandboxRef,
			PtyID:      sessionID,
			Command:    command,
			Args:       req.GetArgs(),
			Cwd:        strings.TrimSpace(req.GetCwd()),
		})
		if openErr != nil {
			_ = s.removeRow(ctx, actorID, sessionID)
			return nil, errcode.New(errcode.AgentSandboxUnavailable, http.StatusServiceUnavailable,
				errcode.AgentSandboxUnavailableLocaleKey, openErr)
		}
	}
	return &row, nil
}

// removeRow hard-deletes one owned session row (cleanup after a failed
// provisioner open). It is best-effort and returns the persistence error.
func (s *TerminalSessionService) removeRow(ctx context.Context, actorID, sessionID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Where("id = ? AND actor_ptid = ?", strings.TrimSpace(sessionID), strings.TrimSpace(actorID)).
		Delete(&persistence.TerminalSession{}).Error
}

func (s *TerminalSessionService) getOwnedTx(
	tx *gorm.DB,
	actorID string,
	sessionID string,
) (*persistence.TerminalSession, error) {
	var row persistence.TerminalSession
	if err := tx.
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(sessionID), strings.TrimSpace(actorID)).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "terminal session not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load terminal session", err)
	}
	return &row, nil
}

// Update applies a worker lifecycle report.
func (s *TerminalSessionService) Update(
	ctx context.Context,
	actorID string,
	req *model.UpdateTerminalSessionRequest,
) (*persistence.TerminalSession, error) {
	status := terminalSessionStatusToString(req.GetStatus())
	if status == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "valid terminal status is required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var saved persistence.TerminalSession
	err = db.Transaction(func(tx *gorm.DB) error {
		row, ownedErr := s.getOwnedTx(tx, actorID, req.GetSessionId())
		if ownedErr != nil {
			return ownedErr
		}
		updates := map[string]interface{}{
			"status":       status,
			"output_bytes": req.GetOutputBytes(),
			"updated_at":   now,
		}
		if status == terminalStatusExited || status == terminalStatusKilled {
			row.ExitCode = req.GetExitCode()
			updates["exit_code"] = req.GetExitCode()
			if row.EndedAt == nil {
				updates["ended_at"] = now
			}
		}
		if updateErr := tx.Model(&persistence.TerminalSession{}).
			Where("id = ?", row.ID).
			Updates(updates).Error; updateErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "update terminal session", updateErr)
		}
		if findErr := tx.Where("id = ?", row.ID).First(&saved).Error; findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reload terminal session", findErr)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

// List returns the sessions bound to one conversation, newest first.
func (s *TerminalSessionService) List(
	ctx context.Context,
	actorID string,
	conversationID string,
) ([]persistence.TerminalSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.TerminalSession
	if err := db.
		Where("actor_ptid = ? AND conversation_id = ?",
			strings.TrimSpace(actorID), strings.TrimSpace(conversationID)).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list terminal sessions", err)
	}
	return rows, nil
}

// Reconcile downgrades every RUNNING session of this device that the worker
// cannot currently prove alive to UNKNOWN. A fresh worker proves nothing, so
// boot-time reconciliation must never advertise stale sessions as running.
func (s *TerminalSessionService) Reconcile(
	ctx context.Context,
	actorID string,
	req *model.ReconcileTerminalSessionsRequest,
) ([]persistence.TerminalSession, error) {
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
	now := s.now()
	var rows []persistence.TerminalSession
	err = db.Transaction(func(tx *gorm.DB) error {
		var deviceRows []persistence.TerminalSession
		if findErr := tx.
			Where("actor_ptid = ? AND device_id = ?", strings.TrimSpace(actorID), deviceID).
			Order("created_at DESC").
			Find(&deviceRows).Error; findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load device terminal sessions", findErr)
		}
		staleIDs := make([]string, 0)
		for i := range deviceRows {
			if deviceRows[i].Status == terminalStatusRunning {
				if _, proven := live[deviceRows[i].ID]; !proven {
					staleIDs = append(staleIDs, deviceRows[i].ID)
				}
			}
		}
		if len(staleIDs) > 0 {
			if updateErr := tx.Model(&persistence.TerminalSession{}).
				Where("id IN ?", staleIDs).
				Updates(map[string]interface{}{
					"status":     terminalStatusUnknown,
					"updated_at": now,
				}).Error; updateErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reconcile terminal sessions", updateErr)
			}
			if findErr := tx.
				Where("actor_ptid = ? AND device_id = ?", strings.TrimSpace(actorID), deviceID).
				Order("created_at DESC").
				Find(&deviceRows).Error; findErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "reload terminal sessions", findErr)
			}
		}
		rows = deviceRows
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// Remove deletes metadata for a terminal session (worker-side process and
// ring are torn down by the caller first).
func (s *TerminalSessionService) Remove(
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
		// Sandbox PTYs are Station-owned processes: close the provisioner
		// PTY before dropping the row. A provisioner failure must not silently
		// leave a running process, so surface it rather than deleting anyway.
		if row.ExecutionTarget == terminalTargetSandbox {
			if s.sandboxPTY == nil {
				return errcode.New(errcode.AgentSandboxUnavailable, http.StatusServiceUnavailable,
					errcode.AgentSandboxUnavailableLocaleKey, nil)
			}
			if closeErr := s.sandboxPTY.Close(ctx, row.SandboxRef, row.ID); closeErr != nil {
				return errcode.New(errcode.AgentSandboxUnavailable, http.StatusBadGateway,
					errcode.AgentSandboxUnavailableLocaleKey, closeErr)
			}
		}
		if deleteErr := tx.Delete(&persistence.TerminalSession{}, "id = ?", row.ID).Error; deleteErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "remove terminal session", deleteErr)
		}
		return nil
	})
}

// ownedSandboxSession loads an owned row and asserts it is a sandbox session.
func (s *TerminalSessionService) ownedSandboxSession(
	ctx context.Context,
	actorID, sessionID string,
) (*persistence.TerminalSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.TerminalSession
	if err := db.Where("id = ? AND actor_ptid = ?",
		strings.TrimSpace(sessionID), strings.TrimSpace(actorID)).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "terminal session not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load terminal session", err)
	}
	if row.ExecutionTarget != terminalTargetSandbox {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"sandbox PTY RPC used on a desktop-device session", nil)
	}
	return &row, nil
}

func (s *TerminalSessionService) requireSandboxBridge() error {
	if s.sandboxPTY == nil {
		return errcode.New(errcode.AgentSandboxUnavailable, http.StatusServiceUnavailable,
			errcode.AgentSandboxUnavailableLocaleKey, nil)
	}
	return nil
}

// SandboxPtyWrite forwards keystrokes to a provisioner-held PTY.
func (s *TerminalSessionService) SandboxPtyWrite(ctx context.Context, actorID string, req *model.SandboxPtyWriteRequest) error {
	if err := s.requireSandboxBridge(); err != nil {
		return err
	}
	row, err := s.ownedSandboxSession(ctx, actorID, req.GetSessionId())
	if err != nil {
		return err
	}
	return s.sandboxPTY.Write(ctx, row.SandboxRef, row.ID, req.GetData())
}

// SandboxPtyRead returns bounded scrollback and surfaces honest process state,
// persisting a terminal transition when the proxied process has ended.
func (s *TerminalSessionService) SandboxPtyRead(ctx context.Context, actorID string, req *model.SandboxPtyReadRequest) (*model.SandboxPtyReadResponse, error) {
	if err := s.requireSandboxBridge(); err != nil {
		return nil, err
	}
	row, err := s.ownedSandboxSession(ctx, actorID, req.GetSessionId())
	if err != nil {
		return nil, err
	}
	read, err := s.sandboxPTY.Read(ctx, row.SandboxRef, row.ID, req.GetCursor(), req.GetMaxBytes())
	if err != nil {
		return nil, errcode.New(errcode.AgentSandboxUnavailable, http.StatusBadGateway,
			errcode.AgentSandboxUnavailableLocaleKey, err)
	}
	status := ptyStateToStatus(read.State)
	if (read.State == "exited" || read.State == "killed") && row.Status == terminalStatusRunning {
		now := s.now()
		mapped := terminalSessionStatusToString(status)
		db, _ := s.getDB(ctx)
		_ = db.Model(&persistence.TerminalSession{}).Where("id = ?", row.ID).
			Updates(map[string]interface{}{
				"status":       mapped,
				"exit_code":    read.ExitCode,
				"output_bytes": read.NextCursor,
				"ended_at":     now,
				"updated_at":   now,
			}).Error
	}
	return &model.SandboxPtyReadResponse{
		Data:        read.Data,
		NextCursor:  read.NextCursor,
		Truncated:   read.Truncated,
		Status:      status,
		ExitCode:    int32(read.ExitCode),
		OutputBytes: read.NextCursor,
	}, nil
}

func (s *TerminalSessionService) SandboxPtyResize(ctx context.Context, actorID string, req *model.SandboxPtyResizeRequest) error {
	if err := s.requireSandboxBridge(); err != nil {
		return err
	}
	row, err := s.ownedSandboxSession(ctx, actorID, req.GetSessionId())
	if err != nil {
		return err
	}
	return s.sandboxPTY.Resize(ctx, row.SandboxRef, row.ID, req.GetCols(), req.GetRows())
}

func (s *TerminalSessionService) SandboxPtySignal(ctx context.Context, actorID string, req *model.SandboxPtySignalRequest) error {
	if err := s.requireSandboxBridge(); err != nil {
		return err
	}
	row, err := s.ownedSandboxSession(ctx, actorID, req.GetSessionId())
	if err != nil {
		return err
	}
	return s.sandboxPTY.Signal(ctx, row.SandboxRef, row.ID, int(req.GetSignal()))
}

func ptyStateToStatus(state string) model.TerminalSessionStatus {
	switch state {
	case "running":
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_RUNNING
	case "exited":
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_EXITED
	case "killed":
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_KILLED
	default:
		return model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_UNKNOWN
	}
}
