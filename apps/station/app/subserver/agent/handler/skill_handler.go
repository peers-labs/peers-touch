// Changelog:
// 2026-04-11 — Wired SkillHandlers to SkillService: replaced 501 stubs with
//   real service calls for HandleListSkills, HandleGetSkill, HandleInstallSkill.
//   GetSkillRequest.SkillID is treated as the skill name for service lookup.
//   InstallSkill defaults to community trust level and empty description.
// 2026-04-15 — Request/response types from generated model (skill.pb.go).

package handler

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SkillHandlers exposes HTTP handlers for the skill subsystem.
// Delegates all domain logic to SkillService.
type SkillHandlers struct {
	skillService *service.SkillService
}

func NewSkillHandlers(skillService *service.SkillService) *SkillHandlers {
	return &SkillHandlers{skillService: skillService}
}

// HandleListSkills returns Tier 1 skill listing: name + description only.
func (h *SkillHandlers) HandleListSkills(ctx context.Context, req *model.ListSkillsRequest) (*model.ListSkillsResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	manifests, err := h.skillService.ListSkills(ctx, req.GetAgentId())
	if err != nil {
		logger.Errorf(ctx, "HandleListSkills failed: agent_id=%s, err=%v", req.GetAgentId(), err)
		return nil, toHandlerError(err)
	}

	cat := strings.TrimSpace(req.GetCategory())
	out := make([]*model.SkillManifest, 0, len(manifests))
	for i := range manifests {
		if cat != "" && !strings.EqualFold(manifests[i].Category, cat) {
			continue
		}
		out = append(out, skillManifestToProto(&manifests[i]))
	}

	return &model.ListSkillsResponse{Skills: out}, nil
}

// HandleGetSkill returns Tier 2 full skill content.
// SkillID in the request is treated as the skill name.
func (h *SkillHandlers) HandleGetSkill(ctx context.Context, req *model.GetSkillRequest) (*model.GetSkillResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.GetSkillId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "skill_id is required", nil))
	}

	manifest, err := h.skillService.GetSkill(ctx, req.GetAgentId(), req.GetSkillId())
	if err != nil {
		logger.Errorf(ctx, "HandleGetSkill failed: agent_id=%s, skill_name=%s, err=%v",
			req.GetAgentId(), req.GetSkillId(), err)
		return nil, toHandlerError(err)
	}

	return &model.GetSkillResponse{
		Skill:       skillManifestToProto(manifest),
		FileContent: manifest.Content,
	}, nil
}

// HandleInstallSkill creates a new skill with security scanning.
func (h *SkillHandlers) HandleInstallSkill(ctx context.Context, req *model.InstallSkillRequest) (*model.InstallSkillResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}
	if req.GetName() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "name is required", nil))
	}

	trust := domain.TrustLevelCommunity
	if tl := strings.TrimSpace(req.GetTrustLevel()); tl != "" {
		trust = domain.TrustLevel(tl)
	}

	manifest, scanResult, err := h.skillService.CreateSkill(
		ctx,
		req.GetAgentId(),
		req.GetName(),
		"",
		req.GetContent(),
		trust,
	)
	if err != nil {
		logger.Errorf(ctx, "HandleInstallSkill failed: agent_id=%s, name=%s, err=%v",
			req.GetAgentId(), req.GetName(), err)
		return nil, toHandlerError(err)
	}

	resp := &model.InstallSkillResponse{
		SkillId:   manifest.SkillID,
		Installed: true,
	}
	if scanResult != nil {
		resp.Verdict = string(scanResult.Verdict)
		resp.ScanResult = scanResultToProto(scanResult)
	} else {
		resp.Verdict = "safe"
	}

	return resp, nil
}

func skillManifestToProto(m *domain.SkillManifest) *model.SkillManifest {
	if m == nil {
		return nil
	}
	out := &model.SkillManifest{
		SkillId:     m.SkillID,
		AgentId:     m.AgentID,
		Name:        m.Name,
		Description: m.Description,
		Category:    m.Category,
		Platforms:   append([]string(nil), m.Platforms...),
		Content:     m.Content,
		Source:      m.Source,
		TrustLevel:  string(m.TrustLevel),
		ScanVerdict: string(m.ScanVerdict),
		Version:     int32(m.Version),
	}
	if m.Conditions != nil {
		out.Conditions = &model.SkillConditions{
			FallbackForToolsets: append([]string(nil), m.Conditions.FallbackForToolsets...),
			RequiresTools:       append([]string(nil), m.Conditions.RequiresTools...),
		}
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt)
	}
	if !m.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(m.UpdatedAt)
	}
	return out
}

func scanResultToProto(s *domain.ScanResult) *model.SkillScanResult {
	if s == nil {
		return nil
	}
	out := &model.SkillScanResult{
		SkillName:  s.SkillName,
		Source:     s.Source,
		TrustLevel: string(s.TrustLevel),
		Verdict:    string(s.Verdict),
		Summary:    s.Summary,
	}
	if !s.ScannedAt.IsZero() {
		out.ScannedAt = timestamppb.New(s.ScannedAt)
	}
	for i := range s.Findings {
		f := &s.Findings[i]
		out.Findings = append(out.Findings, &model.SkillFinding{
			PatternId:   f.PatternID,
			Severity:    f.Severity,
			Category:    f.Category,
			File:        f.File,
			Line:        int32(f.Line),
			Match:       f.Match,
			Description: f.Description,
		})
	}
	return out
}
