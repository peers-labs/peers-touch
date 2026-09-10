package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	agentPackageSchemaVersion          = "peers.agent.package.v1"
	agentPackageImportCommand          = "agent-package-import"
	maxAgentPackageIdempotencyKeyBytes = 160
	maxAgentPackageResourceIDBytes     = 128

	packageReasonClientResourceNotPortable = "client_local_resource_not_portable"
	packageReasonClientResourceRequired    = "client_local_resource_resolution_required"
	packageReasonManifestUnavailable       = "capability_manifest_unavailable"
	packageReasonKnowledgeResourceRequired = "knowledge_package_resource_required"
)

var legacyPackageAuthorityKeys = map[string]struct{}{
	"connectors":          {},
	"knowledgeResources":  {},
	"knowledge_resources": {},
	"mcpServers":          {},
	"mcp_servers":         {},
	"skills":              {},
	"tools":               {},
	"toolsAllow":          {},
	"toolsDeny":           {},
	"toolsProfile":        {},
}

type AgentPackageService struct {
	db        *gorm.DB
	agents    *AgentService
	knowledge *KnowledgeResourceService
	authority *CapabilityAuthorityService
	now       func() time.Time
}

type agentPackageImportPlan struct {
	agentOptions     domain.AgentUpsertOptions
	portableBindings map[string]*model.AgentPackageKnowledgeResource
}

type agentPackageImportMutation struct {
	knowledge []*knowledgeDescriptorMutation
	bindings  []*model.AgentCapabilityBinding
}

func NewAgentPackageService(
	db *gorm.DB,
	agents *AgentService,
	knowledge *KnowledgeResourceService,
	authority *CapabilityAuthorityService,
) *AgentPackageService {
	if agents == nil {
		agents = NewAgentService()
	}
	if authority == nil {
		authority = NewCapabilityAuthorityService(db)
	}
	if knowledge == nil {
		knowledge = NewKnowledgeResourceService(db, authority)
	}
	return &AgentPackageService{
		db:        db,
		agents:    agents,
		knowledge: knowledge,
		authority: authority,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *AgentPackageService) Export(
	ctx context.Context,
	ptid string,
	req *model.ExportAgentPackageRequest,
) (*model.ExportAgentPackageResponse, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || strings.TrimSpace(req.GetAgentId()) == "" {
		return nil, capabilityInvalid("ptid and agent_id are required")
	}
	agentRecord, err := getOwnedAgentWithDB(ctx, s.db.WithContext(ctx), ptid, req.GetAgentId())
	if err != nil {
		return nil, err
	}
	configJSON, _, err := normalizePortableAgentConfig(agentRecord.ConfigJSON, false)
	if err != nil {
		return nil, err
	}
	agentRecord.ConfigJSON = configJSON

	var bindingRecords []persistence.AgentCapabilityBinding
	if err := s.db.WithContext(ctx).
		Where("ptid = ? AND agent_id = ? AND tombstoned_at IS NULL", ptid, agentRecord.ID).
		Order("binding_id").
		Find(&bindingRecords).Error; err != nil {
		return nil, capabilityInternal("failed to load Agent package bindings", err)
	}

	response := &model.ExportAgentPackageResponse{
		Package: &model.AgentPackageDocument{
			SchemaVersion: agentPackageSchemaVersion,
			Agent:         persistenceAgentToPackageModel(agentRecord),
			Bindings:      make([]*model.AgentPackageBindingRef, 0, len(bindingRecords)),
		},
	}
	portableResources := make(map[string]*model.AgentPackageKnowledgeResource)
	bindingIdentities := make(map[string]struct{}, len(bindingRecords))
	for i := range bindingRecords {
		binding := &bindingRecords[i]
		identity := packageBindingIdentity(binding.CapabilityID, binding.CapabilityVersion)
		if _, duplicate := bindingIdentities[identity]; duplicate {
			return nil, capabilityInvalid("Agent contains duplicate active capability bindings")
		}
		bindingIdentities[identity] = struct{}{}
		response.Package.Bindings = append(response.Package.Bindings, &model.AgentPackageBindingRef{
			CapabilityId:      binding.CapabilityID,
			CapabilityVersion: binding.CapabilityVersion,
			Enabled:           binding.Enabled,
			ApprovalPolicy:    model.CapabilityApprovalPolicy(binding.ApprovalPolicy),
		})

		manifest, loadErr := s.loadExportManifest(ctx, ptid, binding)
		if loadErr != nil {
			if errors.Is(loadErr, gorm.ErrRecordNotFound) {
				response.UnresolvedDependencies = append(
					response.UnresolvedDependencies,
					packageUnresolved(binding, packageResourceIDFromCapability(binding.CapabilityID), packageReasonManifestUnavailable),
				)
				continue
			}
			return nil, capabilityInternal("failed to resolve Agent package manifest", loadErr)
		}
		if model.CapabilitySourceKind(manifest.SourceKind) !=
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE {
			continue
		}
		resource, reason, loadErr := s.exportKnowledgeResource(ctx, ptid, binding, manifest)
		if loadErr != nil {
			return nil, loadErr
		}
		if reason != "" {
			response.UnresolvedDependencies = append(
				response.UnresolvedDependencies,
				packageUnresolved(binding, manifest.SourceInstanceID, reason),
			)
			continue
		}
		if existing, ok := portableResources[resource.GetPackageResourceId()]; ok {
			if !proto.Equal(existing, resource) {
				return nil, capabilityInvalid("Agent package cannot represent multiple active revisions of one Knowledge resource")
			}
			continue
		}
		portableResources[resource.GetPackageResourceId()] = resource
	}

	resourceIDs := make([]string, 0, len(portableResources))
	for resourceID := range portableResources {
		resourceIDs = append(resourceIDs, resourceID)
	}
	sort.Strings(resourceIDs)
	for _, resourceID := range resourceIDs {
		response.Package.KnowledgeResources = append(
			response.Package.KnowledgeResources,
			portableResources[resourceID],
		)
	}
	sortPackageUnresolved(response.UnresolvedDependencies)
	return response, nil
}

func (s *AgentPackageService) Import(
	ctx context.Context,
	ptid string,
	req *model.ImportAgentPackageRequest,
) (*model.ImportAgentPackageResponse, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || req.GetPackage() == nil ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxAgentPackageIdempotencyKeyBytes {
		return nil, capabilityInvalid("ptid, package and idempotency_key are required")
	}
	payloadHash, err := agentPackageImportPayloadHash(req)
	if err != nil {
		return nil, capabilityInternal("failed to hash Agent package import", err)
	}
	if replayed, err := loadAgentPackageImportReceipt(
		s.db.WithContext(ctx), ptid, req.GetIdempotencyKey(), payloadHash,
	); err != nil || replayed != nil {
		return replayed, err
	}

	plan, unresolved, err := s.preflightImport(ctx, ptid, req)
	if err != nil {
		return nil, err
	}
	if len(unresolved) > 0 {
		sortPackageUnresolved(unresolved)
		return &model.ImportAgentPackageResponse{UnresolvedDependencies: unresolved}, nil
	}

	var response *model.ImportAgentPackageResponse
	var mutation agentPackageImportMutation
	replayed := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		stored, receiptErr := loadAgentPackageImportReceipt(
			tx, ptid, req.GetIdempotencyKey(), payloadHash,
		)
		if receiptErr != nil {
			return receiptErr
		}
		if stored != nil {
			response = stored
			replayed = true
			return nil
		}
		var importErr error
		response, mutation, importErr = s.importTx(ctx, tx, ptid, req, plan, payloadHash)
		return importErr
	})
	if err != nil {
		if stored, receiptErr := loadAgentPackageImportReceipt(
			s.db.WithContext(ctx), ptid, req.GetIdempotencyKey(), payloadHash,
		); receiptErr != nil {
			return nil, receiptErr
		} else if stored != nil {
			return stored, nil
		}
		return nil, err
	}
	if !replayed {
		for _, item := range mutation.knowledge {
			s.knowledge.publishManifestInvalidationAfterCommit(ctx, *item)
		}
		for _, binding := range mutation.bindings {
			s.authority.publishBindingInvalidation(
				ctx,
				domain.AgentAuthorityInvalidationBindingUpsert,
				binding,
			)
		}
	}
	return response, nil
}

func (s *AgentPackageService) importTx(
	ctx context.Context,
	tx *gorm.DB,
	ptid string,
	req *model.ImportAgentPackageRequest,
	plan *agentPackageImportPlan,
	payloadHash string,
) (*model.ImportAgentPackageResponse, agentPackageImportMutation, error) {
	var mutation agentPackageImportMutation
	agent, err := s.agents.createAgentTx(ctx, tx, plan.agentOptions)
	if err != nil {
		return nil, mutation, err
	}

	resolvedKnowledge := make(map[string]*model.CapabilityManifest, len(plan.portableBindings))
	resources := append([]*model.AgentPackageKnowledgeResource(nil), req.GetPackage().GetKnowledgeResources()...)
	sort.Slice(resources, func(i, j int) bool {
		return resources[i].GetPackageResourceId() < resources[j].GetPackageResourceId()
	})
	for _, resource := range resources {
		createRequest := &model.CreateKnowledgeResourceDescriptorRequest{
			ResourceKind: resource.GetResourceKind(),
			Source: &model.CreateKnowledgeResourceDescriptorRequest_StationContent{
				StationContent: append([]byte(nil), resource.GetStationContent()...),
			},
			IdempotencyKey: packageCommandKey(
				"knowledge", req.GetIdempotencyKey(), resource.GetPackageResourceId(),
			),
			Title: resource.GetTitle(),
		}
		createHash, hashErr := capabilityProtoHash(createRequest)
		if hashErr != nil {
			return nil, mutation, capabilityInternal("failed to hash imported Knowledge resource", hashErr)
		}
		created, createErr := s.knowledge.createTx(ctx, tx, ptid, createRequest, createHash)
		if createErr != nil {
			return nil, mutation, createErr
		}
		mutation.knowledge = append(mutation.knowledge, created)
		sourceIdentity := packageBindingIdentity(
			knowledgeCapabilityID(resource.GetPackageResourceId()),
			packageKnowledgeVersion(resource, req.GetPackage().GetBindings()),
		)
		resolvedKnowledge[sourceIdentity] = created.manifest
	}

	for index, bindingRef := range req.GetPackage().GetBindings() {
		capabilityID := strings.TrimSpace(bindingRef.GetCapabilityId())
		capabilityVersion := strings.TrimSpace(bindingRef.GetCapabilityVersion())
		if importedManifest := resolvedKnowledge[packageBindingIdentity(capabilityID, capabilityVersion)]; importedManifest != nil {
			capabilityID = importedManifest.GetCapabilityId()
			capabilityVersion = importedManifest.GetVersion()
		}
		bindingRequest := &model.UpsertAgentCapabilityBindingRequest{
			Binding: &model.AgentCapabilityBinding{
				AgentId:              agent.AgentID,
				CapabilityId:         capabilityID,
				CapabilityVersion:    capabilityVersion,
				Enabled:              bindingRef.GetEnabled(),
				ApprovalPolicy:       bindingRef.GetApprovalPolicy(),
				ExpectedAgentVersion: uint64(agent.Version),
			},
			IdempotencyKey: packageCommandKey(
				"binding",
				req.GetIdempotencyKey(),
				strconv.Itoa(index),
				capabilityID,
				capabilityVersion,
			),
		}
		bindingHash, hashErr := capabilityProtoHash(bindingRequest)
		if hashErr != nil {
			return nil, mutation, capabilityInternal("failed to hash imported capability binding", hashErr)
		}
		binding, mutated, bindErr := s.authority.upsertBindingCommandTx(
			ctx, tx, ptid, bindingRequest, bindingHash,
		)
		if bindErr != nil {
			return nil, mutation, bindErr
		}
		if mutated {
			mutation.bindings = append(mutation.bindings, binding)
		}
	}

	response := &model.ImportAgentPackageResponse{Agent: domainAgentToPackageModel(agent)}
	resultPayload, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return nil, mutation, capabilityInternal("failed to encode Agent package import receipt", err)
	}
	receipt := &persistence.AgentPackageImportReceipt{
		ID:             generateID("agent-package-import"),
		Ptid:           ptid,
		IdempotencyKey: strings.TrimSpace(req.GetIdempotencyKey()),
		PayloadHash:    payloadHash,
		AgentID:        agent.AgentID,
		ResultPayload:  resultPayload,
		CreatedAt:      s.now(),
	}
	if err := tx.Create(receipt).Error; err != nil {
		return nil, mutation, capabilityInternal("failed to store Agent package import receipt", err)
	}
	return response, mutation, nil
}

func (s *AgentPackageService) preflightImport(
	ctx context.Context,
	ptid string,
	req *model.ImportAgentPackageRequest,
) (*agentPackageImportPlan, []*model.AgentPackageUnresolvedDependency, error) {
	pkg := req.GetPackage()
	if strings.TrimSpace(pkg.GetSchemaVersion()) != agentPackageSchemaVersion {
		return nil, nil, capabilityInvalid("unsupported Agent package schema_version")
	}
	if pkg.GetAgent() == nil {
		return nil, nil, capabilityInvalid("Agent package agent is required")
	}
	configJSON, changed, err := normalizePortableAgentConfig(pkg.GetAgent().GetConfigJson(), true)
	if err != nil {
		return nil, nil, err
	}
	if changed {
		return nil, nil, capabilityInvalid("Agent package contains legacy capability authority")
	}
	name := strings.TrimSpace(req.GetName())
	if name == "" {
		name = strings.TrimSpace(pkg.GetAgent().GetName())
	}
	if name == "" {
		return nil, nil, capabilityInvalid("Agent package name is required")
	}
	if _, err := normalizeThinkingMode(domain.ThinkingMode(pkg.GetAgent().GetThinkingMode())); err != nil {
		return nil, nil, err
	}

	bindingsByCapability := make(map[string][]*model.AgentPackageBindingRef)
	bindingIdentities := make(map[string]struct{}, len(pkg.GetBindings()))
	for _, binding := range pkg.GetBindings() {
		if err := validatePackageBinding(binding); err != nil {
			return nil, nil, err
		}
		identity := packageBindingIdentity(binding.GetCapabilityId(), binding.GetCapabilityVersion())
		if _, duplicate := bindingIdentities[identity]; duplicate {
			return nil, nil, capabilityInvalid("Agent package contains duplicate capability binding")
		}
		bindingIdentities[identity] = struct{}{}
		capabilityID := strings.TrimSpace(binding.GetCapabilityId())
		bindingsByCapability[capabilityID] = append(bindingsByCapability[capabilityID], binding)
	}

	portableBindings := make(map[string]*model.AgentPackageKnowledgeResource)
	resourceIDs := make(map[string]struct{}, len(pkg.GetKnowledgeResources()))
	for _, resource := range pkg.GetKnowledgeResources() {
		if err := validatePackageKnowledgeResource(resource); err != nil {
			return nil, nil, err
		}
		resourceID := strings.TrimSpace(resource.GetPackageResourceId())
		if _, duplicate := resourceIDs[resourceID]; duplicate {
			return nil, nil, capabilityInvalid("Agent package contains duplicate Knowledge resource")
		}
		resourceIDs[resourceID] = struct{}{}
		capabilityID := knowledgeCapabilityID(resourceID)
		matches := bindingsByCapability[capabilityID]
		if len(matches) != 1 {
			return nil, nil, capabilityInvalid("portable Knowledge resource must have exactly one active binding")
		}
		version, parseErr := strconv.ParseUint(strings.TrimSpace(matches[0].GetCapabilityVersion()), 10, 64)
		if parseErr != nil || version == 0 {
			return nil, nil, capabilityInvalid("portable Knowledge binding version is invalid")
		}
		expectedIndexRevision := knowledgeIndexRevision(resourceID, version, resource.GetContentHash())
		if resource.GetIndexRevision() != expectedIndexRevision {
			return nil, nil, capabilityInvalid("portable Knowledge index revision does not match content")
		}
		portableBindings[packageBindingIdentity(capabilityID, matches[0].GetCapabilityVersion())] = resource
	}

	unresolved := make([]*model.AgentPackageUnresolvedDependency, 0)
	for _, binding := range pkg.GetBindings() {
		identity := packageBindingIdentity(binding.GetCapabilityId(), binding.GetCapabilityVersion())
		if portableBindings[identity] != nil {
			continue
		}
		if resourceID := packageResourceIDFromCapability(binding.GetCapabilityId()); resourceID != "" {
			unresolved = append(
				unresolved,
				packageUnresolvedRef(binding, resourceID, packageReasonClientResourceRequired),
			)
			continue
		}
		var manifest persistence.CapabilityManifest
		err := s.db.WithContext(ctx).Where(
			"capability_id = ? AND version = ? AND retired_at IS NULL AND (owner_ptid = ? OR owner_ptid = ?)",
			strings.TrimSpace(binding.GetCapabilityId()),
			strings.TrimSpace(binding.GetCapabilityVersion()),
			"",
			ptid,
		).First(&manifest).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			unresolved = append(
				unresolved,
				packageUnresolvedRef(binding, "", packageReasonManifestUnavailable),
			)
			continue
		}
		if err != nil {
			return nil, nil, capabilityInternal("failed to preflight Agent package manifest", err)
		}
		if model.CapabilitySourceKind(manifest.SourceKind) ==
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE {
			unresolved = append(
				unresolved,
				packageUnresolvedRef(binding, manifest.SourceInstanceID, packageReasonKnowledgeResourceRequired),
			)
		}
	}

	return &agentPackageImportPlan{
		agentOptions: domain.AgentUpsertOptions{
			ActorPTID:    ptid,
			Name:         name,
			Title:        pkg.GetAgent().GetTitle(),
			Description:  pkg.GetAgent().GetDescription(),
			ProviderID:   pkg.GetAgent().GetProviderId(),
			ModelName:    pkg.GetAgent().GetModelName(),
			Effort:       pkg.GetAgent().GetEffort(),
			ThinkingMode: domain.ThinkingMode(pkg.GetAgent().GetThinkingMode()),
			Visibility:   packageAgentVisibility(pkg.GetAgent().GetVisibility()),
			ConfigJSON:   configJSON,
		},
		portableBindings: portableBindings,
	}, unresolved, nil
}

func (s *AgentPackageService) loadExportManifest(
	ctx context.Context,
	ptid string,
	binding *persistence.AgentCapabilityBinding,
) (*persistence.CapabilityManifest, error) {
	var manifest persistence.CapabilityManifest
	if err := s.db.WithContext(ctx).Where(
		"capability_id = ? AND version = ? AND retired_at IS NULL AND (owner_ptid = ? OR owner_ptid = ?)",
		binding.CapabilityID,
		binding.CapabilityVersion,
		"",
		ptid,
	).First(&manifest).Error; err != nil {
		return nil, err
	}
	return &manifest, nil
}

func (s *AgentPackageService) exportKnowledgeResource(
	ctx context.Context,
	ptid string,
	binding *persistence.AgentCapabilityBinding,
	manifest *persistence.CapabilityManifest,
) (*model.AgentPackageKnowledgeResource, string, error) {
	revision, err := strconv.ParseUint(binding.CapabilityVersion, 10, 64)
	if err != nil || revision == 0 || strings.TrimSpace(manifest.SourceInstanceID) == "" {
		return nil, packageReasonKnowledgeResourceRequired, nil
	}
	var descriptor persistence.KnowledgeResourceRevision
	if err := s.db.WithContext(ctx).Where(
		"resource_id = ? AND revision = ? AND ptid = ?",
		manifest.SourceInstanceID,
		revision,
		ptid,
	).First(&descriptor).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, packageReasonKnowledgeResourceRequired, nil
		}
		return nil, "", capabilityInternal("failed to load Agent package Knowledge descriptor", err)
	}
	if descriptor.LocatorKind == "client" {
		return nil, packageReasonClientResourceNotPortable, nil
	}
	if descriptor.LocatorKind != "station" {
		return nil, packageReasonKnowledgeResourceRequired, nil
	}
	var content persistence.KnowledgeContentRevision
	if err := s.db.WithContext(ctx).Where(
		"content_ref = ? AND resource_id = ? AND revision = ? AND ptid = ?",
		descriptor.StationContentRef,
		descriptor.ResourceID,
		descriptor.Revision,
		ptid,
	).First(&content).Error; err != nil {
		return nil, "", capabilityInternal("failed to load Agent package Knowledge content", err)
	}
	contentHash := sha256.Sum256(content.Content)
	actualHash := hex.EncodeToString(contentHash[:])
	if actualHash != descriptor.ContentHash || actualHash != content.ContentHash ||
		descriptor.IndexRevision != content.IndexRevision {
		return nil, "", capabilityInternal("Agent package Knowledge integrity check failed", nil)
	}
	return &model.AgentPackageKnowledgeResource{
		PackageResourceId: descriptor.ResourceID,
		ResourceKind:      model.KnowledgeResourceKind(descriptor.ResourceKind),
		Title:             descriptor.Title,
		StationContent:    append([]byte(nil), content.Content...),
		ContentHash:       descriptor.ContentHash,
		IndexRevision:     descriptor.IndexRevision,
	}, "", nil
}

func validatePackageBinding(binding *model.AgentPackageBindingRef) error {
	if binding == nil || strings.TrimSpace(binding.GetCapabilityId()) == "" ||
		strings.TrimSpace(binding.GetCapabilityVersion()) == "" {
		return capabilityInvalid("Agent package binding capability_id and capability_version are required")
	}
	if binding.GetApprovalPolicy() ==
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_UNSPECIFIED {
		return capabilityInvalid("Agent package binding approval_policy is required")
	}
	if _, ok := model.CapabilityApprovalPolicy_name[int32(binding.GetApprovalPolicy())]; !ok {
		return capabilityInvalid("Agent package binding approval_policy is invalid")
	}
	return nil
}

func validatePackageKnowledgeResource(resource *model.AgentPackageKnowledgeResource) error {
	if resource == nil {
		return capabilityInvalid("Agent package Knowledge resource is required")
	}
	resourceID := strings.TrimSpace(resource.GetPackageResourceId())
	if resourceID == "" || len(resourceID) > maxAgentPackageResourceIDBytes ||
		!utf8.ValidString(resourceID) || strings.TrimSpace(resource.GetTitle()) == "" ||
		resource.GetResourceKind() == model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_UNSPECIFIED ||
		len(resource.GetStationContent()) == 0 ||
		len(resource.GetStationContent()) > maxKnowledgeStationContentBytes ||
		strings.TrimSpace(resource.GetContentHash()) == "" ||
		strings.TrimSpace(resource.GetIndexRevision()) == "" {
		return capabilityInvalid("Agent package Knowledge resource is incomplete")
	}
	if strings.ContainsAny(resourceID, `/\\`) ||
		strings.IndexFunc(resourceID, unicode.IsSpace) >= 0 ||
		strings.IndexFunc(resourceID, unicode.IsControl) >= 0 {
		return capabilityInvalid("Agent package resource ID is invalid")
	}
	sum := sha256.Sum256(resource.GetStationContent())
	if !strings.EqualFold(resource.GetContentHash(), hex.EncodeToString(sum[:])) {
		return capabilityInvalid("Agent package Knowledge content hash mismatch")
	}
	return nil
}

func agentPackageImportPayloadHash(req *model.ImportAgentPackageRequest) (string, error) {
	canonical := proto.Clone(req).(*model.ImportAgentPackageRequest)
	canonical.IdempotencyKey = ""
	return capabilityProtoHash(canonical)
}

func loadAgentPackageImportReceipt(
	db *gorm.DB,
	ptid string,
	idempotencyKey string,
	payloadHash string,
) (*model.ImportAgentPackageResponse, error) {
	var receipt persistence.AgentPackageImportReceipt
	err := db.Where(
		"ptid = ? AND idempotency_key = ?",
		strings.TrimSpace(ptid),
		strings.TrimSpace(idempotencyKey),
	).First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("failed to load Agent package import receipt", err)
	}
	if receipt.PayloadHash != payloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"idempotency key payload mismatch",
			nil,
		)
	}
	response := &model.ImportAgentPackageResponse{}
	if err := proto.Unmarshal(receipt.ResultPayload, response); err != nil {
		return nil, capabilityInternal("failed to decode Agent package import receipt", err)
	}
	if response.GetAgent() == nil || response.GetAgent().GetAgentId() != receipt.AgentID {
		return nil, capabilityInternal("Agent package import receipt is inconsistent", nil)
	}
	return response, nil
}

func normalizePortableAgentConfig(raw string, rejectLegacy bool) (string, bool, error) {
	if strings.TrimSpace(raw) == "" {
		return "", false, nil
	}
	var config map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &config); err != nil || config == nil {
		return "", false, capabilityInvalid("Agent package config_json must be a JSON object")
	}
	changed := stripLegacyPackageKeys(config)
	for _, key := range []string{"chatConfig", "chat_config"} {
		rawNested, ok := config[key]
		if !ok {
			continue
		}
		nestedChanged, normalized, err := normalizeNestedPortableConfig(rawNested)
		if err != nil {
			return "", false, err
		}
		if nestedChanged {
			changed = true
			config[key] = normalized
		}
	}
	if rejectLegacy && changed {
		return raw, true, nil
	}
	normalized, err := json.Marshal(config)
	if err != nil {
		return "", false, capabilityInternal("failed to encode portable Agent config", err)
	}
	return string(normalized), changed, nil
}

func normalizeNestedPortableConfig(raw json.RawMessage) (bool, json.RawMessage, error) {
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err == nil {
		var nested map[string]json.RawMessage
		if err := json.Unmarshal([]byte(encoded), &nested); err != nil || nested == nil {
			return false, nil, capabilityInvalid("Agent package chatConfig must be a JSON object")
		}
		changed := stripLegacyPackageKeys(nested)
		normalized, err := json.Marshal(nested)
		if err != nil {
			return false, nil, capabilityInternal("failed to encode portable Agent chatConfig", err)
		}
		wrapped, err := json.Marshal(string(normalized))
		if err != nil {
			return false, nil, capabilityInternal("failed to encode portable Agent chatConfig", err)
		}
		return changed, wrapped, nil
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(raw, &nested); err != nil || nested == nil {
		return false, nil, capabilityInvalid("Agent package chatConfig must be a JSON object")
	}
	changed := stripLegacyPackageKeys(nested)
	normalized, err := json.Marshal(nested)
	if err != nil {
		return false, nil, capabilityInternal("failed to encode portable Agent chatConfig", err)
	}
	return changed, normalized, nil
}

func stripLegacyPackageKeys(config map[string]json.RawMessage) bool {
	changed := false
	for key := range legacyPackageAuthorityKeys {
		if _, exists := config[key]; exists {
			delete(config, key)
			changed = true
		}
	}
	return changed
}

func persistenceAgentToPackageModel(record *persistence.Agent) *model.Agent {
	agent := persistenceAgentToDomain(record)
	return domainAgentToPackageModel(&agent)
}

func domainAgentToPackageModel(agent *domain.Agent) *model.Agent {
	if agent == nil {
		return nil
	}
	visibility := model.AgentVisibility_AGENT_VISIBILITY_PRIVATE
	if agent.Visibility == domain.AgentVisibilityWorkspace {
		visibility = model.AgentVisibility_AGENT_VISIBILITY_WORKSPACE
	}
	return &model.Agent{
		AgentId:        agent.AgentID,
		Name:           agent.Name,
		Title:          agent.Title,
		Description:    agent.Description,
		ProviderId:     agent.ProviderID,
		ModelName:      agent.ModelName,
		Effort:         agent.Effort,
		Visibility:     visibility,
		OwnerActorPtid: agent.OwnerActorPTID,
		ConfigJson:     agent.ConfigJSON,
		CreatedAt:      timestamppb.New(agent.CreatedAt),
		UpdatedAt:      timestamppb.New(agent.UpdatedAt),
		Version:        agent.Version,
		ThinkingMode:   string(agent.ThinkingMode),
	}
}

func packageAgentVisibility(value model.AgentVisibility) domain.AgentVisibility {
	if value == model.AgentVisibility_AGENT_VISIBILITY_WORKSPACE {
		return domain.AgentVisibilityWorkspace
	}
	return domain.AgentVisibilityPrivate
}

func packageBindingIdentity(capabilityID string, version string) string {
	return strings.TrimSpace(capabilityID) + "\x00" + strings.TrimSpace(version)
}

func packageResourceIDFromCapability(capabilityID string) string {
	const prefix = "knowledge.resource."
	capabilityID = strings.TrimSpace(capabilityID)
	if !strings.HasPrefix(capabilityID, prefix) {
		return ""
	}
	return strings.TrimPrefix(capabilityID, prefix)
}

func packageKnowledgeVersion(
	resource *model.AgentPackageKnowledgeResource,
	bindings []*model.AgentPackageBindingRef,
) string {
	capabilityID := knowledgeCapabilityID(resource.GetPackageResourceId())
	for _, binding := range bindings {
		if strings.TrimSpace(binding.GetCapabilityId()) == capabilityID {
			return strings.TrimSpace(binding.GetCapabilityVersion())
		}
	}
	return ""
}

func packageCommandKey(prefix string, idempotencyKey string, parts ...string) string {
	payload := prefix + "\x00" + strings.TrimSpace(idempotencyKey) + "\x00" + strings.Join(parts, "\x00")
	sum := sha256.Sum256([]byte(payload))
	return fmt.Sprintf("package-%s:%s", prefix, hex.EncodeToString(sum[:]))
}

func packageUnresolved(
	binding *persistence.AgentCapabilityBinding,
	packageResourceID string,
	reason string,
) *model.AgentPackageUnresolvedDependency {
	return &model.AgentPackageUnresolvedDependency{
		PackageResourceId: strings.TrimSpace(packageResourceID),
		CapabilityId:      binding.CapabilityID,
		CapabilityVersion: binding.CapabilityVersion,
		ReasonCode:        reason,
	}
}

func packageUnresolvedRef(
	binding *model.AgentPackageBindingRef,
	packageResourceID string,
	reason string,
) *model.AgentPackageUnresolvedDependency {
	return &model.AgentPackageUnresolvedDependency{
		PackageResourceId: strings.TrimSpace(packageResourceID),
		CapabilityId:      strings.TrimSpace(binding.GetCapabilityId()),
		CapabilityVersion: strings.TrimSpace(binding.GetCapabilityVersion()),
		ReasonCode:        reason,
	}
}

func sortPackageUnresolved(items []*model.AgentPackageUnresolvedDependency) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetPackageResourceId() + "\x00" + items[i].GetCapabilityId() + "\x00" + items[i].GetCapabilityVersion()
		right := items[j].GetPackageResourceId() + "\x00" + items[j].GetCapabilityId() + "\x00" + items[j].GetCapabilityVersion()
		return left < right
	})
}
