// Changelog:
// 2026-04-11 — Wired SkillHandlers to SkillService: replaced 501 stubs with
//   real service calls for HandleListSkills, HandleGetSkill, HandleInstallSkill.
//   GetSkillRequest.SkillID is treated as the skill name for service lookup.
//   InstallSkill defaults to community trust level and empty description.

package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// SkillHandlers exposes HTTP handlers for the skill subsystem.
// Delegates all domain logic to SkillService.
type SkillHandlers struct {
	skillService *service.SkillService
}

func NewSkillHandlers(skillService *service.SkillService) *SkillHandlers {
	return &SkillHandlers{skillService: skillService}
}

// -- Request / Response types ------------------------------------------------

type ListSkillsRequest struct {
	AgentID  string `json:"agent_id"`
	Category string `json:"category"`
}

type SkillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type ListSkillsResponse struct {
	Skills []SkillSummary `json:"skills"`
}

type GetSkillRequest struct {
	AgentID string `json:"agent_id"`
	SkillID string `json:"skill_id"`
}

type GetSkillResponse struct {
	Content string `json:"content"`
}

type InstallSkillRequest struct {
	AgentID string `json:"agent_id"`
	Source  string `json:"source"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

type InstallSkillResponse struct {
	SkillID string `json:"skill_id"`
	Verdict string `json:"verdict"`
}

// -- Handlers ----------------------------------------------------------------

// HandleListSkills returns Tier 1 skill listing: name + description only.
func (h *SkillHandlers) HandleListSkills(ctx context.Context, req *ListSkillsRequest) (*ListSkillsResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	manifests, err := h.skillService.ListSkills(ctx, req.AgentID)
	if err != nil {
		logger.Errorf(ctx, "HandleListSkills failed: agent_id=%s, err=%v", req.AgentID, err)
		return nil, toHandlerError(err)
	}

	resp := &ListSkillsResponse{
		Skills: make([]SkillSummary, 0, len(manifests)),
	}
	for _, m := range manifests {
		resp.Skills = append(resp.Skills, SkillSummary{
			Name:        m.Name,
			Description: m.Description,
		})
	}

	return resp, nil
}

// HandleGetSkill returns Tier 2 full skill content.
// SkillID in the request is treated as the skill name.
func (h *SkillHandlers) HandleGetSkill(ctx context.Context, req *GetSkillRequest) (*GetSkillResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.SkillID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "skill_id is required", nil))
	}

	manifest, err := h.skillService.GetSkill(ctx, req.AgentID, req.SkillID)
	if err != nil {
		logger.Errorf(ctx, "HandleGetSkill failed: agent_id=%s, skill_name=%s, err=%v",
			req.AgentID, req.SkillID, err)
		return nil, toHandlerError(err)
	}

	return &GetSkillResponse{
		Content: manifest.Content,
	}, nil
}

// HandleInstallSkill creates a new skill with security scanning.
// Defaults to community trust level. Verdict defaults to "safe" when scan
// result is nil.
func (h *SkillHandlers) HandleInstallSkill(ctx context.Context, req *InstallSkillRequest) (*InstallSkillResponse, error) {
	if req.AgentID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.Name == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "name is required", nil))
	}

	manifest, scanResult, err := h.skillService.CreateSkill(
		ctx,
		req.AgentID,
		req.Name,
		"",
		req.Content,
		domain.TrustLevelCommunity,
	)
	if err != nil {
		logger.Errorf(ctx, "HandleInstallSkill failed: agent_id=%s, name=%s, err=%v",
			req.AgentID, req.Name, err)
		return nil, toHandlerError(err)
	}

	verdict := "safe"
	if scanResult != nil {
		verdict = string(scanResult.Verdict)
	}

	return &InstallSkillResponse{
		SkillID: manifest.SkillID,
		Verdict: verdict,
	}, nil
}
