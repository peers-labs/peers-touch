package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const atelierProjectionVersion = "atelier-projection/v0"
const atelierArtifactBodyFetchDefaultMaxBytes int64 = 64 * 1024
const atelierRunKindAgents = "agents"
const atelierRunKindModel = "model"
const atelierIntentPresetWork = "work"
const atelierIntentPresetCode = "code"
const atelierIntentPresetDesign = "design"
const atelierFullE2EProviderRuntimeEvidenceEnv = "PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE"

type AtelierProjectionService struct {
	orchestrationService *OrchestrationService
	memoryService        *MemoryService
}

type LoadAtelierWorkspaceRequest struct {
	SelectedTaskID string `json:"selectedTaskId,omitempty"`
	PageSize       int    `json:"pageSize,omitempty"`
	EventPageSize  int    `json:"eventPageSize,omitempty"`
}

type CreateAtelierProjectFromGoalRequest struct {
	Goal         string                  `json:"goal,omitempty"`
	Project      string                  `json:"project,omitempty"`
	IntentPreset string                  `json:"intentPreset,omitempty"`
	Run          AtelierRunTargetRequest `json:"run,omitempty"`
	AgentIDs     []string                `json:"agentIds,omitempty"`
}

type SendAtelierMessageRequest struct {
	TaskID string `json:"taskId,omitempty"`
	Text   string `json:"text,omitempty"`
}

type ResolveAtelierDecisionRequest struct {
	TaskID  string `json:"taskId,omitempty"`
	BlockID string `json:"blockId,omitempty"`
	Choice  string `json:"choice,omitempty"`
}

type SetAtelierTaskStatusRequest struct {
	TaskID string `json:"taskId,omitempty"`
	Status string `json:"status,omitempty"`
}

type PurgeAtelierTaskRequest struct {
	TaskID string `json:"taskId,omitempty"`
}

type ListAtelierProviderCapabilitiesRequest struct {
	TaskID                    string `json:"taskId,omitempty"`
	FullE2ELaunchID           string `json:"fullE2ELaunchId,omitempty"`
	FullE2ESessionID          string `json:"fullE2ESessionId,omitempty"`
	FullE2EProviderProfileRef string `json:"fullE2EProviderProfileRef,omitempty"`
}

type SubmitAtelierFeedbackRequest struct {
	TaskID  string `json:"taskId,omitempty"`
	BlockID string `json:"blockId,omitempty"`
	Signal  string `json:"signal,omitempty"`
	Comment string `json:"comment,omitempty"`
}

type ConfirmAtelierMemoryCandidateRequest struct {
	TaskID     string `json:"taskId,omitempty"`
	FeedbackID string `json:"feedbackId,omitempty"`
}

type ConfirmAtelierMemoryCandidateResponse struct {
	Accepted    bool   `json:"accepted"`
	FeedbackID  string `json:"feedbackId"`
	MemoryID    string `json:"memoryId"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	Target      string `json:"target"`
	Layer       string `json:"layer"`
	AlreadyDone bool   `json:"alreadyDone"`
}

type ConfirmAtelierRerunRequest struct {
	TaskID     string `json:"taskId,omitempty"`
	FeedbackID string `json:"feedbackId,omitempty"`
}

type ConfirmAtelierRerunResponse struct {
	Accepted    bool   `json:"accepted"`
	FeedbackID  string `json:"feedbackId"`
	TaskID      string `json:"taskId"`
	RerunTaskID string `json:"rerunTaskId"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	AlreadyDone bool   `json:"alreadyDone"`
	Started     bool   `json:"started"`
}

type FetchAtelierArtifactBodyRequest struct {
	TaskID       string `json:"taskId,omitempty"`
	ArtifactID   string `json:"artifactId,omitempty"`
	BodyRef      string `json:"bodyRef,omitempty"`
	ExpectedHash string `json:"expectedHash,omitempty"`
	MaxBytes     int64  `json:"maxBytes,omitempty"`
}

type AtelierProviderCapability struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Description  string `json:"description"`
	SlashCommand string `json:"slashCommand"`
	ProviderKind string `json:"providerKind"`
	Scope        string `json:"scope"`
	ReadOnly     bool   `json:"readOnly"`
}

type AtelierProviderCapabilitiesResponse struct {
	Capabilities []AtelierProviderCapability `json:"capabilities"`
	Source       string                      `json:"source"`
}

type AtelierDirectRunExecutionEvidence struct {
	DirectRunID        string                      `json:"directRunId"`
	TaskID             string                      `json:"taskId"`
	ProviderID         string                      `json:"providerId"`
	ModelIntent        string                      `json:"modelIntent"`
	State              string                      `json:"state"`
	TraceID            string                      `json:"traceId"`
	ArtifactRefs       []string                    `json:"artifactRefs"`
	GateRefs           []string                    `json:"gateRefs"`
	BudgetUsage        AtelierDirectRunBudgetUsage `json:"budgetUsage"`
	FailureArtifactRef *string                     `json:"failureArtifactRef"`
	CliHandoffRef      *string                     `json:"cliHandoffRef"`
}

type AtelierDirectRunBudgetUsage struct {
	Tokens     int64   `json:"tokens"`
	MoneyUSD   float64 `json:"moneyUsd"`
	Source     string  `json:"source"`
	BudgetRef  string  `json:"budgetRef"`
	PricingRef string  `json:"pricingRef,omitempty"`
}

type AtelierFeedbackPolicyHint struct {
	Status               string   `json:"status"`
	Reason               string   `json:"reason"`
	RequiresConfirmation bool     `json:"requiresConfirmation"`
	ConfirmationMode     string   `json:"confirmationMode"`
	Feeds                []string `json:"feeds"`
}

type SubmitAtelierFeedbackResponse struct {
	Accepted        bool                      `json:"accepted"`
	FeedbackID      string                    `json:"feedbackId"`
	MemoryCandidate AtelierFeedbackPolicyHint `json:"memoryCandidate"`
	RerunIntent     AtelierFeedbackPolicyHint `json:"rerunIntent"`
}

type FetchAtelierArtifactBodyResponse struct {
	TaskID          string `json:"taskId"`
	ArtifactID      string `json:"artifactId"`
	BodyRef         string `json:"bodyRef"`
	BodyKind        string `json:"bodyKind"`
	BodyHash        string `json:"bodyHash"`
	BodySize        int64  `json:"bodySize"`
	Text            string `json:"text"`
	Truncated       bool   `json:"truncated"`
	RetentionStatus string `json:"retentionStatus"`
}

type AtelierRunTargetRequest struct {
	Kind     string   `json:"kind,omitempty"`
	Model    string   `json:"model,omitempty"`
	FlowID   string   `json:"flowId,omitempty"`
	AgentIDs []string `json:"agentIds,omitempty"`
}

func NewAtelierProjectionService(orchestrationService *OrchestrationService, memoryServices ...*MemoryService) *AtelierProjectionService {
	var memoryService *MemoryService
	if len(memoryServices) > 0 {
		memoryService = memoryServices[0]
	}
	return &AtelierProjectionService{orchestrationService: orchestrationService, memoryService: memoryService}
}

type AtelierProjectionSnapshot struct {
	Version        string                     `json:"version"`
	Workspace      AtelierWorkspaceProjection `json:"workspace"`
	SelectedTaskID string                     `json:"selectedTaskId"`
}

type AtelierWorkspaceProjection struct {
	BudgetSpent float64                         `json:"budgetSpent"`
	BudgetCap   float64                         `json:"budgetCap"`
	Model       string                          `json:"model"`
	Tasks       []AtelierTaskProjection         `json:"tasks"`
	Projects    []AtelierProjectProjection      `json:"projects,omitempty"`
	Streams     map[string][]AtelierBlock       `json:"streams"`
	Todos       map[string][]AtelierTodoItem    `json:"todos"`
	Contexts    map[string]AtelierTaskContext   `json:"contexts"`
	Artifacts   map[string][]AtelierArtifactRef `json:"artifacts"`
	Gates       map[string][]AtelierGateResult  `json:"gates,omitempty"`
	Replay      map[string]AtelierReplayState   `json:"replay,omitempty"`
}

type AtelierReplayState struct {
	Source             string `json:"source"`
	EventCount         int    `json:"eventCount"`
	ReplayedEventCount int    `json:"replayedEventCount"`
	NextEventSeq       int64  `json:"nextEventSeq"`
	HasMore            bool   `json:"hasMore"`
	CheckpointID       string `json:"checkpointId,omitempty"`
	CheckpointEventSeq int64  `json:"checkpointEventSeq,omitempty"`
}

type atelierMaterializedTaskProjection struct {
	TaskID       string
	Streams      []AtelierBlock
	HasStreams   bool
	Todos        []AtelierTodoItem
	HasTodos     bool
	Context      AtelierTaskContext
	HasContext   bool
	Artifacts    []AtelierArtifactRef
	HasArtifacts bool
	Gates        []AtelierGateResult
	HasGates     bool
}

type atelierCheckpointState struct {
	AtelierProjection atelierMaterializedTaskProjectionPayload `json:"atelierProjection"`
}

type atelierMaterializedTaskProjectionPayload struct {
	Version   string               `json:"version"`
	TaskID    string               `json:"taskId"`
	Streams   []AtelierBlock       `json:"streams,omitempty"`
	Todos     []AtelierTodoItem    `json:"todos,omitempty"`
	Context   *AtelierTaskContext  `json:"context,omitempty"`
	Artifacts []AtelierArtifactRef `json:"artifacts,omitempty"`
	Gates     []AtelierGateResult  `json:"gates,omitempty"`
}

type AtelierTaskProjection struct {
	ID                  string                      `json:"id"`
	Project             string                      `json:"project"`
	ProjectID           string                      `json:"projectId,omitempty"`
	Title               string                      `json:"title"`
	Status              string                      `json:"status"`
	Running             bool                        `json:"running,omitempty"`
	Branch              string                      `json:"branch,omitempty"`
	IntentPreset        string                      `json:"intentPreset,omitempty"`
	ProviderStrategy    string                      `json:"providerStrategyPreset,omitempty"`
	GatePlanPreset      string                      `json:"gatePlanPreset,omitempty"`
	WorkspaceOpenTarget *AtelierWorkspaceOpenTarget `json:"workspaceOpenTarget,omitempty"`
}

type AtelierProjectProjection struct {
	ID               string                      `json:"id"`
	Goal             string                      `json:"goal"`
	Title            string                      `json:"title"`
	State            string                      `json:"state"`
	WorkspaceRef     string                      `json:"workspaceRef"`
	TraceRoot        string                      `json:"traceRoot,omitempty"`
	GoalOwnerSignoff bool                        `json:"goalOwnerSignoff"`
	ResidualRisks    []AtelierResidualRisk       `json:"residualRisks"`
	OpenBlockers     []AtelierProjectBlocker     `json:"openBlockers"`
	MemoryCandidates []AtelierMemoryCandidateRef `json:"memoryCandidates"`
	Completion       AtelierProjectCompletion    `json:"completion"`
	MilestoneTree    AtelierMilestoneTree        `json:"milestoneTree"`
	TaskGraph        AtelierTaskGraph            `json:"taskGraph"`
	Policy           *AtelierPolicyProjection    `json:"policy,omitempty"`
	Defects          []AtelierDefectProjection   `json:"defects"`
}

type AtelierProjectCompletion struct {
	NoOpenBlockers            bool `json:"noOpenBlockers"`
	L0L1AcceptancePassed      bool `json:"l0L1AcceptancePassed"`
	L2HumanSignoffComplete    bool `json:"l2HumanSignoffComplete"`
	ResidualRisksLogged       bool `json:"residualRisksLogged"`
	MemoryCandidatesGenerated bool `json:"memoryCandidatesGenerated"`
}

type AtelierProjectBlocker struct {
	ID          string `json:"id"`
	Owner       string `json:"owner"`
	Severity    string `json:"severity"`
	State       string `json:"state"`
	EvidenceRef string `json:"evidenceRef"`
	Reason      string `json:"reason"`
}

type AtelierResidualRisk struct {
	ID          string `json:"id"`
	Description string `json:"desc"`
	State       string `json:"state"`
	EvidenceRef string `json:"evidenceRef"`
	Owner       string `json:"owner"`
}

type AtelierMemoryCandidateRef struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	Content      string   `json:"content"`
	EvidenceRefs []string `json:"evidenceRefs"`
	Scope        string   `json:"scope"`
	Confirmed    bool     `json:"confirmed"`
	Feeds        []string `json:"feeds"`
}

type AtelierMilestoneTree struct {
	RootID     string                       `json:"rootId"`
	Milestones []AtelierMilestoneProjection `json:"milestones"`
	Edges      []AtelierDependencyEdge      `json:"edges"`
}

type AtelierMilestoneProjection struct {
	ID                     string                  `json:"id"`
	Title                  string                  `json:"title"`
	State                  string                  `json:"state"`
	TaskIDs                []string                `json:"taskIds"`
	AcceptancePredicateIDs []string                `json:"acceptancePredicateIds"`
	OpenBlockers           []AtelierProjectBlocker `json:"openBlockers"`
}

type AtelierTaskGraph struct {
	RootTaskIDs    []string                    `json:"rootTaskIds"`
	Tasks          []AtelierTaskNodeProjection `json:"tasks"`
	Edges          []AtelierDependencyEdge     `json:"edges"`
	ParallelPolicy string                      `json:"parallelPolicy"`
}

type AtelierTaskNodeProjection struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	State       string   `json:"state"`
	AgentRole   string   `json:"agentRole"`
	ArtifactIDs []string `json:"artifactIds"`
	GateIDs     []string `json:"gateIds"`
}

type AtelierDependencyEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"`
}

type AtelierPolicyProjection struct {
	ID       string              `json:"id"`
	Rules    []AtelierPolicyRule `json:"rules"`
	HardDeny bool                `json:"hardDeny"`
}

type AtelierPolicyRule struct {
	ID       string `json:"id"`
	Scope    string `json:"scope"`
	Expr     string `json:"expr"`
	Severity string `json:"severity"`
}

type AtelierDefectProjection struct {
	ID          string                `json:"id"`
	TaskID      string                `json:"taskId"`
	Source      string                `json:"source"`
	State       string                `json:"state"`
	EvidenceRef string                `json:"evidenceRef"`
	Proposal    AtelierDefectProposal `json:"proposal"`
}

type AtelierDefectProposal struct {
	Summary        string   `json:"summary"`
	ExpectedChange string   `json:"expectedChange"`
	TargetRefs     []string `json:"targetRefs"`
}

type AtelierWorkspaceOpenTarget struct {
	WorkspaceID  string `json:"workspaceId"`
	WorkspaceURI string `json:"workspaceUri"`
	Label        string `json:"label"`
	IDEHint      string `json:"ideHint,omitempty"`
}

type AtelierBlock struct {
	Kind           string                  `json:"kind"`
	ID             string                  `json:"id"`
	Text           string                  `json:"text,omitempty"`
	At             string                  `json:"at,omitempty"`
	Done           bool                    `json:"done,omitempty"`
	Summary        string                  `json:"summary,omitempty"`
	AgentCount     int                     `json:"agentCount,omitempty"`
	Converged      *bool                   `json:"converged,omitempty"`
	Voices         []AtelierNegoVoice      `json:"voices,omitempty"`
	Consensus      string                  `json:"consensus,omitempty"`
	Question       string                  `json:"question,omitempty"`
	SpentSoFar     string                  `json:"spentSoFar,omitempty"`
	Options        []AtelierDecisionOption `json:"options,omitempty"`
	RollbackImpact string                  `json:"rollbackImpact,omitempty"`
	Chosen         string                  `json:"chosen,omitempty"`
	Name           string                  `json:"name,omitempty"`
	FileKind       string                  `json:"fileKind,omitempty"`
	ProducedBy     string                  `json:"producedBy,omitempty"`
	Meta           map[string]interface{}  `json:"meta,omitempty"`
}

type AtelierNegoVoice struct {
	Role        string `json:"role"`
	Stance      string `json:"stance"`
	Text        string `json:"text"`
	EvidenceRef string `json:"evidenceRef,omitempty"`
}

type AtelierDecisionOption struct {
	Text        string `json:"text"`
	Recommended bool   `json:"recommended,omitempty"`
}

type AtelierTodoItem struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

type AtelierTaskContext struct {
	UsedPct int                  `json:"usedPct"`
	Files   []AtelierContextFile `json:"files"`
}

type AtelierContextFile struct {
	Name  string `json:"name"`
	Group string `json:"group"`
}

type AtelierArtifactRef struct {
	ID            string                        `json:"id"`
	Name          string                        `json:"name"`
	Kind          string                        `json:"kind"`
	Meta          string                        `json:"meta"`
	PreviewHint   string                        `json:"previewHint,omitempty"`
	BodyRef       string                        `json:"bodyRef,omitempty"`
	BodyHash      string                        `json:"bodyHash,omitempty"`
	BodySize      string                        `json:"bodySize,omitempty"`
	BodyKind      string                        `json:"bodyKind,omitempty"`
	PreviewTarget *AtelierArtifactPreviewTarget `json:"previewTarget,omitempty"`
	Paths         []string                      `json:"paths,omitempty"`
	Size          string                        `json:"size,omitempty"`
}

type AtelierArtifactPreviewTarget struct {
	Kind       string `json:"kind,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Label      string `json:"label,omitempty"`
	SandboxRef string `json:"sandboxRef,omitempty"`
	BodyRef    string `json:"bodyRef,omitempty"`
}

type AtelierGateResult struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Status      string             `json:"status"`
	Summary     string             `json:"summary"`
	Checks      []AtelierGateCheck `json:"checks"`
	ArtifactIDs []string           `json:"artifactIds,omitempty"`
	At          string             `json:"at,omitempty"`
}

type AtelierGateCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type AtelierProjectionEvent struct {
	ID         string                 `json:"id"`
	Seq        int64                  `json:"seq"`
	TaskID     string                 `json:"taskId,omitempty"`
	Patch      AtelierProjectionPatch `json:"patch"`
	ReceivedAt string                 `json:"receivedAt"`
}

type AtelierProjectionPatch struct {
	Kind     string                     `json:"kind"`
	Snapshot *AtelierProjectionSnapshot `json:"snapshot,omitempty"`
	Task     *AtelierTaskProjection     `json:"task,omitempty"`
	Select   bool                       `json:"select,omitempty"`
	TaskID   string                     `json:"taskId,omitempty"`
	BlockID  string                     `json:"blockId,omitempty"`
	Choice   string                     `json:"choice,omitempty"`
	Blocks   []AtelierBlock             `json:"blocks,omitempty"`
	Status   string                     `json:"status,omitempty"`
	Artifact *AtelierArtifactRef        `json:"artifact,omitempty"`
	Gate     *AtelierGateResult         `json:"gate,omitempty"`
}

type atelierProjectPersistence struct {
	ProjectState           string
	MilestoneState         string
	AcceptancePredicates   []atelierAcceptancePredicateRecord
	AcceptancePredicateIDs []string
	Milestones             []atelierMilestoneRecord
	TaskGraph              AtelierTaskGraph
	HasTaskGraph           bool
	Policy                 *AtelierPolicyProjection
	Defects                []AtelierDefectProjection
	Blockers               []AtelierProjectBlocker
	ResidualRisks          []AtelierResidualRisk
}

type atelierAcceptancePredicateRecord struct {
	ID           string
	Level        string
	LastEval     *bool
	HumanSignoff bool
}

type atelierMilestoneRecord struct {
	ID                     string
	Title                  string
	State                  string
	TaskIDs                []string
	AcceptancePredicateIDs []string
}

func (s *AtelierProjectionService) LoadWorkspace(
	ctx context.Context,
	actorPTID string,
	req *LoadAtelierWorkspaceRequest,
) (*AtelierProjectionSnapshot, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		req = &LoadAtelierWorkspaceRequest{}
	}
	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	eventPageSize := req.EventPageSize
	if eventPageSize <= 0 || eventPageSize > 200 {
		eventPageSize = 100
	}

	var taskRecords []persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("goal_owner_ptid = ?", actorPTID).
		Order("created_at DESC").
		Limit(pageSize).
		Find(&taskRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier tasks", err)
	}

	taskIDs := make([]string, 0, len(taskRecords))
	tasks := make([]*model.CollaborationTask, 0, len(taskRecords))
	for i := range taskRecords {
		taskIDs = append(taskIDs, taskRecords[i].ID)
		tasks = append(tasks, taskRecordToProto(&taskRecords[i]))
	}

	nodesByTask, err := loadAtelierNodesByTask(ctx, db, taskIDs)
	if err != nil {
		return nil, err
	}
	checkpointsByTask, err := loadAtelierCheckpointsByTask(ctx, db, taskIDs)
	if err != nil {
		return nil, err
	}
	materializedByTask := loadAtelierMaterializedProjectionsByTask(checkpointsByTask)
	eventsByTask, replayByTask, err := loadAtelierEventsByTask(ctx, db, taskIDs, eventPageSize, checkpointsByTask, materializedByTask)
	if err != nil {
		return nil, err
	}
	projectPersistenceByTask, err := loadAtelierProjectPersistenceByTask(ctx, db, taskIDs)
	if err != nil {
		return nil, err
	}

	snapshot := buildAtelierProjectionSnapshot(tasks, nodesByTask, eventsByTask, replayByTask, materializedByTask, projectPersistenceByTask, req.SelectedTaskID)
	return &snapshot, nil
}

func (s *AtelierProjectionService) CreateProjectFromGoal(
	ctx context.Context,
	actorPTID string,
	req *CreateAtelierProjectFromGoalRequest,
) (*AtelierProjectionSnapshot, error) {
	if err := enforce_canvas_single_agent_readiness(); err != nil {
		return nil, err
	}
	if s.orchestrationService == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration service is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "goal is required", nil)
	}
	agentIDs := compactStrings(append(req.AgentIDs, req.Run.AgentIDs...))
	if len(agentIDs) == 0 {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agentIds is required for Atelier project creation", nil)
	}
	project := atelierFirstNonEmpty(req.Project, "peers-touch")
	runKind, err := validateAtelierRunTarget(req.Run)
	if err != nil {
		return nil, err
	}
	intentPreset, err := normalizeAtelierIntentPreset(req.IntentPreset)
	if err != nil {
		return nil, err
	}
	meta := map[string]string{
		"agent_ids":         mustJSON(agentIDs),
		"atelier_status":    "active",
		"project":           project,
		"source":            "atelier.project.createFromGoal",
		"run_kind":          runKind,
		"run_model":         strings.TrimSpace(req.Run.Model),
		"run_flow_id":       strings.TrimSpace(req.Run.FlowID),
		"desktop_agent_ids": mustJSON(agentIDs),
	}
	for key, value := range atelierIntentPresetMetadata(intentPreset) {
		meta[key] = value
	}
	if runKind == atelierRunKindModel {
		meta["direct_run_intent"] = "station_owned"
		meta["direct_run_provider_id"] = agentIDs[0]
		meta["direct_run_model_intent"] = strings.TrimSpace(req.Run.Model)
		meta["direct_run_state"] = "pending_station_provider_route"
	}
	engineType := model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED
	if runKind == atelierRunKindAgents {
		engineType, err = atelierEngineTypeFromFlowID(req.Run.FlowID)
		if err != nil {
			return nil, err
		}
	}
	task, _, err := s.orchestrationService.CreateCollaborationTask(ctx, actorPTID, &model.CreateCollaborationTaskRequest{
		Title:        goal,
		Description:  goal,
		EngineType:   engineType,
		WorkspaceId:  &project,
		Meta:         meta,
		ProviderPlan: atelierProviderPlanFromCreateRequest(agentIDs, req.Run),
	})
	if err != nil {
		return nil, err
	}
	return s.LoadWorkspace(ctx, actorPTID, &LoadAtelierWorkspaceRequest{SelectedTaskID: task.GetTaskId()})
}

func atelierEngineTypeFromFlowID(flowID string) (model.CollaborationEngineType, error) {
	switch strings.ToLower(strings.TrimSpace(flowID)) {
	case "", "expert-hierarchy", "expert_hierarchy":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY, nil
	case "roundtable":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE, nil
	case "debate-judge", "debate_judge":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE, nil
	case "swarm":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM, nil
	case "hierarchy":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY, nil
	case "expert-mesh", "expert_mesh":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH, nil
	default:
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "run.flowId must be a known Atelier EngineType", nil)
	}
}

func validateAtelierRunTarget(run AtelierRunTargetRequest) (string, error) {
	runKind, err := normalizeAtelierRunKind(run.Kind)
	if err != nil {
		return "", err
	}
	if runKind == atelierRunKindModel {
		if strings.TrimSpace(run.Model) == "" {
			return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "run.model is required for DirectRun model intent", nil)
		}
		if strings.TrimSpace(run.FlowID) != "" {
			return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "run.flowId is not allowed for DirectRun model intent", nil)
		}
		if len(run.AgentIDs) > 0 {
			return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "run.agentIds is not allowed for DirectRun model intent", nil)
		}
	}
	return runKind, nil
}

func normalizeAtelierRunKind(kind string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", atelierRunKindAgents:
		return atelierRunKindAgents, nil
	case atelierRunKindModel:
		return atelierRunKindModel, nil
	default:
		return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "run.kind must be agents or model", nil)
	}
}

func normalizeAtelierIntentPreset(preset string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(preset)) {
	case "", atelierIntentPresetWork:
		return atelierIntentPresetWork, nil
	case atelierIntentPresetCode:
		return atelierIntentPresetCode, nil
	case atelierIntentPresetDesign:
		return atelierIntentPresetDesign, nil
	default:
		return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "intentPreset must be work, code, or design", nil)
	}
}

func atelierIntentPresetMetadata(preset string) map[string]string {
	normalized, err := normalizeAtelierIntentPreset(preset)
	if err != nil {
		normalized = atelierIntentPresetWork
	}
	switch normalized {
	case atelierIntentPresetCode:
		return map[string]string{
			"intent_preset":            atelierIntentPresetCode,
			"provider_strategy_preset": "coding_provider_preferred",
			"gate_plan_preset":         "lint_typecheck_build",
		}
	case atelierIntentPresetDesign:
		return map[string]string{
			"intent_preset":            atelierIntentPresetDesign,
			"provider_strategy_preset": "design_review_preferred",
			"gate_plan_preset":         "prototype_visual_review",
		}
	default:
		return map[string]string{
			"intent_preset":            atelierIntentPresetWork,
			"provider_strategy_preset": "station_generalist_research",
			"gate_plan_preset":         "plan_review_evidence",
		}
	}
}

func atelierProviderPlanFromCreateRequest(agentIDs []string, run AtelierRunTargetRequest) *model.TaskProviderPlan {
	agentIDs = compactStrings(agentIDs)
	runKind, _ := normalizeAtelierRunKind(run.Kind)
	if runKind == atelierRunKindModel && len(agentIDs) > 1 {
		agentIDs = agentIDs[:1]
	}
	providers := make([]*model.TaskProviderSpec, 0, len(agentIDs))
	modelName := strings.TrimSpace(run.Model)
	for index, agentID := range agentIDs {
		providers = append(providers, &model.TaskProviderSpec{
			AgentId: strings.TrimSpace(agentID),
			Model:   modelName,
			Role:    roleForIndex(index),
		})
	}
	source := "atelier.project.createFromGoal"
	if runKind == atelierRunKindModel {
		source = "atelier.direct_run.intent"
	}
	return &model.TaskProviderPlan{
		Providers:          providers,
		SynthesizerAgentId: agentIDs[0],
		Source:             source,
	}
}

func (s *AtelierProjectionService) SendMessage(
	ctx context.Context,
	actorPTID string,
	req *SendAtelierMessageRequest,
) (*AtelierProjectionSnapshot, error) {
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "text is required", nil)
	}

	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorPTID)
	payload := map[string]interface{}{
		"source":         "atelier.message.send",
		"block_kind":     "user",
		"text":           text,
		"result_summary": text,
		"task_id":        taskID,
		"actor_ptid":     actorPTID,
	}
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeAgentTurnCompleted),
		payload,
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "message.send"},
	)
	return s.LoadWorkspace(ctx, actorPTID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) ResolveDecision(
	ctx context.Context,
	actorPTID string,
	req *ResolveAtelierDecisionRequest,
) (*AtelierProjectionSnapshot, error) {
	if err := enforce_canvas_single_agent_readiness(); err != nil {
		return nil, err
	}
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	blockID := strings.TrimSpace(req.BlockID)
	if blockID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "blockId is required", nil)
	}
	choice := strings.TrimSpace(req.Choice)
	if choice == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "choice is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorPTID)
	payload := map[string]interface{}{
		"source":              "atelier.escalation.resolve",
		"block_kind":          "decision_resolved",
		"interrupt_id":        blockID,
		"block_id":            blockID,
		"choice":              choice,
		"task_id":             taskID,
		"actor_ptid":          actorPTID,
		"description":         fmt.Sprintf("用户选择：%s", choice),
		"resume_payload_json": mustJSON(map[string]string{"choice": choice, "block_id": blockID}),
	}
	if _, _, err := s.orchestrationService.ResolveCollaborationInterrupt(
		ctx,
		actorPTID,
		agentID,
		taskID,
		"atelier.escalation.resolve",
		payload,
	); err != nil {
		return nil, err
	}
	return s.LoadWorkspace(ctx, actorPTID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) SetTaskStatus(
	ctx context.Context,
	actorPTID string,
	req *SetAtelierTaskStatusRequest,
) (*AtelierProjectionSnapshot, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	status := normalizeAtelierTaskStatus(req.Status)
	if status != strings.TrimSpace(req.Status) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "status must be active, archived, or deleted", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	meta := decodeStringMap(task.MetaJSON)
	meta["atelier_status"] = status
	nextMeta, _ := json.Marshal(meta)

	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	if err := db.WithContext(ctx).
		Model(&persistence.CollaborationTask{}).
		Where("id = ? AND goal_owner_ptid = ?", taskID, actorPTID).
		Update("meta_json", string(nextMeta)).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update Atelier task status", err)
	}
	return s.LoadWorkspace(ctx, actorPTID, &LoadAtelierWorkspaceRequest{SelectedTaskID: taskID})
}

func (s *AtelierProjectionService) PurgeTask(
	ctx context.Context,
	actorPTID string,
	req *PurgeAtelierTaskRequest,
) (*AtelierProjectionSnapshot, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	if normalizeAtelierTaskStatus(decodeStringMap(task.MetaJSON)["atelier_status"]) != "deleted" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task must be deleted before purge", nil)
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return purgeAtelierTaskRecordsTx(ctx, tx, actorPTID, taskID)
	}); err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to purge Atelier task", err)
	}
	return s.LoadWorkspace(ctx, actorPTID, &LoadAtelierWorkspaceRequest{})
}

func (s *AtelierProjectionService) ProviderCapabilities(
	ctx context.Context,
	actorPTID string,
	req *ListAtelierProviderCapabilitiesRequest,
) (*AtelierProviderCapabilitiesResponse, error) {
	if strings.TrimSpace(actorPTID) == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if err := s.recordAtelierFullE2EProviderRuntimeEvidence(ctx, actorPTID, req); err != nil {
		return nil, err
	}
	return &AtelierProviderCapabilitiesResponse{
		Source: "station.provider.capabilities",
		Capabilities: []AtelierProviderCapability{
			{
				ID:           "provider.capability.implement",
				Label:        "Implement",
				Description:  "Ask Station orchestration to plan and implement through the configured coding provider.",
				SlashCommand: "/implement",
				ProviderKind: "coding",
				Scope:        "station-provider",
				ReadOnly:     true,
			},
			{
				ID:           "provider.capability.review",
				Label:        "Review",
				Description:  "Ask Station orchestration to review the selected task context with evidence.",
				SlashCommand: "/review",
				ProviderKind: "verifier",
				Scope:        "station-provider",
				ReadOnly:     true,
			},
			{
				ID:           "provider.capability.test",
				Label:        "Test",
				Description:  "Ask Station orchestration to derive and run the task-owned verification plan.",
				SlashCommand: "/test",
				ProviderKind: "verifier",
				Scope:        "station-provider",
				ReadOnly:     true,
			},
		},
	}, nil
}

func (s *AtelierProjectionService) recordAtelierFullE2EProviderRuntimeEvidence(
	ctx context.Context,
	actorPTID string,
	req *ListAtelierProviderCapabilitiesRequest,
) error {
	outputPath := strings.TrimSpace(os.Getenv(atelierFullE2EProviderRuntimeEvidenceEnv))
	if outputPath == "" {
		return nil
	}
	if req == nil {
		return nil
	}
	launchID := strings.TrimSpace(req.FullE2ELaunchID)
	sessionID := strings.TrimSpace(req.FullE2ESessionID)
	providerProfileRef := strings.TrimSpace(req.FullE2EProviderProfileRef)
	if launchID == "" || sessionID == "" || providerProfileRef == "" {
		return nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	run, ok, err := loadAtelierFullE2EProviderRuntimeRun(ctx, db, actorPTID, req.TaskID)
	if err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to inspect Atelier provider runtime evidence", err)
	}
	if !ok {
		return nil
	}
	evidence, ok, err := buildAtelierFullE2EProviderRuntimeEvidence(ctx, db, run, launchID, sessionID, providerProfileRef)
	if err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to build Atelier provider runtime evidence", err)
	}
	if !ok {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create Atelier provider runtime evidence directory", err)
	}
	document, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to encode Atelier provider runtime evidence", err)
	}
	if err := os.WriteFile(outputPath, append(document, '\n'), 0o644); err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to write Atelier provider runtime evidence", err)
	}
	return nil
}

func loadAtelierFullE2EProviderRuntimeRun(
	ctx context.Context,
	db *gorm.DB,
	actorPTID string,
	taskID string,
) (*persistence.DirectRun, bool, error) {
	query := db.WithContext(ctx).
		Table("agent_direct_runs").
		Select("agent_direct_runs.*").
		Joins("JOIN agent_collaboration_tasks ON agent_collaboration_tasks.id = agent_direct_runs.task_id").
		Where("agent_collaboration_tasks.goal_owner_ptid = ?", strings.TrimSpace(actorPTID)).
		Where("agent_direct_runs.state = ?", "succeeded").
		Where("agent_direct_runs.source = ?", collaborationProviderPlanSourceDirectRun)
	if strings.TrimSpace(taskID) != "" {
		query = query.Where("agent_direct_runs.task_id = ?", strings.TrimSpace(taskID))
	}
	var run persistence.DirectRun
	if err := query.Order("agent_direct_runs.updated_at DESC, agent_direct_runs.direct_run_id DESC").First(&run).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, false, nil
		}
		return nil, false, err
	}
	return &run, true, nil
}

func buildAtelierFullE2EProviderRuntimeEvidence(
	ctx context.Context,
	db *gorm.DB,
	run *persistence.DirectRun,
	launchID string,
	sessionID string,
	providerProfileRef string,
) (map[string]interface{}, bool, error) {
	if db == nil || run == nil ||
		strings.TrimSpace(run.DirectRunID) == "" ||
		strings.TrimSpace(run.TaskID) == "" ||
		strings.TrimSpace(run.ProviderID) == "" ||
		strings.TrimSpace(run.ModelIntent) == "" ||
		strings.TrimSpace(run.TraceID) == "" {
		return nil, false, nil
	}
	directRunEvidence, err := buildAtelierDirectRunExecutionEvidence(ctx, db, run.TaskID)
	if err != nil {
		return nil, false, err
	}
	var matched *AtelierDirectRunExecutionEvidence
	for index := range directRunEvidence {
		if directRunEvidence[index].DirectRunID == strings.TrimSpace(run.DirectRunID) {
			matched = &directRunEvidence[index]
			break
		}
	}
	if matched == nil ||
		matched.State != "succeeded" ||
		len(matched.ArtifactRefs) == 0 ||
		len(matched.GateRefs) == 0 ||
		matched.BudgetUsage.Tokens <= 0 ||
		strings.TrimSpace(matched.TraceID) == "" {
		return nil, false, nil
	}
	streamed, err := atelierDirectRunStreamedProviderResponse(ctx, db, run.TaskID, run.DirectRunID)
	if err != nil || !streamed {
		return nil, false, err
	}
	checkpointed, err := atelierDirectRunHasCheckpoint(ctx, db, run.TaskID)
	if err != nil || !checkpointed {
		return nil, false, err
	}
	return map[string]interface{}{
		"ok":                                 true,
		"launchId":                           strings.TrimSpace(launchID),
		"appletId":                           "peers.atelier",
		"sessionId":                          strings.TrimSpace(sessionID),
		"owner":                              "station",
		"scope":                              "production-provider-runtime",
		"providerProfileRefRedacted":         true,
		"providerProfileRefHash":             atelierSHA256Hash(providerProfileRef),
		"providerRuntimeProven":              true,
		"providerModelQualityProven":         true,
		"streamingReplyUXProven":             true,
		"artifactPersistenceProven":          true,
		"traceCheckpointResumeProven":        true,
		"appletProviderInvokeExposed":        false,
		"appletRuntimeExecuteExposed":        false,
		"appletArtifactWriteExposed":         false,
		"appletTraceCheckpointResumeExposed": false,
		"directRunId":                        strings.TrimSpace(run.DirectRunID),
		"taskId":                             strings.TrimSpace(run.TaskID),
		"providerId":                         strings.TrimSpace(run.ProviderID),
		"modelIntent":                        strings.TrimSpace(run.ModelIntent),
		"traceId":                            strings.TrimSpace(run.TraceID),
		"artifactRefs":                       matched.ArtifactRefs,
		"gateRefs":                           matched.GateRefs,
		"budgetUsage":                        matched.BudgetUsage,
		"evidenceSource":                     "station.direct_run.persisted_facts",
		"completedAt":                        time.Now().UTC().Format(time.RFC3339),
	}, true, nil
}

func atelierDirectRunStreamedProviderResponse(ctx context.Context, db *gorm.DB, taskID string, directRunID string) (bool, error) {
	var artifacts []persistence.TaskArtifact
	if err := db.WithContext(ctx).
		Where("task_id = ? AND produced_by = ?", strings.TrimSpace(taskID), "station.direct_run").
		Find(&artifacts).Error; err != nil {
		return false, err
	}
	for _, artifact := range artifacts {
		if !artifactRefsDirectRun(artifact, directRunID) {
			continue
		}
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
			continue
		}
		if streamed, ok := payload["streamed"].(bool); ok && streamed {
			return true, nil
		}
	}
	return false, nil
}

func atelierDirectRunHasCheckpoint(ctx context.Context, db *gorm.DB, taskID string) (bool, error) {
	var count int64
	if err := db.WithContext(ctx).
		Model(&persistence.TaskCheckpoint{}).
		Where("task_id = ?", strings.TrimSpace(taskID)).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *AtelierProjectionService) SubmitFeedback(
	ctx context.Context,
	actorPTID string,
	req *SubmitAtelierFeedbackRequest,
) (*SubmitAtelierFeedbackResponse, error) {
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	blockID := strings.TrimSpace(req.BlockID)
	if blockID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "blockId is required", nil)
	}
	signal := normalizeAtelierFeedbackSignal(req.Signal)
	if signal == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "signal must be positive, negative, copy, or regenerate", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorPTID)
	feedbackID := generateID("feedback")
	memoryStatus, memoryReason, memoryFeeds := atelierFeedbackMemoryCandidatePolicy(signal)
	memoryRequiresConfirmation := memoryStatus == "candidate"
	memoryConfirmationMode := "not_required"
	if memoryRequiresConfirmation {
		memoryConfirmationMode = "station_memory_review"
	}
	rerunStatus, rerunReason := atelierFeedbackRerunPolicy(signal)
	rerunRequiresConfirmation := rerunStatus == "intent_recorded"
	rerunConfirmationMode := "not_required"
	if rerunRequiresConfirmation {
		rerunConfirmationMode = "station_rerun_review"
	}
	payload := map[string]interface{}{
		"source":                       "atelier.feedback.submit",
		"block_kind":                   "feedback",
		"feedback_id":                  feedbackID,
		"task_id":                      taskID,
		"block_id":                     blockID,
		"signal":                       signal,
		"comment":                      strings.TrimSpace(req.Comment),
		"actor_ptid":                   actorPTID,
		"memory_candidate_status":      memoryStatus,
		"memory_candidate_reason":      memoryReason,
		"memory_candidate_feeds":       memoryFeeds,
		"memory_confirmation_required": memoryRequiresConfirmation,
		"memory_confirmation_mode":     memoryConfirmationMode,
		"rerun_intent_status":          rerunStatus,
		"rerun_intent_reason":          rerunReason,
		"rerun_confirmation_required":  rerunRequiresConfirmation,
		"rerun_confirmation_mode":      rerunConfirmationMode,
	}
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeCollaborationFeedbackRecorded),
		payload,
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "feedback.submit"},
	)
	return &SubmitAtelierFeedbackResponse{
		Accepted:   true,
		FeedbackID: feedbackID,
		MemoryCandidate: AtelierFeedbackPolicyHint{
			Status:               memoryStatus,
			Reason:               memoryReason,
			RequiresConfirmation: memoryRequiresConfirmation,
			ConfirmationMode:     memoryConfirmationMode,
			Feeds:                memoryFeeds,
		},
		RerunIntent: AtelierFeedbackPolicyHint{
			Status:               rerunStatus,
			Reason:               rerunReason,
			RequiresConfirmation: rerunRequiresConfirmation,
			ConfirmationMode:     rerunConfirmationMode,
			Feeds:                []string{},
		},
	}, nil
}

func (s *AtelierProjectionService) ConfirmMemoryCandidate(
	ctx context.Context,
	actorPTID string,
	req *ConfirmAtelierMemoryCandidateRequest,
) (*ConfirmAtelierMemoryCandidateResponse, error) {
	if s.memoryService == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "memory service is not configured", nil)
	}
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	feedbackID := strings.TrimSpace(req.FeedbackID)
	if feedbackID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "feedbackId is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	payload, err := loadAtelierFeedbackCandidatePayload(ctx, db, taskID, feedbackID)
	if err != nil {
		return nil, err
	}
	if atelierStringValue(payload, "memory_candidate_status") != "candidate" ||
		atelierStringValue(payload, "memory_confirmation_mode") != "station_memory_review" ||
		!atelierBoolValue(payload, "memory_confirmation_required") {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "feedback is not a confirmable memory candidate", nil)
	}
	var existing persistence.Memory
	if err := db.WithContext(ctx).
		Where("agent_id = ? AND source_turn_id = ? AND source = ?", actorPTID, feedbackID, domain.MemorySourceReview).
		First(&existing).Error; err == nil {
		return &ConfirmAtelierMemoryCandidateResponse{
			Accepted:    true,
			FeedbackID:  feedbackID,
			MemoryID:    existing.ID,
			Status:      "confirmed",
			Source:      "station_memory_review",
			Target:      existing.Target,
			Layer:       existing.Layer,
			AlreadyDone: true,
		}, nil
	} else if err != gorm.ErrRecordNotFound {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to query confirmed memory candidate", err)
	}
	content := atelierMemoryCandidateContent(task, payload)
	memory, err := s.memoryService.AddMemory(ctx, domain.MemoryItem{
		AgentID:      actorPTID,
		Target:       domain.MemoryTargetMemory,
		Layer:        domain.MemoryLayerExperience,
		Content:      content,
		SourceTurnID: feedbackID,
		Source:       domain.MemorySourceReview,
		Summary:      summarizeMemoryContent(content),
		TrustScore:   domain.MemoryReviewInitialTrustScore,
	})
	if err != nil {
		return nil, err
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorPTID)
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeCollaborationFeedbackRecorded),
		map[string]interface{}{
			"source":                           "atelier.memory.confirmCandidate",
			"block_kind":                       "memory_candidate_confirmed",
			"task_id":                          taskID,
			"feedback_id":                      feedbackID,
			"actor_ptid":                       actorPTID,
			"memory_id":                        memory.MemoryID,
			"memory_candidate_status":          "confirmed",
			"memory_confirmation_required":     false,
			"memory_confirmation_mode":         "station_memory_review",
			"memory_confirmation_source":       "station_owned_review",
			"memory_confirmation_target":       memory.Target,
			"memory_confirmation_layer":        string(memory.Layer),
			"memory_confirmation_already_done": false,
		},
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "memory.confirmCandidate"},
	)
	return &ConfirmAtelierMemoryCandidateResponse{
		Accepted:    true,
		FeedbackID:  feedbackID,
		MemoryID:    memory.MemoryID,
		Status:      "confirmed",
		Source:      "station_memory_review",
		Target:      memory.Target,
		Layer:       string(memory.Layer),
		AlreadyDone: false,
	}, nil
}

func (s *AtelierProjectionService) ConfirmRerun(
	ctx context.Context,
	actorPTID string,
	req *ConfirmAtelierRerunRequest,
) (*ConfirmAtelierRerunResponse, error) {
	if err := enforce_canvas_single_agent_readiness(); err != nil {
		return nil, err
	}
	return s.confirmRerunAfterCanvasReadiness(ctx, actorID, req)
}

func (s *AtelierProjectionService) confirmRerunAfterCanvasReadiness(
	ctx context.Context,
	actorID string,
	req *ConfirmAtelierRerunRequest,
) (*ConfirmAtelierRerunResponse, error) {
	if s.orchestrationService == nil || s.orchestrationService.eventWriter == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration event writer is not configured", nil)
	}
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	feedbackID := strings.TrimSpace(req.FeedbackID)
	if feedbackID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "feedbackId is required", nil)
	}
	task, err := loadOwnedAtelierTask(ctx, actorPTID, taskID)
	if err != nil {
		return nil, err
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	payload, err := loadAtelierFeedbackCandidatePayload(ctx, db, taskID, feedbackID)
	if err != nil {
		return nil, err
	}
	if atelierStringValue(payload, "rerun_intent_status") != "intent_recorded" ||
		atelierStringValue(payload, "rerun_confirmation_mode") != "station_rerun_review" ||
		!atelierBoolValue(payload, "rerun_confirmation_required") {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "feedback is not a confirmable rerun intent", nil)
	}
	if confirmed, ok, err := loadAtelierRerunConfirmationPayload(ctx, db, taskID, feedbackID); err != nil {
		return nil, err
	} else if ok {
		rerunTaskID := atelierStringValue(confirmed, "rerun_task_id")
		return &ConfirmAtelierRerunResponse{
			Accepted:    true,
			FeedbackID:  feedbackID,
			TaskID:      taskID,
			RerunTaskID: rerunTaskID,
			Status:      "confirmed",
			Source:      "station_rerun_review",
			AlreadyDone: true,
			Started:     atelierBoolValue(confirmed, "rerun_started"),
		}, nil
	}
	rerunTask, _, started, err := s.orchestrationService.createConfirmedFeedbackRerun(ctx, db, actorPTID, task, feedbackID, payload)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create Atelier rerun task", err)
	}
	agentID := atelierFirstNonEmpty(firstAgentID(taskRecordToProto(task).GetMeta()), actorPTID)
	s.orchestrationService.eventWriter.Publish(
		ctx,
		agentID,
		string(domain.EventTypeCollaborationFeedbackRecorded),
		map[string]interface{}{
			"source":                        "atelier.feedback.confirmRerun",
			"block_kind":                    "rerun_confirmed",
			"task_id":                       taskID,
			"feedback_id":                   feedbackID,
			"actor_ptid":                    actorPTID,
			"rerun_task_id":                 rerunTask.ID,
			"rerun_intent_status":           "confirmed",
			"rerun_confirmation_required":   false,
			"rerun_confirmation_mode":       "station_rerun_review",
			"rerun_confirmation_source":     "station_owned_review",
			"rerun_source_block_id":         atelierStringValue(payload, "block_id"),
			"rerun_source_signal":           atelierStringValue(payload, "signal"),
			"rerun_started":                 started,
			"rerun_already_done":            false,
			"rerun_original_task_status":    task.Status,
			"rerun_original_task_workspace": task.WorkspaceID,
		},
		taskID,
		"",
		"",
		map[string]string{"atelier_source": "feedback.confirmRerun"},
	)
	return &ConfirmAtelierRerunResponse{
		Accepted:    true,
		FeedbackID:  feedbackID,
		TaskID:      taskID,
		RerunTaskID: rerunTask.ID,
		Status:      "confirmed",
		Source:      "station_rerun_review",
		AlreadyDone: false,
		Started:     started,
	}, nil
}

func (s *OrchestrationService) createConfirmedFeedbackRerun(
	ctx context.Context,
	db *gorm.DB,
	actorPTID string,
	sourceTask *persistence.CollaborationTask,
	feedbackID string,
	feedbackPayload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, bool, error) {
	if s == nil || db == nil || sourceTask == nil {
		return persistence.CollaborationTask{}, nil, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "orchestration service is not configured", nil)
	}
	var rerunTask persistence.CollaborationTask
	var rerunNodes []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		rerunTask, rerunNodes, txErr = cloneAtelierFeedbackRerunTaskTx(ctx, tx, actorPTID, sourceTask, feedbackID, feedbackPayload)
		return txErr
	}); err != nil {
		return persistence.CollaborationTask{}, nil, false, err
	}
	taskProto := taskRecordToProto(&rerunTask)
	nodeProtos := nodeRecordsToProto(rerunNodes)
	s.publishTaskCreated(ctx, taskProto, nodeProtos)
	started := s.agentService != nil && s.turnService != nil
	if started {
		s.startTaskExecution(actorPTID, rerunTask, rerunNodes, "atelier-feedback-rerun")
	}
	return rerunTask, rerunNodes, started, nil
}

func cloneAtelierFeedbackRerunTaskTx(
	ctx context.Context,
	tx *gorm.DB,
	actorPTID string,
	sourceTask *persistence.CollaborationTask,
	feedbackID string,
	feedbackPayload map[string]interface{},
) (persistence.CollaborationTask, []persistence.CollaborationTaskNode, error) {
	var locked persistence.CollaborationTask
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND goal_owner_ptid = ?", sourceTask.ID, strings.TrimSpace(actorPTID)).
		First(&locked).Error; err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(locked.MetaJSON), &meta)
	providerPlan, agentIDs, err := atelierRerunProviderPlanTx(ctx, tx, locked.ID, meta)
	if err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	synthesizerAgentID := selectSynthesizerAgentID(meta, agentIDs)
	if planSynthesizerAgentID := strings.TrimSpace(providerPlan.GetSynthesizerAgentId()); planSynthesizerAgentID != "" {
		synthesizerAgentID = planSynthesizerAgentID
	}
	providerPlan.SynthesizerAgentId = synthesizerAgentID
	rerunMeta := copyStringMap(meta)
	rerunMeta["source"] = "atelier.feedback.confirmRerun"
	rerunMeta["atelier_status"] = "active"
	rerunMeta["rerun_source_task_id"] = locked.ID
	rerunMeta["rerun_source_feedback_id"] = strings.TrimSpace(feedbackID)
	rerunMeta["rerun_source_block_id"] = atelierStringValue(feedbackPayload, "block_id")
	rerunMeta["rerun_source_signal"] = atelierStringValue(feedbackPayload, "signal")
	rerunMeta["rerun_requested_by"] = strings.TrimSpace(actorPTID)
	rerunMeta["rerun_confirmed_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	rerunMeta["agent_ids"] = mustJSONString(agentIDs)
	rerunMeta["desktop_agent_ids"] = mustJSONString(agentIDs)
	if err := applyCollaborationPlanConstraints(rerunMeta, model.CollaborationEngineType(locked.EngineType), providerPlan, locked.WorkspaceID); err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	now := time.Now()
	metaJSON, _ := json.Marshal(rerunMeta)
	rerunTask := persistence.CollaborationTask{
		ID:            generateID("collab"),
		Title:         locked.Title,
		Description:   locked.Description,
		EngineType:    locked.EngineType,
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: strings.TrimSpace(actorPTID),
		WorkspaceID:   locked.WorkspaceID,
		BudgetTokens:  locked.BudgetTokens,
		BudgetMoney:   locked.BudgetMoney,
		BudgetTimeMs:  locked.BudgetTimeMs,
		MetaJSON:      string(metaJSON),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := buildCollaborationTaskNodes(
		rerunTask.ID,
		rerunTask.Description,
		model.CollaborationEngineType(rerunTask.EngineType),
		agentIDs,
		synthesizerAgentID,
		providerPlan,
		now,
	)
	providerPlanRecord, err := taskProviderPlanRecordFromProto(rerunTask.ID, providerPlan, now)
	if err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	if err := tx.WithContext(ctx).Create(&rerunTask).Error; err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	if err := tx.WithContext(ctx).Create(providerPlanRecord).Error; err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	if err := tx.WithContext(ctx).Create(&nodes).Error; err != nil {
		return persistence.CollaborationTask{}, nil, err
	}
	return rerunTask, nodes, nil
}

func atelierRerunProviderPlanTx(ctx context.Context, tx *gorm.DB, taskID string, meta map[string]string) (*model.TaskProviderPlan, []string, error) {
	var record persistence.TaskProviderPlan
	if err := tx.WithContext(ctx).
		Where("task_id = ? AND status = ?", strings.TrimSpace(taskID), "active").
		Order("updated_at DESC, created_at DESC").
		First(&record).Error; err == nil {
		var plan model.TaskProviderPlan
		if unmarshalErr := protojson.Unmarshal([]byte(record.PlanJSON), &plan); unmarshalErr != nil {
			return nil, nil, unmarshalErr
		}
		cloned := cloneProviderPlan(&plan)
		cloned.Source = "atelier.feedback.confirmRerun"
		agentIDs := providerPlanAgentIDs(cloned)
		if len(agentIDs) == 0 {
			return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider plan has no agents", nil)
		}
		return cloned, agentIDs, nil
	} else if err != gorm.ErrRecordNotFound {
		return nil, nil, err
	}
	agentIDs := compactStrings(parseMetaList(meta["agent_ids"]))
	if len(agentIDs) == 0 {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "rerun requires provider plan or meta.agent_ids", nil)
	}
	plan := legacyProviderPlanFromMeta(agentIDs, meta)
	plan.Source = "atelier.feedback.confirmRerun"
	return plan, agentIDs, nil
}

func (s *AtelierProjectionService) FetchArtifactBody(
	ctx context.Context,
	actorPTID string,
	req *FetchAtelierArtifactBodyRequest,
) (*FetchAtelierArtifactBodyResponse, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "request is required", nil)
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "taskId is required", nil)
	}
	artifactID := strings.TrimSpace(req.ArtifactID)
	if artifactID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifactId is required", nil)
	}
	bodyRef := strings.TrimSpace(req.BodyRef)
	if bodyRef == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "bodyRef is required", nil)
	}
	canonicalBodyRef := atelierArtifactBodyRef(taskID, artifactID)
	if bodyRef != canonicalBodyRef {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "bodyRef must match artifact://<taskId>/<artifactId>/body", nil)
	}
	if _, err := loadOwnedAtelierTask(ctx, actorPTID, taskID); err != nil {
		return nil, err
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	var artifact persistence.TaskArtifact
	if err := db.WithContext(ctx).
		Where("task_id = ? AND artifact_id = ?", taskID, artifactID).
		First(&artifact).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "Atelier artifact not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load Atelier artifact", err)
	}
	var blob persistence.TaskArtifactBlob
	if err := db.WithContext(ctx).
		Where("task_id = ? AND artifact_id = ? AND body_uri = ?", taskID, artifactID, bodyRef).
		First(&blob).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "Atelier artifact body not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load Atelier artifact body", err)
	}
	if strings.TrimSpace(blob.RetentionStatus) != "active" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusGone, "Atelier artifact body is not active", nil)
	}
	if blob.ExpiresAt != nil && !blob.ExpiresAt.After(time.Now().UTC()) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusGone, "Atelier artifact body is expired", nil)
	}
	bodyKind := strings.TrimSpace(blob.BodyKind)
	if !isAtelierFetchableArtifactBodyKind(bodyKind) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact body kind is not fetchable as text", nil)
	}
	bodyHash := strings.TrimSpace(blob.ContentHash)
	actualHash := atelierArtifactBodyHash(blob.BodyText)
	if bodyHash != "" && bodyHash != actualHash {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "artifact body hash mismatch", nil)
	}
	if expectedHash := strings.TrimSpace(req.ExpectedHash); expectedHash != "" && expectedHash != actualHash {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "expectedHash does not match artifact body", nil)
	}
	maxBytes := req.MaxBytes
	if maxBytes <= 0 || maxBytes > atelierArtifactBodyFetchDefaultMaxBytes {
		maxBytes = atelierArtifactBodyFetchDefaultMaxBytes
	}
	text, truncated := truncateUTF8Bytes(blob.BodyText, maxBytes)
	return &FetchAtelierArtifactBodyResponse{
		TaskID:          taskID,
		ArtifactID:      artifactID,
		BodyRef:         bodyRef,
		BodyKind:        bodyKind,
		BodyHash:        actualHash,
		BodySize:        int64(len([]byte(blob.BodyText))),
		Text:            text,
		Truncated:       truncated,
		RetentionStatus: strings.TrimSpace(blob.RetentionStatus),
	}, nil
}

func buildAtelierDirectRunExecutionEvidence(ctx context.Context, db *gorm.DB, taskID string) ([]AtelierDirectRunExecutionEvidence, error) {
	taskID = strings.TrimSpace(taskID)
	if db == nil || taskID == "" {
		return nil, nil
	}
	var runs []persistence.DirectRun
	if err := db.WithContext(ctx).
		Where("task_id = ?", taskID).
		Order("created_at ASC, direct_run_id ASC").
		Find(&runs).Error; err != nil {
		return nil, err
	}
	evidence := make([]AtelierDirectRunExecutionEvidence, 0, len(runs))
	for _, run := range runs {
		artifactRefs, failureArtifactRef, err := loadAtelierDirectRunArtifactRefs(ctx, db, taskID, run.DirectRunID)
		if err != nil {
			return nil, err
		}
		gateRefs, err := loadAtelierDirectRunGateRefs(ctx, db, taskID)
		if err != nil {
			return nil, err
		}
		budgetUsage, err := loadAtelierDirectRunBudgetUsage(ctx, db, taskID, run.DirectRunID, run.BudgetRef)
		if err != nil {
			return nil, err
		}
		evidence = append(evidence, AtelierDirectRunExecutionEvidence{
			DirectRunID:        strings.TrimSpace(run.DirectRunID),
			TaskID:             strings.TrimSpace(run.TaskID),
			ProviderID:         strings.TrimSpace(run.ProviderID),
			ModelIntent:        strings.TrimSpace(run.ModelIntent),
			State:              strings.TrimSpace(run.State),
			TraceID:            strings.TrimSpace(run.TraceID),
			ArtifactRefs:       artifactRefs,
			GateRefs:           gateRefs,
			BudgetUsage:        budgetUsage,
			FailureArtifactRef: failureArtifactRef,
			CliHandoffRef:      nil,
		})
	}
	return evidence, nil
}

func loadAtelierDirectRunArtifactRefs(ctx context.Context, db *gorm.DB, taskID string, directRunID string) ([]string, *string, error) {
	var artifacts []persistence.TaskArtifact
	if err := db.WithContext(ctx).
		Where("task_id = ? AND produced_by = ?", taskID, "station.direct_run").
		Order("created_at ASC, artifact_id ASC").
		Find(&artifacts).Error; err != nil {
		return nil, nil, err
	}
	refs := make([]string, 0, len(artifacts))
	var failureRef *string
	for _, artifact := range artifacts {
		if !artifactRefsDirectRun(artifact, directRunID) {
			continue
		}
		ref := firstNonEmptyString(strings.TrimSpace(artifact.URI), stationArtifactURI(taskID, artifact.ArtifactID))
		if ref == "" {
			continue
		}
		refs = append(refs, ref)
		if failureRef == nil && strings.Contains(strings.ToLower(strings.TrimSpace(artifact.Kind)), "failure") {
			captured := ref
			failureRef = &captured
		}
	}
	sort.Strings(refs)
	return refs, failureRef, nil
}

func artifactRefsDirectRun(artifact persistence.TaskArtifact, directRunID string) bool {
	directRunID = strings.TrimSpace(directRunID)
	if directRunID == "" {
		return false
	}
	if strings.TrimSpace(artifact.RunID) == directRunID {
		return true
	}
	var refs []string
	if err := json.Unmarshal([]byte(artifact.RefsJSON), &refs); err != nil {
		return false
	}
	for _, ref := range refs {
		if strings.TrimSpace(ref) == directRunID {
			return true
		}
	}
	return false
}

func loadAtelierDirectRunGateRefs(ctx context.Context, db *gorm.DB, taskID string) ([]string, error) {
	var gates []persistence.TaskGateResult
	if err := db.WithContext(ctx).
		Where("task_id = ? AND produced_by = ?", taskID, "station.direct_run").
		Order("created_at ASC, gate_result_id ASC").
		Find(&gates).Error; err != nil {
		return nil, err
	}
	refs := make([]string, 0, len(gates))
	for _, gate := range gates {
		gateID := strings.TrimSpace(gate.GateID)
		if gateID == "" {
			gateID = strings.TrimSpace(gate.GateResultID)
		}
		if gateID != "" {
			refs = append(refs, fmt.Sprintf("gate://%s/%s", taskID, gateID))
		}
	}
	sort.Strings(refs)
	return refs, nil
}

func loadAtelierDirectRunBudgetUsage(ctx context.Context, db *gorm.DB, taskID string, directRunID string, budgetRef string) (AtelierDirectRunBudgetUsage, error) {
	var usages []persistence.TaskBudgetUsage
	if err := db.WithContext(ctx).
		Where("task_id = ? AND direct_run_id = ?", taskID, directRunID).
		Find(&usages).Error; err != nil {
		return AtelierDirectRunBudgetUsage{}, err
	}
	usage := AtelierDirectRunBudgetUsage{
		Source:    "station_budget_ledger_projection",
		BudgetRef: strings.TrimSpace(budgetRef),
	}
	for _, item := range usages {
		usage.Tokens += item.TotalTokens
		usage.MoneyUSD += item.UsedMoney
		if usage.PricingRef == "" {
			usage.PricingRef = strings.TrimSpace(item.PricingSource)
		}
	}
	return usage, nil
}

func purgeAtelierTaskRecordsTx(ctx context.Context, tx *gorm.DB, actorPTID string, taskID string) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id is required", nil)
	}
	for _, deleteOp := range []func() error{
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskArtifactBlob{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskGateResult{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskArtifact{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskBudgetUsage{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskProviderPlan{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.DirectRun{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskGatePlan{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.InterruptRequest{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierTaskGraphEdge{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierTaskGraphNode{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierMilestone{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierPolicyRule{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierPolicy{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierDefect{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.ProjectState{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AcceptancePredicate{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.ProjectResidualRisk{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.ProjectBlocker{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.TaskEvent{}).Error
		},
		func() error {
			return tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.CollaborationTaskNode{}).Error
		},
	} {
		if err := deleteOp(); err != nil {
			return err
		}
	}
	return tx.WithContext(ctx).Where("id = ? AND goal_owner_ptid = ?", taskID, strings.TrimSpace(actorPTID)).Delete(&persistence.CollaborationTask{}).Error
}

func BuildAtelierProjectionSnapshot(
	tasks []*model.CollaborationTask,
	nodesByTask map[string][]*model.TaskNode,
	eventsByTask map[string][]*model.TaskEvent,
	replayByTask map[string]AtelierReplayState,
	selectedTaskID string,
) AtelierProjectionSnapshot {
	return buildAtelierProjectionSnapshot(tasks, nodesByTask, eventsByTask, replayByTask, nil, nil, selectedTaskID)
}

func buildAtelierProjectionSnapshot(
	tasks []*model.CollaborationTask,
	nodesByTask map[string][]*model.TaskNode,
	eventsByTask map[string][]*model.TaskEvent,
	replayByTask map[string]AtelierReplayState,
	materializedByTask map[string]atelierMaterializedTaskProjection,
	projectPersistenceByTask map[string]atelierProjectPersistence,
	selectedTaskID string,
) AtelierProjectionSnapshot {
	workspace := AtelierWorkspaceProjection{
		Model:     "openrouter-3o",
		Tasks:     make([]AtelierTaskProjection, 0, len(tasks)),
		Streams:   map[string][]AtelierBlock{},
		Todos:     map[string][]AtelierTodoItem{},
		Contexts:  map[string]AtelierTaskContext{},
		Artifacts: map[string][]AtelierArtifactRef{},
		Gates:     map[string][]AtelierGateResult{},
		Replay:    map[string]AtelierReplayState{},
	}

	for _, task := range tasks {
		if task == nil {
			continue
		}
		projectedTask := projectCollaborationTask(task)
		workspace.Tasks = append(workspace.Tasks, projectedTask)
		workspace.Projects = append(workspace.Projects, projectAtelierProject(task, nodesByTask[task.GetTaskId()], eventsByTask[task.GetTaskId()], projectPersistenceByTask[task.GetTaskId()]))
		workspace.BudgetCap += task.GetBudgetMoney()

		taskID := task.GetTaskId()
		nodes := nodesByTask[taskID]
		events := eventsByTask[taskID]
		materialized, hasMaterialized := materializedByTask[taskID]
		workspace.Todos[taskID] = projectTaskNodesToTodos(nodes)
		if hasMaterialized && materialized.HasTodos {
			workspace.Todos[taskID] = cloneAtelierTodos(materialized.Todos)
		}
		workspace.Contexts[taskID] = AtelierTaskContext{UsedPct: estimateContextUse(nodes, events), Files: []AtelierContextFile{}}
		if hasMaterialized && materialized.HasContext {
			workspace.Contexts[taskID] = materialized.Context
		}
		workspace.Artifacts[taskID] = projectTaskEventsToArtifacts(events)
		if hasMaterialized && materialized.HasArtifacts {
			workspace.Artifacts[taskID] = foldAtelierArtifacts(materialized.Artifacts, events)
		}
		workspace.Gates[taskID] = projectTaskEventsToGates(events)
		if hasMaterialized && materialized.HasGates {
			workspace.Gates[taskID] = foldAtelierGates(materialized.Gates, events)
		}
		workspace.Streams[taskID] = buildTaskStream(task, nodes, events)
		if hasMaterialized && materialized.HasStreams {
			workspace.Streams[taskID] = foldAtelierStream(materialized.Streams, events)
		}
		if replay, ok := replayByTask[taskID]; ok {
			workspace.Replay[taskID] = replay
		}
	}

	if strings.TrimSpace(selectedTaskID) == "" && len(workspace.Tasks) > 0 {
		selectedTaskID = workspace.Tasks[0].ID
	}

	return AtelierProjectionSnapshot{
		Version:        atelierProjectionVersion,
		Workspace:      workspace,
		SelectedTaskID: selectedTaskID,
	}
}

func BuildAtelierProjectionEvent(event *model.TaskEvent) (AtelierProjectionEvent, bool) {
	if event == nil {
		return AtelierProjectionEvent{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if artifact, ok := projectTaskEventToArtifact(event); ok {
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:     "artifact.upsert",
				TaskID:   event.GetTaskId(),
				Artifact: &artifact,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	if gate, ok := projectTaskEventToGate(event); ok {
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:   "gate.upsert",
				TaskID: event.GetTaskId(),
				Gate:   &gate,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	if atelierStringValue(payload, "block_kind") == "decision_resolved" {
		blockID := atelierFirstNonEmpty(
			atelierStringValue(payload, "block_id"),
			atelierStringValue(payload, "blockId"),
			atelierStringValue(payload, "interrupt_id"),
			atelierStringValue(payload, "interruptId"),
		)
		choice := atelierStringValue(payload, "choice")
		if blockID == "" || choice == "" {
			return AtelierProjectionEvent{}, false
		}
		return AtelierProjectionEvent{
			ID:     event.GetEventId(),
			Seq:    event.GetEventSeq(),
			TaskID: event.GetTaskId(),
			Patch: AtelierProjectionPatch{
				Kind:    "decision.resolved",
				TaskID:  event.GetTaskId(),
				BlockID: blockID,
				Choice:  choice,
			},
			ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
		}, true
	}
	block := projectTaskEventToBlock(event)
	if block.ID == "" {
		return AtelierProjectionEvent{}, false
	}
	return AtelierProjectionEvent{
		ID:     event.GetEventId(),
		Seq:    event.GetEventSeq(),
		TaskID: event.GetTaskId(),
		Patch: AtelierProjectionPatch{
			Kind:   "stream.append",
			TaskID: event.GetTaskId(),
			Blocks: []AtelierBlock{block},
		},
		ReceivedAt: timestampRFC3339(event.GetCreatedAt()),
	}, true
}

func loadAtelierNodesByTask(ctx context.Context, db *gorm.DB, taskIDs []string) (map[string][]*model.TaskNode, error) {
	result := map[string][]*model.TaskNode{}
	if len(taskIDs) == 0 {
		return result, nil
	}
	var records []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("started_at ASC").
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task nodes", err)
	}
	for i := range records {
		node := &model.TaskNode{
			NodeId:              records[i].ID,
			TaskId:              records[i].TaskID,
			ParentNodeId:        records[i].ParentNodeID,
			AgentId:             records[i].AgentID,
			Role:                records[i].Role,
			Description:         records[i].Description,
			Status:              model.TaskNodeStatus(records[i].Status),
			PrerequisiteNodeIds: parseMetaList(records[i].PrerequisiteNodeIDs),
			ResultSummary:       records[i].ResultSummary,
			StartedAt:           timestamppb.New(records[i].StartedAt),
			EndedAt:             timestamppb.New(records[i].EndedAt),
		}
		result[node.GetTaskId()] = append(result[node.GetTaskId()], node)
	}
	return result, nil
}

func loadAtelierProjectPersistenceByTask(ctx context.Context, db *gorm.DB, taskIDs []string) (map[string]atelierProjectPersistence, error) {
	result := map[string]atelierProjectPersistence{}
	if len(taskIDs) == 0 {
		return result, nil
	}
	var stateRecords []persistence.ProjectState
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, updated_at ASC").
		Find(&stateRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier project states", err)
	}
	for i := range stateRecords {
		record := stateRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.ProjectState = strings.TrimSpace(record.ProjectState)
		projectRecords.MilestoneState = strings.TrimSpace(record.MilestoneState)
		result[record.TaskID] = projectRecords
	}
	var predicateRecords []persistence.AcceptancePredicate
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&predicateRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier acceptance predicates", err)
	}
	for i := range predicateRecords {
		record := predicateRecords[i]
		projectRecords := result[record.TaskID]
		predicateID := strings.TrimSpace(record.PredicateID)
		projectRecords.AcceptancePredicates = append(projectRecords.AcceptancePredicates, atelierAcceptancePredicateRecord{
			ID:           predicateID,
			Level:        strings.ToUpper(strings.TrimSpace(record.Level)),
			LastEval:     record.LastEval,
			HumanSignoff: record.HumanSignoff,
		})
		projectRecords.AcceptancePredicateIDs = appendAtelierUniqueString(projectRecords.AcceptancePredicateIDs, predicateID)
		result[record.TaskID] = projectRecords
	}
	var milestoneRecords []persistence.AtelierMilestone
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&milestoneRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier milestones", err)
	}
	for i := range milestoneRecords {
		record := milestoneRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.Milestones = append(projectRecords.Milestones, atelierMilestoneRecord{
			ID:                     strings.TrimSpace(record.MilestoneID),
			Title:                  atelierFirstNonEmpty(record.Title, "Root milestone"),
			State:                  strings.TrimSpace(record.State),
			TaskIDs:                atelierJSONStrings(record.TaskIDsJSON),
			AcceptancePredicateIDs: atelierJSONStrings(record.AcceptancePredicateIDsJSON),
		})
		result[record.TaskID] = projectRecords
	}
	var taskGraphNodeRecords []persistence.AtelierTaskGraphNode
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC, node_id ASC").
		Find(&taskGraphNodeRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task graph nodes", err)
	}
	for i := range taskGraphNodeRecords {
		record := taskGraphNodeRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.HasTaskGraph = true
		projectRecords.TaskGraph.Tasks = append(projectRecords.TaskGraph.Tasks, AtelierTaskNodeProjection{
			ID:          strings.TrimSpace(record.NodeID),
			Title:       atelierFirstNonEmpty(record.Title, record.NodeID),
			State:       atelierFirstNonEmpty(record.State, "todo"),
			AgentRole:   strings.ToLower(strings.TrimSpace(record.AgentRole)),
			ArtifactIDs: atelierJSONStrings(record.ArtifactIDsJSON),
			GateIDs:     atelierJSONStrings(record.GateIDsJSON),
		})
		result[record.TaskID] = projectRecords
	}
	var taskGraphEdgeRecords []persistence.AtelierTaskGraphEdge
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC, edge_id ASC").
		Find(&taskGraphEdgeRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task graph edges", err)
	}
	for i := range taskGraphEdgeRecords {
		record := taskGraphEdgeRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.HasTaskGraph = true
		projectRecords.TaskGraph.Edges = append(projectRecords.TaskGraph.Edges, AtelierDependencyEdge{
			From: strings.TrimSpace(record.FromID),
			To:   strings.TrimSpace(record.ToID),
			Type: atelierFirstNonEmpty(record.Type, "blocks"),
		})
		result[record.TaskID] = projectRecords
	}
	for taskID, projectRecords := range result {
		if projectRecords.HasTaskGraph {
			hasPrerequisite := map[string]struct{}{}
			for _, edge := range projectRecords.TaskGraph.Edges {
				if strings.TrimSpace(edge.To) != "" {
					hasPrerequisite[edge.To] = struct{}{}
				}
			}
			for _, node := range projectRecords.TaskGraph.Tasks {
				if _, ok := hasPrerequisite[node.ID]; !ok {
					projectRecords.TaskGraph.RootTaskIDs = appendAtelierUniqueString(projectRecords.TaskGraph.RootTaskIDs, node.ID)
				}
			}
			if len(projectRecords.TaskGraph.RootTaskIDs) == 0 {
				projectRecords.TaskGraph.RootTaskIDs = append(projectRecords.TaskGraph.RootTaskIDs, taskID)
			}
			projectRecords.TaskGraph.ParallelPolicy = "serial_only"
			result[taskID] = projectRecords
		}
	}
	var policyRecords []persistence.AtelierPolicy
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&policyRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier policies", err)
	}
	policyIDs := make([]string, 0, len(policyRecords))
	for i := range policyRecords {
		record := policyRecords[i]
		policyID := strings.TrimSpace(record.PolicyID)
		if policyID == "" {
			continue
		}
		policyIDs = appendAtelierUniqueString(policyIDs, policyID)
		projectRecords := result[record.TaskID]
		projectRecords.Policy = &AtelierPolicyProjection{
			ID:       policyID,
			Rules:    []AtelierPolicyRule{},
			HardDeny: record.HardDeny,
		}
		result[record.TaskID] = projectRecords
	}
	if len(policyIDs) > 0 {
		var ruleRecords []persistence.AtelierPolicyRule
		if err := db.WithContext(ctx).
			Where("policy_id IN ?", policyIDs).
			Order("source_event_seq ASC, created_at ASC, rule_id ASC").
			Find(&ruleRecords).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier policy rules", err)
		}
		for i := range ruleRecords {
			record := ruleRecords[i]
			projectRecords := result[record.TaskID]
			if projectRecords.Policy == nil || projectRecords.Policy.ID != strings.TrimSpace(record.PolicyID) {
				continue
			}
			projectRecords.Policy.Rules = append(projectRecords.Policy.Rules, AtelierPolicyRule{
				ID:       strings.TrimSpace(record.RuleID),
				Scope:    atelierFirstNonEmpty(record.Scope, "project"),
				Expr:     strings.TrimSpace(record.Expr),
				Severity: atelierFirstNonEmpty(record.Severity, "block"),
			})
			result[record.TaskID] = projectRecords
		}
	}
	var defectRecords []persistence.AtelierDefect
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&defectRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier defects", err)
	}
	for i := range defectRecords {
		record := defectRecords[i]
		projectRecords := result[record.TaskID]
		summary := atelierFirstNonEmpty(record.Summary, "gate reported a defect")
		evidenceRef := atelierFirstNonEmpty(record.EvidenceRef, record.SourceEventID, record.DefectID)
		targetRefs := atelierJSONStrings(record.TargetRefsJSON)
		if len(targetRefs) == 0 {
			targetRefs = []string{evidenceRef}
		}
		projectRecords.Defects = append(projectRecords.Defects, AtelierDefectProjection{
			ID:          strings.TrimSpace(record.DefectID),
			TaskID:      record.TaskID,
			Source:      normalizeAtelierDefectSource(record.Source),
			State:       normalizeAtelierDefectState(record.State),
			EvidenceRef: evidenceRef,
			Proposal: AtelierDefectProposal{
				Summary:        summary,
				ExpectedChange: atelierFirstNonEmpty(record.ExpectedChange, summary),
				TargetRefs:     targetRefs,
			},
		})
		result[record.TaskID] = projectRecords
	}
	var blockerRecords []persistence.ProjectBlocker
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&blockerRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier project blockers", err)
	}
	for i := range blockerRecords {
		record := blockerRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.Blockers = append(projectRecords.Blockers, AtelierProjectBlocker{
			ID:          strings.TrimSpace(record.BlockerID),
			Owner:       atelierFirstNonEmpty(record.Owner, "verifier"),
			Severity:    atelierFirstNonEmpty(record.Severity, "block"),
			State:       atelierFirstNonEmpty(record.State, "open"),
			EvidenceRef: strings.TrimSpace(record.EvidenceRef),
			Reason:      atelierFirstNonEmpty(record.Reason, "blocking gate failed"),
		})
		result[record.TaskID] = projectRecords
	}
	var riskRecords []persistence.ProjectResidualRisk
	if err := db.WithContext(ctx).
		Where("task_id IN ?", taskIDs).
		Order("source_event_seq ASC, created_at ASC").
		Find(&riskRecords).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier residual risks", err)
	}
	for i := range riskRecords {
		record := riskRecords[i]
		projectRecords := result[record.TaskID]
		projectRecords.ResidualRisks = append(projectRecords.ResidualRisks, AtelierResidualRisk{
			ID:          strings.TrimSpace(record.RiskID),
			Description: atelierFirstNonEmpty(record.Description, "residual risk recorded"),
			State:       atelierFirstNonEmpty(record.State, "logged"),
			EvidenceRef: strings.TrimSpace(record.EvidenceRef),
			Owner:       atelierFirstNonEmpty(record.Owner, "risk"),
		})
		result[record.TaskID] = projectRecords
	}
	return result, nil
}

func loadOwnedAtelierTask(ctx context.Context, actorPTID, taskID string) (*persistence.CollaborationTask, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	var task persistence.CollaborationTask
	if err := db.WithContext(ctx).
		Where("id = ? AND goal_owner_ptid = ?", taskID, actorPTID).
		First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "Atelier task not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get Atelier task", err)
	}
	return &task, nil
}

func loadAtelierCheckpointsByTask(ctx context.Context, db *gorm.DB, taskIDs []string) (map[string]*persistence.TaskCheckpoint, error) {
	result := map[string]*persistence.TaskCheckpoint{}
	if len(taskIDs) == 0 {
		return result, nil
	}
	for _, taskID := range taskIDs {
		var checkpoint persistence.TaskCheckpoint
		if err := db.WithContext(ctx).
			Where("task_id = ?", taskID).
			Order("event_seq DESC, created_at DESC").
			First(&checkpoint).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				continue
			}
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load Atelier task checkpoint", err)
		}
		result[taskID] = &checkpoint
	}
	return result, nil
}

func loadAtelierMaterializedProjectionsByTask(checkpointsByTask map[string]*persistence.TaskCheckpoint) map[string]atelierMaterializedTaskProjection {
	result := map[string]atelierMaterializedTaskProjection{}
	for taskID, checkpoint := range checkpointsByTask {
		materialized, ok := parseAtelierMaterializedTaskProjection(checkpoint)
		if !ok {
			continue
		}
		if strings.TrimSpace(materialized.TaskID) != "" && materialized.TaskID != taskID {
			continue
		}
		result[taskID] = materialized
	}
	return result
}

func parseAtelierMaterializedTaskProjection(checkpoint *persistence.TaskCheckpoint) (atelierMaterializedTaskProjection, bool) {
	if checkpoint == nil || strings.TrimSpace(checkpoint.StateJSON) == "" {
		return atelierMaterializedTaskProjection{}, false
	}
	return parseAtelierMaterializedTaskProjectionRaw([]byte(checkpoint.StateJSON))
}

func parseAtelierMaterializedTaskProjectionRaw(raw []byte) (atelierMaterializedTaskProjection, bool) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return atelierMaterializedTaskProjection{}, false
	}
	if nested, ok := firstRawMessage(fields, "atelierProjection", "projection"); ok {
		return parseAtelierMaterializedTaskProjectionRaw(nested)
	}

	materialized := atelierMaterializedTaskProjection{}
	var version string
	if decodeRawField(fields, &version, "version") && version != "" && version != atelierProjectionVersion {
		return atelierMaterializedTaskProjection{}, false
	}
	_ = decodeRawField(fields, &materialized.TaskID, "taskId", "task_id")
	materialized.HasStreams = decodeRawField(fields, &materialized.Streams, "stream", "streams", "blocks")
	materialized.HasTodos = decodeRawField(fields, &materialized.Todos, "todos")
	materialized.HasContext = decodeRawField(fields, &materialized.Context, "context")
	materialized.HasArtifacts = decodeRawField(fields, &materialized.Artifacts, "artifacts")
	materialized.HasGates = decodeRawField(fields, &materialized.Gates, "gates")
	if !materialized.HasStreams && !materialized.HasTodos && !materialized.HasContext && !materialized.HasArtifacts && !materialized.HasGates {
		return atelierMaterializedTaskProjection{}, false
	}
	return materialized, true
}

func firstRawMessage(fields map[string]json.RawMessage, keys ...string) (json.RawMessage, bool) {
	for _, key := range keys {
		if raw, ok := fields[key]; ok && len(raw) > 0 && string(raw) != "null" {
			return raw, true
		}
	}
	return nil, false
}

func decodeRawField(fields map[string]json.RawMessage, target interface{}, keys ...string) bool {
	raw, ok := firstRawMessage(fields, keys...)
	if !ok {
		return false
	}
	return json.Unmarshal(raw, target) == nil
}

func buildAtelierCheckpointStateJSON(taskID string, nodes []*model.TaskNode, events []*model.TaskEvent) string {
	state := buildAtelierCheckpointState(taskID, nodes, events)
	raw, err := json.Marshal(state)
	if err != nil {
		return ""
	}
	return string(raw)
}

func buildChatTaskCheckpointStateJSONTx(tx *gorm.DB, taskID string, checkpointEventSeq int64) (string, error) {
	events, err := loadAtelierCheckpointEventsTx(tx, taskID, checkpointEventSeq)
	if err != nil {
		return "", err
	}
	return buildAtelierCheckpointStateJSON(taskID, nil, events), nil
}

func loadAtelierCheckpointEventsTx(tx *gorm.DB, taskID string, checkpointEventSeq int64) ([]*model.TaskEvent, error) {
	if tx == nil || strings.TrimSpace(taskID) == "" || checkpointEventSeq <= 0 {
		return []*model.TaskEvent{}, nil
	}
	var records []persistence.TaskEvent
	if err := tx.
		Where("task_id = ? AND event_seq <= ?", taskID, checkpointEventSeq).
		Order("event_seq ASC, created_at ASC").
		Find(&records).Error; err != nil {
		return nil, err
	}
	events := make([]*model.TaskEvent, 0, len(records))
	for i := range records {
		events = append(events, taskEventRecordToProto(&records[i]))
	}
	return events, nil
}

func buildAtelierCheckpointState(taskID string, nodes []*model.TaskNode, events []*model.TaskEvent) atelierCheckpointState {
	taskID = strings.TrimSpace(taskID)
	context := AtelierTaskContext{UsedPct: estimateContextUse(nodes, events), Files: []AtelierContextFile{}}
	return atelierCheckpointState{
		AtelierProjection: atelierMaterializedTaskProjectionPayload{
			Version:   atelierProjectionVersion,
			TaskID:    taskID,
			Streams:   foldAtelierStream(nil, events),
			Todos:     projectTaskNodesToTodos(nodes),
			Context:   &context,
			Artifacts: foldAtelierArtifacts(nil, events),
			Gates:     foldAtelierGates(nil, events),
		},
	}
}

func loadAtelierEventsByTask(
	ctx context.Context,
	db *gorm.DB,
	taskIDs []string,
	perTaskLimit int,
	checkpointsByTask map[string]*persistence.TaskCheckpoint,
	materializedByTask map[string]atelierMaterializedTaskProjection,
) (map[string][]*model.TaskEvent, map[string]AtelierReplayState, error) {
	result := map[string][]*model.TaskEvent{}
	replay := map[string]AtelierReplayState{}
	if len(taskIDs) == 0 {
		return result, replay, nil
	}
	if perTaskLimit <= 0 {
		perTaskLimit = 100
	}
	headLimit := perTaskLimit / 3
	if headLimit < 20 {
		headLimit = 20
	}
	for _, taskID := range taskIDs {
		var total int64
		if err := db.WithContext(ctx).
			Model(&persistence.TaskEvent{}).
			Where("task_id = ?", taskID).
			Count(&total).Error; err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count Atelier task events", err)
		}
		checkpoint := checkpointsByTask[taskID]
		_, hasMaterialized := materializedByTask[taskID]
		afterCheckpoint := int64(0)
		eventQuery := func() *gorm.DB {
			query := db.WithContext(ctx).Where("task_id = ?", taskID)
			if hasMaterialized && checkpoint != nil {
				query = query.Where("event_seq > ?", checkpoint.EventSeq)
			}
			return query
		}
		if hasMaterialized && checkpoint != nil {
			if err := db.WithContext(ctx).
				Model(&persistence.TaskEvent{}).
				Where("task_id = ? AND event_seq > ?", taskID, checkpoint.EventSeq).
				Count(&afterCheckpoint).Error; err != nil {
				return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count Atelier post-checkpoint events", err)
			}
		} else {
			afterCheckpoint = total
		}

		var head []persistence.TaskEvent
		if err := eventQuery().
			Order("event_seq ASC").
			Limit(headLimit).
			Find(&head).Error; err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier task events", err)
		}

		var tail []persistence.TaskEvent
		if err := eventQuery().
			Order("event_seq DESC").
			Limit(perTaskLimit).
			Find(&tail).Error; err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier latest task events", err)
		}

		var anchors []persistence.TaskEvent
		if err := eventQuery().
			Where(
				"payload LIKE ? OR payload LIKE ? OR payload LIKE ?",
				`%"block_kind":"artifact"%`,
				`%"block_kind":"gate_result"%`,
				`%"block_kind":"decision_resolved"%`,
			).
			Order("event_seq ASC").
			Find(&anchors).Error; err != nil {
			return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list Atelier projection replay anchors", err)
		}

		events := mergeAtelierProjectionReplayRecords(head, tail, anchors)
		result[taskID] = events
		replay[taskID] = buildAtelierReplayStateWithWindow(events, int(total), checkpoint, hasMaterialized, int(afterCheckpoint))
	}
	return result, replay, nil
}

func buildAtelierReplayState(
	events []*model.TaskEvent,
	totalEventCount int,
	checkpoint *persistence.TaskCheckpoint,
) AtelierReplayState {
	return buildAtelierReplayStateWithWindow(events, totalEventCount, checkpoint, false, totalEventCount)
}

func buildAtelierReplayStateWithWindow(
	events []*model.TaskEvent,
	totalEventCount int,
	checkpoint *persistence.TaskCheckpoint,
	materialized bool,
	windowEventCount int,
) AtelierReplayState {
	nextEventSeq := int64(0)
	for _, event := range events {
		if event.GetEventSeq() > nextEventSeq {
			nextEventSeq = event.GetEventSeq()
		}
	}
	replayedEventCount := len(events)
	hasMore := totalEventCount > len(events)
	if materialized && checkpoint != nil {
		foldedBeforeCheckpoint := totalEventCount - windowEventCount
		if foldedBeforeCheckpoint < 0 {
			foldedBeforeCheckpoint = 0
		}
		replayedEventCount = foldedBeforeCheckpoint + len(events)
		hasMore = windowEventCount > len(events)
	}
	state := AtelierReplayState{
		Source:             "event-window",
		EventCount:         totalEventCount,
		ReplayedEventCount: replayedEventCount,
		NextEventSeq:       nextEventSeq,
		HasMore:            hasMore,
	}
	if checkpoint != nil {
		state.Source = "checkpoint-anchor+event-window"
		if materialized {
			state.Source = "checkpoint-materialized+event-window"
		}
		state.CheckpointID = checkpoint.CheckpointID
		state.CheckpointEventSeq = checkpoint.EventSeq
		if checkpoint.EventSeq > state.NextEventSeq {
			state.NextEventSeq = checkpoint.EventSeq
		}
	}
	return state
}

func mergeAtelierProjectionReplayRecords(groups ...[]persistence.TaskEvent) []*model.TaskEvent {
	byKey := map[string]persistence.TaskEvent{}
	for _, group := range groups {
		for i := range group {
			record := group[i]
			key := strings.TrimSpace(record.ID)
			if key == "" {
				key = fmt.Sprintf("%s:%d", record.TaskID, record.EventSeq)
			}
			byKey[key] = record
		}
	}
	records := make([]persistence.TaskEvent, 0, len(byKey))
	for _, record := range byKey {
		records = append(records, record)
	}
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].EventSeq == records[j].EventSeq {
			return records[i].CreatedAt.Before(records[j].CreatedAt)
		}
		return records[i].EventSeq < records[j].EventSeq
	})
	events := make([]*model.TaskEvent, 0, len(records))
	for i := range records {
		events = append(events, taskEventRecordToProto(&records[i]))
	}
	return events
}

func projectCollaborationTask(task *model.CollaborationTask) AtelierTaskProjection {
	meta := task.GetMeta()
	workspaceID := atelierFirstNonEmpty(task.GetWorkspaceId(), meta["workspace_id"], meta["project"], "peers-touch")
	projectID := atelierFirstNonEmpty(meta["project_id"], task.GetTaskId())
	return AtelierTaskProjection{
		ID:                  task.GetTaskId(),
		Project:             atelierFirstNonEmpty(meta["project"], task.GetWorkspaceId(), "peers-touch"),
		ProjectID:           projectID,
		Title:               atelierFirstNonEmpty(task.GetTitle(), "Untitled task"),
		Status:              normalizeAtelierTaskStatus(meta["atelier_status"]),
		Running:             isCollaborationTaskRunning(task.GetStatus()),
		Branch:              meta["branch"],
		IntentPreset:        meta["intent_preset"],
		ProviderStrategy:    meta["provider_strategy_preset"],
		GatePlanPreset:      meta["gate_plan_preset"],
		WorkspaceOpenTarget: atelierWorkspaceOpenTarget(task.GetTaskId(), workspaceID, meta),
	}
}

func projectAtelierProject(task *model.CollaborationTask, nodes []*model.TaskNode, events []*model.TaskEvent, persisted atelierProjectPersistence) AtelierProjectProjection {
	meta := task.GetMeta()
	projectID := atelierFirstNonEmpty(meta["project_id"], task.GetTaskId())
	workspaceID := atelierFirstNonEmpty(task.GetWorkspaceId(), meta["workspace_id"], meta["project"], "peers-touch")
	taskGraph := projectAtelierTaskGraph(task, nodes, events, meta)
	if persisted.HasTaskGraph {
		taskGraph = persisted.TaskGraph
		taskGraph.ParallelPolicy = atelierFirstNonEmpty(taskGraph.ParallelPolicy, meta["task_graph_parallel_policy"], "serial_only")
	}
	completion := projectAtelierCompletion(task, events, meta, persisted)
	projectState := projectAtelierProjectState(task, completion, meta, persisted.ProjectState)
	blockers := persisted.Blockers
	if len(blockers) == 0 {
		blockers = projectAtelierOpenBlockers(events)
	}
	residualRisks := persisted.ResidualRisks
	if len(residualRisks) == 0 {
		residualRisks = projectAtelierResidualRisks(events)
	}
	policy := persisted.Policy
	if policy == nil {
		policy = projectAtelierPolicy(meta)
	}
	defects := persisted.Defects
	if len(defects) == 0 {
		defects = projectAtelierDefects(events)
	}
	return AtelierProjectProjection{
		ID:               projectID,
		Goal:             atelierFirstNonEmpty(task.GetDescription(), task.GetTitle()),
		Title:            atelierFirstNonEmpty(task.GetTitle(), "Untitled task"),
		State:            projectState,
		WorkspaceRef:     workspaceID,
		TraceRoot:        meta["trace_root"],
		GoalOwnerSignoff: meta["goal_owner_signoff"] == "true",
		ResidualRisks:    residualRisks,
		OpenBlockers:     blockers,
		MemoryCandidates: projectAtelierMemoryCandidates(events),
		Completion:       completion,
		MilestoneTree:    projectAtelierMilestoneTree(task, taskGraph, completion, projectState, blockers, persisted.MilestoneState, persisted.AcceptancePredicateIDs, persisted.Milestones),
		TaskGraph:        taskGraph,
		Policy:           policy,
		Defects:          defects,
	}
}

func projectAtelierTaskGraph(task *model.CollaborationTask, nodes []*model.TaskNode, events []*model.TaskEvent, meta map[string]string) AtelierTaskGraph {
	projectedNodes := make([]AtelierTaskNodeProjection, 0, len(nodes))
	edges := []AtelierDependencyEdge{}
	rootIDs := []string{}
	hasPrerequisite := map[string]struct{}{}
	refsByNode := projectAtelierTaskGraphRefsByNode(events)
	for _, node := range nodes {
		if node == nil {
			continue
		}
		refs := refsByNode[node.GetNodeId()]
		artifactIDs := refs.artifactIDs
		if artifactIDs == nil {
			artifactIDs = []string{}
		}
		gateIDs := refs.gateIDs
		if gateIDs == nil {
			gateIDs = []string{}
		}
		for _, prerequisiteID := range node.GetPrerequisiteNodeIds() {
			prerequisiteID = strings.TrimSpace(prerequisiteID)
			if prerequisiteID == "" {
				continue
			}
			edges = append(edges, AtelierDependencyEdge{From: prerequisiteID, To: node.GetNodeId(), Type: "blocks"})
			hasPrerequisite[node.GetNodeId()] = struct{}{}
		}
		projectedNodes = append(projectedNodes, AtelierTaskNodeProjection{
			ID:          node.GetNodeId(),
			Title:       atelierFirstNonEmpty(node.GetDescription(), node.GetNodeId()),
			State:       todoStatusForNode(node.GetStatus()),
			AgentRole:   strings.ToLower(strings.TrimSpace(node.GetRole())),
			ArtifactIDs: artifactIDs,
			GateIDs:     gateIDs,
		})
	}
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if _, ok := hasPrerequisite[node.GetNodeId()]; !ok {
			rootIDs = append(rootIDs, node.GetNodeId())
		}
	}
	if len(rootIDs) == 0 && strings.TrimSpace(task.GetTaskId()) != "" {
		rootIDs = append(rootIDs, task.GetTaskId())
	}
	return AtelierTaskGraph{
		RootTaskIDs:    rootIDs,
		Tasks:          projectedNodes,
		Edges:          edges,
		ParallelPolicy: atelierFirstNonEmpty(meta["task_graph_parallel_policy"], "serial_only"),
	}
}

type atelierTaskGraphNodeRefs struct {
	artifactIDs []string
	gateIDs     []string
}

func projectAtelierTaskGraphRefsByNode(events []*model.TaskEvent) map[string]atelierTaskGraphNodeRefs {
	refsByNode := map[string]atelierTaskGraphNodeRefs{}
	for _, event := range events {
		if event == nil {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		nodeID := atelierFirstNonEmpty(
			atelierStringValue(payload, "node_id"),
			atelierStringValue(payload, "nodeId"),
			atelierStringValue(payload, "task_node_id"),
			atelierStringValue(payload, "taskNodeId"),
		)
		if nodeID == "" {
			continue
		}
		refs := refsByNode[nodeID]
		switch atelierStringValue(payload, "block_kind") {
		case "artifact":
			artifactID := atelierFirstNonEmpty(atelierStringValue(payload, "artifact_id"), atelierStringValue(payload, "artifactId"), event.GetEventId())
			refs.artifactIDs = appendAtelierUniqueString(refs.artifactIDs, artifactID)
		case "gate_result":
			gateID := atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"), event.GetEventId())
			refs.gateIDs = appendAtelierUniqueString(refs.gateIDs, gateID)
			for _, artifactID := range atelierStringList(payload, "artifact_ids", "artifactIds") {
				refs.artifactIDs = appendAtelierUniqueString(refs.artifactIDs, artifactID)
			}
		}
		refsByNode[nodeID] = refs
	}
	return refsByNode
}

func appendAtelierUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func atelierAcceptancePredicateIDsOrDefault(taskID string, values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = appendAtelierUniqueString(result, value)
	}
	if len(result) > 0 {
		return result
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return []string{"acceptance.no_open_blockers"}
	}
	return []string{fmt.Sprintf("%s.acceptance.no_open_blockers", taskID)}
}

func projectAtelierMilestoneTree(task *model.CollaborationTask, taskGraph AtelierTaskGraph, completion AtelierProjectCompletion, projectState string, blockers []AtelierProjectBlocker, persistedMilestoneState string, acceptancePredicateIDs []string, persistedMilestones []atelierMilestoneRecord) AtelierMilestoneTree {
	if len(persistedMilestones) > 0 {
		milestones := make([]AtelierMilestoneProjection, 0, len(persistedMilestones))
		for _, record := range persistedMilestones {
			recordAcceptancePredicateIDs := atelierAcceptancePredicateIDsOrDefault(task.GetTaskId(), record.AcceptancePredicateIDs)
			milestones = append(milestones, AtelierMilestoneProjection{
				ID:                     record.ID,
				Title:                  atelierFirstNonEmpty(record.Title, "Root milestone"),
				State:                  projectAtelierMilestoneState(task, taskGraph, completion, projectState, record.State),
				TaskIDs:                record.TaskIDs,
				AcceptancePredicateIDs: recordAcceptancePredicateIDs,
				OpenBlockers:           blockers,
			})
		}
		rootID := milestones[0].ID
		return AtelierMilestoneTree{
			RootID:     rootID,
			Milestones: milestones,
			Edges:      []AtelierDependencyEdge{},
		}
	}
	milestoneID := fmt.Sprintf("%s-milestone-root", task.GetTaskId())
	taskIDs := make([]string, 0, len(taskGraph.Tasks))
	for _, node := range taskGraph.Tasks {
		taskIDs = append(taskIDs, node.ID)
	}
	if len(taskIDs) == 0 {
		taskIDs = append(taskIDs, task.GetTaskId())
	}
	acceptancePredicateIDs = atelierAcceptancePredicateIDsOrDefault(task.GetTaskId(), acceptancePredicateIDs)
	return AtelierMilestoneTree{
		RootID: milestoneID,
		Milestones: []AtelierMilestoneProjection{{
			ID:                     milestoneID,
			Title:                  atelierFirstNonEmpty(task.GetTitle(), "Root milestone"),
			State:                  projectAtelierMilestoneState(task, taskGraph, completion, projectState, persistedMilestoneState),
			TaskIDs:                taskIDs,
			AcceptancePredicateIDs: acceptancePredicateIDs,
			OpenBlockers:           blockers,
		}},
		Edges: []AtelierDependencyEdge{},
	}
}

func projectAtelierProjectState(task *model.CollaborationTask, completion AtelierProjectCompletion, meta map[string]string, persistedProjectState string) string {
	if state, ok := normalizeAtelierProjectState(persistedProjectState); ok {
		return state
	}
	if state, ok := normalizeAtelierProjectState(atelierFirstNonEmpty(meta["project_state"], meta["projectState"])); ok {
		return state
	}
	if !completion.NoOpenBlockers {
		return "blocked"
	}
	switch task.GetStatus() {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING:
		if atelierGoalOwnerSignoffComplete(task, nil, meta) {
			return "contracted"
		}
		return "draft"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		if completion.L0L1AcceptancePassed {
			return "verifying"
		}
		return "executing"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED:
		if completion.L0L1AcceptancePassed && completion.L2HumanSignoffComplete && completion.ResidualRisksLogged && completion.MemoryCandidatesGenerated {
			return "accepted"
		}
		if completion.L0L1AcceptancePassed && !completion.L2HumanSignoffComplete && strings.EqualFold(strings.TrimSpace(meta["requires_owner_signoff"]), "true") {
			return "awaiting_owner_signoff"
		}
		return "verifying"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		return "blocked"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return "escalated"
	default:
		if atelierGoalOwnerSignoffComplete(task, nil, meta) {
			return "executing"
		}
		return "draft"
	}
}

func projectAtelierMilestoneState(task *model.CollaborationTask, taskGraph AtelierTaskGraph, completion AtelierProjectCompletion, projectState string, persistedMilestoneState string) string {
	if state, ok := normalizeAtelierMilestoneState(persistedMilestoneState); ok {
		return state
	}
	if state, ok := normalizeAtelierMilestoneState(atelierFirstNonEmpty(task.GetMeta()["milestone_state"], task.GetMeta()["milestoneState"])); ok {
		return state
	}
	if projectState == "accepted" || (completion.NoOpenBlockers && completion.L0L1AcceptancePassed && allAtelierTaskGraphNodesDone(taskGraph)) {
		return "accepted"
	}
	if !completion.NoOpenBlockers || projectState == "blocked" || projectState == "escalated" {
		return "blocked"
	}
	if task.GetStatus() == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED {
		return "abandoned"
	}
	if projectState == "draft" || projectState == "contracted" {
		return "planned"
	}
	return "active"
}

func normalizeAtelierProjectState(raw string) (string, bool) {
	state := strings.ToLower(strings.TrimSpace(raw))
	switch state {
	case "draft", "contracted", "executing", "blocked", "verifying", "awaiting_owner_signoff", "accepted", "escalated":
		return state, true
	case "awaiting-owner-signoff":
		return "awaiting_owner_signoff", true
	default:
		return "", false
	}
}

func normalizeAtelierMilestoneState(raw string) (string, bool) {
	state := strings.ToLower(strings.TrimSpace(raw))
	switch state {
	case "planned", "active", "blocked", "replanning", "accepted", "abandoned":
		return state, true
	default:
		return "", false
	}
}

func allAtelierTaskGraphNodesDone(taskGraph AtelierTaskGraph) bool {
	if len(taskGraph.Tasks) == 0 {
		return false
	}
	for _, task := range taskGraph.Tasks {
		if task.State != "done" && task.State != "skipped" && task.State != "accepted" {
			return false
		}
	}
	return true
}

func projectAtelierCompletion(task *model.CollaborationTask, events []*model.TaskEvent, meta map[string]string, persisted atelierProjectPersistence) AtelierProjectCompletion {
	openBlockers := persisted.Blockers
	if len(openBlockers) == 0 {
		openBlockers = projectAtelierOpenBlockers(events)
	}
	residualRisks := persisted.ResidualRisks
	if len(residualRisks) == 0 {
		residualRisks = projectAtelierResidualRisks(events)
	}
	memoryCandidates := projectAtelierMemoryCandidates(events)
	l0L1AcceptancePassed := atelierAutomatedAcceptancePassed(events, meta)
	if passed, ok := atelierPersistedAutomatedAcceptancePassed(persisted.AcceptancePredicates); ok {
		l0L1AcceptancePassed = passed
	}
	l2HumanSignoffComplete := atelierGoalOwnerSignoffComplete(task, events, meta)
	if complete, ok := atelierPersistedHumanSignoffComplete(persisted.AcceptancePredicates); ok {
		l2HumanSignoffComplete = complete
	}
	return AtelierProjectCompletion{
		NoOpenBlockers:            atelierNoOpenBlockers(openBlockers),
		L0L1AcceptancePassed:      l0L1AcceptancePassed,
		L2HumanSignoffComplete:    l2HumanSignoffComplete,
		ResidualRisksLogged:       atelierResidualRisksLogged(residualRisks),
		MemoryCandidatesGenerated: len(memoryCandidates) > 0 || strings.EqualFold(strings.TrimSpace(meta["memory_candidates_generated"]), "true"),
	}
}

func atelierPersistedAutomatedAcceptancePassed(predicates []atelierAcceptancePredicateRecord) (bool, bool) {
	found := false
	for _, predicate := range predicates {
		if predicate.Level != "L0" && predicate.Level != "L1" {
			continue
		}
		found = true
		if predicate.LastEval == nil || !*predicate.LastEval {
			return false, true
		}
	}
	if !found {
		return false, false
	}
	return true, true
}

func atelierPersistedHumanSignoffComplete(predicates []atelierAcceptancePredicateRecord) (bool, bool) {
	found := false
	for _, predicate := range predicates {
		if predicate.Level != "L2" {
			continue
		}
		found = true
		if !predicate.HumanSignoff {
			return false, true
		}
	}
	if !found {
		return false, false
	}
	return true, true
}

func atelierAutomatedAcceptancePassed(events []*model.TaskEvent, meta map[string]string) bool {
	if strings.EqualFold(strings.TrimSpace(meta["l0_l1_acceptance_passed"]), "true") {
		return true
	}
	latestGatePassed := map[string]bool{}
	gateOrder := []string{}
	for _, event := range events {
		if event == nil || event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		if atelierGateIsHumanLevel(payload) {
			continue
		}
		gateID := atelierGateID(payload, event)
		if _, seen := latestGatePassed[gateID]; !seen {
			gateOrder = append(gateOrder, gateID)
		}
		latestGatePassed[gateID] = atelierGateStatusPassed(payload)
	}
	if len(gateOrder) == 0 {
		return false
	}
	for _, gateID := range gateOrder {
		if !latestGatePassed[gateID] {
			return false
		}
	}
	return true
}

func atelierGoalOwnerSignoffComplete(task *model.CollaborationTask, events []*model.TaskEvent, meta map[string]string) bool {
	if strings.EqualFold(strings.TrimSpace(meta["goal_owner_signoff"]), "true") ||
		strings.EqualFold(strings.TrimSpace(meta["l2_human_signoff_complete"]), "true") {
		return true
	}
	for _, event := range events {
		if event == nil {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		if event.GetType() == model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT &&
			atelierGateIsHumanLevel(payload) &&
			atelierGateStatusPassed(payload) {
			return true
		}
		if event.GetType() == model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED &&
			strings.EqualFold(atelierStringValue(payload, "human_decision_reason"), "l2_review") &&
			strings.EqualFold(atelierStringValue(payload, "human_decision_action"), "continue") {
			return true
		}
	}
	return task != nil && strings.EqualFold(strings.TrimSpace(task.GetMeta()["goal_owner_signoff"]), "true")
}

func atelierResidualRisksLogged(risks []AtelierResidualRisk) bool {
	for _, risk := range risks {
		switch strings.ToLower(strings.TrimSpace(risk.State)) {
		case "logged", "downgraded", "follow_up":
		default:
			return false
		}
	}
	return true
}

func atelierGateStatusPassed(payload map[string]interface{}) bool {
	status := strings.ToLower(strings.TrimSpace(atelierStringValue(payload, "status")))
	return status == "passed" || status == "success" || status == "ok"
}

func atelierGateID(payload map[string]interface{}, event *model.TaskEvent) string {
	if event == nil {
		return atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"))
	}
	return atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"), event.GetEventId())
}

func atelierGateIsHumanLevel(payload map[string]interface{}) bool {
	for _, key := range []string{"level", "blocking_level", "blockingLevel", "gate_level", "gateLevel"} {
		level := strings.ToLower(strings.TrimSpace(atelierStringValue(payload, key)))
		switch level {
		case "l2", "human", "owner", "goal_owner":
			return true
		}
	}
	return false
}

func projectAtelierOpenBlockers(events []*model.TaskEvent) []AtelierProjectBlocker {
	blockersByID := map[string]AtelierProjectBlocker{}
	order := []string{}
	for _, event := range events {
		if event == nil {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		switch event.GetType() {
		case model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT:
			gateID := atelierGateID(payload, event)
			if !atelierPayloadBool(payload, "blocking", "is_blocking", "isBlocking") {
				continue
			}
			if _, seen := blockersByID[gateID]; !seen {
				order = append(order, gateID)
			}
			blocker := blockersByID[gateID]
			if blocker.ID == "" {
				blocker = AtelierProjectBlocker{
					ID:       gateID,
					Owner:    "verifier",
					Severity: "block",
					State:    "open",
				}
			}
			if atelierGateStatusPassed(payload) {
				blocker.State = "resolved"
			} else {
				blocker.State = "open"
			}
			blocker.EvidenceRef = atelierFirstNonEmpty(
				atelierStringValue(payload, "artifact_id"),
				atelierStringValue(payload, "artifactId"),
				atelierFirstString(atelierStringList(payload, "artifact_ids", "artifactIds")),
				blocker.EvidenceRef,
				event.GetEventId(),
			)
			blocker.Reason = atelierFirstNonEmpty(atelierStringValue(payload, "summary"), blocker.Reason, "blocking gate failed")
			blockersByID[gateID] = blocker
		case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED:
			if !strings.EqualFold(atelierStringValue(payload, "human_decision_reason"), "gate_blocked") {
				continue
			}
			gateID := atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"), atelierStringValue(payload, "gate_blocked_id"), atelierStringValue(payload, "gateBlockedId"))
			if gateID == "" {
				continue
			}
			blocker, ok := blockersByID[gateID]
			if !ok {
				order = append(order, gateID)
				blocker = AtelierProjectBlocker{
					ID:       gateID,
					Owner:    "verifier",
					Severity: "block",
					State:    "open",
					Reason:   "blocking gate human decision recorded",
				}
			}
			switch strings.ToLower(strings.TrimSpace(atelierStringValue(payload, "human_decision_action"))) {
			case "accept_risk":
				blocker.State = "waived"
			case "continue", "rerun_failed_node":
				blocker.State = "resolved"
			}
			blockersByID[gateID] = blocker
		}
	}
	blockers := make([]AtelierProjectBlocker, 0, len(order))
	for _, id := range order {
		blockers = append(blockers, blockersByID[id])
	}
	return blockers
}

func atelierNoOpenBlockers(blockers []AtelierProjectBlocker) bool {
	for _, blocker := range blockers {
		switch strings.ToLower(strings.TrimSpace(blocker.State)) {
		case "resolved", "waived":
		default:
			return false
		}
	}
	return true
}

func atelierPayloadBool(payload map[string]interface{}, keys ...string) bool {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case bool:
			return value
		case string:
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true", "1", "yes", "y", "block", "blocking":
				return true
			case "false", "0", "no", "n":
				return false
			}
		}
	}
	return false
}

func projectAtelierResidualRisks(events []*model.TaskEvent) []AtelierResidualRisk {
	risks := []AtelierResidualRisk{}
	for _, event := range events {
		if event == nil || event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		if strings.TrimSpace(atelierStringValue(payload, "signal")) != "negative" {
			continue
		}
		risks = append(risks, AtelierResidualRisk{
			ID:          atelierFirstNonEmpty(atelierStringValue(payload, "feedback_id"), atelierStringValue(payload, "feedbackId"), event.GetEventId()),
			Description: atelierFirstNonEmpty(atelierStringValue(payload, "comment"), "negative feedback recorded"),
			State:       "logged",
			EvidenceRef: atelierFirstNonEmpty(atelierStringValue(payload, "block_id"), atelierStringValue(payload, "blockId")),
			Owner:       "risk",
		})
	}
	return risks
}

func projectAtelierMemoryCandidates(events []*model.TaskEvent) []AtelierMemoryCandidateRef {
	candidates := []AtelierMemoryCandidateRef{}
	for _, event := range events {
		if event == nil || event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		if strings.TrimSpace(atelierStringValue(payload, "memory_candidate_status")) != "candidate" {
			continue
		}
		candidates = append(candidates, AtelierMemoryCandidateRef{
			ID:           atelierFirstNonEmpty(atelierStringValue(payload, "feedback_id"), atelierStringValue(payload, "feedbackId"), event.GetEventId()),
			Type:         "workflow_improvement",
			Content:      atelierFirstNonEmpty(atelierStringValue(payload, "comment"), atelierStringValue(payload, "memory_candidate_reason")),
			EvidenceRefs: atelierCompactStrings([]string{atelierFirstNonEmpty(atelierStringValue(payload, "block_id"), atelierStringValue(payload, "blockId"))}),
			Scope:        "project",
			Confirmed:    false,
			Feeds:        atelierStringList(payload, "memory_candidate_feeds", "memoryCandidateFeeds"),
		})
	}
	return candidates
}

func projectAtelierPolicy(meta map[string]string) *AtelierPolicyProjection {
	policyID := strings.TrimSpace(meta["policy_id"])
	if policyID == "" {
		return nil
	}
	return &AtelierPolicyProjection{
		ID:       policyID,
		Rules:    []AtelierPolicyRule{},
		HardDeny: meta["policy_hard_deny"] == "true",
	}
}

func projectAtelierDefects(events []*model.TaskEvent) []AtelierDefectProjection {
	defects := []AtelierDefectProjection{}
	for _, event := range events {
		if event == nil || event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT {
			continue
		}
		payload := decodePayload(event.GetPayloadJson())
		status := strings.ToLower(fmt.Sprint(payload["status"]))
		if status == "passed" || status == "success" {
			continue
		}
		artifactRef := atelierFirstNonEmpty(
			atelierStringValue(payload, "artifact_id"),
			atelierStringValue(payload, "artifactId"),
			atelierFirstString(atelierStringList(payload, "artifact_ids", "artifactIds")),
		)
		evidenceRef := atelierFirstNonEmpty(artifactRef, event.GetEventId())
		summary := atelierFirstNonEmpty(atelierStringValue(payload, "summary"), "gate reported a defect")
		targetRefs := atelierCompactStrings(append(
			atelierStringList(payload, "target_refs", "targetRefs"),
			artifactRef,
			atelierGateID(payload, event),
		))
		if len(targetRefs) == 0 {
			targetRefs = []string{event.GetEventId()}
		}
		defects = append(defects, AtelierDefectProjection{
			ID:          atelierFirstNonEmpty(atelierStringValue(payload, "defect_id"), atelierStringValue(payload, "defectId"), event.GetEventId()),
			TaskID:      event.GetTaskId(),
			Source:      "gate",
			State:       "proposed",
			EvidenceRef: evidenceRef,
			Proposal: AtelierDefectProposal{
				Summary:        summary,
				ExpectedChange: atelierFirstNonEmpty(atelierStringValue(payload, "expected_change"), atelierStringValue(payload, "expectedChange"), summary),
				TargetRefs:     targetRefs,
			},
		})
	}
	return defects
}

func normalizeAtelierDefectSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "gate", "verifier", "user", "supervisor":
		return strings.ToLower(strings.TrimSpace(source))
	case "orchestration.goal_keeper", "goal_keeper", "goalkeeper":
		return "supervisor"
	default:
		return "gate"
	}
}

func normalizeAtelierDefectState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "proposed", "accepted", "fixed", "rejected":
		return strings.ToLower(strings.TrimSpace(state))
	default:
		return "proposed"
	}
}

func atelierWorkspaceOpenTarget(taskID, workspaceID string, meta map[string]string) *AtelierWorkspaceOpenTarget {
	taskID = strings.TrimSpace(taskID)
	workspaceID = strings.TrimSpace(workspaceID)
	if taskID == "" || workspaceID == "" {
		return nil
	}
	ideHint := atelierFirstNonEmpty(meta["ide_hint"], meta["ide"], "vscode")
	return &AtelierWorkspaceOpenTarget{
		WorkspaceID:  workspaceID,
		WorkspaceURI: fmt.Sprintf("pt-workspace://task/%s?workspace=%s", url.QueryEscape(taskID), url.QueryEscape(workspaceID)),
		Label:        atelierFirstNonEmpty(meta["workspace_label"], meta["project"], workspaceID),
		IDEHint:      ideHint,
	}
}

func buildTaskStream(task *model.CollaborationTask, nodes []*model.TaskNode, events []*model.TaskEvent) []AtelierBlock {
	blocks := []AtelierBlock{
		{
			Kind: "agent",
			ID:   fmt.Sprintf("%s-summary", task.GetTaskId()),
			Text: atelierFirstNonEmpty(task.GetDescription(), task.GetTitle()),
			At:   timestampHHMM(task.GetCreatedAt()),
			Done: !isCollaborationTaskRunning(task.GetStatus()),
		},
	}

	if len(nodes) > 0 {
		blocks = append(blocks, projectNodesToNegotiationBlock(task, nodes))
	}
	for _, event := range events {
		if applyDecisionResolvedEvent(blocks, event) {
			continue
		}
		block := projectTaskEventToBlock(event)
		if block.ID != "" {
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func projectNodesToNegotiationBlock(task *model.CollaborationTask, nodes []*model.TaskNode) AtelierBlock {
	voices := make([]AtelierNegoVoice, 0, len(nodes))
	completed := 0
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if node.GetStatus() == model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED {
			completed++
		}
		voices = append(voices, AtelierNegoVoice{
			Role:   atelierFirstNonEmpty(node.GetRole(), "Executor"),
			Stance: stanceForNode(node.GetStatus()),
			Text:   atelierFirstNonEmpty(node.GetResultSummary(), node.GetDescription(), "等待执行"),
		})
	}
	converged := completed == len(voices) && len(voices) > 0
	return AtelierBlock{
		Kind:       "nego",
		ID:         fmt.Sprintf("%s-negotiation", task.GetTaskId()),
		Summary:    fmt.Sprintf("%d 个 Agent 节点已进入协作编排", len(voices)),
		AgentCount: len(voices),
		Converged:  &converged,
		Voices:     voices,
		Consensus:  consensusForNodes(completed, len(voices)),
	}
}

func projectTaskNodesToTodos(nodes []*model.TaskNode) []AtelierTodoItem {
	todos := make([]AtelierTodoItem, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		todos = append(todos, AtelierTodoItem{
			ID:     node.GetNodeId(),
			Text:   atelierFirstNonEmpty(node.GetDescription(), node.GetRole(), node.GetAgentId()),
			Status: todoStatusForNode(node.GetStatus()),
		})
	}
	return todos
}

func projectTaskEventsToArtifacts(events []*model.TaskEvent) []AtelierArtifactRef {
	artifacts := []AtelierArtifactRef{}
	for _, event := range events {
		artifact, ok := projectTaskEventToArtifact(event)
		if ok {
			artifacts = upsertAtelierArtifact(artifacts, artifact)
		}
	}
	return artifacts
}

func projectTaskEventsToGates(events []*model.TaskEvent) []AtelierGateResult {
	gates := []AtelierGateResult{}
	for _, event := range events {
		gate, ok := projectTaskEventToGate(event)
		if ok {
			gates = upsertAtelierGate(gates, gate)
		}
	}
	return gates
}

func projectTaskEventToBlock(event *model.TaskEvent) AtelierBlock {
	if event == nil {
		return AtelierBlock{}
	}
	if event.GetType() == model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED {
		return AtelierBlock{}
	}
	if decision, ok := projectTaskEventToDecisionBlock(event); ok {
		return decision
	}
	payload := decodePayload(event.GetPayloadJson())
	blockKind := atelierStringValue(payload, "block_kind")
	if blockKind == "decision_resolved" || blockKind == "gate_result" {
		return AtelierBlock{}
	}
	if artifact, ok := projectTaskEventToArtifact(event); ok {
		return AtelierBlock{
			Kind:       "artifact",
			ID:         event.GetEventId(),
			Name:       artifact.Name,
			FileKind:   artifactBlockFileKind(artifact.Kind),
			ProducedBy: atelierFirstNonEmpty(atelierStringValue(payload, "produced_by"), atelierStringValue(payload, "role"), "Agent"),
			Meta:       redactedAtelierArtifactPayload(payload),
		}
	}
	if stringValue := atelierStringValue(payload, "block_kind"); stringValue == "user" {
		return AtelierBlock{
			Kind: "user",
			ID:   event.GetEventId(),
			Text: atelierFirstNonEmpty(atelierStringValue(payload, "text"), eventText(event.GetType(), payload)),
			At:   timestampHHMM(event.GetCreatedAt()),
			Meta: payload,
		}
	}
	return AtelierBlock{
		Kind: "agent",
		ID:   event.GetEventId(),
		Text: eventText(event.GetType(), payload),
		At:   timestampHHMM(event.GetCreatedAt()),
		Done: event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED,
		Meta: payload,
	}
}

func projectTaskEventToDecisionBlock(event *model.TaskEvent) (AtelierBlock, bool) {
	if event == nil || event.GetType() != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
		return AtelierBlock{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	blockID := atelierFirstNonEmpty(
		atelierStringValue(payload, "block_id"),
		atelierStringValue(payload, "blockId"),
		atelierStringValue(payload, "interrupt_id"),
		atelierStringValue(payload, "interruptId"),
		event.GetEventId(),
	)
	options := atelierDecisionOptions(payload)
	if len(options) == 0 {
		options = []AtelierDecisionOption{{Text: "继续执行", Recommended: true}}
	}
	return AtelierBlock{
		Kind:           "decision",
		ID:             blockID,
		Question:       atelierFirstNonEmpty(atelierStringValue(payload, "question"), atelierStringValue(payload, "description"), "需要人工决策"),
		SpentSoFar:     atelierFirstNonEmpty(atelierStringValue(payload, "spent_so_far"), atelierStringValue(payload, "spentSoFar"), atelierStringValue(payload, "reason"), atelierStringValue(payload, "description"), "Station-owned decision is pending"),
		Options:        options,
		RollbackImpact: atelierFirstNonEmpty(atelierStringValue(payload, "rollback_impact"), atelierStringValue(payload, "rollbackImpact"), "Station owns the recovery transition."),
		At:             timestampHHMM(event.GetCreatedAt()),
		Meta:           payload,
	}, true
}

func projectTaskEventToArtifact(event *model.TaskEvent) (AtelierArtifactRef, bool) {
	if event == nil {
		return AtelierArtifactRef{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "artifact" {
		return AtelierArtifactRef{}, false
	}
	payload = redactedAtelierArtifactPayload(payload)
	id := atelierFirstNonEmpty(atelierStringValue(payload, "artifact_id"), atelierStringValue(payload, "artifactId"), event.GetEventId())
	name := atelierFirstNonEmpty(atelierStringValue(payload, "name"), atelierStringValue(payload, "title"), "artifact")
	kind := normalizeAtelierArtifactKind(atelierFirstNonEmpty(atelierStringValue(payload, "kind"), atelierStringValue(payload, "file_kind"), atelierStringValue(payload, "fileKind")))
	bodyRef := atelierStringValue(payload, "body_ref")
	bodyKind := atelierStringValue(payload, "body_kind")
	previewHint := normalizeAtelierArtifactPreviewHint(atelierStringValue(payload, "preview_hint"))
	return AtelierArtifactRef{
		ID:            id,
		Name:          name,
		Kind:          kind,
		Meta:          atelierFirstNonEmpty(atelierStringValue(payload, "meta"), atelierStringValue(payload, "produced_by"), "Artifact"),
		PreviewHint:   previewHint,
		BodyRef:       bodyRef,
		BodyHash:      atelierStringValue(payload, "body_hash"),
		BodySize:      atelierStringValue(payload, "body_size"),
		BodyKind:      bodyKind,
		PreviewTarget: atelierArtifactPreviewTargetFromPayload(payload, event.GetTaskId(), id, kind, previewHint, bodyRef, bodyKind),
		Paths:         atelierStringList(payload, "paths"),
		Size:          atelierStringValue(payload, "size"),
	}, true
}

func redactedAtelierArtifactPayload(payload map[string]interface{}) map[string]interface{} {
	if payload == nil {
		return nil
	}
	redacted := make(map[string]interface{}, len(payload))
	for key, value := range payload {
		switch key {
		case "markdown", "content", "body", "html", "diff", "patch", "url", "src", "iframe":
			continue
		default:
			redacted[key] = value
		}
	}
	return redacted
}

func projectTaskEventToGate(event *model.TaskEvent) (AtelierGateResult, bool) {
	if event == nil {
		return AtelierGateResult{}, false
	}
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "gate_result" {
		return AtelierGateResult{}, false
	}
	id := atelierFirstNonEmpty(atelierStringValue(payload, "gate_id"), atelierStringValue(payload, "gateId"), event.GetEventId())
	return AtelierGateResult{
		ID:          id,
		Name:        atelierFirstNonEmpty(atelierStringValue(payload, "name"), "Gate"),
		Status:      normalizeAtelierGateStatus(atelierStringValue(payload, "status")),
		Summary:     atelierFirstNonEmpty(atelierStringValue(payload, "summary"), atelierStringValue(payload, "result_summary"), "Gate result updated"),
		Checks:      atelierGateChecks(payload),
		ArtifactIDs: atelierStringList(payload, "artifact_ids", "artifactIds"),
		At:          timestampHHMM(event.GetCreatedAt()),
	}, true
}

func applyDecisionResolvedEvent(blocks []AtelierBlock, event *model.TaskEvent) bool {
	payload := decodePayload(event.GetPayloadJson())
	if atelierStringValue(payload, "block_kind") != "decision_resolved" {
		return false
	}
	blockID := atelierFirstNonEmpty(
		atelierStringValue(payload, "block_id"),
		atelierStringValue(payload, "blockId"),
		atelierStringValue(payload, "interrupt_id"),
		atelierStringValue(payload, "interruptId"),
	)
	choice := atelierStringValue(payload, "choice")
	if blockID == "" || choice == "" {
		return true
	}
	for i := range blocks {
		if blocks[i].Kind == "decision" && blocks[i].ID == blockID {
			blocks[i].Chosen = choice
		}
	}
	return true
}

func atelierDecisionOptions(payload map[string]interface{}) []AtelierDecisionOption {
	if payload == nil {
		return nil
	}
	recommended := atelierFirstNonEmpty(
		atelierStringValue(payload, "recommended_choice"),
		atelierStringValue(payload, "recommendedChoice"),
	)
	value, ok := payload["options"]
	if !ok {
		return nil
	}
	options := []AtelierDecisionOption{}
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			text := atelierFirstNonEmpty(item)
			if text == "" {
				continue
			}
			options = append(options, AtelierDecisionOption{Text: text, Recommended: text == recommended})
		}
	case []interface{}:
		for _, item := range typed {
			switch option := item.(type) {
			case map[string]interface{}:
				text := atelierFirstNonEmpty(atelierStringValue(option, "text"), atelierStringValue(option, "label"), atelierStringValue(option, "value"))
				if text == "" {
					continue
				}
				options = append(options, AtelierDecisionOption{
					Text:        text,
					Recommended: atelierBoolValue(option, "recommended") || text == recommended,
				})
			case string:
				text := atelierFirstNonEmpty(option)
				if text != "" {
					options = append(options, AtelierDecisionOption{Text: text, Recommended: text == recommended})
				}
			default:
				text := atelierFirstNonEmpty(fmt.Sprint(option))
				if text != "" {
					options = append(options, AtelierDecisionOption{Text: text, Recommended: text == recommended})
				}
			}
		}
	case string:
		for _, item := range strings.Split(typed, ",") {
			text := atelierFirstNonEmpty(item)
			if text != "" {
				options = append(options, AtelierDecisionOption{Text: text, Recommended: text == recommended})
			}
		}
	}
	return options
}

func eventText(eventType model.TaskEventType, payload map[string]interface{}) string {
	role := atelierStringValue(payload, "role")
	summary := atelierFirstNonEmpty(atelierStringValue(payload, "result_summary"), atelierStringValue(payload, "title"))
	switch eventType {
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED:
		return atelierFirstNonEmpty(summary, "已创建协作任务")
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED:
		return fmt.Sprintf("%s 开始执行", atelierFirstNonEmpty(role, "Agent"))
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED:
		return atelierFirstNonEmpty(summary, fmt.Sprintf("%s 已完成执行", atelierFirstNonEmpty(role, "Agent")))
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED:
		return atelierFirstNonEmpty(summary, fmt.Sprintf("%s 执行失败", atelierFirstNonEmpty(role, "Agent")))
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_STATUS_CHANGED:
		return atelierFirstNonEmpty(summary, "协作任务状态已更新")
	default:
		return atelierFirstNonEmpty(summary, "收到协作编排事件")
	}
}

func decodePayload(raw string) map[string]interface{} {
	payload := map[string]interface{}{}
	if strings.TrimSpace(raw) == "" {
		return payload
	}
	_ = json.Unmarshal([]byte(raw), &payload)
	return payload
}

func estimateContextUse(nodes []*model.TaskNode, events []*model.TaskEvent) int {
	estimate := len(nodes)*6 + len(events)*3
	if estimate < 0 {
		return 0
	}
	if estimate > 95 {
		return 95
	}
	return estimate
}

func normalizeAtelierTaskStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "archived", "deleted":
		return strings.TrimSpace(status)
	default:
		return "active"
	}
}

func normalizeAtelierFeedbackSignal(signal string) string {
	switch strings.TrimSpace(signal) {
	case "positive", "negative", "copy", "regenerate":
		return strings.TrimSpace(signal)
	default:
		return ""
	}
}

func atelierFeedbackMemoryCandidatePolicy(signal string) (string, string, []string) {
	switch signal {
	case "positive":
		return "candidate", "positive feedback is a weak memory candidate signal; Station must still require later confirmation before long-term memory write", []string{"planner", "verifier"}
	case "negative":
		return "candidate", "negative feedback is a weak correction candidate signal; Station must still require later confirmation before long-term memory write", []string{"planner", "risk", "verifier"}
	default:
		return "not_applicable", "signal does not create a memory candidate", []string{}
	}
}

func atelierFeedbackRerunPolicy(signal string) (string, string) {
	if signal == "regenerate" {
		return "intent_recorded", "rerun is recorded as an orchestration intent; Station must create any new run"
	}
	return "not_requested", "signal does not request rerun"
}

func loadAtelierFeedbackCandidatePayload(ctx context.Context, db *gorm.DB, taskID string, feedbackID string) (map[string]interface{}, error) {
	var records []persistence.TaskEvent
	if err := db.WithContext(ctx).
		Where("task_id = ? AND event_type = ?", taskID, int32(model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED)).
		Order("event_seq DESC, created_at DESC").
		Limit(200).
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load Atelier feedback events", err)
	}
	for index := range records {
		payload := decodePayload(records[index].Payload)
		if atelierStringValue(payload, "feedback_id") == feedbackID &&
			(atelierStringValue(payload, "source") == "atelier.feedback.submit" ||
				atelierStringValue(payload, "block_kind") == "feedback") {
			return payload, nil
		}
	}
	return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "Atelier feedback candidate not found", nil)
}

func loadAtelierRerunConfirmationPayload(ctx context.Context, db *gorm.DB, taskID string, feedbackID string) (map[string]interface{}, bool, error) {
	var records []persistence.TaskEvent
	if err := db.WithContext(ctx).
		Where("task_id = ? AND event_type = ?", taskID, int32(model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED)).
		Order("event_seq DESC, created_at DESC").
		Limit(200).
		Find(&records).Error; err != nil {
		return nil, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load Atelier rerun confirmation events", err)
	}
	for index := range records {
		payload := decodePayload(records[index].Payload)
		if atelierStringValue(payload, "feedback_id") == feedbackID &&
			atelierStringValue(payload, "source") == "atelier.feedback.confirmRerun" &&
			atelierStringValue(payload, "block_kind") == "rerun_confirmed" {
			return payload, true, nil
		}
	}
	return nil, false, nil
}

func atelierMemoryCandidateContent(task *persistence.CollaborationTask, payload map[string]interface{}) string {
	taskTitle := ""
	taskID := ""
	if task != nil {
		taskTitle = strings.TrimSpace(task.Title)
		taskID = strings.TrimSpace(task.ID)
	}
	parts := []string{
		"Atelier feedback memory candidate confirmed by Station review.",
		fmt.Sprintf("task_id=%s", taskID),
		fmt.Sprintf("task_title=%s", taskTitle),
		fmt.Sprintf("block_id=%s", atelierStringValue(payload, "block_id")),
		fmt.Sprintf("signal=%s", atelierStringValue(payload, "signal")),
	}
	if comment := strings.TrimSpace(atelierStringValue(payload, "comment")); comment != "" {
		parts = append(parts, fmt.Sprintf("comment=%s", comment))
	}
	return strings.Join(parts, "\n")
}

func isCollaborationTaskRunning(status model.CollaborationTaskStatus) bool {
	return status == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING ||
		status == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING
}

func todoStatusForNode(status model.TaskNodeStatus) string {
	switch status {
	case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED:
		return "done"
	case model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING:
		return "running"
	default:
		return "todo"
	}
}

func normalizeAtelierArtifactKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "web", "image", "diff":
		return strings.TrimSpace(kind)
	default:
		return "markdown"
	}
}

func normalizeAtelierArtifactPreviewHint(previewHint string) string {
	switch strings.TrimSpace(previewHint) {
	case "markdown", "web", "image", "diff", "metadata", "metadata_only":
		return strings.TrimSpace(previewHint)
	default:
		return "metadata_only"
	}
}

func atelierArtifactPreviewTargetFromPayload(payload map[string]interface{}, taskID, artifactID, kind, previewHint, bodyRef, bodyKind string) *AtelierArtifactPreviewTarget {
	if explicit := sanitizedAtelierArtifactPreviewTarget(payload); explicit != nil {
		return explicit
	}
	if strings.TrimSpace(bodyRef) == "" || !isAtelierFetchableArtifactBodyKind(bodyKind) {
		return nil
	}
	return &AtelierArtifactPreviewTarget{
		Kind:       atelierArtifactPreviewTargetKind(kind, previewHint, bodyKind),
		Mode:       "sandbox_manifest",
		Label:      "Host sandbox preview manifest",
		SandboxRef: fmt.Sprintf("atelier-sandbox://%s/%s/preview", strings.TrimSpace(taskID), strings.TrimSpace(artifactID)),
		BodyRef:    strings.TrimSpace(bodyRef),
	}
}

func sanitizedAtelierArtifactPreviewTarget(payload map[string]interface{}) *AtelierArtifactPreviewTarget {
	if payload == nil {
		return nil
	}
	raw, ok := payload["preview_target"]
	if !ok {
		raw = payload["previewTarget"]
	}
	target, ok := raw.(map[string]interface{})
	if !ok || target == nil {
		return nil
	}
	for _, forbidden := range []string{"markdown", "content", "body", "html", "diff", "patch", "url", "src", "iframe"} {
		if _, exists := target[forbidden]; exists {
			return nil
		}
	}
	return &AtelierArtifactPreviewTarget{
		Kind:       atelierFirstNonEmpty(atelierStringValue(target, "kind"), "metadata"),
		Mode:       atelierFirstNonEmpty(atelierStringValue(target, "mode"), "sandbox_manifest"),
		Label:      atelierStringValue(target, "label"),
		SandboxRef: atelierFirstNonEmpty(atelierStringValue(target, "sandbox_ref"), atelierStringValue(target, "sandboxRef")),
		BodyRef:    atelierFirstNonEmpty(atelierStringValue(target, "body_ref"), atelierStringValue(target, "bodyRef")),
	}
}

func atelierArtifactPreviewTargetKind(kind, previewHint, bodyKind string) string {
	switch strings.TrimSpace(previewHint) {
	case "markdown", "web", "image", "diff", "metadata":
		return strings.TrimSpace(previewHint)
	}
	switch strings.TrimSpace(kind) {
	case "markdown", "web", "image", "diff":
		return strings.TrimSpace(kind)
	}
	switch strings.TrimSpace(bodyKind) {
	case "markdown", "diff":
		return strings.TrimSpace(bodyKind)
	default:
		return "metadata"
	}
}

func artifactBlockFileKind(kind string) string {
	switch normalizeAtelierArtifactKind(kind) {
	case "diff":
		return "diff"
	case "markdown":
		return "report"
	default:
		return "data"
	}
}

func normalizeAtelierGateStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "running", "passed", "failed", "blocked":
		return strings.TrimSpace(status)
	default:
		return "pending"
	}
}

func normalizeAtelierGateCheckStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "passed", "failed":
		return strings.TrimSpace(status)
	default:
		return "pending"
	}
}

func atelierGateChecks(payload map[string]interface{}) []AtelierGateCheck {
	value, ok := payload["checks"]
	if !ok {
		summary := atelierFirstNonEmpty(atelierStringValue(payload, "summary"), atelierStringValue(payload, "result_summary"))
		if summary == "" {
			return []AtelierGateCheck{}
		}
		return []AtelierGateCheck{{Name: "summary", Status: normalizeAtelierGateCheckStatus(atelierStringValue(payload, "status")), Detail: summary}}
	}
	items, ok := value.([]interface{})
	if !ok {
		return []AtelierGateCheck{}
	}
	checks := make([]AtelierGateCheck, 0, len(items))
	for _, item := range items {
		raw, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		name := atelierFirstNonEmpty(atelierStringValue(raw, "name"), "check")
		checks = append(checks, AtelierGateCheck{
			Name:   name,
			Status: normalizeAtelierGateCheckStatus(atelierStringValue(raw, "status")),
			Detail: atelierStringValue(raw, "detail"),
		})
	}
	return checks
}

func upsertAtelierArtifact(current []AtelierArtifactRef, incoming AtelierArtifactRef) []AtelierArtifactRef {
	for i := range current {
		if current[i].ID == incoming.ID {
			current[i] = incoming
			return current
		}
	}
	return append(current, incoming)
}

func upsertAtelierGate(current []AtelierGateResult, incoming AtelierGateResult) []AtelierGateResult {
	for i := range current {
		if current[i].ID == incoming.ID {
			current[i] = incoming
			return current
		}
	}
	return append(current, incoming)
}

func cloneAtelierTodos(todos []AtelierTodoItem) []AtelierTodoItem {
	if todos == nil {
		return []AtelierTodoItem{}
	}
	cloned := make([]AtelierTodoItem, len(todos))
	copy(cloned, todos)
	return cloned
}

func cloneAtelierBlocks(blocks []AtelierBlock) []AtelierBlock {
	if blocks == nil {
		return []AtelierBlock{}
	}
	cloned := make([]AtelierBlock, len(blocks))
	copy(cloned, blocks)
	return cloned
}

func cloneAtelierArtifacts(artifacts []AtelierArtifactRef) []AtelierArtifactRef {
	if artifacts == nil {
		return []AtelierArtifactRef{}
	}
	cloned := make([]AtelierArtifactRef, len(artifacts))
	copy(cloned, artifacts)
	return cloned
}

func cloneAtelierGates(gates []AtelierGateResult) []AtelierGateResult {
	if gates == nil {
		return []AtelierGateResult{}
	}
	cloned := make([]AtelierGateResult, len(gates))
	copy(cloned, gates)
	return cloned
}

func foldAtelierStream(materialized []AtelierBlock, events []*model.TaskEvent) []AtelierBlock {
	blocks := cloneAtelierBlocks(materialized)
	for _, event := range events {
		if applyDecisionResolvedEvent(blocks, event) {
			continue
		}
		block := projectTaskEventToBlock(event)
		if block.ID != "" {
			blocks = upsertAtelierBlock(blocks, block)
		}
	}
	return blocks
}

func foldAtelierArtifacts(materialized []AtelierArtifactRef, events []*model.TaskEvent) []AtelierArtifactRef {
	artifacts := cloneAtelierArtifacts(materialized)
	for _, event := range events {
		artifact, ok := projectTaskEventToArtifact(event)
		if ok {
			artifacts = upsertAtelierArtifact(artifacts, artifact)
		}
	}
	return artifacts
}

func foldAtelierGates(materialized []AtelierGateResult, events []*model.TaskEvent) []AtelierGateResult {
	gates := cloneAtelierGates(materialized)
	for _, event := range events {
		gate, ok := projectTaskEventToGate(event)
		if ok {
			gates = upsertAtelierGate(gates, gate)
		}
	}
	return gates
}

func upsertAtelierBlock(current []AtelierBlock, incoming AtelierBlock) []AtelierBlock {
	for i := range current {
		if current[i].ID == incoming.ID {
			current[i] = incoming
			return current
		}
	}
	return append(current, incoming)
}

func stanceForNode(status model.TaskNodeStatus) string {
	switch status {
	case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED:
		return "signoff"
	case model.TaskNodeStatus_TASK_NODE_STATUS_FAILED:
		return "objection"
	case model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING:
		return "proposal"
	default:
		return "counter"
	}
}

func consensusForNodes(completed, total int) string {
	if total == 0 {
		return ""
	}
	if completed == total {
		return "全部协作节点已完成，等待 Gate / Artifact 投影。"
	}
	return fmt.Sprintf("%d/%d 个协作节点已完成，仍在等待后续 projection event。", completed, total)
}

func atelierFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func atelierFirstString(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func atelierStringValue(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func atelierStringList(payload map[string]interface{}, keys ...string) []string {
	if payload == nil {
		return nil
	}
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case []string:
			return atelierCompactStrings(typed)
		case []interface{}:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				values = append(values, atelierFirstNonEmpty(fmt.Sprint(item)))
			}
			return atelierCompactStrings(values)
		case string:
			if strings.TrimSpace(typed) == "" {
				return nil
			}
			return atelierCompactStrings(strings.Split(typed, ","))
		default:
			if strings.TrimSpace(fmt.Sprint(typed)) == "" {
				return nil
			}
			return []string{strings.TrimSpace(fmt.Sprint(typed))}
		}
	}
	return nil
}

func atelierJSONStrings(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	return atelierCompactStrings(values)
}

func atelierBoolValue(payload map[string]interface{}, key string) bool {
	if payload == nil {
		return false
	}
	value, ok := payload[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") ||
			strings.EqualFold(strings.TrimSpace(typed), "yes") ||
			strings.TrimSpace(typed) == "1"
	default:
		return fmt.Sprint(typed) == "1"
	}
}

func atelierCompactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func mustJSON(value interface{}) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func decodeStringMap(raw string) map[string]string {
	result := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}

func firstAgentID(meta map[string]string) string {
	if meta == nil {
		return ""
	}
	for _, key := range []string{"agent_ids", "desktop_agent_ids"} {
		var ids []string
		if err := json.Unmarshal([]byte(meta[key]), &ids); err == nil {
			for _, id := range ids {
				if strings.TrimSpace(id) != "" {
					return strings.TrimSpace(id)
				}
			}
		}
	}
	return ""
}

func atelierArtifactBodyRef(taskID, artifactID string) string {
	return fmt.Sprintf("artifact://%s/%s/body", strings.TrimSpace(taskID), strings.TrimSpace(artifactID))
}

func isAtelierFetchableArtifactBodyKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "markdown", "diff", "text", "json":
		return true
	default:
		return false
	}
}

func atelierArtifactBodyHash(text string) string {
	return atelierSHA256Hash(text)
}

func atelierSHA256Hash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return fmt.Sprintf("sha256:%x", sum[:])
}

func truncateUTF8Bytes(text string, maxBytes int64) (string, bool) {
	if maxBytes <= 0 || int64(len([]byte(text))) <= maxBytes {
		return text, false
	}
	limit := int(maxBytes)
	if limit > len(text) {
		limit = len(text)
	}
	for limit > 0 && !utf8.ValidString(text[:limit]) {
		limit--
	}
	return text[:limit], true
}

func timestampHHMM(ts *timestamppb.Timestamp) string {
	if ts == nil || !ts.IsValid() {
		return ""
	}
	return ts.AsTime().Format("15:04")
}

func timestampRFC3339(ts *timestamppb.Timestamp) string {
	if ts == nil || !ts.IsValid() {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return ts.AsTime().UTC().Format(time.RFC3339)
}
