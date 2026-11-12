package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// LogicalArtifactHandlers exposes the TW-D3 versioned artifact contract.
type LogicalArtifactHandlers struct {
	artifacts *service.LogicalArtifactService
}

func NewLogicalArtifactHandlers(artifacts *service.LogicalArtifactService) *LogicalArtifactHandlers {
	return &LogicalArtifactHandlers{artifacts: artifacts}
}

func (h *LogicalArtifactHandlers) HandleClaimVersion(
	ctx context.Context,
	req *model.ClaimArtifactVersionRequest,
) (*model.ClaimArtifactVersionResponse, error) {
	artifact, version, err := h.artifacts.ClaimVersion(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ClaimArtifactVersionResponse{
		Artifact: service.LogicalArtifactProto(artifact),
		Version:  service.ArtifactVersionProto(version),
	}, nil
}

func (h *LogicalArtifactHandlers) HandleListTaskArtifacts(
	ctx context.Context,
	req *model.ListTaskArtifactsRequest,
) (*model.ListTaskArtifactsResponse, error) {
	rows, err := h.artifacts.ListArtifacts(ctx, subjectActorID(ctx), req.GetConversationId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	artifacts := make([]*model.LogicalArtifact, 0, len(rows))
	for i := range rows {
		artifacts = append(artifacts, service.LogicalArtifactProto(&rows[i]))
	}
	return &model.ListTaskArtifactsResponse{Artifacts: artifacts}, nil
}

func (h *LogicalArtifactHandlers) HandleListArtifactVersions(
	ctx context.Context,
	req *model.ListArtifactVersionsRequest,
) (*model.ListArtifactVersionsResponse, error) {
	rows, err := h.artifacts.ListVersions(ctx, subjectActorID(ctx), req.GetArtifactId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	versions := make([]*model.ArtifactVersion, 0, len(rows))
	for i := range rows {
		versions = append(versions, service.ArtifactVersionProto(&rows[i]))
	}
	return &model.ListArtifactVersionsResponse{Versions: versions}, nil
}

func (h *LogicalArtifactHandlers) HandleGetArtifactVersionBody(
	ctx context.Context,
	req *model.GetArtifactVersionBodyRequest,
) (*model.GetArtifactVersionBodyResponse, error) {
	version, body, err := h.artifacts.GetVersionBody(ctx, subjectActorID(ctx), req.GetVersionId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetArtifactVersionBodyResponse{
		Version: service.ArtifactVersionProto(version),
		Body:    string(body.Body),
	}, nil
}

func (h *LogicalArtifactHandlers) HandleSubmitArtifactFeedback(
	ctx context.Context,
	req *model.SubmitArtifactFeedbackRequest,
) (*model.SubmitArtifactFeedbackResponse, error) {
	feedback, err := h.artifacts.SubmitFeedback(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SubmitArtifactFeedbackResponse{Feedback: service.ArtifactFeedbackProto(feedback)}, nil
}

func (h *LogicalArtifactHandlers) HandleListArtifactFeedback(
	ctx context.Context,
	req *model.ListArtifactFeedbackRequest,
) (*model.ListArtifactFeedbackResponse, error) {
	rows, err := h.artifacts.ListFeedback(ctx, subjectActorID(ctx), req.GetArtifactId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	feedback := make([]*model.ArtifactFeedback, 0, len(rows))
	for i := range rows {
		feedback = append(feedback, service.ArtifactFeedbackProto(&rows[i]))
	}
	return &model.ListArtifactFeedbackResponse{Feedback: feedback}, nil
}

func (h *LogicalArtifactHandlers) HandleRecordArtifactCheck(
	ctx context.Context,
	req *model.RecordArtifactCheckRequest,
) (*model.RecordArtifactCheckResponse, error) {
	check, err := h.artifacts.RecordCheck(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RecordArtifactCheckResponse{Check: service.ArtifactCheckProto(check)}, nil
}

func (h *LogicalArtifactHandlers) HandleListArtifactChecks(
	ctx context.Context,
	req *model.ListArtifactChecksRequest,
) (*model.ListArtifactChecksResponse, error) {
	rows, err := h.artifacts.ListChecks(ctx, subjectActorID(ctx), req.GetArtifactId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	checks := make([]*model.ArtifactCheck, 0, len(rows))
	for i := range rows {
		checks = append(checks, service.ArtifactCheckProto(&rows[i]))
	}
	return &model.ListArtifactChecksResponse{Checks: checks}, nil
}

func (h *LogicalArtifactHandlers) HandleAcceptArtifactVersion(
	ctx context.Context,
	req *model.AcceptArtifactVersionRequest,
) (*model.AcceptArtifactVersionResponse, error) {
	acceptance, err := h.artifacts.AcceptVersion(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	currentVersion, currentErr := h.artifacts.CurrentVersionID(ctx, subjectActorID(ctx), acceptance.ArtifactID)
	if currentErr != nil {
		return nil, toHandlerError(currentErr)
	}
	return &model.AcceptArtifactVersionResponse{
		Acceptance: service.ArtifactAcceptanceProto(acceptance, currentVersion),
	}, nil
}

func (h *LogicalArtifactHandlers) HandleListArtifactAcceptances(
	ctx context.Context,
	req *model.ListArtifactAcceptancesRequest,
) (*model.ListArtifactAcceptancesResponse, error) {
	rows, err := h.artifacts.ListAcceptances(ctx, subjectActorID(ctx), req.GetArtifactId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	currentVersion, currentErr := h.artifacts.CurrentVersionID(ctx, subjectActorID(ctx), req.GetArtifactId())
	if currentErr != nil {
		return nil, toHandlerError(currentErr)
	}
	acceptances := make([]*model.ArtifactAcceptance, 0, len(rows))
	for i := range rows {
		acceptances = append(acceptances, service.ArtifactAcceptanceProto(&rows[i], currentVersion))
	}
	return &model.ListArtifactAcceptancesResponse{Acceptances: acceptances}, nil
}
