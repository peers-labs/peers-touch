// Changelog:
// 2026-04-11 — Initial implementation: Skill CRUD service with progressive
//              disclosure (Tier 1 list / Tier 2 full), security scanning
//              integration, content validation, fuzzy patch, and conditional
//              activation index building.
// 2026-04-11 — Skill Versioning & Rollback: added recordVersion, ListVersions,
//              RollbackSkill, ToggleSkill for "dumbed-down agent" recovery.
//              BuildSkillIndex now filters disabled skills. toManifest maps
//              the new Enabled field.
// 2026-04-11 — Growth Metrics Integration: injected GrowthMetricsService dependency,
//   emit RecordEvent on Create (skill_created), Patch (skill_patched), Delete (skill_deleted).

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	maxDescriptionLen = 1024
	maxContentLen     = 100000
)

type SkillService struct {
	guard         *SkillsGuardService
	growthMetrics *GrowthMetricsService
}

func NewSkillService(guard *SkillsGuardService, growthMetrics *GrowthMetricsService) *SkillService {
	return &SkillService{guard: guard, growthMetrics: growthMetrics}
}

func (s *SkillService) recordGrowthEvent(ctx context.Context, agentID, eventType, target, details string) {
	if s.growthMetrics == nil {
		return
	}
	s.growthMetrics.RecordEvent(ctx, agentID, eventType, CategorySkill, target, details, "success")
}

// ListSkills returns Tier 1 progressive disclosure: name + description only,
// content is cleared from every returned manifest.
func (s *SkillService) ListSkills(ctx context.Context, agentID string) ([]domain.SkillManifest, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var rows []persistence.Skill
	if err := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		logger.Errorf(ctx, "skill list query failed: agent_id=%s, err=%v", agentID, err)
		return nil, errcode.New(errcode.AgentInternal, 500, "failed to list skills", err)
	}

	manifests := make([]domain.SkillManifest, 0, len(rows))
	for _, row := range rows {
		m := s.toManifest(&row)
		m.Content = ""
		manifests = append(manifests, m)
	}

	return manifests, nil
}

// GetSkill returns Tier 2 progressive disclosure: full SKILL.md content.
func (s *SkillService) GetSkill(ctx context.Context, agentID, name string) (*domain.SkillManifest, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	row, err := s.findByName(ctx, db, agentID, name)
	if err != nil {
		return nil, err
	}

	m := s.toManifest(row)
	return &m, nil
}

// GetSkillByID returns a skill by durable ID for UI/API callers.
func (s *SkillService) GetSkillByID(ctx context.Context, agentID, skillID string) (*domain.SkillManifest, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	row, err := s.findByID(ctx, db, agentID, skillID)
	if err != nil {
		return nil, err
	}

	m := s.toManifest(row)
	return &m, nil
}

// CreateSkill validates content, runs security scan, checks install policy,
// and persists the skill if allowed.
func (s *SkillService) CreateSkill(
	ctx context.Context,
	agentID, name, description, content string,
	trustLevel domain.TrustLevel,
) (*domain.SkillManifest, *domain.ScanResult, error) {

	if err := s.validateContent(description, content); err != nil {
		return nil, nil, err
	}

	scanResult := s.guard.ScanContent(name, content, trustLevel)

	policy := domain.ResolveInstallPolicy(trustLevel, scanResult.Verdict)
	if policy == domain.InstallPolicyBlock {
		logger.Warnf(ctx, "skill install blocked: name=%s, verdict=%s, trust=%s",
			name, scanResult.Verdict, trustLevel)
		return nil, scanResult, errcode.New(
			errcode.AgentInvalidRequest, 403,
			fmt.Sprintf("skill '%s' blocked by install policy (verdict=%s)", name, scanResult.Verdict),
			nil,
		)
	}

	if policy == domain.InstallPolicyAsk {
		logger.Infof(ctx, "skill install requires confirmation: name=%s, verdict=%s", name, scanResult.Verdict)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, scanResult, err
	}

	now := time.Now()
	verdictStr := string(scanResult.Verdict)

	row := persistence.Skill{
		ID:          generateID("skill"),
		AgentID:     agentID,
		Name:        name,
		Description: description,
		Content:     content,
		TrustLevel:  string(trustLevel),
		ScanVerdict: &verdictStr,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		logger.Errorf(ctx, "skill create failed: name=%s, err=%v", name, err)
		return nil, scanResult, errcode.New(errcode.AgentInternal, 500, "failed to create skill", err)
	}

	// Record initial version for rollback history.
	s.recordVersion(ctx, db, &row, "create")

	logger.Infof(ctx, "skill created: id=%s, name=%s, verdict=%s, policy=%s",
		row.ID, name, scanResult.Verdict, policy)

	s.recordGrowthEvent(ctx, agentID, EventSkillCreated, name, row.ID)

	m := s.toManifest(&row)
	return &m, scanResult, nil
}

// PatchSkill performs a fuzzy find-and-replace in the skill content.
func (s *SkillService) PatchSkill(ctx context.Context, agentID, name, oldStr, newStr string) (*domain.SkillManifest, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	row, err := s.findByName(ctx, db, agentID, name)
	if err != nil {
		return nil, err
	}

	idx := strings.Index(row.Content, oldStr)
	if idx == -1 {
		idx = s.fuzzyFind(row.Content, oldStr)
		if idx == -1 {
			return nil, errcode.New(errcode.AgentInvalidRequest, 400,
				fmt.Sprintf("patch target not found in skill '%s'", name), nil)
		}
	}

	patched := row.Content[:idx] + newStr + row.Content[idx+len(oldStr):]

	if err := s.validateContent(row.Description, patched); err != nil {
		return nil, err
	}

	// Record current version before mutation for rollback history.
	s.recordVersion(ctx, db, row, "patch")

	now := time.Now()
	if err := db.WithContext(ctx).
		Model(&persistence.Skill{}).
		Where("id = ?", row.ID).
		Updates(map[string]interface{}{
			"content":    patched,
			"version":    row.Version + 1,
			"updated_at": now,
		}).Error; err != nil {
		logger.Errorf(ctx, "skill patch failed: name=%s, err=%v", name, err)
		return nil, errcode.New(errcode.AgentInternal, 500, "failed to patch skill", err)
	}

	row.Content = patched
	row.Version++
	row.UpdatedAt = now

	logger.Infof(ctx, "skill patched: name=%s, version=%d", name, row.Version)

	s.recordGrowthEvent(ctx, row.AgentID, EventSkillPatched, name, row.ID)

	m := s.toManifest(row)
	return &m, nil
}

// DeleteSkill removes a skill by agent ID and name.
func (s *SkillService) DeleteSkill(ctx context.Context, agentID, name string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	result := db.WithContext(ctx).
		Where("agent_id = ? AND name = ?", agentID, name).
		Delete(&persistence.Skill{})

	if result.Error != nil {
		logger.Errorf(ctx, "skill delete failed: name=%s, err=%v", name, result.Error)
		return errcode.New(errcode.AgentInternal, 500, "failed to delete skill", result.Error)
	}

	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("skill '%s' not found for agent '%s'", name, agentID), nil)
	}

	logger.Infof(ctx, "skill deleted: agent_id=%s, name=%s", agentID, name)

	s.recordGrowthEvent(ctx, agentID, EventSkillDeleted, name, "")

	return nil
}

// UpdateSkill mutates durable skill metadata/content by skill ID and preserves
// Station scan/version authority for content changes.
func (s *SkillService) UpdateSkill(
	ctx context.Context,
	agentID string,
	skillID string,
	name *string,
	description *string,
	content *string,
	enabled *bool,
) (*domain.SkillManifest, *domain.ScanResult, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}

	row, err := s.findByID(ctx, db, agentID, skillID)
	if err != nil {
		return nil, nil, err
	}

	nextName := row.Name
	if name != nil && strings.TrimSpace(*name) != "" {
		nextName = strings.TrimSpace(*name)
	}
	nextDescription := row.Description
	if description != nil {
		nextDescription = *description
	}
	nextContent := row.Content
	contentChanged := false
	if content != nil {
		nextContent = *content
		contentChanged = nextContent != row.Content
	}

	if err := s.validateContent(nextDescription, nextContent); err != nil {
		return nil, nil, err
	}

	updates := map[string]interface{}{
		"name":        nextName,
		"description": nextDescription,
		"updated_at":  time.Now(),
	}
	var scanResult *domain.ScanResult

	if contentChanged {
		trust := domain.TrustLevel(row.TrustLevel)
		scan := s.guard.ScanContent(nextName, nextContent, trust)
		policy := domain.ResolveInstallPolicy(trust, scan.Verdict)
		if policy == domain.InstallPolicyBlock {
			return nil, scan, errcode.New(
				errcode.AgentInvalidRequest, 403,
				fmt.Sprintf("skill '%s' blocked by update policy (verdict=%s)", nextName, scan.Verdict),
				nil,
			)
		}
		s.recordVersion(ctx, db, row, "update")
		verdictStr := string(scan.Verdict)
		updates["content"] = nextContent
		updates["scan_verdict"] = &verdictStr
		updates["version"] = row.Version + 1
		scanResult = scan
	}

	if enabled != nil {
		updates["enabled"] = *enabled
	}

	if err := db.WithContext(ctx).
		Model(&persistence.Skill{}).
		Where("id = ? AND agent_id = ?", skillID, agentID).
		Updates(updates).Error; err != nil {
		logger.Errorf(ctx, "skill update failed: id=%s, err=%v", skillID, err)
		return nil, scanResult, errcode.New(errcode.AgentInternal, 500, "failed to update skill", err)
	}

	updated, err := s.findByID(ctx, db, agentID, skillID)
	if err != nil {
		return nil, scanResult, err
	}
	m := s.toManifest(updated)
	s.recordGrowthEvent(ctx, agentID, EventSkillPatched, updated.Name, updated.ID)
	return &m, scanResult, nil
}

// DeleteSkillByID removes a skill by durable ID for Desktop UI callers.
func (s *SkillService) DeleteSkillByID(ctx context.Context, agentID, skillID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var row persistence.Skill
	if err := db.WithContext(ctx).
		Where("id = ? AND agent_id = ?", skillID, agentID).
		First(&row).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("skill %s not found for agent %s", skillID, agentID), err)
	}

	if err := db.WithContext(ctx).Delete(&persistence.Skill{}, "id = ? AND agent_id = ?", skillID, agentID).Error; err != nil {
		logger.Errorf(ctx, "skill delete failed: id=%s, err=%v", skillID, err)
		return errcode.New(errcode.AgentInternal, 500, "failed to delete skill", err)
	}

	logger.Infof(ctx, "skill deleted: agent_id=%s id=%s name=%s", agentID, skillID, row.Name)
	s.recordGrowthEvent(ctx, agentID, EventSkillDeleted, row.Name, row.ID)
	return nil
}

// BuildSkillIndex generates a system prompt skills index block with
// conditional activation filtering based on platform and tool availability.
// Returns the formatted index string, the count of activated skills, and any error.
func (s *SkillService) BuildSkillIndex(ctx context.Context, agentID string, availableTools []string) (string, int, error) {
	return s.BuildAuthorizedSkillIndex(ctx, agentID, availableTools, nil)
}

func (s *SkillService) BuildAuthorizedSkillIndex(
	ctx context.Context,
	agentID string,
	availableTools []string,
	authorized *AuthorizedCapabilitySet,
) (string, int, error) {
	if authorized == nil {
		return "", 0, capabilityStateError(
			"authorized capability set is required for Skill prompt assembly",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Errorf(ctx, "skill index build failed (db): agent_id=%s, err=%v", agentID, err)
		return "", 0, err
	}

	var rows []persistence.Skill
	if err := db.WithContext(ctx).
		Where("agent_id = ? AND enabled = ?", agentID, true).
		Order("category ASC, name ASC").
		Find(&rows).Error; err != nil {
		logger.Errorf(ctx, "skill index query failed: agent_id=%s, err=%v", agentID, err)
		return "", 0, errcode.New(errcode.AgentInternal, 500, "failed to query skills for index", err)
	}

	if len(rows) == 0 {
		return "", 0, nil
	}

	toolSet := make(map[string]bool, len(availableTools))
	for _, t := range availableTools {
		toolSet[t] = true
	}

	type indexEntry struct {
		category    string
		name        string
		description string
	}

	var entries []indexEntry

	for _, row := range rows {
		capability, ok := authorized.Source(
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_SKILL,
			row.Name,
		)
		if !ok ||
			capability.Manifest.GetCapabilityId() != "skill:"+row.ID ||
			capability.Manifest.GetVersion() != fmt.Sprintf("%d", row.Version) {
			continue
		}
		manifest := s.toManifest(&row)

		if len(manifest.Platforms) > 0 {
			continue
		}

		if s.isFallbackSatisfied(manifest.Conditions, toolSet) {
			continue
		}

		if !s.hasRequiredTools(manifest.Conditions, toolSet) {
			continue
		}

		cat := manifest.Category
		if cat == "" {
			cat = "general"
		}

		entries = append(entries, indexEntry{
			category:    cat,
			name:        manifest.Name,
			description: manifest.Description,
		})
	}

	if len(entries) == 0 {
		return "", 0, nil
	}

	grouped := map[string][]indexEntry{}
	for _, e := range entries {
		grouped[e.category] = append(grouped[e.category], e)
	}

	categories := make([]string, 0, len(grouped))
	for cat := range grouped {
		categories = append(categories, cat)
	}
	sort.Strings(categories)

	var sb strings.Builder

	sb.WriteString("## Skills (mandatory)\n")
	sb.WriteString("Before replying, scan the skills below. If one clearly matches your task,\n")
	sb.WriteString("load it with skill_view(name) and follow its instructions.\n")
	sb.WriteString("If a skill has issues, fix it with skill_manage(action='patch').\n\n")
	sb.WriteString("<available_skills>\n")

	for _, cat := range categories {
		sb.WriteString(fmt.Sprintf("  %s:\n", cat))
		for _, e := range grouped[cat] {
			sb.WriteString(fmt.Sprintf("    - %s: %s\n", e.name, e.description))
		}
	}

	sb.WriteString("</available_skills>")

	return sb.String(), len(entries), nil
}

// RecordSkillUsage updates usage statistics for skills that were loaded during
// a turn. If turnSucceeded is true, ApplyCount is incremented (the skill
// contributed to a successful turn).
func (s *SkillService) RecordSkillUsage(ctx context.Context, agentID string, skillNames []string, turnSucceeded bool) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}

	now := time.Now()
	for _, name := range skillNames {
		updates := map[string]interface{}{
			"view_count":   gorm.Expr("view_count + 1"),
			"last_used_at": now,
			"updated_at":   now,
		}
		if turnSucceeded {
			updates["apply_count"] = gorm.Expr("apply_count + 1")
		}
		db.WithContext(ctx).
			Model(&persistence.Skill{}).
			Where("agent_id = ? AND name = ?", agentID, name).
			Updates(updates)
	}
}

// ── Internal helpers ────────────────────────────────────────────────────────

func (s *SkillService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		logger.Errorf(ctx, "agent database not available: %v", err)
		return nil, errcode.New(errcode.AgentInternal, 500, "database unavailable", err)
	}
	return db, nil
}

func (s *SkillService) findByName(ctx context.Context, db *gorm.DB, agentID, name string) (*persistence.Skill, error) {
	var row persistence.Skill

	err := db.WithContext(ctx).
		Where("agent_id = ? AND name = ?", agentID, name).
		First(&row).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, 404,
				fmt.Sprintf("skill '%s' not found for agent '%s'", name, agentID), nil)
		}
		logger.Errorf(ctx, "skill lookup failed: name=%s, err=%v", name, err)
		return nil, errcode.New(errcode.AgentInternal, 500, "failed to find skill", err)
	}

	return &row, nil
}

func (s *SkillService) validateContent(description, content string) error {
	if len(description) > maxDescriptionLen {
		return errcode.New(errcode.AgentInvalidRequest, 400,
			fmt.Sprintf("description exceeds %d characters", maxDescriptionLen), nil)
	}

	if len(content) > maxContentLen {
		return errcode.New(errcode.AgentInvalidRequest, 400,
			fmt.Sprintf("content exceeds %d characters", maxContentLen), nil)
	}

	return nil
}

func (s *SkillService) toManifest(row *persistence.Skill) domain.SkillManifest {
	m := domain.SkillManifest{
		SkillID:     row.ID,
		AgentID:     row.AgentID,
		Name:        row.Name,
		Description: row.Description,
		Content:     row.Content,
		TrustLevel:  domain.TrustLevel(row.TrustLevel),
		Enabled:     row.Enabled,
		Version:     row.Version,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}

	if row.Category != nil {
		m.Category = *row.Category
	}
	if row.Source != nil {
		m.Source = *row.Source
	}
	if row.ScanVerdict != nil {
		m.ScanVerdict = domain.ScanVerdict(*row.ScanVerdict)
	}

	if len(row.Platforms) > 0 {
		_ = json.Unmarshal(row.Platforms, &m.Platforms)
	}

	if len(row.Conditions) > 0 {
		var cond domain.SkillConditions
		if err := json.Unmarshal(row.Conditions, &cond); err == nil {
			m.Conditions = &cond
		}
	}

	return m
}

func (s *SkillService) findByID(ctx context.Context, db *gorm.DB, agentID, skillID string) (*persistence.Skill, error) {
	var row persistence.Skill
	if err := db.WithContext(ctx).
		Where("id = ? AND agent_id = ?", skillID, agentID).
		First(&row).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("skill %s not found for agent %s", skillID, agentID), err)
	}
	return &row, nil
}

// fuzzyFind performs a whitespace-normalized search as fallback
// when exact match fails in PatchSkill.
func (s *SkillService) fuzzyFind(content, target string) int {
	normalizeWS := func(s string) string {
		fields := strings.Fields(s)
		return strings.Join(fields, " ")
	}

	normContent := normalizeWS(content)
	normTarget := normalizeWS(target)

	normIdx := strings.Index(normContent, normTarget)
	if normIdx == -1 {
		return -1
	}

	// Map normalized index back to original content position.
	// Walk through original content, tracking normalized character position.
	normPos := 0
	inSpace := false

	for i, r := range content {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if !inSpace && normPos > 0 {
				normPos++
				inSpace = true
			}
			continue
		}

		inSpace = false
		if normPos == normIdx {
			return i
		}
		normPos++
	}

	return -1
}

// isFallbackSatisfied returns true if all fallback tools are already available,
// meaning this fallback skill is not needed.
func (s *SkillService) isFallbackSatisfied(cond *domain.SkillConditions, toolSet map[string]bool) bool {
	if cond == nil || len(cond.FallbackForToolsets) == 0 {
		return false
	}

	for _, tool := range cond.FallbackForToolsets {
		if !toolSet[tool] {
			return false
		}
	}

	return true
}

// ---------------------------------------------------------------------------
// Skill Versioning & Rollback — "dumbed-down agent" recovery path
// ---------------------------------------------------------------------------

// recordVersion saves the current skill content as a version record before mutation.
// Errors are logged but never propagated so that the parent operation is not failed.
func (s *SkillService) recordVersion(ctx context.Context, db *gorm.DB, skill *persistence.Skill, trigger string) {
	version := persistence.SkillVersion{
		ID:        generateID("sv"),
		SkillID:   skill.ID,
		AgentID:   skill.AgentID,
		Version:   skill.Version,
		Content:   skill.Content,
		Trigger:   trigger,
		CreatedAt: time.Now(),
	}

	if err := db.WithContext(ctx).Create(&version).Error; err != nil {
		logger.Warnf(ctx, "skill version: failed to record version for skill %s: %v", skill.ID, err)
	}
}

// ListVersions returns version history for a skill, newest first.
func (s *SkillService) ListVersions(ctx context.Context, agentID, skillID string, limit, offset int) ([]persistence.SkillVersion, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	db.Model(&persistence.SkillVersion{}).
		Where("skill_id = ? AND agent_id = ?", skillID, agentID).
		Count(&total)

	var versions []persistence.SkillVersion
	err = db.WithContext(ctx).
		Where("skill_id = ? AND agent_id = ?", skillID, agentID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&versions).Error

	return versions, total, err
}

// RollbackSkill restores a skill to a specific version.
// Records the current state as a "rollback" version before overwriting, so
// the rollback itself is reversible.
func (s *SkillService) RollbackSkill(ctx context.Context, agentID, skillID string, targetVersion int) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Find the target version record.
	var version persistence.SkillVersion
	if err := db.WithContext(ctx).
		Where("skill_id = ? AND agent_id = ? AND version = ?", skillID, agentID, targetVersion).
		First(&version).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("version %d not found for skill %s", targetVersion, skillID), err)
	}

	// Load current skill.
	var skill persistence.Skill
	if err := db.WithContext(ctx).
		Where("id = ? AND agent_id = ?", skillID, agentID).
		First(&skill).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("skill %s not found for agent %s", skillID, agentID), err)
	}

	// Record current state as a version before rollback.
	s.recordVersion(ctx, db, &skill, "rollback")

	// Restore content and bump version.
	now := time.Now()
	newVersion := skill.Version + 1
	if err := db.WithContext(ctx).
		Model(&persistence.Skill{}).
		Where("id = ?", skill.ID).
		Updates(map[string]interface{}{
			"content":    version.Content,
			"version":    newVersion,
			"updated_at": now,
		}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, 500, "failed to rollback skill", err)
	}

	logger.Infof(ctx, "skill rolled back: id=%s, from_version=%d to_version=%d, new_version=%d",
		skillID, skill.Version, targetVersion, newVersion)

	return nil
}

// ToggleSkill enables or disables a skill. Disabled skills are excluded from
// BuildSkillIndex, effectively deactivating them without deletion.
func (s *SkillService) ToggleSkill(ctx context.Context, agentID, skillID string, enabled bool) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	result := db.WithContext(ctx).
		Model(&persistence.Skill{}).
		Where("id = ? AND agent_id = ?", skillID, agentID).
		Update("enabled", enabled)

	if result.Error != nil {
		return errcode.New(errcode.AgentInternal, 500, "failed to toggle skill", result.Error)
	}
	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, 404,
			fmt.Sprintf("skill %s not found for agent %s", skillID, agentID), nil)
	}

	state := "enabled"
	if !enabled {
		state = "disabled"
	}
	logger.Infof(ctx, "skill %s: id=%s, agent=%s", state, skillID, agentID)

	return nil
}

// hasRequiredTools returns true if all required tools are available.
// Returns true if no requirements are specified.
func (s *SkillService) hasRequiredTools(cond *domain.SkillConditions, toolSet map[string]bool) bool {
	if cond == nil || len(cond.RequiresTools) == 0 {
		return true
	}

	for _, tool := range cond.RequiresTools {
		if !toolSet[tool] {
			return false
		}
	}

	return true
}
