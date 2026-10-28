package service

import (
	"context"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func (s *TurnService) ListTurnArtifacts(
	ctx context.Context,
	actorPTID string,
	req *model.ListTurnArtifactsRequest,
) ([]*model.TurnArtifact, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" || req == nil || strings.TrimSpace(req.GetConversationId()) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor and conversation_id are required",
			nil,
		)
	}
	if len(req.GetTurnIds()) > 100 {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"turn_ids cannot exceed 100",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.WithContext(ctx).
		Where("actor_ptid = ? AND conversation_id = ?", actorPTID, strings.TrimSpace(req.GetConversationId())).
		Order("created_at ASC, id ASC")
	if len(req.GetTurnIds()) > 0 {
		query = query.Where("turn_id IN ?", req.GetTurnIds())
	}
	var rows []persistence.TurnArtifact
	if err := query.Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list turn artifacts", err)
	}
	artifacts := make([]*model.TurnArtifact, 0, len(rows))
	for i := range rows {
		artifacts = append(artifacts, turnArtifactToProto(&rows[i]))
	}
	return artifacts, nil
}

func (s *TurnService) GetTurnArtifact(
	ctx context.Context,
	actorPTID string,
	artifactID string,
) (*model.TurnArtifact, error) {
	row, err := s.getTurnArtifactRow(ctx, actorPTID, artifactID)
	if err != nil {
		return nil, err
	}
	return turnArtifactToProto(row), nil
}

func (s *TurnService) getTurnArtifactRow(
	ctx context.Context,
	actorPTID string,
	artifactID string,
) (*persistence.TurnArtifact, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	artifactID = strings.TrimSpace(artifactID)
	if actorPTID == "" || artifactID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and artifact_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.TurnArtifact
	if err := db.WithContext(ctx).
		Where("id = ? AND actor_ptid = ?", artifactID, actorPTID).
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "turn artifact not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get turn artifact", err)
	}
	return &row, nil
}

func turnArtifactToProto(row *persistence.TurnArtifact) *model.TurnArtifact {
	if row == nil {
		return nil
	}
	return &model.TurnArtifact{
		ArtifactId: row.ID,
		TurnId:     row.TurnID,
		AgentId:    row.AgentID,
		ToolCallId: row.ToolCallID,
		Kind:       model.TurnArtifactKind_TURN_ARTIFACT_KIND_FILE,
		Name:       row.Name,
		Size:       row.Size,
		Sha256:     row.SHA256,
		Locator: &model.TurnArtifactLocator{
			ClientLocalRef:   row.ClientLocalRef,
			ClientDeviceId:   row.ClientDeviceID,
			StationObjectRef: row.StationObjectRef,
		},
		CreatedAt: timestamppb.New(row.CreatedAt),
	}
}
