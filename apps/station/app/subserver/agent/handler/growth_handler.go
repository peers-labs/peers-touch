// Changelog:
// 2026-04-11 — Initial implementation: GrowthHandlers exposing 10 REST
//   endpoints for the Growth Supervision Dashboard. Covers growth snapshot,
//   audit log, feedback recording, memory rollback/snapshots/delete/freeze,
//   and skill rollback/versions/toggle. Follows the same typed handler
//   pattern as memory_handler.go and skill_handler.go.
// 2026-04-11 — Added HandleGetFeedbackHistory (endpoint 11) for paginated
//   feedback history retrieval. Total REST endpoints: 11.

package handler

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ---------------------------------------------------------------------------
// GrowthHandlers — typed handler struct
// ---------------------------------------------------------------------------

// GrowthHandlers exposes REST endpoints for the growth supervision dashboard.
// Delegates all domain logic to GrowthMetricsService, MemoryService, and
// SkillService.
type GrowthHandlers struct {
	growthMetrics     *service.GrowthMetricsService
	memoryService     *service.MemoryService
	skillService      *service.SkillService
	diagnosticService *service.GrowthDiagnosticService
}

func NewGrowthHandlers(
	growthMetrics *service.GrowthMetricsService,
	memoryService *service.MemoryService,
	skillService *service.SkillService,
	diagnosticService *service.GrowthDiagnosticService,
) *GrowthHandlers {
	return &GrowthHandlers{
		growthMetrics:     growthMetrics,
		memoryService:     memoryService,
		skillService:      skillService,
		diagnosticService: diagnosticService,
	}
}

// ---------------------------------------------------------------------------
// Pagination defaults
// ---------------------------------------------------------------------------

const (
	defaultLimit = 50
	maxLimit     = 200
)

// clampLimit enforces default and maximum pagination limits.
func clampLimit(limit int) int {
	if limit <= 0 {
		return defaultLimit
	}
	if limit > maxLimit {
		return maxLimit
	}
	return limit
}

// clampOffset ensures offset is non-negative.
func clampOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

// ===========================================================================
// 1. HandleGetGrowthSnapshot — GET /agent/growth/snapshot
// ===========================================================================

// HandleGetGrowthSnapshot returns a comprehensive growth snapshot for an agent.
func (h *GrowthHandlers) HandleGetGrowthSnapshot(ctx context.Context, req *model.GetGrowthSnapshotRequest) (*model.GetGrowthSnapshotResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	snapshot, err := h.growthMetrics.GetGrowthSnapshot(ctx, req.GetAgentId())
	if err != nil {
		logger.Errorf(ctx, "HandleGetGrowthSnapshot failed: agent_id=%s err=%v", req.GetAgentId(), err)
		return nil, toHandlerError(err)
	}

	return &model.GetGrowthSnapshotResponse{
		AgentId:           snapshot.AgentID,
		TotalMemories:     int32(snapshot.TotalMemories),
		TotalSkills:       int32(snapshot.TotalSkills),
		TotalReviews:      int32(snapshot.TotalReviews),
		TotalTurns:        int64(snapshot.TotalTurns),
		PositiveFeedback:  int32(snapshot.PositiveFeedback),
		NegativeFeedback:  int32(snapshot.NegativeFeedback),
		FeedbackRatio:     snapshot.FeedbackRatio,
		ErrorRate:         snapshot.ErrorRate,
		RetryRate:         snapshot.RetryRate,
		ReviewSuccessRate: snapshot.ReviewSuccessRate,
		MemoryGrowthRate:  snapshot.MemoryGrowthRate,
		SkillGrowthRate:   snapshot.SkillGrowthRate,
		QualityTrend:      strconv.FormatFloat(snapshot.QualityTrend, 'f', -1, 64),
		GrowthScore:       snapshot.GrowthScore,
		GrowthVerdict:     snapshot.GrowthVerdict,
		WindowStart:       snapshot.WindowStart.Format("2006-01-02T15:04:05Z"),
		WindowEnd:         snapshot.WindowEnd.Format("2006-01-02T15:04:05Z"),
	}, nil
}

// ===========================================================================
// 2. HandleGetAuditLog — GET /agent/growth/audit
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth audit types exist in agent.proto.
type GetAuditLogRequest struct {
	AgentID string `json:"agent_id"`
	Limit   int    `json:"limit"`
	Offset  int    `json:"offset"`
}

type AuditLogEventResponse struct {
	EventID   string `json:"event_id"`
	AgentID   string `json:"agent_id"`
	EventType string `json:"event_type"`
	Category  string `json:"category"`
	Target    string `json:"target"`
	Details   string `json:"details"`
	Outcome   string `json:"outcome"`
	CreatedAt string `json:"created_at"`
}

type GetAuditLogResponse struct {
	Events []AuditLogEventResponse `json:"events"`
	Total  int                     `json:"total"`
}

// HandleGetAuditLog returns a paginated audit log of growth events.
func (h *GrowthHandlers) HandleGetAuditLog(ctx context.Context, req *GetAuditLogRequest) (*GetAuditLogResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	limit := clampLimit(req.Limit)
	offset := clampOffset(req.Offset)

	events, total, err := h.growthMetrics.GetAuditLog(ctx, req.AgentID, limit, offset)
	if err != nil {
		logger.Errorf(ctx, "HandleGetAuditLog failed: agent_id=%s err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	resp := &GetAuditLogResponse{
		Events: make([]AuditLogEventResponse, 0, len(events)),
		Total:  int(total),
	}

	for _, e := range events {
		resp.Events = append(resp.Events, AuditLogEventResponse{
			EventID:   e.ID,
			AgentID:   e.AgentID,
			EventType: e.EventType,
			Category:  e.Category,
			Target:    e.Target,
			Details:   e.Details,
			Outcome:   e.Outcome,
			CreatedAt: e.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return resp, nil
}

// ===========================================================================
// 3. HandleRecordFeedback — POST /agent/growth/feedback
// ===========================================================================

// HandleRecordFeedback records explicit user feedback on a turn.
func (h *GrowthHandlers) HandleRecordFeedback(ctx context.Context, req *model.RecordFeedbackRequest) (*model.RecordFeedbackResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.GetTurnId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "turn_id is required", nil))
	}
	if req.GetConversationId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "conversation_id is required", nil))
	}

	// Validate the feedback signal value.
	signal := domain.FeedbackSignal(req.GetSignal())
	if !signal.IsValid() {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"signal must be \"positive\" or \"negative\"", nil))
	}

	record, replayed, err := h.growthMetrics.RecordFeedback(ctx, subjectActorID(ctx), service.TurnFeedbackInput{
		AgentID:            req.GetAgentId(),
		TurnID:             req.GetTurnId(),
		ConversationID:     req.GetConversationId(),
		AssistantMessageID: req.GetAssistantMessageId(),
		Signal:             req.GetSignal(),
		Source:             req.GetSource(),
		Rating:             req.GetRating(),
		Categories:         req.GetCategories(),
		Comment:            req.Comment,
		IdempotencyKey:     req.GetIdempotencyKey(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	logger.Infof(ctx, "HandleRecordFeedback accepted: agent_id=%s turn_id=%s signal=%s",
		req.GetAgentId(), req.GetTurnId(), req.GetSignal())

	return &model.RecordFeedbackResponse{
		Id:       record.ID,
		Feedback: persistenceFeedbackToProto(record),
		Replayed: replayed,
	}, nil
}

func (h *GrowthHandlers) HandleListTurnFeedback(
	ctx context.Context,
	req *model.ListTurnFeedbackRequest,
) (*model.ListTurnFeedbackResponse, error) {
	if req.GetTurnId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "turn_id is required", nil))
	}
	records, err := h.growthMetrics.ListTurnFeedback(ctx, subjectActorID(ctx), req.GetTurnId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	response := &model.ListTurnFeedbackResponse{
		Feedback: make([]*model.TurnFeedback, 0, len(records)),
	}
	for index := range records {
		response.Feedback = append(response.Feedback, persistenceFeedbackToProto(&records[index]))
	}
	return response, nil
}

// ===========================================================================
// 4. HandleMemoryRollback — POST /agent/growth/memory/rollback
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth memory rollback is modeled in agent.proto.
type MemoryRollbackRequest struct {
	AgentID    string `json:"agent_id"`
	SnapshotID string `json:"snapshot_id"`
}

type MemoryRollbackResponse struct {
	Success bool `json:"success"`
}

// HandleMemoryRollback restores agent memories to a previously captured snapshot.
func (h *GrowthHandlers) HandleMemoryRollback(ctx context.Context, req *MemoryRollbackRequest) (*MemoryRollbackResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.SnapshotID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "snapshot_id is required", nil))
	}

	if err := h.memoryService.RollbackToSnapshot(ctx, req.AgentID, req.SnapshotID); err != nil {
		logger.Errorf(ctx, "HandleMemoryRollback failed: agent_id=%s snapshot_id=%s err=%v",
			req.AgentID, req.SnapshotID, err)
		return nil, toHandlerError(err)
	}

	return &MemoryRollbackResponse{Success: true}, nil
}

// ===========================================================================
// 5. HandleListMemorySnapshots — GET /agent/growth/memory/snapshots
// ===========================================================================

// TODO(agent): replace with generated proto messages when list memory snapshots API is in agent.proto.
type ListMemorySnapshotsRequest struct {
	AgentID string `json:"agent_id"`
	Limit   int    `json:"limit"`
	Offset  int    `json:"offset"`
}

type MemorySnapshotItem struct {
	SnapshotID string `json:"snapshot_id"`
	AgentID    string `json:"agent_id"`
	Trigger    string `json:"trigger"`
	CreatedAt  string `json:"created_at"`
}

type ListMemorySnapshotsResponse struct {
	Snapshots []MemorySnapshotItem `json:"snapshots"`
	Total     int                  `json:"total"`
}

// HandleListMemorySnapshots returns a paginated list of memory snapshots.
func (h *GrowthHandlers) HandleListMemorySnapshots(ctx context.Context, req *ListMemorySnapshotsRequest) (*ListMemorySnapshotsResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	limit := clampLimit(req.Limit)
	offset := clampOffset(req.Offset)

	snapshots, total, err := h.memoryService.ListSnapshots(ctx, req.AgentID, limit, offset)
	if err != nil {
		logger.Errorf(ctx, "HandleListMemorySnapshots failed: agent_id=%s err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	resp := &ListMemorySnapshotsResponse{
		Snapshots: make([]MemorySnapshotItem, 0, len(snapshots)),
		Total:     int(total),
	}

	for _, s := range snapshots {
		resp.Snapshots = append(resp.Snapshots, MemorySnapshotItem{
			SnapshotID: s.ID,
			AgentID:    s.AgentID,
			Trigger:    s.Trigger,
			CreatedAt:  s.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return resp, nil
}

// ===========================================================================
// 6. HandleDeleteMemory — POST /agent/growth/memory/delete
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth delete memory is in agent.proto.
type DeleteMemoryRequest struct {
	AgentID  string `json:"agent_id"`
	MemoryID string `json:"memory_id"`
}

type DeleteMemoryResponse struct {
	Success bool `json:"success"`
}

// HandleDeleteMemory performs an admin-level hard delete of a specific memory.
func (h *GrowthHandlers) HandleDeleteMemory(ctx context.Context, req *DeleteMemoryRequest) (*DeleteMemoryResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.MemoryID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "memory_id is required", nil))
	}

	if err := h.memoryService.DeleteMemoryByID(ctx, req.AgentID, req.MemoryID); err != nil {
		logger.Errorf(ctx, "HandleDeleteMemory failed: agent_id=%s memory_id=%s err=%v",
			req.AgentID, req.MemoryID, err)
		return nil, toHandlerError(err)
	}

	return &DeleteMemoryResponse{Success: true}, nil
}

// ===========================================================================
// 7. HandleFreezeMemory — POST /agent/growth/memory/freeze
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth freeze memory is in agent.proto.
type FreezeMemoryRequest struct {
	AgentID  string `json:"agent_id"`
	MemoryID string `json:"memory_id"`
	Frozen   bool   `json:"frozen"`
}

type FreezeMemoryResponse struct {
	Success bool `json:"success"`
}

// HandleFreezeMemory toggles the frozen state on a memory entry.
// Frozen memories cannot be modified or deleted by the LLM.
func (h *GrowthHandlers) HandleFreezeMemory(ctx context.Context, req *FreezeMemoryRequest) (*FreezeMemoryResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.MemoryID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "memory_id is required", nil))
	}

	if err := h.memoryService.FreezeMemory(ctx, req.AgentID, req.MemoryID, req.Frozen); err != nil {
		logger.Errorf(ctx, "HandleFreezeMemory failed: agent_id=%s memory_id=%s frozen=%v err=%v",
			req.AgentID, req.MemoryID, req.Frozen, err)
		return nil, toHandlerError(err)
	}

	return &FreezeMemoryResponse{Success: true}, nil
}

// ===========================================================================
// 8. HandleSkillRollback — POST /agent/growth/skill/rollback
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth skill rollback is in agent.proto.
type SkillRollbackRequest struct {
	AgentID       string `json:"agent_id"`
	SkillID       string `json:"skill_id"`
	TargetVersion int    `json:"target_version"`
}

type SkillRollbackResponse struct {
	Success bool `json:"success"`
}

// HandleSkillRollback restores a skill to a previously recorded version.
func (h *GrowthHandlers) HandleSkillRollback(ctx context.Context, req *SkillRollbackRequest) (*SkillRollbackResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.SkillID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "skill_id is required", nil))
	}
	if req.TargetVersion <= 0 {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "target_version must be > 0", nil))
	}

	if err := h.skillService.RollbackSkill(ctx, req.AgentID, req.SkillID, req.TargetVersion); err != nil {
		logger.Errorf(ctx, "HandleSkillRollback failed: agent_id=%s skill_id=%s target_version=%d err=%v",
			req.AgentID, req.SkillID, req.TargetVersion, err)
		return nil, toHandlerError(err)
	}

	return &SkillRollbackResponse{Success: true}, nil
}

// ===========================================================================
// 9. HandleListSkillVersions — GET /agent/growth/skill/versions
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth skill versions list is in agent.proto.
type ListSkillVersionsRequest struct {
	AgentID string `json:"agent_id"`
	SkillID string `json:"skill_id"`
	Limit   int    `json:"limit"`
	Offset  int    `json:"offset"`
}

type SkillVersionItem struct {
	VersionID string `json:"version_id"`
	SkillID   string `json:"skill_id"`
	AgentID   string `json:"agent_id"`
	Version   int    `json:"version"`
	Trigger   string `json:"trigger"`
	CreatedAt string `json:"created_at"`
}

type ListSkillVersionsResponse struct {
	Versions []SkillVersionItem `json:"versions"`
	Total    int                `json:"total"`
}

// HandleListSkillVersions returns a paginated version history for a skill.
func (h *GrowthHandlers) HandleListSkillVersions(ctx context.Context, req *ListSkillVersionsRequest) (*ListSkillVersionsResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.SkillID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "skill_id is required", nil))
	}

	limit := clampLimit(req.Limit)
	offset := clampOffset(req.Offset)

	versions, total, err := h.skillService.ListVersions(ctx, req.AgentID, req.SkillID, limit, offset)
	if err != nil {
		logger.Errorf(ctx, "HandleListSkillVersions failed: agent_id=%s skill_id=%s err=%v",
			req.AgentID, req.SkillID, err)
		return nil, toHandlerError(err)
	}

	resp := &ListSkillVersionsResponse{
		Versions: make([]SkillVersionItem, 0, len(versions)),
		Total:    int(total),
	}

	for _, v := range versions {
		resp.Versions = append(resp.Versions, SkillVersionItem{
			VersionID: v.ID,
			SkillID:   v.SkillID,
			AgentID:   v.AgentID,
			Version:   v.Version,
			Trigger:   v.Trigger,
			CreatedAt: v.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return resp, nil
}

// ===========================================================================
// 10. HandleToggleSkill — POST /agent/growth/skill/toggle
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth skill toggle is in agent.proto.
type ToggleSkillRequest struct {
	AgentID string `json:"agent_id"`
	SkillID string `json:"skill_id"`
	Enabled bool   `json:"enabled"`
}

type ToggleSkillResponse struct {
	Success bool `json:"success"`
}

// HandleToggleSkill enables or disables a skill without deleting it.
// Disabled skills are excluded from the skill index and will not be
// loaded by the LLM.
func (h *GrowthHandlers) HandleToggleSkill(ctx context.Context, req *ToggleSkillRequest) (*ToggleSkillResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.SkillID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "skill_id is required", nil))
	}

	if err := h.skillService.ToggleSkill(ctx, req.AgentID, req.SkillID, req.Enabled); err != nil {
		logger.Errorf(ctx, "HandleToggleSkill failed: agent_id=%s skill_id=%s enabled=%v err=%v",
			req.AgentID, req.SkillID, req.Enabled, err)
		return nil, toHandlerError(err)
	}

	return &ToggleSkillResponse{Success: true}, nil
}

// ===========================================================================
// 11. HandleGetFeedbackHistory — GET /agent/growth/feedback/history
// ===========================================================================

// TODO(agent): replace with generated proto messages when feedback history API is in agent.proto.
type GetFeedbackHistoryRequest struct {
	AgentID string `json:"agent_id"`
	Limit   int    `json:"limit"`
	Offset  int    `json:"offset"`
}

type FeedbackHistoryItem struct {
	FeedbackID     string  `json:"feedback_id"`
	AgentID        string  `json:"agent_id"`
	TurnID         string  `json:"turn_id"`
	ConversationID string  `json:"conversation_id"`
	Signal         string  `json:"signal"`
	Comment        *string `json:"comment,omitempty"`
	CreatedAt      string  `json:"created_at"`
}

type GetFeedbackHistoryResponse struct {
	Feedbacks []FeedbackHistoryItem `json:"feedbacks"`
	Total     int                   `json:"total"`
}

func (h *GrowthHandlers) HandleGetFeedbackHistory(ctx context.Context, req *GetFeedbackHistoryRequest) (*GetFeedbackHistoryResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	limit := clampLimit(req.Limit)
	offset := clampOffset(req.Offset)

	feedbacks, total, err := h.growthMetrics.GetFeedbackHistory(ctx, subjectActorID(ctx), req.AgentID, limit, offset)
	if err != nil {
		logger.Errorf(ctx, "HandleGetFeedbackHistory failed: agent_id=%s err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	resp := &GetFeedbackHistoryResponse{
		Feedbacks: make([]FeedbackHistoryItem, 0, len(feedbacks)),
		Total:     int(total),
	}

	for _, f := range feedbacks {
		resp.Feedbacks = append(resp.Feedbacks, FeedbackHistoryItem{
			FeedbackID:     f.ID,
			AgentID:        f.AgentID,
			TurnID:         f.TurnID,
			ConversationID: f.ConversationID,
			Signal:         f.Signal,
			Comment:        f.Comment,
			CreatedAt:      f.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return resp, nil
}

func persistenceFeedbackToProto(record *persistence.UserFeedback) *model.TurnFeedback {
	if record == nil {
		return nil
	}
	var categories []string
	_ = json.Unmarshal(record.Categories, &categories)
	return &model.TurnFeedback{
		FeedbackId:         record.ID,
		TurnId:             record.TurnID,
		AssistantMessageId: record.AssistantMessageID,
		Ptid:               record.Ptid,
		Source:             record.Source,
		Rating:             record.Rating,
		Categories:         categories,
		Comment:            optionalStringValue(record.Comment),
		CreatedAt:          timestamppb.New(record.CreatedAt),
		UpdatedAt:          timestamppb.New(record.UpdatedAt),
		ConversationId:     record.ConversationID,
	}
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// ===========================================================================
// 12. HandleGetDiagnostic — GET /agent/growth/diagnostic
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth diagnostic API is in agent.proto.
type GetDiagnosticRequest struct {
	AgentID string `json:"agent_id"`
}

type DiagnosticSuspectResponse struct {
	ItemType          string `json:"item_type"`
	ItemID            string `json:"item_id"`
	ItemContent       string `json:"item_content"`
	NegativeCount     int    `json:"negative_count"`
	RecommendedAction string `json:"recommended_action"`
	Reason            string `json:"reason"`
}

type GetDiagnosticResponse struct {
	ReportID      string                      `json:"report_id"`
	AgentID       string                      `json:"agent_id"`
	GrowthScore   float64                     `json:"growth_score"`
	GrowthVerdict string                      `json:"growth_verdict"`
	Suspects      []DiagnosticSuspectResponse `json:"suspects"`
	Summary       string                      `json:"summary"`
	CreatedAt     string                      `json:"created_at"`
}

// HandleGetDiagnostic returns the latest diagnostic report for an agent.
// The report contains suspected memories/skills with recommended actions.
func (h *GrowthHandlers) HandleGetDiagnostic(ctx context.Context, req *GetDiagnosticRequest) (*GetDiagnosticResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	result, err := h.diagnosticService.GetLatestDiagnostic(ctx, req.AgentID)
	if err != nil {
		logger.Errorf(ctx, "HandleGetDiagnostic failed: agent_id=%s err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	if result == nil {
		return &GetDiagnosticResponse{
			AgentID:  req.AgentID,
			Suspects: []DiagnosticSuspectResponse{},
			Summary:  "No diagnostic report available. Agent growth is stable.",
		}, nil
	}

	suspects := make([]DiagnosticSuspectResponse, 0, len(result.Suspects))
	for _, s := range result.Suspects {
		suspects = append(suspects, DiagnosticSuspectResponse{
			ItemType:          s.ItemType,
			ItemID:            s.ItemID,
			ItemContent:       s.ItemContent,
			NegativeCount:     s.NegativeCount,
			RecommendedAction: s.RecommendedAction,
			Reason:            s.Reason,
		})
	}

	return &GetDiagnosticResponse{
		ReportID:      result.ReportID,
		AgentID:       result.AgentID,
		GrowthScore:   result.GrowthScore,
		GrowthVerdict: result.GrowthVerdict,
		Suspects:      suspects,
		Summary:       result.Summary,
		CreatedAt:     result.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}, nil
}

// ===========================================================================
// 13. HandleClearSuspectedItem — POST /agent/growth/diagnostic/clear
// ===========================================================================

// TODO(agent): replace with generated proto messages when growth diagnostic clear is in agent.proto.
type ClearSuspectedItemRequest struct {
	AgentID string `json:"agent_id"`
	ItemID  string `json:"item_id"`
}

type ClearSuspectedItemResponse struct {
	Success bool `json:"success"`
}

// HandleClearSuspectedItem marks a suspected item as cleared after the user
// has taken action (rollback, freeze, delete, etc.).
func (h *GrowthHandlers) HandleClearSuspectedItem(ctx context.Context, req *ClearSuspectedItemRequest) (*ClearSuspectedItemResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.ItemID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "item_id is required", nil))
	}

	if err := h.diagnosticService.ClearSuspectedItem(ctx, req.AgentID, req.ItemID); err != nil {
		logger.Errorf(ctx, "HandleClearSuspectedItem failed: agent_id=%s item_id=%s err=%v",
			req.AgentID, req.ItemID, err)
		return nil, toHandlerError(err)
	}

	return &ClearSuspectedItemResponse{Success: true}, nil
}
