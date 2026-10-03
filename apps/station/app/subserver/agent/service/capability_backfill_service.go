package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const capabilityLegacyVersion = "legacy-1"

type CapabilityBackfillSourceReport struct {
	Source     string `json:"source"`
	Scanned    int    `json:"scanned"`
	Imported   int    `json:"imported"`
	Reconciled int    `json:"reconciled"`
	Rejected   int    `json:"rejected"`
}

type CapabilityBackfillRejection struct {
	Source     string `json:"source"`
	SourceID   string `json:"sourceId"`
	ReasonCode string `json:"reasonCode"`
}

type CapabilityBackfillReport struct {
	RunID               string                                 `json:"runId"`
	PayloadHash         string                                 `json:"payloadHash"`
	Sources             []CapabilityBackfillSourceReport       `json:"sources"`
	Rejections          []CapabilityBackfillRejection          `json:"rejections"`
	KnowledgeMigrations []CapabilityBackfillKnowledgeMigration `json:"knowledgeMigrations,omitempty"`
}

type CapabilityBackfillKnowledgeMigration struct {
	SourceID          string `json:"sourceId"`
	ResourceID        string `json:"resourceId"`
	Revision          uint64 `json:"revision"`
	CapabilityID      string `json:"capabilityId"`
	CapabilityVersion string `json:"capabilityVersion"`
	BindingID         string `json:"bindingId"`
	Outcome           string `json:"outcome"`
}

type capabilityManifestSeed struct {
	source   string
	sourceID string
	manifest *model.CapabilityManifest
}

type capabilityBindingSeed struct {
	source            string
	sourceID          string
	ptid              string
	agentID           string
	agentVersion      uint64
	capabilityID      string
	capabilityVersion string
	enabled           bool
	approvalPolicy    model.CapabilityApprovalPolicy
	preservePolicy    bool
	reconcileVersion  bool
}

type legacyAgentChatConfig struct {
	Tools              []string                     `json:"tools"`
	Skills             []string                     `json:"skills"`
	Connectors         []legacyAgentConnectorConfig `json:"connectors"`
	KnowledgeResources json.RawMessage              `json:"knowledgeResources"`
}

type legacyAgentConnectorConfig struct {
	ConnectorID  string   `json:"connectorId"`
	EnabledTools []string `json:"enabledTools"`
}

type legacyKnowledgeResource struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Title  string `json:"title"`
	Source string `json:"source"`
	Policy string `json:"policy"`
	Status string `json:"status"`
}

type knowledgeMigrationSeed struct {
	sourceID  string
	revision  *persistence.KnowledgeResourceRevision
	content   *persistence.KnowledgeContentRevision
	manifest  *model.CapabilityManifest
	binding   capabilityBindingSeed
	receiptID string
}

type knowledgeLegacyCleanupSeed struct {
	rowID        string
	ptid         string
	agentID      string
	legacyID     string
	capabilityID string
}

type CapabilityBackfillService struct {
	db       *gorm.DB
	registry *ToolRegistryService
	now      func() time.Time
}

func NewCapabilityBackfillService(
	db *gorm.DB,
	registry *ToolRegistryService,
) *CapabilityBackfillService {
	return &CapabilityBackfillService{
		db:       db,
		registry: registry,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

func (s *CapabilityBackfillService) Run(
	ctx context.Context,
) (*CapabilityBackfillReport, error) {
	manifests, bindings, knowledge, knowledgeCleanup,
		rejections, reports, err := s.scan(ctx)
	if err != nil {
		return nil, capabilityInternal("scan capability backfill sources", err)
	}
	sortCapabilityBackfillInputs(manifests, bindings, rejections, reports)
	sortKnowledgeMigrationInputs(knowledge, knowledgeCleanup)

	now := s.now()
	var report *CapabilityBackfillReport
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := retireLegacyConnectorPlaceholder(tx, now); err != nil {
			return err
		}
		for _, seed := range manifests {
			imported, err := upsertBackfillManifest(tx, seed.manifest, now)
			if err != nil {
				return fmt.Errorf("%s %s: %w", seed.source, seed.sourceID, err)
			}
			incrementBackfillReport(reports, seed.source, imported)
		}
		for _, seed := range bindings {
			imported, err := upsertBackfillBinding(tx, seed, now)
			if err != nil {
				return fmt.Errorf("%s %s: %w", seed.source, seed.sourceID, err)
			}
			incrementBackfillReport(reports, seed.source, imported)
		}
		for _, seed := range knowledge {
			imported, persistErr := persistKnowledgeMigration(tx, seed, now)
			if persistErr != nil {
				return fmt.Errorf("knowledge_resource %s: %w", seed.sourceID, persistErr)
			}
			incrementBackfillReport(reports, "knowledge_resource", imported)
		}
		for _, cleanup := range knowledgeCleanup {
			if cleanupErr := cleanupLegacyKnowledgeAuthority(tx, cleanup, now); cleanupErr != nil {
				return fmt.Errorf("knowledge authority cleanup %s: %w", cleanup.rowID, cleanupErr)
			}
		}
		for _, rejection := range rejections {
			incrementBackfillRejection(reports, rejection.Source)
		}
		var payload []byte
		var reportErr error
		report, payload, reportErr = buildCapabilityBackfillReport(
			reports,
			rejections,
			knowledge,
		)
		if reportErr != nil {
			return reportErr
		}
		record := &persistence.CapabilityBackfillRun{
			RunID:       report.RunID,
			Payload:     payload,
			PayloadHash: report.PayloadHash,
			CreatedAt:   now,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(record).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, capabilityInternal("persist capability backfill", err)
	}

	return report, nil
}

func retireLegacyConnectorPlaceholder(tx *gorm.DB, now time.Time) error {
	result := tx.Model(&persistence.CapabilityManifest{}).
		Where(
			"source_kind = ? AND source_instance_id = ? AND retired_at IS NULL",
			int32(model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR),
			"oauth_connector_call",
		).
		Updates(map[string]interface{}{
			"availability":      int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED),
			"retired_at":        now,
			"retirement_reason": "connector_resource_projection_required",
		})
	if result.Error != nil {
		return fmt.Errorf("retire legacy Connector placeholder: %w", result.Error)
	}
	return nil
}

func (s *CapabilityBackfillService) scan(
	ctx context.Context,
) (
	[]capabilityManifestSeed,
	[]capabilityBindingSeed,
	[]knowledgeMigrationSeed,
	[]knowledgeLegacyCleanupSeed,
	[]CapabilityBackfillRejection,
	[]CapabilityBackfillSourceReport,
	error,
) {
	reports := capabilityBackfillReports()
	manifests := s.scanBuiltinTools(reports)
	var bindings []capabilityBindingSeed
	var rejections []CapabilityBackfillRejection

	var agents []persistence.Agent
	if err := s.db.WithContext(ctx).Order("id").Find(&agents).Error; err != nil {
		return nil, nil, nil, nil, nil, nil, err
	}
	agentByID := make(map[string]persistence.Agent, len(agents))
	for _, agent := range agents {
		agentByID[agent.ID] = agent
	}

	skillManifests, skillBindings, skillRejects, err := s.scanSkills(ctx, agentByID, reports)
	if err != nil {
		return nil, nil, nil, nil, nil, nil, err
	}
	manifests = append(manifests, skillManifests...)
	bindings = append(bindings, skillBindings...)
	rejections = append(rejections, skillRejects...)

	knowledge, knowledgeCleanup, knowledgeRejects, err :=
		s.scanKnowledgeResources(ctx, agents, agentByID, reports)
	if err != nil {
		return nil, nil, nil, nil, nil, nil, err
	}
	rejections = append(rejections, knowledgeRejects...)

	configManifests, configBindings, configRejects :=
		s.scanAgentConfigs(agents, manifests, reports)
	manifests = append(manifests, configManifests...)
	bindings = append(bindings, configBindings...)
	rejections = append(rejections, configRejects...)

	clientManifests, clientRejects, err := s.scanClientCapabilities(
		ctx,
		reports,
		manifests,
	)
	if err != nil {
		return nil, nil, nil, nil, nil, nil, err
	}
	manifests = append(manifests, clientManifests...)
	rejections = append(rejections, clientRejects...)

	retiredExtensionRejects, err :=
		s.scanRetiredExtensionEndpoints(reports)
	if err != nil {
		return nil, nil, nil, nil, nil, nil, err
	}
	rejections = append(rejections, retiredExtensionRejects...)

	manifests = deduplicateManifestSeeds(manifests, &rejections)
	bindings = deduplicateBindingSeeds(bindings, &rejections)
	return manifests, bindings, knowledge, knowledgeCleanup,
		rejections, reports, nil
}

func (s *CapabilityBackfillService) scanBuiltinTools(
	reports []CapabilityBackfillSourceReport,
) []capabilityManifestSeed {
	if s.registry == nil {
		return nil
	}
	names := s.registry.ToolNames()
	sort.Strings(names)
	definitions := s.registry.Definitions(names)
	result := make([]capabilityManifestSeed, 0, len(definitions))
	for _, definition := range definitions {
		incrementBackfillScanned(reports, "builtin_tool")
		result = append(result, capabilityToolManifestSeed(definition))
	}
	return result
}

func (s *CapabilityBackfillService) scanSkills(
	ctx context.Context,
	agents map[string]persistence.Agent,
	reports []CapabilityBackfillSourceReport,
) ([]capabilityManifestSeed, []capabilityBindingSeed, []CapabilityBackfillRejection, error) {
	var skills []persistence.Skill
	if err := s.db.WithContext(ctx).Order("id").Find(&skills).Error; err != nil {
		return nil, nil, nil, err
	}
	var legacyBindings []persistence.AgentSkillBinding
	if err := s.db.WithContext(ctx).Order("id").Find(&legacyBindings).Error; err != nil {
		return nil, nil, nil, err
	}
	byID := make(map[string]persistence.Skill, len(skills))
	var manifests []capabilityManifestSeed
	for _, skill := range skills {
		incrementBackfillScanned(reports, "skill")
		byID[skill.ID] = skill
		manifests = append(manifests, capabilitySkillManifestSeed(skill))
	}
	var bindings []capabilityBindingSeed
	var rejections []CapabilityBackfillRejection
	for _, legacy := range legacyBindings {
		incrementBackfillScanned(reports, "skill_binding")
		agent, agentOK := agents[legacy.AgentID]
		skill, skillOK := byID[legacy.SkillID]
		if !agentOK || !skillOK {
			rejections = append(rejections, backfillRejection(
				"skill_binding", legacy.ID, "missing_agent_or_skill",
			))
			continue
		}
		bindings = append(bindings, capabilityBindingFromSkill(
			"skill_binding", legacy.ID, agent, skill, legacy.Enabled,
		))
	}
	return manifests, bindings, rejections, nil
}

func (s *CapabilityBackfillService) scanKnowledgeResources(
	ctx context.Context,
	agentList []persistence.Agent,
	agents map[string]persistence.Agent,
	reports []CapabilityBackfillSourceReport,
) (
	[]knowledgeMigrationSeed,
	[]knowledgeLegacyCleanupSeed,
	[]CapabilityBackfillRejection,
	error,
) {
	var rows []persistence.AgentKnowledgeBinding
	if err := s.db.WithContext(ctx).Order("id").Find(&rows).Error; err != nil {
		return nil, nil, nil, err
	}
	rowsByAgentResource := make(map[string][]persistence.AgentKnowledgeBinding)
	var cleanups []knowledgeLegacyCleanupSeed
	var rejections []CapabilityBackfillRejection
	for _, row := range rows {
		incrementBackfillScanned(reports, "knowledge_binding")
		agent, ok := agents[row.AgentID]
		legacyID := strings.TrimSpace(row.ResourceID)
		cleanup := knowledgeLegacyCleanupSeed{
			rowID:        row.ID,
			agentID:      row.AgentID,
			legacyID:     legacyID,
			capabilityID: "knowledge:" + legacyID,
		}
		if ok {
			cleanup.ptid = strings.TrimSpace(agent.OwnerActorPTID)
		}
		cleanups = append(cleanups, cleanup)
		if !ok || legacyID == "" {
			rejections = append(rejections, backfillRejection(
				"knowledge_binding", row.ID, "missing_agent_or_resource",
			))
			continue
		}
		key := row.AgentID + "\x00" + legacyID
		rowsByAgentResource[key] = append(rowsByAgentResource[key], row)
	}

	var migrations []knowledgeMigrationSeed
	matchedRows := make(map[string]struct{})
	descriptorHashes := make(map[string]string)
	for _, agent := range agentList {
		rawConfig := strings.TrimSpace(agent.ConfigJSON)
		if rawConfig == "" {
			continue
		}
		var config legacyAgentChatConfig
		if err := json.Unmarshal([]byte(rawConfig), &config); err != nil {
			continue
		}
		resources, present, parseErr := parseLegacyKnowledgeResources(config.KnowledgeResources)
		if !present {
			continue
		}
		if parseErr != nil {
			incrementBackfillScanned(reports, "knowledge_resource")
			rejections = append(rejections, backfillRejection(
				"knowledge_resource", agent.ID+":knowledge", "invalid_embedded_resources",
			))
			continue
		}
		for index, resource := range resources {
			incrementBackfillScanned(reports, "knowledge_resource")
			sourceID := knowledgeReportSourceID(agent.ID, resource.ID, index)
			seed, reason := buildKnowledgeMigrationSeed(agent, resource, rowsByAgentResource)
			if reason != "" {
				rejections = append(rejections, backfillRejection(
					"knowledge_resource", sourceID, reason,
				))
				continue
			}
			key := agent.ID + "\x00" + strings.TrimSpace(resource.ID)
			for _, row := range rowsByAgentResource[key] {
				matchedRows[row.ID] = struct{}{}
			}
			descriptorKey := seed.revision.ResourceID
			descriptorHash := capabilityHash(
				seed.revision.Ptid,
				seed.revision.Title,
				strconv.Itoa(int(seed.revision.ResourceKind)),
				seed.revision.ContentHash,
			)
			if previous, exists := descriptorHashes[descriptorKey]; exists &&
				previous != descriptorHash {
				rejections = append(rejections, backfillRejection(
					"knowledge_resource", sourceID, "descriptor_identity_conflict",
				))
				continue
			}
			descriptorHashes[descriptorKey] = descriptorHash
			seed.sourceID = sourceID
			migrations = append(migrations, seed)
		}
	}
	for _, row := range rows {
		if _, ok := matchedRows[row.ID]; ok {
			continue
		}
		if _, agentOK := agents[row.AgentID]; !agentOK ||
			strings.TrimSpace(row.ResourceID) == "" {
			continue
		}
		rejections = append(rejections, backfillRejection(
			"knowledge_resource",
			knowledgeReportSourceID(row.AgentID, row.ResourceID, 0),
			"missing_embedded_descriptor",
		))
	}
	return migrations, cleanups, rejections, nil
}

func parseLegacyKnowledgeResources(
	raw json.RawMessage,
) ([]legacyKnowledgeResource, bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, false, nil
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return nil, true, nil
	}
	if trimmed[0] == '"' {
		var encoded string
		if err := json.Unmarshal(trimmed, &encoded); err != nil {
			return nil, true, err
		}
		trimmed = bytes.TrimSpace([]byte(encoded))
	}
	if len(trimmed) == 0 {
		return nil, true, nil
	}
	var resources []legacyKnowledgeResource
	if err := json.Unmarshal(trimmed, &resources); err != nil {
		return nil, true, err
	}
	return resources, true, nil
}

func buildKnowledgeMigrationSeed(
	agent persistence.Agent,
	legacy legacyKnowledgeResource,
	rows map[string][]persistence.AgentKnowledgeBinding,
) (knowledgeMigrationSeed, string) {
	legacyID := strings.TrimSpace(legacy.ID)
	if legacyID == "" {
		return knowledgeMigrationSeed{}, "missing_resource_id"
	}
	resourceType := strings.ToLower(strings.TrimSpace(legacy.Type))
	if resourceType == "" {
		resourceType = "document"
	}
	source := strings.TrimSpace(legacy.Source)
	switch resourceType {
	case "url":
		return knowledgeMigrationSeed{}, "mutable_url_not_migratable"
	case "folder", "project", "notebook", "workspace":
		return knowledgeMigrationSeed{}, "client_local_resource_not_migratable"
	case "document":
	default:
		return knowledgeMigrationSeed{}, "unsupported_resource_type"
	}
	if source == "" {
		return knowledgeMigrationSeed{}, "missing_resource_source"
	}
	if looksLikeLegacyURL(source) {
		return knowledgeMigrationSeed{}, "mutable_url_not_migratable"
	}
	if looksLikeLegacyLocalPath(source) {
		return knowledgeMigrationSeed{}, "local_path_not_migratable"
	}
	if strings.IndexFunc(source, unicode.IsSpace) < 0 {
		return knowledgeMigrationSeed{}, "ambiguous_document_source"
	}
	if len([]byte(source)) > maxKnowledgeStationContentBytes {
		return knowledgeMigrationSeed{}, "station_content_too_large"
	}
	if !legacyKnowledgeStatusAccepted(legacy.Status) {
		return knowledgeMigrationSeed{}, "unsupported_resource_status"
	}

	enabled, approvalPolicy, policyOK := embeddedKnowledgePolicy(legacy.Policy)
	if !policyOK {
		return knowledgeMigrationSeed{}, "unsupported_resource_policy"
	}
	key := agent.ID + "\x00" + legacyID
	if legacyRows := rows[key]; len(legacyRows) > 0 {
		enabled = legacyRows[0].Enabled
		approvalPolicy = legacyApprovalPolicy(legacyRows[0].Policy)
	}

	ptid := strings.TrimSpace(agent.OwnerActorPTID)
	resourceID := "knowledge-resource-" + shortCapabilityHash(ptid, legacyID)
	title := strings.TrimSpace(legacy.Title)
	if title == "" {
		title = legacyID
	}
	revision, content, err := buildKnowledgeRevision(
		resourceID,
		ptid,
		1,
		title,
		model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_DOCUMENT,
		[]byte(source),
		nil,
		agent.UpdatedAt.UTC(),
	)
	if err != nil {
		return knowledgeMigrationSeed{}, "descriptor_build_failed"
	}
	manifest := knowledgeManifest(revision)
	return knowledgeMigrationSeed{
		revision: revision,
		content:  content,
		manifest: manifest,
		binding: capabilityBindingSeed{
			source:            "knowledge_resource",
			ptid:              ptid,
			agentID:           agent.ID,
			agentVersion:      uint64(agent.Version),
			capabilityID:      manifest.GetCapabilityId(),
			capabilityVersion: manifest.GetVersion(),
			enabled:           enabled,
			approvalPolicy:    approvalPolicy,
			preservePolicy:    true,
		},
		receiptID: "knowledge-backfill-" + shortCapabilityHash(ptid, agent.ID, legacyID),
	}, ""
}

func legacyKnowledgeStatusAccepted(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "bound", "pending_index", "indexed", "error":
		return true
	default:
		return false
	}
}

func embeddedKnowledgePolicy(
	value string,
) (bool, model.CapabilityApprovalPolicy, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "manual":
		return true, model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL, true
	case "auto", "always":
		return true, model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO, true
	case "disabled":
		return false, model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_DENY, true
	default:
		return false, model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_UNSPECIFIED, false
	}
}

func looksLikeLegacyURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.IsAbs()
}

func looksLikeLegacyLocalPath(value string) bool {
	normalized := strings.TrimSpace(value)
	if strings.HasPrefix(normalized, "/") ||
		strings.HasPrefix(normalized, `\`) ||
		strings.HasPrefix(normalized, "./") ||
		strings.HasPrefix(normalized, "../") ||
		strings.HasPrefix(normalized, "~/") ||
		strings.HasPrefix(strings.ToLower(normalized), "file:") {
		return true
	}
	return len(normalized) >= 3 &&
		((normalized[0] >= 'A' && normalized[0] <= 'Z') ||
			(normalized[0] >= 'a' && normalized[0] <= 'z')) &&
		normalized[1] == ':' &&
		(normalized[2] == '/' || normalized[2] == '\\')
}

func knowledgeReportSourceID(agentID string, legacyID string, index int) string {
	legacyID = strings.TrimSpace(legacyID)
	if legacyID == "" {
		return agentID + ":knowledge:" + strconv.Itoa(index)
	}
	return agentID + ":knowledge:" + shortCapabilityHash(legacyID)
}

func (s *CapabilityBackfillService) scanAgentConfigs(
	agents []persistence.Agent,
	knownManifests []capabilityManifestSeed,
	reports []CapabilityBackfillSourceReport,
) ([]capabilityManifestSeed, []capabilityBindingSeed, []CapabilityBackfillRejection) {
	knownTools := make(map[string]capabilityManifestSeed)
	knownSkills := make(map[string]capabilityManifestSeed)
	for _, seed := range knownManifests {
		switch {
		case seed.source == "builtin_tool":
			knownTools[seed.manifest.GetSourceInstanceId()] = seed
		case seed.manifest.GetSourceKind() ==
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_SKILL:
			knownSkills[seed.manifest.GetSourceInstanceId()] = seed
		}
	}
	var manifests []capabilityManifestSeed
	var bindings []capabilityBindingSeed
	var rejections []CapabilityBackfillRejection
	for _, agent := range agents {
		if strings.TrimSpace(agent.ConfigJSON) == "" {
			continue
		}
		incrementBackfillScanned(reports, "agent_config")
		var config legacyAgentChatConfig
		if err := json.Unmarshal([]byte(agent.ConfigJSON), &config); err != nil {
			rejections = append(rejections, backfillRejection(
				"agent_config", agent.ID, "invalid_config_json",
			))
			continue
		}
		for _, toolName := range normalizedStrings(config.Tools) {
			manifest, ok := knownTools[toolName]
			if !ok {
				rejections = append(rejections, backfillRejection(
					"agent_config", agent.ID+":tool:"+toolName, "unknown_tool",
				))
				continue
			}
			bindings = append(bindings, bindingFromManifest(
				"agent_config", agent.ID+":tool:"+toolName, agent, manifest.manifest, true,
			))
		}
		for _, skillName := range normalizedStrings(config.Skills) {
			manifest, ok := knownSkills[skillName]
			if !ok {
				rejections = append(rejections, backfillRejection(
					"agent_config", agent.ID+":skill:"+skillName, "unknown_skill",
				))
				continue
			}
			bindings = append(bindings, bindingFromManifest(
				"agent_config", agent.ID+":skill:"+skillName, agent, manifest.manifest, true,
			))
		}
		for _, connector := range config.Connectors {
			connectorID := strings.TrimSpace(connector.ConnectorID)
			if connectorID == "" {
				rejections = append(rejections, backfillRejection(
					"agent_config", agent.ID+":connector", "missing_connector_id",
				))
				continue
			}
			capabilityID := "connector:" + connectorID
			manifest := legacyManifestSeed(
				"agent_config", agent.ID+":connector:"+connectorID, capabilityID,
				model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR,
				connectorID, model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
				model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE,
			)
			manifests = append(manifests, manifest)
			bindings = append(bindings, bindingFromManifest(
				"agent_config", manifest.sourceID, agent, manifest.manifest, true,
			))
		}
	}
	return manifests, bindings, rejections
}

func (s *CapabilityBackfillService) scanClientCapabilities(
	ctx context.Context,
	reports []CapabilityBackfillSourceReport,
	knownManifests []capabilityManifestSeed,
) ([]capabilityManifestSeed, []CapabilityBackfillRejection, error) {
	var rows []persistence.ClientCapabilityLease
	if err := s.db.WithContext(ctx).Order("session_id").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	knownCapabilityIDs := make(map[string]struct{}, len(knownManifests))
	for _, seed := range knownManifests {
		knownCapabilityIDs[seed.manifest.GetCapabilityId()] = struct{}{}
	}
	var persistedCapabilityIDs []string
	if err := s.db.WithContext(ctx).
		Model(&persistence.CapabilityManifest{}).
		Distinct("capability_id").
		Pluck("capability_id", &persistedCapabilityIDs).Error; err != nil {
		return nil, nil, err
	}
	for _, capabilityID := range persistedCapabilityIDs {
		knownCapabilityIDs[strings.TrimSpace(capabilityID)] = struct{}{}
	}
	var manifests []capabilityManifestSeed
	var rejections []CapabilityBackfillRejection
	for _, row := range rows {
		var lease model.ClientCapabilityLease
		if err := proto.Unmarshal(row.LeasePayload, &lease); err != nil {
			incrementBackfillScanned(reports, "client_capability")
			rejections = append(rejections, backfillRejection(
				"client_capability", row.SessionID, "invalid_lease_payload",
			))
			continue
		}
		for _, capability := range lease.GetCapabilities() {
			incrementBackfillScanned(reports, "client_capability")
			capabilityID := strings.TrimSpace(capability.GetCapabilityId())
			version := strings.TrimSpace(capability.GetSchemaVersion())
			if capabilityID == "" || version == "" {
				rejections = append(rejections, backfillRejection(
					"client_capability", row.SessionID, "missing_capability_identity",
				))
				continue
			}
			if _, exists := knownCapabilityIDs[capabilityID]; exists {
				continue
			}
			manifests = append(manifests, capabilityManifestSeed{
				source:   "client_capability",
				sourceID: row.SessionID + ":" + capabilityID,
				manifest: &model.CapabilityManifest{
					CapabilityId:          capabilityID,
					Version:               version,
					SourceKind:            model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE,
					SourceInstanceId:      capabilityID,
					InputSchemaRef:        "client-capability://" + capabilityID + "/input",
					OutputSchemaRef:       "client-capability://" + capabilityID + "/output",
					ExecutionOwner:        model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
					RiskClass:             "client-local",
					DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
					SecretBoundary:        "client",
					Availability:          model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE,
				},
			})
		}
	}
	return manifests, rejections, nil
}

func (s *CapabilityBackfillService) scanRetiredExtensionEndpoints(
	reports []CapabilityBackfillSourceReport,
) ([]CapabilityBackfillRejection, error) {
	audits, err := persistence.ReadRetiredExtensionEndpointAudits(s.db)
	if err != nil {
		return nil, err
	}
	result := make([]CapabilityBackfillRejection, 0, len(audits))
	for _, audit := range audits {
		incrementBackfillScanned(reports, "retired_extension_endpoint")
		result = append(result, backfillRejection(
			"retired_extension_endpoint",
			audit.ActorScopeHash+":"+audit.MetadataHash,
			"source_kind_not_accepted",
		))
	}
	return result, nil
}

func capabilityToolManifestSeed(definition *domain.ToolDefinition) capabilityManifestSeed {
	sourceKind := model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL
	owner := model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION
	availability := model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
	approval := model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO
	secretBoundary := "station"
	capabilityID := "tool:" + definition.Name
	requiredRuntimeCapabilities := []string{"native-tools"}
	version := ""
	switch {
	case strings.HasPrefix(definition.Name, "local_"):
		sourceKind = model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CLIENT_NATIVE
		owner = model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
		approval = model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL
		secretBoundary = "client"
		requiredRuntimeCapabilities = nil
		if mappedID := capabilityIDForTool(definition.Name); mappedID != "" {
			capabilityID = mappedID
			version = "1"
		}
	}
	if version == "" {
		versionParts := []string{
			definition.Name,
			definition.Description,
			string(definition.JSONSchema),
			strconv.Itoa(int(sourceKind)),
		}
		if sourceKind == model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL {
			versionParts = append(versionParts, strings.Join(requiredRuntimeCapabilities, ","))
		}
		version = shortCapabilityHash(versionParts...)
	}
	return capabilityManifestSeed{
		source:   "builtin_tool",
		sourceID: definition.Name,
		manifest: &model.CapabilityManifest{
			CapabilityId:                capabilityID,
			Version:                     version,
			SourceKind:                  sourceKind,
			SourceInstanceId:            definition.Name,
			DisplayMetadata:             &model.CapabilityDisplayMetadata{Name: definition.Name, Description: definition.Description},
			InputSchemaRef:              "inline-sha256:" + capabilityHash(string(definition.JSONSchema)),
			OutputSchemaRef:             "schema://agent/tool-result/text",
			ExecutionOwner:              owner,
			RequiredRuntimeCapabilities: requiredRuntimeCapabilities,
			RiskClass:                   "tool",
			DefaultApprovalPolicy:       approval,
			SecretBoundary:              secretBoundary,
			Availability:                availability,
		},
	}
}

func capabilitySkillManifestSeed(skill persistence.Skill) capabilityManifestSeed {
	availability := model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED
	if skill.Enabled {
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
	}
	return capabilityManifestSeed{
		source:   "skill",
		sourceID: skill.ID,
		manifest: &model.CapabilityManifest{
			CapabilityId:          "skill:" + skill.ID,
			Version:               strconv.Itoa(skill.Version),
			SourceKind:            model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_SKILL,
			SourceInstanceId:      skill.Name,
			DisplayMetadata:       &model.CapabilityDisplayMetadata{Name: skill.Name, Description: skill.Description},
			InputSchemaRef:        "schema://agent/skill/invoke",
			OutputSchemaRef:       "schema://agent/skill/context",
			ExecutionOwner:        model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
			RiskClass:             "context",
			DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
			SecretBoundary:        "station",
			Availability:          availability,
		},
	}
}

func legacyManifestSeed(
	source string,
	sourceID string,
	capabilityID string,
	sourceKind model.CapabilitySourceKind,
	sourceInstanceID string,
	owner model.ToolExecutionOwner,
	availability model.CapabilityAvailability,
) capabilityManifestSeed {
	return capabilityManifestSeed{
		source:   source,
		sourceID: sourceID,
		manifest: &model.CapabilityManifest{
			CapabilityId:          capabilityID,
			Version:               capabilityLegacyVersion,
			SourceKind:            sourceKind,
			SourceInstanceId:      strings.TrimSpace(sourceInstanceID),
			InputSchemaRef:        "legacy://" + capabilityID + "/input",
			OutputSchemaRef:       "legacy://" + capabilityID + "/output",
			ExecutionOwner:        owner,
			RiskClass:             "legacy",
			DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
			SecretBoundary:        capabilitySecretBoundary(owner),
			Availability:          availability,
		},
	}
}

func capabilityBindingFromSkill(
	source string,
	sourceID string,
	agent persistence.Agent,
	skill persistence.Skill,
	enabled bool,
) capabilityBindingSeed {
	return capabilityBindingSeed{
		source:            source,
		sourceID:          sourceID,
		ptid:              agent.OwnerActorPTID,
		agentID:           agent.ID,
		agentVersion:      uint64(agent.Version),
		capabilityID:      "skill:" + skill.ID,
		capabilityVersion: strconv.Itoa(skill.Version),
		enabled:           enabled,
		approvalPolicy:    model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
	}
}

func bindingFromManifest(
	source string,
	sourceID string,
	agent persistence.Agent,
	manifest *model.CapabilityManifest,
	enabled bool,
) capabilityBindingSeed {
	return capabilityBindingSeed{
		source:            source,
		sourceID:          sourceID,
		ptid:              agent.OwnerActorPTID,
		agentID:           agent.ID,
		agentVersion:      uint64(agent.Version),
		capabilityID:      manifest.GetCapabilityId(),
		capabilityVersion: manifest.GetVersion(),
		enabled:           enabled,
		approvalPolicy:    manifest.GetDefaultApprovalPolicy(),
		reconcileVersion: manifest.GetSourceKind() ==
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
	}
}

func upsertBackfillManifest(
	tx *gorm.DB,
	manifest *model.CapabilityManifest,
	now time.Time,
) (bool, error) {
	payloadHash, err := capabilityManifestContentHash(manifest)
	if err != nil {
		return false, err
	}
	record, err := capabilityManifestRecord(manifest, payloadHash, now)
	if err != nil {
		return false, err
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	var existing persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND version = ?", record.CapabilityID, record.Version,
	).First(&existing).Error; err != nil {
		return false, err
	}
	if existing.PayloadHash != payloadHash {
		return false, fmt.Errorf("manifest identity conflict")
	}
	return false, nil
}

func upsertBackfillBinding(
	tx *gorm.DB,
	seed capabilityBindingSeed,
	now time.Time,
) (bool, error) {
	bindingID := "binding-" + shortCapabilityHash(
		seed.ptid, seed.agentID, seed.capabilityID,
	)
	record := &persistence.AgentCapabilityBinding{
		BindingID:         bindingID,
		Ptid:              seed.ptid,
		AgentID:           seed.agentID,
		CapabilityID:      seed.capabilityID,
		CapabilityVersion: seed.capabilityVersion,
		Enabled:           seed.enabled,
		ApprovalPolicy:    int32(seed.approvalPolicy),
		AgentVersion:      seed.agentVersion,
		Revision:          1,
		UpdatedAt:         now,
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	var existing persistence.AgentCapabilityBinding
	if err := tx.Where("binding_id = ?", bindingID).First(&existing).Error; err != nil {
		return false, err
	}
	if existing.Ptid != record.Ptid ||
		existing.AgentID != record.AgentID ||
		existing.CapabilityID != record.CapabilityID {
		return false, fmt.Errorf("binding identity conflict")
	}
	if !seed.preservePolicy && (existing.Enabled != record.Enabled ||
		existing.ApprovalPolicy != record.ApprovalPolicy) {
		return false, fmt.Errorf("binding identity conflict")
	}
	if existing.AgentVersion != record.AgentVersion {
		return false, fmt.Errorf("binding identity conflict")
	}
	if existing.CapabilityVersion == record.CapabilityVersion {
		return false, nil
	}
	if !seed.reconcileVersion {
		return false, fmt.Errorf("binding identity conflict")
	}
	update := tx.Model(&persistence.AgentCapabilityBinding{}).
		Where(
			"binding_id = ? AND revision = ? AND capability_version = ? AND tombstoned_at IS NULL",
			existing.BindingID,
			existing.Revision,
			existing.CapabilityVersion,
		).
		Updates(map[string]interface{}{
			"capability_version": record.CapabilityVersion,
			"revision":           existing.Revision + 1,
			"updated_at":         now,
		})
	if update.Error != nil {
		return false, update.Error
	}
	if update.RowsAffected != 1 {
		return false, fmt.Errorf("binding changed during manifest version reconciliation")
	}
	return false, nil
}

func persistKnowledgeMigration(
	tx *gorm.DB,
	seed knowledgeMigrationSeed,
	now time.Time,
) (bool, error) {
	imported, err := upsertKnowledgeRevision(tx, seed.revision)
	if err != nil {
		return false, err
	}
	if seed.content != nil {
		if err := upsertKnowledgeContent(tx, seed.content); err != nil {
			return false, err
		}
	}
	if err := upsertKnowledgeHead(tx, seed.revision); err != nil {
		return false, err
	}
	if _, err := upsertBackfillManifest(tx, seed.manifest, now); err != nil {
		return false, err
	}
	if _, err := upsertBackfillBinding(tx, seed.binding, now); err != nil {
		return false, err
	}
	if err := upsertKnowledgeBackfillReceipt(tx, seed, now); err != nil {
		return false, err
	}
	return imported, nil
}

func upsertKnowledgeRevision(
	tx *gorm.DB,
	revision *persistence.KnowledgeResourceRevision,
) (bool, error) {
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(revision)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	var existing persistence.KnowledgeResourceRevision
	if err := tx.Where(
		"resource_id = ? AND revision = ?", revision.ResourceID, revision.Revision,
	).First(&existing).Error; err != nil {
		return false, err
	}
	if existing.Ptid != revision.Ptid ||
		existing.Title != revision.Title ||
		existing.ResourceKind != revision.ResourceKind ||
		existing.LocatorKind != revision.LocatorKind ||
		existing.StationContentRef != revision.StationContentRef ||
		existing.ContentHash != revision.ContentHash ||
		existing.IndexRevision != revision.IndexRevision ||
		existing.Availability != revision.Availability {
		return false, fmt.Errorf("knowledge descriptor identity conflict")
	}
	return false, nil
}

func upsertKnowledgeContent(
	tx *gorm.DB,
	content *persistence.KnowledgeContentRevision,
) error {
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(content)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing persistence.KnowledgeContentRevision
	if err := tx.Where("content_ref = ?", content.ContentRef).First(&existing).Error; err != nil {
		return err
	}
	if existing.ResourceID != content.ResourceID ||
		existing.Revision != content.Revision ||
		existing.Ptid != content.Ptid ||
		existing.ContentHash != content.ContentHash ||
		existing.IndexRevision != content.IndexRevision ||
		!bytes.Equal(existing.Content, content.Content) {
		return fmt.Errorf("knowledge content identity conflict")
	}
	return nil
}

func upsertKnowledgeHead(
	tx *gorm.DB,
	revision *persistence.KnowledgeResourceRevision,
) error {
	head := &persistence.KnowledgeResourceHead{
		ResourceID:      revision.ResourceID,
		Ptid:            revision.Ptid,
		CurrentRevision: revision.Revision,
		CreatedAt:       revision.CreatedAt,
		UpdatedAt:       revision.UpdatedAt,
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(head)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing persistence.KnowledgeResourceHead
	if err := tx.Where("resource_id = ?", revision.ResourceID).First(&existing).Error; err != nil {
		return err
	}
	if existing.Ptid != revision.Ptid ||
		existing.CurrentRevision != revision.Revision ||
		existing.TombstonedAt != nil {
		return fmt.Errorf("knowledge descriptor head conflict")
	}
	return nil
}

func upsertKnowledgeBackfillReceipt(
	tx *gorm.DB,
	seed knowledgeMigrationSeed,
	now time.Time,
) error {
	payloadHash := capabilityHash(
		seed.revision.Ptid,
		seed.revision.ResourceID,
		strconv.FormatUint(seed.revision.Revision, 10),
		seed.revision.ContentHash,
		seed.binding.agentID,
	)
	command := &persistence.KnowledgeDescriptorCommand{
		ID:                seed.receiptID,
		Ptid:              seed.revision.Ptid,
		CommandKind:       "backfill",
		IdempotencyKey:    seed.receiptID,
		PayloadHash:       payloadHash,
		ResourceID:        seed.revision.ResourceID,
		Revision:          seed.revision.Revision,
		CapabilityID:      seed.manifest.GetCapabilityId(),
		CapabilityVersion: seed.manifest.GetVersion(),
		CreatedAt:         now,
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(command)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing persistence.KnowledgeDescriptorCommand
	if err := tx.Where("id = ?", command.ID).First(&existing).Error; err != nil {
		return err
	}
	if existing.Ptid != command.Ptid ||
		existing.CommandKind != command.CommandKind ||
		existing.IdempotencyKey != command.IdempotencyKey ||
		existing.PayloadHash != command.PayloadHash ||
		existing.ResourceID != command.ResourceID ||
		existing.Revision != command.Revision ||
		existing.CapabilityID != command.CapabilityID ||
		existing.CapabilityVersion != command.CapabilityVersion {
		return fmt.Errorf("knowledge migration receipt conflict")
	}
	return nil
}

func cleanupLegacyKnowledgeAuthority(
	tx *gorm.DB,
	seed knowledgeLegacyCleanupSeed,
	now time.Time,
) error {
	if strings.TrimSpace(seed.capabilityID) != "knowledge:" {
		bindingUpdate := tx.Model(&persistence.AgentCapabilityBinding{}).
			Where(
				"ptid = ? AND agent_id = ? AND capability_id = ? AND capability_version = ? AND tombstoned_at IS NULL",
				seed.ptid,
				seed.agentID,
				seed.capabilityID,
				capabilityLegacyVersion,
			).
			Updates(map[string]interface{}{
				"revision":           gorm.Expr("revision + 1"),
				"updated_at":         now,
				"tombstoned_at":      now,
				"tombstoned_by_ptid": seed.ptid,
				"tombstone_reason":   "knowledge_descriptor_migrated",
			})
		if bindingUpdate.Error != nil {
			return bindingUpdate.Error
		}
		manifestUpdate := tx.Model(&persistence.CapabilityManifest{}).
			Where(
				"capability_id = ? AND version = ? AND retired_at IS NULL",
				seed.capabilityID,
				capabilityLegacyVersion,
			).
			Updates(map[string]interface{}{
				"availability":      int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED),
				"retired_at":        now,
				"retired_by_ptid":   seed.ptid,
				"retirement_reason": "knowledge_descriptor_migrated",
			})
		if manifestUpdate.Error != nil {
			return manifestUpdate.Error
		}
	}
	if seed.rowID == "" {
		return nil
	}
	return nil
}

func buildCapabilityBackfillReport(
	reports []CapabilityBackfillSourceReport,
	rejections []CapabilityBackfillRejection,
	knowledge []knowledgeMigrationSeed,
) (*CapabilityBackfillReport, []byte, error) {
	knowledgeMigrations := make([]CapabilityBackfillKnowledgeMigration, 0, len(knowledge))
	for _, seed := range knowledge {
		knowledgeMigrations = append(
			knowledgeMigrations,
			CapabilityBackfillKnowledgeMigration{
				SourceID:          seed.sourceID,
				ResourceID:        seed.revision.ResourceID,
				Revision:          seed.revision.Revision,
				CapabilityID:      seed.manifest.GetCapabilityId(),
				CapabilityVersion: seed.manifest.GetVersion(),
				BindingID: "binding-" + shortCapabilityHash(
					seed.binding.ptid,
					seed.binding.agentID,
					seed.binding.capabilityID,
				),
				Outcome: "resolved",
			},
		)
	}
	payload := struct {
		Sources             []CapabilityBackfillSourceReport       `json:"sources"`
		Rejections          []CapabilityBackfillRejection          `json:"rejections"`
		KnowledgeMigrations []CapabilityBackfillKnowledgeMigration `json:"knowledgeMigrations,omitempty"`
	}{
		Sources:             reports,
		Rejections:          rejections,
		KnowledgeMigrations: knowledgeMigrations,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	sum := sha256.Sum256(encoded)
	hash := hex.EncodeToString(sum[:])
	report := &CapabilityBackfillReport{
		RunID:               "capability-backfill-" + hash[:24],
		PayloadHash:         hash,
		Sources:             reports,
		Rejections:          rejections,
		KnowledgeMigrations: knowledgeMigrations,
	}
	fullPayload, err := json.Marshal(report)
	if err != nil {
		return nil, nil, err
	}
	return report, fullPayload, nil
}

func deduplicateManifestSeeds(
	seeds []capabilityManifestSeed,
	rejections *[]CapabilityBackfillRejection,
) []capabilityManifestSeed {
	sort.Slice(seeds, func(i, j int) bool {
		left := seeds[i].manifest.GetCapabilityId() + "\x00" + seeds[i].manifest.GetVersion()
		right := seeds[j].manifest.GetCapabilityId() + "\x00" + seeds[j].manifest.GetVersion()
		if left == right {
			return seeds[i].sourceID < seeds[j].sourceID
		}
		return left < right
	})
	result := make([]capabilityManifestSeed, 0, len(seeds))
	seen := make(map[string]string)
	for _, seed := range seeds {
		key := seed.manifest.GetCapabilityId() + "\x00" + seed.manifest.GetVersion()
		hash, err := capabilityManifestContentHash(seed.manifest)
		if err != nil {
			*rejections = append(*rejections, backfillRejection(
				seed.source, seed.sourceID, "manifest_hash_failed",
			))
			continue
		}
		if previous, ok := seen[key]; ok {
			if previous != hash {
				*rejections = append(*rejections, backfillRejection(
					seed.source, seed.sourceID, "manifest_identity_conflict",
				))
			}
			continue
		}
		seen[key] = hash
		result = append(result, seed)
	}
	return result
}

func deduplicateBindingSeeds(
	seeds []capabilityBindingSeed,
	rejections *[]CapabilityBackfillRejection,
) []capabilityBindingSeed {
	sort.Slice(seeds, func(i, j int) bool {
		left := seeds[i].ptid + "\x00" + seeds[i].agentID + "\x00" + seeds[i].capabilityID
		right := seeds[j].ptid + "\x00" + seeds[j].agentID + "\x00" + seeds[j].capabilityID
		if left == right {
			return bindingSourcePriority(seeds[i].source) < bindingSourcePriority(seeds[j].source)
		}
		return left < right
	})
	result := make([]capabilityBindingSeed, 0, len(seeds))
	seen := make(map[string]capabilityBindingSeed)
	for _, seed := range seeds {
		key := seed.ptid + "\x00" + seed.agentID + "\x00" + seed.capabilityID
		if previous, ok := seen[key]; ok {
			if previous.capabilityVersion != seed.capabilityVersion ||
				previous.enabled != seed.enabled ||
				previous.approvalPolicy != seed.approvalPolicy {
				*rejections = append(*rejections, backfillRejection(
					seed.source, seed.sourceID, "binding_source_conflict",
				))
			}
			continue
		}
		seen[key] = seed
		result = append(result, seed)
	}
	return result
}

func capabilityBackfillReports() []CapabilityBackfillSourceReport {
	sources := []string{
		"agent_config",
		"builtin_tool",
		"client_capability",
		"custom_http_plugin",
		"knowledge_binding",
		"knowledge_resource",
		"skill",
		"skill_binding",
	}
	result := make([]CapabilityBackfillSourceReport, 0, len(sources))
	for _, source := range sources {
		result = append(result, CapabilityBackfillSourceReport{Source: source})
	}
	return result
}

func sortCapabilityBackfillInputs(
	manifests []capabilityManifestSeed,
	bindings []capabilityBindingSeed,
	rejections []CapabilityBackfillRejection,
	reports []CapabilityBackfillSourceReport,
) {
	sort.Slice(manifests, func(i, j int) bool {
		return manifests[i].manifest.GetCapabilityId()+"\x00"+manifests[i].manifest.GetVersion() <
			manifests[j].manifest.GetCapabilityId()+"\x00"+manifests[j].manifest.GetVersion()
	})
	sort.Slice(bindings, func(i, j int) bool {
		return bindings[i].ptid+"\x00"+bindings[i].agentID+"\x00"+bindings[i].capabilityID <
			bindings[j].ptid+"\x00"+bindings[j].agentID+"\x00"+bindings[j].capabilityID
	})
	sort.Slice(rejections, func(i, j int) bool {
		left := rejections[i].Source + "\x00" + rejections[i].SourceID + "\x00" + rejections[i].ReasonCode
		right := rejections[j].Source + "\x00" + rejections[j].SourceID + "\x00" + rejections[j].ReasonCode
		return left < right
	})
	sort.Slice(reports, func(i, j int) bool { return reports[i].Source < reports[j].Source })
}

func sortKnowledgeMigrationInputs(
	migrations []knowledgeMigrationSeed,
	cleanups []knowledgeLegacyCleanupSeed,
) {
	sort.Slice(migrations, func(i, j int) bool {
		left := migrations[i].revision.Ptid + "\x00" +
			migrations[i].revision.ResourceID + "\x00" +
			migrations[i].binding.agentID
		right := migrations[j].revision.Ptid + "\x00" +
			migrations[j].revision.ResourceID + "\x00" +
			migrations[j].binding.agentID
		return left < right
	})
	sort.Slice(cleanups, func(i, j int) bool {
		return cleanups[i].rowID < cleanups[j].rowID
	})
}

func incrementBackfillScanned(reports []CapabilityBackfillSourceReport, source string) {
	for i := range reports {
		if reports[i].Source == source {
			reports[i].Scanned++
			return
		}
	}
}

func incrementBackfillReport(
	reports []CapabilityBackfillSourceReport,
	source string,
	imported bool,
) {
	for i := range reports {
		if reports[i].Source != source {
			continue
		}
		if imported {
			reports[i].Imported++
		} else {
			reports[i].Reconciled++
		}
		return
	}
}

func incrementBackfillRejection(reports []CapabilityBackfillSourceReport, source string) {
	for i := range reports {
		if reports[i].Source == source {
			reports[i].Rejected++
			return
		}
	}
}

func backfillRejection(source, sourceID, reason string) CapabilityBackfillRejection {
	return CapabilityBackfillRejection{
		Source:     source,
		SourceID:   sourceID,
		ReasonCode: reason,
	}
}

func shortCapabilityHash(parts ...string) string {
	return capabilityHash(parts...)[:24]
}

func capabilityHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

func normalizedStrings(values []string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func legacyApprovalPolicy(value string) model.CapabilityApprovalPolicy {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "auto":
		return model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO
	case "deny", "disabled":
		return model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_DENY
	default:
		return model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL
	}
}

func capabilitySecretBoundary(owner model.ToolExecutionOwner) string {
	if owner == model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		return "client"
	}
	return "station"
}

func bindingSourcePriority(source string) int {
	switch source {
	case "knowledge_binding", "skill_binding":
		return 0
	case "agent_config":
		return 1
	default:
		return 2
	}
}
