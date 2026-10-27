package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const (
	maxSkillResourceBytes      = 64 * 1024
	maxSkillResourceTotalBytes = 256 * 1024
	maxSkillResourcePathLen    = 255
	maxSkillResourceCount      = 64
)

type preparedSkillResource struct {
	row     persistence.SkillResource
	content []byte
}

func validateSkillResourcePath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxSkillResourcePathLen || !utf8.ValidString(value) {
		return "", skillResourceInvalid("resource path is required and must be UTF-8")
	}
	if strings.Contains(value, "\\") || strings.ContainsRune(value, 0) {
		return "", skillResourceInvalid("resource path must use POSIX-style relative paths")
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || path.IsAbs(clean) ||
		strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", skillResourceInvalid("resource path escapes the skill package")
	}
	return clean, nil
}

func skillResourceInvalid(message string) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, message, nil)
}

func skillResourceNotFound(message string) error {
	return errcode.New(errcode.AgentNotFound, http.StatusNotFound, message, nil)
}

func prepareSkillResources(
	skillID, agentID, actorPTID string,
	version int,
	inputs []*model.SkillResourceInput,
	guard *SkillsGuardService,
	trustLevel domain.TrustLevel,
	now time.Time,
) ([]preparedSkillResource, error) {
	if len(inputs) > maxSkillResourceCount {
		return nil, skillResourceInvalid("too many skill resources")
	}
	prepared := make([]preparedSkillResource, 0, len(inputs))
	seen := make(map[string]struct{}, len(inputs))
	var total int
	for _, input := range inputs {
		if input == nil {
			return nil, skillResourceInvalid("skill resource is required")
		}
		cleanPath, err := validateSkillResourcePath(input.GetPath())
		if err != nil {
			return nil, err
		}
		if _, exists := seen[cleanPath]; exists {
			return nil, skillResourceInvalid("duplicate skill resource path: " + cleanPath)
		}
		seen[cleanPath] = struct{}{}
		if input.GetKind() == model.SkillResourceKind_SKILL_RESOURCE_KIND_UNSPECIFIED {
			return nil, skillResourceInvalid("resource kind is required: " + cleanPath)
		}
		if input.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION &&
			input.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
			return nil, skillResourceInvalid("resource execution owner is invalid: " + cleanPath)
		}
		if len(input.GetContent()) == 0 || len(input.GetContent()) > maxSkillResourceBytes {
			return nil, skillResourceInvalid("resource must contain between 1 and 64 KiB: " + cleanPath)
		}
		total += len(input.GetContent())
		if total > maxSkillResourceTotalBytes {
			return nil, skillResourceInvalid("skill resource package exceeds 256 KiB")
		}
		// Every text-like resource goes through the same threat scan as SKILL.md.
		// Binary assets remain bounded and content-addressed, but are never read as prompts.
		if input.GetKind() != model.SkillResourceKind_SKILL_RESOURCE_KIND_ASSET && utf8.Valid(input.GetContent()) {
			scan := guard.ScanContent(cleanPath, string(input.GetContent()), trustLevel)
			if domain.ResolveInstallPolicy(trustLevel, scan.Verdict) == domain.InstallPolicyBlock {
				return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusForbidden,
					"skill resource blocked by content policy: "+cleanPath, nil)
			}
		}
		sum := sha256.Sum256(input.GetContent())
		prepared = append(prepared, preparedSkillResource{
			row: persistence.SkillResource{
				ID:             generateID("skres"),
				SkillID:        skillID,
				AgentID:        agentID,
				Version:        version,
				Path:           cleanPath,
				Kind:           input.GetKind().String(),
				ExecutionOwner: input.GetExecutionOwner().String(),
				ContentHash:    hex.EncodeToString(sum[:]),
				Size:           uint64(len(input.GetContent())),
				CreatedAt:      now,
				UpdatedAt:      now,
			},
			content: append([]byte(nil), input.GetContent()...),
		})
	}
	return prepared, nil
}

func putSkillResourcesTx(
	tx *gorm.DB,
	actorPTID string,
	resources []preparedSkillResource,
	now time.Time,
) error {
	for _, resource := range resources {
		// Client-owned bytes live only in the Desktop managed package directory.
		// Station stores immutable metadata/hash but never persists client bodies.
		if resource.row.ExecutionOwner == model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION.String() {
			if _, _, err := PutImmutableContentTx(tx, actorPTID, resource.content, now); err != nil {
				return err
			}
		}
		if err := tx.Create(&resource.row).Error; err != nil {
			return err
		}
	}
	return nil
}

func cloneSkillResourcesTx(
	tx *gorm.DB,
	skillID, agentID string,
	fromVersion, toVersion int,
	now time.Time,
) error {
	var previous []persistence.SkillResource
	if err := tx.Where(
		"skill_id = ? AND agent_id = ? AND version = ?",
		skillID, agentID, fromVersion,
	).Find(&previous).Error; err != nil {
		return err
	}
	for _, resource := range previous {
		resource.ID = generateID("skres")
		resource.SkillID = skillID
		resource.AgentID = agentID
		resource.Version = toVersion
		resource.CreatedAt = now
		resource.UpdatedAt = now
		if err := tx.Create(&resource).Error; err != nil {
			return err
		}
	}
	return nil
}

func listSkillResources(
	ctx context.Context,
	db *gorm.DB,
	skillID string,
	version int,
) ([]*model.SkillResource, error) {
	var rows []persistence.SkillResource
	if err := db.WithContext(ctx).Where(
		"skill_id = ? AND version = ?",
		skillID, version,
	).Order("path ASC").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list skill resources", err)
	}
	result := make([]*model.SkillResource, 0, len(rows))
	for i := range rows {
		result = append(result, skillResourceModel(&rows[i]))
	}
	return result, nil
}

func readSkillResource(
	ctx context.Context,
	db *gorm.DB,
	agentID, skillID string,
	version int,
	rawPath string,
) (*model.SkillResource, []byte, error) {
	cleanPath, err := validateSkillResourcePath(rawPath)
	if err != nil {
		return nil, nil, err
	}
	var skill persistence.Skill
	if err := db.WithContext(ctx).Where(
		"id = ? AND agent_id = ?",
		skillID, agentID,
	).First(&skill).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, skillResourceNotFound("skill not found")
		}
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load skill", err)
	}
	if version <= 0 {
		version = skill.Version
	}
	var row persistence.SkillResource
	if err := db.WithContext(ctx).Where(
		"skill_id = ? AND agent_id = ? AND version = ? AND path = ?",
		skillID, agentID, version, cleanPath,
	).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, skillResourceNotFound("skill resource not found")
		}
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load skill resource", err)
	}
	if row.ExecutionOwner != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION.String() {
		return nil, nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"client-owned skill resource is not readable from Station", nil)
	}
	content, err := GetImmutableContent(db.WithContext(ctx), row.ContentHash)
	if err != nil {
		return nil, nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"skill resource content is unavailable", err)
	}
	sum := sha256.Sum256(content)
	if hex.EncodeToString(sum[:]) != row.ContentHash || uint64(len(content)) != row.Size {
		return nil, nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			"skill resource integrity mismatch", nil)
	}
	return skillResourceModel(&row), content, nil
}

func skillResourceModel(row *persistence.SkillResource) *model.SkillResource {
	return &model.SkillResource{
		Path:           row.Path,
		ContentHash:    row.ContentHash,
		Size:           row.Size,
		Kind:           skillResourceKindModel(row.Kind),
		ExecutionOwner: toolExecutionOwnerModel(row.ExecutionOwner),
	}
}

func skillResourceKindModel(value string) model.SkillResourceKind {
	switch value {
	case model.SkillResourceKind_SKILL_RESOURCE_KIND_DOCUMENT.String():
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_DOCUMENT
	case model.SkillResourceKind_SKILL_RESOURCE_KIND_REFERENCE.String():
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_REFERENCE
	case model.SkillResourceKind_SKILL_RESOURCE_KIND_TEMPLATE.String():
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_TEMPLATE
	case model.SkillResourceKind_SKILL_RESOURCE_KIND_ASSET.String():
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_ASSET
	case model.SkillResourceKind_SKILL_RESOURCE_KIND_SCRIPT.String():
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_SCRIPT
	default:
		return model.SkillResourceKind_SKILL_RESOURCE_KIND_UNSPECIFIED
	}
}

func toolExecutionOwnerModel(value string) model.ToolExecutionOwner {
	switch value {
	case model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION.String():
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION
	case model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY.String():
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
	default:
		return model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_UNSPECIFIED
	}
}
