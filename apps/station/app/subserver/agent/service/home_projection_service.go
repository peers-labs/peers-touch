package service

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const homeRecentWorkLimit = 20

type homeAgentLister interface {
	ListAgents(context.Context, domain.AgentListOptions) ([]domain.Agent, int64, error)
}

type homeConversationLister interface {
	ListConversations(context.Context, string, string, string, int, int) ([]*domain.Conversation, int64, error)
}

type homeReadinessGetter interface {
	Get(context.Context, string, *model.GetCapabilityReadinessRequest) (*model.CapabilityReadinessSnapshot, error)
}

type homeTaskMigrationLister interface {
	ListTaskMigrationReadbacks(
		context.Context,
		string,
	) ([]persistence.AgentTaskGoalMap, error)
}

type homeGoalExecutionLister interface {
	ListTaskRunsForOwner(context.Context, string, int) ([]*GoalExecutionSnapshot, error)
}

type HomeProjectionService struct {
	agents         homeAgentLister
	conversations  homeConversationLister
	readiness      homeReadinessGetter
	taskMigrations homeTaskMigrationLister
	goalExecutions homeGoalExecutionLister
	now            func() time.Time
}

func NewHomeProjectionService(
	agents homeAgentLister,
	conversations homeConversationLister,
	readiness homeReadinessGetter,
	taskMigrations homeTaskMigrationLister,
	goalExecutions ...homeGoalExecutionLister,
) *HomeProjectionService {
	service := &HomeProjectionService{
		agents:         agents,
		conversations:  conversations,
		readiness:      readiness,
		taskMigrations: taskMigrations,
		now:            time.Now,
	}
	if len(goalExecutions) > 0 {
		service.goalExecutions = goalExecutions[0]
	}
	return service
}

func (s *HomeProjectionService) Get(
	ctx context.Context,
	ptid string,
	afterRevision uint64,
) (*model.HomeWorkProjection, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, errcode.New(
			errcode.AgentUnauthorized,
			http.StatusUnauthorized,
			"ptid is required",
			nil,
		)
	}

	agents, _, err := s.agents.ListAgents(ctx, domain.AgentListOptions{
		ActorPTID: ptid,
		Page:      1,
		PageSize:  100,
	})
	if err != nil {
		return nil, err
	}

	projection := &model.HomeWorkProjection{
		Ptid:        ptid,
		Revision:    1,
		GeneratedAt: timestamppb.New(s.now().UTC()),
		Freshness:   model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_FRESH,
	}
	migrationsByTaskID := make(map[string]persistence.AgentTaskGoalMap)
	if s.taskMigrations != nil {
		migrations, migrationErr := s.taskMigrations.ListTaskMigrationReadbacks(
			ctx,
			ptid,
		)
		if migrationErr != nil {
			projection.Freshness = model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL
			projection.SliceErrors = append(projection.SliceErrors, &model.HomeSliceError{
				SliceId:        "task_migration",
				Code:           model.HomeErrorCode_HOME_ERROR_CODE_SLICE_UNAVAILABLE,
				Retryable:      true,
				RecoveryAction: "retry",
			})
		} else {
			for _, migration := range migrations {
				migrationsByTaskID[migration.TaskID] = migration
				projection.Revision = maxHomeRevision(
					projection.Revision,
					migration.UpdatedAt,
				)
			}
		}
	}
	capabilitySummarySeen := make(map[string]struct{})
	for i := range agents {
		agent := agents[i]
		projection.Revision = maxHomeRevision(projection.Revision, agent.UpdatedAt)

		config := decodeHomeAgentConfig(agent.ConfigJSON)
		if config.Pinned {
			readinessSnapshotID := ""
			if s.readiness != nil {
				snapshot, readinessErr := s.readiness.Get(
					ctx,
					ptid,
					&model.GetCapabilityReadinessRequest{AgentId: agent.AgentID},
				)
				if readinessErr != nil || snapshot == nil {
					projection.Freshness = model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL
					projection.Readiness = append(projection.Readiness, &model.HomeReadiness{
						AgentId:     agent.AgentID,
						State:       "unavailable",
						ReasonCodes: []string{"readiness_unresolved"},
					})
					projection.SliceErrors = append(projection.SliceErrors, &model.HomeSliceError{
						SliceId:        "readiness:" + agent.AgentID,
						Code:           model.HomeErrorCode_HOME_ERROR_CODE_READINESS_UNRESOLVED,
						Retryable:      true,
						RecoveryAction: "retry",
					})
				} else {
					readinessSnapshotID = snapshot.GetSnapshotId()
					projection.Revision = maxHomeRevision(
						projection.Revision,
						snapshot.GetCreatedAt().AsTime(),
					)
					projection.Readiness = append(
						projection.Readiness,
						homeReadinessFromSnapshot(snapshot),
					)
					for _, capability := range snapshot.GetCapabilities() {
						key := capability.GetCapabilityId() + "\x00" + capability.GetCapabilityVersion()
						if _, ok := capabilitySummarySeen[key]; ok {
							continue
						}
						capabilitySummarySeen[key] = struct{}{}
						projection.CapabilitySummaries = append(
							projection.CapabilitySummaries,
							&model.HomeCapabilitySummary{
								CapabilityId:      capability.GetCapabilityId(),
								CapabilityVersion: capability.GetCapabilityVersion(),
								DisplayName:       capability.GetCapabilityId(),
								ReadinessState:    homeCapabilityReadinessState(capability.GetState()),
								ReasonCode:        capability.GetReasonCode(),
							},
						)
					}
				}
			}
			projection.PinnedAgents = append(projection.PinnedAgents, &model.HomePinnedAgent{
				AgentId:             agent.AgentID,
				DisplayName:         firstNonEmpty(agent.Title, agent.Name),
				AvatarRef:           config.Avatar,
				ReadinessSnapshotId: readinessSnapshotID,
				AgentName:           agent.Name,
				AgentVersion:        uint64(agent.Version),
				ProviderId:          agent.ProviderID,
				ModelId:             agent.ModelName,
			})
		}

		conversations, _, listErr := s.conversations.ListConversations(
			ctx,
			agent.AgentID,
			ptid,
			string(domain.ConversationStatusActive),
			1,
			homeRecentWorkLimit,
		)
		if listErr != nil {
			projection.Freshness = model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL
			projection.SliceErrors = append(projection.SliceErrors, &model.HomeSliceError{
				SliceId:        "recent_work:" + agent.AgentID,
				Code:           model.HomeErrorCode_HOME_ERROR_CODE_SLICE_UNAVAILABLE,
				Retryable:      true,
				RecoveryAction: "retry",
			})
			continue
		}
		for _, conversation := range conversations {
			if conversation == nil {
				continue
			}
			projection.Revision = maxHomeRevision(projection.Revision, conversation.UpdatedAt)
			projection.RecentWork = append(projection.RecentWork, &model.HomeRecentWork{
				WorkId:    conversation.ConversationID,
				Kind:      model.HomeWorkKind_HOME_WORK_KIND_CHAT,
				AgentId:   conversation.AgentID,
				Title:     conversation.Title,
				UpdatedAt: timestamppb.New(conversation.UpdatedAt.UTC()),
			})
		}
	}

	if s.goalExecutions != nil {
		executions, executionErr := s.goalExecutions.ListTaskRunsForOwner(
			ctx,
			ptid,
			homeRecentWorkLimit,
		)
		if executionErr != nil {
			projection.Freshness = model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL
			projection.SliceErrors = append(projection.SliceErrors, &model.HomeSliceError{
				SliceId:        "task_runs",
				Code:           model.HomeErrorCode_HOME_ERROR_CODE_SLICE_UNAVAILABLE,
				Retryable:      true,
				RecoveryAction: "retry",
			})
		} else {
			for _, execution := range executions {
				if execution == nil ||
					execution.Task == nil || execution.Step == nil {
					continue
				}
				task := execution.Task
				node := execution.Node
				step := execution.Step
				projection.Revision = maxHomeRevision(projection.Revision, task.UpdatedAt)
				projection.RecentWork = append(projection.RecentWork, &model.HomeRecentWork{
					WorkId:    task.TaskID,
					Kind:      model.HomeWorkKind_HOME_WORK_KIND_TASK,
					AgentId:   step.AgentID,
					Title:     task.Title,
					UpdatedAt: timestamppb.New(task.UpdatedAt.UTC()),
				})

				status := homeTaskRunStatus(task.Status)
				goalNodeID := task.GoalNodeID
				if node != nil {
					goalNodeID = node.NodeID
				}
				taskProjection := &model.HomeTaskProjection{
					TaskId:          task.TaskID,
					AgentId:         step.AgentID,
					Title:           task.Title,
					Status:          status,
					ProgressPercent: homeTaskRunProgress(status),
					UpdatedAt:       timestamppb.New(task.UpdatedAt.UTC()),
					GoalId:          task.GoalID,
					GoalNodeId:      goalNodeID,
					StepId:          step.StepID,
					AttemptId:       step.AttemptID,
					Attempt:         uint32(max(step.Attempt, 0)),
					Surface:         model.TaskSurface(task.Surface),
					WorkspaceId:     task.WorkspaceID,
				}
				if migration, ok := migrationsByTaskID[task.TaskID]; ok &&
					migration.State == persistence.AgentTaskMigrationStateMigrated {
					taskProjection.LegacySourceId = migration.LegacyTaskID
					taskProjection.MigrationState =
						model.HomeTaskMigrationState_HOME_TASK_MIGRATION_STATE_MIGRATED
				}
				// Keep every canonical Goal TaskRun in the wire projection so a
				// Desktop restart can reconstruct both active and terminal work.
				projection.ActiveTasks = append(
					projection.ActiveTasks,
					taskProjection,
				)
				switch taskProjection.Status {
				case model.HomeTaskStatus_HOME_TASK_STATUS_PENDING,
					model.HomeTaskStatus_HOME_TASK_STATUS_RUNNING,
					model.HomeTaskStatus_HOME_TASK_STATUS_NEEDS_USER:
				case model.HomeTaskStatus_HOME_TASK_STATUS_COMPLETED:
					projection.BriefItems = append(projection.BriefItems, &model.HomeBriefItem{
						BriefId:   homeTaskRunBriefID(execution),
						SourceRef: task.TaskID,
						Title:     task.Title,
						Summary:   homeGoalResultSummary(execution, "Task completed"),
						UpdatedAt: timestamppb.New(task.UpdatedAt.UTC()),
					})
				case model.HomeTaskStatus_HOME_TASK_STATUS_FAILED:
					projection.BriefItems = append(projection.BriefItems, &model.HomeBriefItem{
						BriefId:   homeTaskRunBriefID(execution),
						SourceRef: task.TaskID,
						Title:     task.Title,
						Summary:   homeGoalResultSummary(execution, "Task failed"),
						UpdatedAt: timestamppb.New(task.UpdatedAt.UTC()),
					})
					projection.NeedsUserItems = append(projection.NeedsUserItems, &model.HomeNeedsUserItem{
						ItemId:     "task:" + task.TaskID,
						SourceRef:  task.TaskID,
						Title:      task.Title,
						ActionKind: "open_task",
						ActionRef:  task.TaskID,
					})
				}
			}
		}
	}

	sort.SliceStable(projection.RecentWork, func(i, j int) bool {
		return projection.RecentWork[i].GetUpdatedAt().AsTime().
			After(projection.RecentWork[j].GetUpdatedAt().AsTime())
	})
	if len(projection.RecentWork) > homeRecentWorkLimit {
		projection.RecentWork = projection.RecentWork[:homeRecentWorkLimit]
	}
	if projection.GetRevision() < afterRevision {
		projection.Freshness = model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_STALE
		projection.SliceErrors = append(projection.SliceErrors, &model.HomeSliceError{
			SliceId:        "projection",
			Code:           model.HomeErrorCode_HOME_ERROR_CODE_PROJECTION_STALE,
			Retryable:      true,
			RecoveryAction: "retry",
		})
	}

	return projection, nil
}

func homeReadinessFromSnapshot(
	snapshot *model.CapabilityReadinessSnapshot,
) *model.HomeReadiness {
	state := "ready"
	reasons := make([]string, 0)
	for _, capability := range snapshot.GetCapabilities() {
		candidate := homeCapabilityReadinessState(capability.GetState())
		if homeReadinessRank(candidate) > homeReadinessRank(state) {
			state = candidate
		}
		if reason := strings.TrimSpace(capability.GetReasonCode()); reason != "" {
			reasons = append(reasons, reason)
		}
	}
	sort.Strings(reasons)
	return &model.HomeReadiness{
		AgentId:             snapshot.GetAgentId(),
		RuntimeSnapshotId:   snapshot.GetRuntimeSnapshotId(),
		ReadinessSnapshotId: snapshot.GetSnapshotId(),
		State:               state,
		ReasonCodes:         reasons,
	}
}

func homeCapabilityReadinessState(state model.CapabilityReadinessState) string {
	switch state {
	case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY:
		return "ready"
	case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_DEGRADED:
		return "degraded"
	case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE:
		return "unavailable"
	case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED:
		return "blocked"
	default:
		return "unknown"
	}
}

func homeReadinessRank(state string) int {
	switch state {
	case "blocked":
		return 4
	case "unavailable":
		return 3
	case "unknown":
		return 2
	case "degraded":
		return 1
	default:
		return 0
	}
}

func homeTaskRunStatus(status int32) model.HomeTaskStatus {
	switch model.CollaborationTaskStatus(status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING:
		return model.HomeTaskStatus_HOME_TASK_STATUS_PENDING
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		return model.HomeTaskStatus_HOME_TASK_STATUS_RUNNING
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		return model.HomeTaskStatus_HOME_TASK_STATUS_NEEDS_USER
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED:
		return model.HomeTaskStatus_HOME_TASK_STATUS_COMPLETED
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED:
		return model.HomeTaskStatus_HOME_TASK_STATUS_FAILED
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return model.HomeTaskStatus_HOME_TASK_STATUS_CANCELLED
	default:
		return model.HomeTaskStatus_HOME_TASK_STATUS_UNSPECIFIED
	}
}

func homeTaskRunProgress(status model.HomeTaskStatus) uint32 {
	if status == model.HomeTaskStatus_HOME_TASK_STATUS_COMPLETED {
		return 100
	}
	return 0
}

func homeTaskRunBriefID(execution *GoalExecutionSnapshot) string {
	if execution != nil &&
		execution.Task != nil &&
		strings.TrimSpace(execution.Task.GoalID) == "" {
		return "task:" + strings.TrimSpace(execution.Task.TaskID)
	}
	return homeGoalResultBriefID(execution)
}

type homeAgentConfig struct {
	Avatar string `json:"avatar"`
	Pinned bool   `json:"pinned"`
}

func decodeHomeAgentConfig(raw string) homeAgentConfig {
	var config homeAgentConfig
	_ = json.Unmarshal([]byte(raw), &config)
	return config
}

func maxHomeRevision(current uint64, updatedAt time.Time) uint64 {
	if updatedAt.IsZero() {
		return current
	}
	value := updatedAt.UTC().UnixNano()
	if value > 0 && uint64(value) > current {
		return uint64(value)
	}
	return current
}
