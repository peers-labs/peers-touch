package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxGoalTitleBytes          = 256
	maxGoalOutcomeBytes        = 16 * 1024
	maxGoalWorkspaceIDBytes    = 64
	maxGoalIdempotencyKeyBytes = 160
)

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
