package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxGoalTitleBytes          = 256
	maxGoalOutcomeBytes        = 16 * 1024
	maxGoalWorkspaceIDBytes    = 64
	maxGoalIdempotencyKeyBytes = 160
	maxGoalContractItems       = 64
	maxGoalContractItemBytes   = 4 * 1024
	maxGoalCriterionIDBytes    = 128
	maxGoalEvaluatorBytes      = 128

	goalUpdateCommand = "update_agent_goal"
	goalReviewCommand = "review_agent_goal"
)

type goalUpdatePayload struct {
	GoalID             string                                `json:"goal_id"`
	Outcome            string                                `json:"outcome"`
	NonGoals           []string                              `json:"non_goals"`
	Constraints        []string                              `json:"constraints"`
	Budget             *model.AgentGoalBudget                `json:"budget"`
	AcceptanceCriteria []*model.AgentGoalAcceptanceCriterion `json:"acceptance_criteria"`
	ExpectedRevision   uint64                                `json:"expected_revision"`
}

type goalReviewPayload struct {
	GoalID           string `json:"goal_id"`
	ExpectedRevision uint64 `json:"expected_revision"`
}

type GoalService struct {
	db    *gorm.DB
	now   func() time.Time
	newID func() string
}

func NewGoalService(db *gorm.DB) *GoalService {
	return &GoalService{
		db:  db,
		now: time.Now,
		newID: func() string {
			return "goal_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		},
	}
}

func (s *GoalService) CreateDraft(
	ctx context.Context,
	ownerPTID string,
	req *model.CreateAgentGoalRequest,
) (*model.AgentGoal, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	if s == nil || s.db == nil {
		return nil, goalInternal("Goal persistence is unavailable", nil)
	}
	if req == nil {
		return nil, goalInvalid("Goal request is required")
	}

	title := strings.TrimSpace(req.GetTitle())
	outcome := strings.TrimSpace(req.GetOutcome())
	workspaceID := strings.TrimSpace(req.GetWorkspaceId())
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	if title == "" || len(title) > maxGoalTitleBytes {
		return nil, goalInvalid("Goal title is required and must not exceed 256 bytes")
	}
	if outcome == "" || len(outcome) > maxGoalOutcomeBytes {
		return nil, goalInvalid("Goal outcome is required and must not exceed 16384 bytes")
	}
	if len(workspaceID) > maxGoalWorkspaceIDBytes {
		return nil, goalInvalid("Goal workspace_id must not exceed 64 bytes")
	}
	if idempotencyKey == "" || len(idempotencyKey) > maxGoalIdempotencyKeyBytes {
		return nil, goalInvalid("Goal idempotency_key is required and must not exceed 160 bytes")
	}
	if req.GetExpectedRevision() != 0 {
		return nil, goalInvalid("Goal creation expected_revision must be 0")
	}

	payloadHash := goalCreatePayloadHash(title, outcome, workspaceID)
	now := s.now().UTC()
	record := &persistence.AgentGoal{
		GoalID:                 s.newID(),
		OwnerPTID:              ownerPTID,
		WorkspaceID:            workspaceID,
		Title:                  title,
		Outcome:                outcome,
		NonGoalsJSON:           []byte("[]"),
		ConstraintsJSON:        []byte("[]"),
		BudgetJSON:             []byte("{}"),
		AcceptanceCriteriaJSON: []byte("[]"),
		Status:                 int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT),
		Revision:               1,
		GraphRevision:          0,
		AcceptanceRevision:     0,
		CreateIdempotencyKey:   idempotencyKey,
		CreatePayloadHash:      payloadHash,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	var selected *persistence.AgentGoal
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "owner_ptid"},
				{Name: "create_idempotency_key"},
			},
			DoNothing: true,
		}).Create(record)
		if result.Error != nil {
			return goalInternal("Create Goal draft", result.Error)
		}
		if result.RowsAffected == 1 {
			selected = record
			return nil
		}

		var existing persistence.AgentGoal
		if err := tx.
			Where(
				"owner_ptid = ? AND create_idempotency_key = ?",
				ownerPTID,
				idempotencyKey,
			).
			First(&existing).Error; err != nil {
			return goalRecordError("Goal draft", record.GoalID, err)
		}
		if existing.CreatePayloadHash != payloadHash {
			return errcode.NewAdmissionDuplicateConflict(
				idempotencyKey,
				existing.GoalID,
			)
		}
		selected = &existing
		return nil
	})
	if err != nil {
		return nil, err
	}
	return goalModel(selected)
}

func (s *GoalService) Get(
	ctx context.Context,
	ownerPTID string,
	goalID string,
) (*model.AgentGoal, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	goalID = strings.TrimSpace(goalID)
	if goalID == "" {
		return nil, goalInvalid("goal_id is required")
	}
	if s == nil || s.db == nil {
		return nil, goalInternal("Goal persistence is unavailable", nil)
	}

	var record persistence.AgentGoal
	if err := s.db.WithContext(ctx).
		Where("goal_id = ?", goalID).
		First(&record).Error; err != nil {
		return nil, goalRecordError("Goal", goalID, err)
	}
	if record.OwnerPTID != ownerPTID {
		return nil, errcode.NewOwnershipForbiddenActor("goal", goalID)
	}
	return goalModel(&record)
}

func (s *GoalService) UpdateContract(
	ctx context.Context,
	ownerPTID string,
	req *model.UpdateAgentGoalRequest,
) (*model.AgentGoal, error) {
	if err := validateGoalMutationInput(s, ownerPTID, req); err != nil {
		return nil, err
	}

	payload, err := normalizedGoalUpdatePayload(req)
	if err != nil {
		return nil, err
	}
	payloadHash := goalPayloadHash(payload)
	return s.runGoalMutation(
		ctx,
		strings.TrimSpace(ownerPTID),
		payload.GoalID,
		payload.ExpectedRevision,
		goalUpdateCommand,
		strings.TrimSpace(req.GetIdempotencyKey()),
		payloadHash,
		func(record *persistence.AgentGoal) error {
			if model.AgentGoalStatus(record.Status) !=
				model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT {
				return goalInvalidState(record.GoalID, "Goal contract is no longer editable")
			}
			nonGoalsJSON, marshalErr := json.Marshal(payload.NonGoals)
			if marshalErr != nil {
				return goalInternal("Encode Goal non-goals", marshalErr)
			}
			constraintsJSON, marshalErr := json.Marshal(payload.Constraints)
			if marshalErr != nil {
				return goalInternal("Encode Goal constraints", marshalErr)
			}
			budgetJSON, marshalErr := json.Marshal(payload.Budget)
			if marshalErr != nil {
				return goalInternal("Encode Goal budget", marshalErr)
			}
			criteriaJSON, marshalErr := json.Marshal(payload.AcceptanceCriteria)
			if marshalErr != nil {
				return goalInternal("Encode Goal acceptance criteria", marshalErr)
			}
			record.Outcome = payload.Outcome
			record.NonGoalsJSON = nonGoalsJSON
			record.ConstraintsJSON = constraintsJSON
			record.BudgetJSON = budgetJSON
			record.AcceptanceCriteriaJSON = criteriaJSON
			return nil
		},
	)
}

func (s *GoalService) Review(
	ctx context.Context,
	ownerPTID string,
	req *model.ReviewAgentGoalRequest,
) (*model.AgentGoal, error) {
	if err := validateGoalMutationInput(s, ownerPTID, req); err != nil {
		return nil, err
	}
	payload := goalReviewPayload{
		GoalID:           strings.TrimSpace(req.GetGoalId()),
		ExpectedRevision: req.GetExpectedRevision(),
	}
	return s.runGoalMutation(
		ctx,
		strings.TrimSpace(ownerPTID),
		payload.GoalID,
		payload.ExpectedRevision,
		goalReviewCommand,
		strings.TrimSpace(req.GetIdempotencyKey()),
		goalPayloadHash(payload),
		func(record *persistence.AgentGoal) error {
			if model.AgentGoalStatus(record.Status) !=
				model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT {
				return goalInvalidState(record.GoalID, "Only a draft Goal can enter review")
			}
			if admissionErr := validateReviewedGoalAdmission(record); admissionErr != nil {
				return admissionErr
			}
			record.Status = int32(
				model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING,
			)
			return nil
		},
	)
}

type goalMutationRequest interface {
	GetGoalId() string
	GetExpectedRevision() uint64
	GetIdempotencyKey() string
}

func validateGoalMutationInput(
	service *GoalService,
	ownerPTID string,
	req goalMutationRequest,
) error {
	if strings.TrimSpace(ownerPTID) == "" {
		return goalUnauthorized()
	}
	if service == nil || service.db == nil {
		return goalInternal("Goal persistence is unavailable", nil)
	}
	if req == nil {
		return goalInvalid("Goal mutation request is required")
	}
	if strings.TrimSpace(req.GetGoalId()) == "" {
		return goalInvalid("Goal goal_id is required")
	}
	if req.GetExpectedRevision() == 0 {
		return goalInvalid("Goal expected_revision is required")
	}
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	if idempotencyKey == "" || len(idempotencyKey) > maxGoalIdempotencyKeyBytes {
		return goalInvalid(
			"Goal idempotency_key is required and must not exceed 160 bytes",
		)
	}
	return nil
}

func normalizedGoalUpdatePayload(
	req *model.UpdateAgentGoalRequest,
) (*goalUpdatePayload, error) {
	outcome := strings.TrimSpace(req.GetOutcome())
	if outcome == "" || len(outcome) > maxGoalOutcomeBytes {
		return nil, goalInvalid(
			"Goal outcome is required and must not exceed 16384 bytes",
		)
	}
	nonGoals, err := normalizeGoalContractItems("non_goals", req.GetNonGoals())
	if err != nil {
		return nil, err
	}
	constraints, err := normalizeGoalContractItems(
		"constraints",
		req.GetConstraints(),
	)
	if err != nil {
		return nil, err
	}
	if req.GetBudget() == nil {
		return nil, goalInvalid("Goal budget is required")
	}
	budget := &model.AgentGoalBudget{
		MaxTokens:        req.GetBudget().GetMaxTokens(),
		WallTimeMs:       req.GetBudget().GetWallTimeMs(),
		MaxParallelTasks: req.GetBudget().GetMaxParallelTasks(),
	}
	if req.GetBudget().MaxCost != nil {
		maxCost := req.GetBudget().GetMaxCost()
		if maxCost < 0 || math.IsNaN(maxCost) || math.IsInf(maxCost, 0) {
			return nil, goalInvalid("Goal budget max_cost must be finite and not negative")
		}
		budget.MaxCost = &maxCost
	}
	if len(req.GetAcceptanceCriteria()) > maxGoalContractItems {
		return nil, goalInvalid("Goal acceptance_criteria must not exceed 64 items")
	}
	criteria := make(
		[]*model.AgentGoalAcceptanceCriterion,
		0,
		len(req.GetAcceptanceCriteria()),
	)
	for _, criterion := range req.GetAcceptanceCriteria() {
		if criterion == nil {
			return nil, goalInvalid("Goal acceptance criterion is required")
		}
		criterionID := strings.TrimSpace(criterion.GetCriterionId())
		description := strings.TrimSpace(criterion.GetDescription())
		evaluator := strings.TrimSpace(criterion.GetEvaluator())
		if criterionID == "" || len(criterionID) > maxGoalCriterionIDBytes {
			return nil, goalInvalid(
				"Goal acceptance criterion_id is required and must not exceed 128 bytes",
			)
		}
		if description == "" || len(description) > maxGoalContractItemBytes {
			return nil, goalInvalid(
				"Goal acceptance description is required and must not exceed 4096 bytes",
			)
		}
		if evaluator == "" || len(evaluator) > maxGoalEvaluatorBytes {
			return nil, goalInvalid(
				"Goal acceptance evaluator is required and must not exceed 128 bytes",
			)
		}
		criteria = append(criteria, &model.AgentGoalAcceptanceCriterion{
			CriterionId: criterionID,
			Description: description,
			Evaluator:   evaluator,
			Required:    criterion.GetRequired(),
		})
	}
	return &goalUpdatePayload{
		GoalID:             strings.TrimSpace(req.GetGoalId()),
		Outcome:            outcome,
		NonGoals:           nonGoals,
		Constraints:        constraints,
		Budget:             budget,
		AcceptanceCriteria: criteria,
		ExpectedRevision:   req.GetExpectedRevision(),
	}, nil
}

func normalizeGoalContractItems(field string, values []string) ([]string, error) {
	if len(values) > maxGoalContractItems {
		return nil, goalInvalid("Goal " + field + " must not exceed 64 items")
	}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > maxGoalContractItemBytes {
			return nil, goalInvalid(
				"Goal " + field + " items must be non-empty and not exceed 4096 bytes",
			)
		}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

func (s *GoalService) runGoalMutation(
	ctx context.Context,
	ownerPTID string,
	goalID string,
	expectedRevision uint64,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	mutate func(*persistence.AgentGoal) error,
) (*model.AgentGoal, error) {
	var selected *model.AgentGoal
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := loadGoalCommandReplayTx(
			tx,
			ownerPTID,
			commandKind,
			idempotencyKey,
			payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			selected = replayed
			return nil
		}

		record, loadErr := loadOwnedGoalTx(tx, ownerPTID, goalID)
		if loadErr != nil {
			return loadErr
		}
		if record.Revision != expectedRevision {
			return errcode.NewLifecycleStaleVersion(
				goalID,
				expectedRevision,
				record.Revision,
			)
		}
		if mutateErr := mutate(record); mutateErr != nil {
			return mutateErr
		}

		record.Revision++
		record.UpdatedAt = s.now().UTC()
		update := tx.Model(&persistence.AgentGoal{}).
			Where("goal_id = ? AND revision = ?", goalID, expectedRevision).
			Updates(map[string]any{
				"outcome":                  record.Outcome,
				"non_goals_json":           record.NonGoalsJSON,
				"constraints_json":         record.ConstraintsJSON,
				"budget_json":              record.BudgetJSON,
				"acceptance_criteria_json": record.AcceptanceCriteriaJSON,
				"status":                   record.Status,
				"revision":                 record.Revision,
				"updated_at":               record.UpdatedAt,
			})
		if update.Error != nil {
			return goalInternal("Update Goal contract", update.Error)
		}
		if update.RowsAffected != 1 {
			return goalRevisionConflictTx(tx, goalID, expectedRevision)
		}

		goal, modelErr := goalModel(record)
		if modelErr != nil {
			return modelErr
		}
		if storeErr := storeGoalCommandTx(
			tx,
			ownerPTID,
			commandKind,
			idempotencyKey,
			payloadHash,
			goal,
		); storeErr != nil {
			return storeErr
		}
		selected = goal
		return nil
	})
	if err == nil {
		return selected, nil
	}
	replayed, replayErr := loadGoalCommandReplayTx(
		s.db.WithContext(ctx),
		ownerPTID,
		commandKind,
		idempotencyKey,
		payloadHash,
	)
	if replayErr != nil {
		return nil, replayErr
	}
	if replayed != nil {
		return replayed, nil
	}
	return nil, err
}

func loadOwnedGoalTx(
	tx *gorm.DB,
	ownerPTID string,
	goalID string,
) (*persistence.AgentGoal, error) {
	var record persistence.AgentGoal
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("goal_id = ?", goalID).
		First(&record).Error; err != nil {
		return nil, goalRecordError("Goal", goalID, err)
	}
	if record.OwnerPTID != ownerPTID {
		return nil, errcode.NewOwnershipForbiddenActor("goal", goalID)
	}
	return &record, nil
}

func goalRevisionConflictTx(
	tx *gorm.DB,
	goalID string,
	expectedRevision uint64,
) error {
	var record persistence.AgentGoal
	if err := tx.Select("revision").
		Where("goal_id = ?", goalID).
		First(&record).Error; err != nil {
		return goalRecordError("Goal", goalID, err)
	}
	return errcode.NewLifecycleStaleVersion(
		goalID,
		expectedRevision,
		record.Revision,
	)
}

func loadGoalCommandReplayTx(
	tx *gorm.DB,
	ownerPTID string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*model.AgentGoal, error) {
	var command persistence.RevisionCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ownerPTID,
		commandKind,
		idempotencyKey,
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, goalInternal("Read Goal command replay", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, errcode.NewAdmissionDuplicateConflict(
			idempotencyKey,
			command.ID,
		)
	}
	goal := &model.AgentGoal{}
	if err := protojson.Unmarshal([]byte(command.ResponseJSON), goal); err != nil {
		return nil, goalInternal("Decode Goal command replay", err)
	}
	return goal, nil
}

func storeGoalCommandTx(
	tx *gorm.DB,
	ownerPTID string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	goal *model.AgentGoal,
) error {
	responseJSON, err := protojson.Marshal(goal)
	if err != nil {
		return goalInternal("Encode Goal command replay", err)
	}
	return tx.Create(&persistence.RevisionCommand{
		ID:             "gc_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		Ptid:           ownerPTID,
		CommandKind:    commandKind,
		IdempotencyKey: idempotencyKey,
		PayloadHash:    payloadHash,
		ResponseJSON:   string(responseJSON),
	}).Error
}

func goalPayloadHash(payload any) string {
	encoded, _ := json.Marshal(payload)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func goalCreatePayloadHash(title string, outcome string, workspaceID string) string {
	sum := sha256.Sum256([]byte(title + "\x00" + outcome + "\x00" + workspaceID))
	return hex.EncodeToString(sum[:])
}

func goalModel(record *persistence.AgentGoal) (*model.AgentGoal, error) {
	if record == nil {
		return nil, goalInternal("Goal record is missing", nil)
	}

	var nonGoals []string
	if err := json.Unmarshal(record.NonGoalsJSON, &nonGoals); err != nil {
		return nil, goalInternal("Decode Goal non-goals", err)
	}
	var constraints []string
	if err := json.Unmarshal(record.ConstraintsJSON, &constraints); err != nil {
		return nil, goalInternal("Decode Goal constraints", err)
	}
	budget := &model.AgentGoalBudget{}
	if err := json.Unmarshal(record.BudgetJSON, budget); err != nil {
		return nil, goalInternal("Decode Goal budget", err)
	}
	var criteria []*model.AgentGoalAcceptanceCriterion
	if err := json.Unmarshal(record.AcceptanceCriteriaJSON, &criteria); err != nil {
		return nil, goalInternal("Decode Goal acceptance criteria", err)
	}

	goal := &model.AgentGoal{
		GoalId:             record.GoalID,
		OwnerPtid:          record.OwnerPTID,
		Title:              record.Title,
		Outcome:            record.Outcome,
		NonGoals:           nonGoals,
		Constraints:        constraints,
		Budget:             budget,
		AcceptanceCriteria: criteria,
		Status:             model.AgentGoalStatus(record.Status),
		Revision:           record.Revision,
		GraphRevision:      record.GraphRevision,
		AcceptanceRevision: record.AcceptanceRevision,
		CreatedAt:          timestamppb.New(record.CreatedAt.UTC()),
		UpdatedAt:          timestamppb.New(record.UpdatedAt.UTC()),
	}
	if record.WorkspaceID != "" {
		workspaceID := record.WorkspaceID
		goal.WorkspaceId = &workspaceID
	}
	return goal, nil
}

func goalRecordError(resource string, resourceID string, cause error) error {
	if errors.Is(cause, gorm.ErrRecordNotFound) {
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			resource+" not found",
			cause,
		)
	}
	return goalInternal("Load "+resource+" "+resourceID, cause)
}

func goalInvalid(message string) error {
	return errcode.New(
		errcode.AgentInvalidRequest,
		http.StatusBadRequest,
		message,
		nil,
	)
}

func goalInvalidState(goalID string, message string) error {
	return errcode.New(
		errcode.AgentInvalidSourceState,
		http.StatusConflict,
		message+" for "+goalID,
		nil,
	)
}

func goalUnauthorized() error {
	return errcode.New(
		errcode.AgentUnauthorized,
		http.StatusUnauthorized,
		"authenticated actor PTID is required",
		nil,
	)
}

func goalInternal(message string, cause error) error {
	return errcode.New(
		errcode.AgentInternal,
		http.StatusInternalServerError,
		message,
		cause,
	)
}
