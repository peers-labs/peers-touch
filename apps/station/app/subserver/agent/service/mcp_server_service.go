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

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const maxMcpIdempotencyKeyBytes = 160

type mcpPublicConfig struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
	EnvKeys     []string `json:"envKeys,omitempty"`
	URL         string   `json:"url,omitempty"`
	HeaderKeys  []string `json:"headerKeys,omitempty"`
}

type mcpSecretConfig struct {
	Env     map[string]string `json:"env,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

type McpServerService struct {
	db        *gorm.DB
	authority *CapabilityAuthorityService
	registry  *ToolRegistryService
	now       func() time.Time
}

func NewMcpServerService(
	db *gorm.DB,
	authority *CapabilityAuthorityService,
	registry *ToolRegistryService,
) *McpServerService {
	return &McpServerService{
		db:        db,
		authority: authority,
		registry:  registry,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *McpServerService) RestoreRegistry(ctx context.Context) error {
	var revisions []persistence.McpServerRevision
	if err := s.db.WithContext(ctx).
		Where("enabled = ?", true).
		Find(&revisions).Error; err != nil {
		return capabilityInternal("load MCP registry projection", err)
	}
	for i := range revisions {
		server, err := mcpServerRevisionModel(&revisions[i])
		if err != nil {
			return err
		}
		s.registerServerTools(server)
	}
	return nil
}

func (s *McpServerService) Upsert(
	ctx context.Context,
	ptid string,
	req *model.UpsertMcpServerRequest,
) (*model.UpsertMcpServerResponse, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || req.GetServer() == nil {
		return nil, capabilityInvalid("ptid and MCP server are required")
	}
	if err := validateMcpIdempotencyKey(req.GetIdempotencyKey()); err != nil {
		return nil, err
	}
	input := proto.Clone(req.GetServer()).(*model.McpServer)
	input.Ptid = ptid
	input.Name = strings.TrimSpace(input.GetName())
	if input.Name == "" {
		return nil, capabilityInvalid("MCP server name is required")
	}
	if input.GetTransport() == model.McpTransport_MCP_TRANSPORT_UNSPECIFIED {
		return nil, capabilityInvalid("MCP transport is required")
	}
	if input.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION &&
		input.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		return nil, capabilityInvalid("MCP execution owner must be STATION or CLIENT_CAPABILITY")
	}
	stationSecrets := req.GetStationSecrets()
	if input.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY &&
		stationSecrets != nil &&
		(len(stationSecrets.GetEnv()) > 0 || len(stationSecrets.GetHeaders()) > 0) {
		return nil, capabilityInvalid(
			"client-owned MCP secrets must remain in the client executor",
		)
	}
	normalizedRequest := proto.Clone(req).(*model.UpsertMcpServerRequest)
	normalizedRequest.Server = input
	payloadHash, err := mcpMutationHash(normalizedRequest)
	if err != nil {
		return nil, err
	}
	replayed, err := replayMcpCommand(
		s.db.WithContext(ctx),
		ptid,
		"upsert",
		req.GetIdempotencyKey(),
		payloadHash,
	)
	if err != nil {
		return nil, err
	}
	if replayed != nil {
		var response model.UpsertMcpServerResponse
		if err := proto.Unmarshal(replayed.ResultPayload, &response); err != nil {
			return nil, capabilityInternal("decode MCP upsert replay", err)
		}
		response.Replayed = true
		return &response, nil
	}

	var existing persistence.McpServer
	query := s.db.WithContext(ctx).Where(
		"ptid = ? AND deleted_at IS NULL AND (server_id = ? OR name = ?)",
		ptid,
		strings.TrimSpace(input.GetServerId()),
		input.Name,
	).First(&existing)
	if query.Error != nil && !errors.Is(query.Error, gorm.ErrRecordNotFound) {
		return nil, capabilityInternal("load MCP server", query.Error)
	}
	found := query.Error == nil
	if found && req.GetExpectedRevision() != existing.Revision {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"MCP server revision conflict",
			nil,
		)
	}
	if !found && req.GetExpectedRevision() != 0 {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"MCP server does not exist at the expected revision",
			nil,
		)
	}

	serverID := strings.TrimSpace(input.GetServerId())
	if found {
		serverID = existing.ServerID
	}
	if serverID == "" {
		serverID = uuid.NewString()
	}
	revision := uint64(1)
	createdAt := s.now()
	if found {
		revision = existing.Revision + 1
		createdAt = existing.CreatedAt
	}

	secrets := mcpSecretConfig{}
	if found && len(existing.SecretConfigJSON) > 0 {
		_ = json.Unmarshal(existing.SecretConfigJSON, &secrets)
	}
	if input.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		secrets = mcpSecretConfig{}
	} else if stationSecrets != nil {
		secrets.Env = mergeMcpSecrets(secrets.Env, stationSecrets.GetEnv())
		secrets.Headers = mergeMcpSecrets(
			secrets.Headers,
			stationSecrets.GetHeaders(),
		)
	}
	publicConfig := mcpPublicConfig{
		Title:       strings.TrimSpace(input.GetTitle()),
		Description: strings.TrimSpace(input.GetDescription()),
		Command:     strings.TrimSpace(input.GetCommand()),
		Args:        normalizedMcpStrings(input.GetArgs()),
		EnvKeys:     sortedMcpKeys(secrets.Env, input.GetEnvKeys()),
		URL:         strings.TrimSpace(input.GetUrl()),
		HeaderKeys:  sortedMcpKeys(secrets.Headers, input.GetHeaderKeys()),
	}
	runtimeConfig := mcpRuntimeConfig{
		Transport: input.GetTransport(),
		Command:   publicConfig.Command,
		Args:      publicConfig.Args,
		Env:       cloneStringMap(secrets.Env),
		URL:       publicConfig.URL,
		Headers:   cloneStringMap(secrets.Headers),
	}
	if err := validateMcpRuntimeConfig(runtimeConfig); err != nil {
		return nil, capabilityInvalid(err.Error())
	}

	tools := normalizeMcpToolDescriptors(input.GetTools())
	status := model.McpServerStatus_MCP_SERVER_STATUS_DISCONNECTED
	lastError := ""
	var lastTestedAt *time.Time
	if input.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION &&
		input.GetEnabled() {
		discovered, probeErr := probeMcpRuntime(ctx, runtimeConfig)
		now := s.now()
		lastTestedAt = &now
		if probeErr != nil {
			status = model.McpServerStatus_MCP_SERVER_STATUS_FAILED
			lastError = redactMcpRuntimeError(probeErr.Error(), secrets)
			tools = nil
		} else {
			status = model.McpServerStatus_MCP_SERVER_STATUS_READY
			tools = mcpToolDescriptors(serverID, revision, discovered)
		}
	} else if input.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY &&
		len(tools) > 0 && input.GetEnabled() {
		status = model.McpServerStatus_MCP_SERVER_STATUS_READY
		tools = assignMcpToolIdentities(serverID, revision, tools)
	}

	publicJSON, err := json.Marshal(publicConfig)
	if err != nil {
		return nil, capabilityInternal("encode MCP public configuration", err)
	}
	secretJSON, err := json.Marshal(secrets)
	if err != nil {
		return nil, capabilityInternal("encode MCP secret configuration", err)
	}
	toolsJSON, err := json.Marshal(tools)
	if err != nil {
		return nil, capabilityInternal("encode MCP tools", err)
	}
	now := s.now()
	record := &persistence.McpServer{
		ServerID:         serverID,
		Ptid:             ptid,
		Name:             input.Name,
		Revision:         revision,
		Transport:        int32(input.GetTransport()),
		ExecutionOwner:   int32(input.GetExecutionOwner()),
		PublicConfigJSON: string(publicJSON),
		SecretConfigJSON: secretJSON,
		ToolsJSON:        string(toolsJSON),
		Enabled:          input.GetEnabled(),
		Status:           int32(status),
		LastError:        lastError,
		LastTestedAt:     lastTestedAt,
		CreatedAt:        createdAt,
		UpdatedAt:        now,
	}
	var result *model.UpsertMcpServerResponse
	oldTools := []*model.McpToolDescriptor{}
	oldManifests := []*model.CapabilityManifest{}
	if found {
		old, decodeErr := mcpServerModel(&existing)
		if decodeErr != nil {
			return nil, decodeErr
		}
		oldTools = old.GetTools()
		oldManifests = mcpManifestModels(old)
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayMcpCommand(
			tx,
			ptid,
			"upsert",
			req.GetIdempotencyKey(),
			payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			var response model.UpsertMcpServerResponse
			if err := proto.Unmarshal(replayed.ResultPayload, &response); err != nil {
				return capabilityInternal("decode MCP upsert replay", err)
			}
			response.Replayed = true
			result = &response
			return nil
		}
		if found {
			if err := retireMcpManifestsTx(tx, ptid, oldTools, now, "mcp_server_revised"); err != nil {
				return err
			}
			result := tx.Model(&persistence.McpServer{}).
				Where("server_id = ? AND ptid = ? AND revision = ?", serverID, ptid, existing.Revision).
				Select(
					"name",
					"revision",
					"transport",
					"execution_owner",
					"public_config_json",
					"secret_config_json",
					"tools_json",
					"enabled",
					"status",
					"last_error",
					"last_tested_at",
					"updated_at",
				).
				Updates(record)
			if result.Error != nil {
				return capabilityInternal("update MCP server", result.Error)
			}
			if result.RowsAffected != 1 {
				return errcode.New(
					errcode.AgentVersionConflict,
					http.StatusConflict,
					"MCP server revision changed during update",
					nil,
				)
			}
		} else if err := tx.Create(record).Error; err != nil {
			return capabilityInternal("create MCP server", err)
		}
		if err := tx.Create(mcpServerRevisionRecord(record)).Error; err != nil {
			return capabilityInternal("persist MCP server revision", err)
		}
		projected, modelErr := mcpServerModel(record)
		if modelErr != nil {
			return modelErr
		}
		manifests, manifestErr := s.registerMcpManifestsTx(tx, projected)
		if manifestErr != nil {
			return manifestErr
		}
		result = &model.UpsertMcpServerResponse{
			Server:    projected,
			Manifests: manifests,
		}
		resultPayload, marshalErr := proto.Marshal(result)
		if marshalErr != nil {
			return capabilityInternal("encode MCP upsert result", marshalErr)
		}
		command := &persistence.McpServerCommand{
			ID:             uuid.NewString(),
			Ptid:           ptid,
			CommandKind:    "upsert",
			IdempotencyKey: req.GetIdempotencyKey(),
			PayloadHash:    payloadHash,
			ServerID:       serverID,
			Revision:       revision,
			ResultPayload:  resultPayload,
			CreatedAt:      now,
		}
		if err := tx.Create(command).Error; err != nil {
			return capabilityInternal("persist MCP upsert command", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.registerServerTools(result.GetServer())
	for _, manifest := range oldManifests {
		s.authority.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRetired,
			manifest,
		)
	}
	for _, manifest := range result.GetManifests() {
		s.authority.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRegistered,
			manifest,
		)
	}
	return result, nil
}

func (s *McpServerService) Get(
	ctx context.Context,
	ptid string,
	req *model.GetMcpServerRequest,
) (*model.McpServer, error) {
	if strings.TrimSpace(ptid) == "" || req == nil {
		return nil, capabilityInvalid("ptid and MCP server selector are required")
	}
	query := s.db.WithContext(ctx).Where("ptid = ? AND deleted_at IS NULL", ptid)
	if serverID := strings.TrimSpace(req.GetServerId()); serverID != "" {
		query = query.Where("server_id = ?", serverID)
	} else if name := strings.TrimSpace(req.GetName()); name != "" {
		query = query.Where("name = ?", name)
	} else {
		return nil, capabilityInvalid("server_id or name is required")
	}
	var record persistence.McpServer
	if err := query.First(&record).Error; err != nil {
		return nil, mcpNotFound(err)
	}
	return mcpServerModel(&record)
}

func (s *McpServerService) List(
	ctx context.Context,
	ptid string,
	req *model.ListMcpServersRequest,
) ([]*model.McpServer, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, capabilityInvalid("ptid is required")
	}
	query := s.db.WithContext(ctx).
		Where("ptid = ? AND deleted_at IS NULL", ptid).
		Order("name, server_id")
	if req == nil || !req.GetIncludeDisabled() {
		query = query.Where("enabled = ?", true)
	}
	var records []persistence.McpServer
	if err := query.Find(&records).Error; err != nil {
		return nil, capabilityInternal("list MCP servers", err)
	}
	result := make([]*model.McpServer, 0, len(records))
	for i := range records {
		server, err := mcpServerModel(&records[i])
		if err != nil {
			return nil, err
		}
		result = append(result, server)
	}
	return result, nil
}

func (s *McpServerService) Refresh(
	ctx context.Context,
	ptid string,
	req *model.RefreshMcpServerRequest,
) (*model.RefreshMcpServerResponse, error) {
	if req == nil {
		return nil, capabilityInvalid("MCP refresh request is required")
	}
	server, err := s.Get(ctx, ptid, &model.GetMcpServerRequest{
		ServerId: req.GetServerId(),
	})
	if err != nil {
		return nil, err
	}
	if server.GetExecutionOwner() !=
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		return nil, capabilityInvalid("client-owned MCP tools must be discovered by that client")
	}
	upsert, err := s.Upsert(ctx, ptid, &model.UpsertMcpServerRequest{
		Server: &model.McpServer{
			ServerId:       server.GetServerId(),
			Name:           server.GetName(),
			Title:          server.GetTitle(),
			Description:    server.GetDescription(),
			Transport:      server.GetTransport(),
			ExecutionOwner: server.GetExecutionOwner(),
			Command:        server.GetCommand(),
			Args:           server.GetArgs(),
			EnvKeys:        server.GetEnvKeys(),
			Url:            server.GetUrl(),
			HeaderKeys:     server.GetHeaderKeys(),
			Enabled:        server.GetEnabled(),
		},
		ExpectedRevision: req.GetExpectedRevision(),
		IdempotencyKey:   req.GetIdempotencyKey(),
	})
	if err != nil {
		return nil, err
	}
	return &model.RefreshMcpServerResponse{
		Server:    upsert.GetServer(),
		Manifests: upsert.GetManifests(),
		Replayed:  upsert.GetReplayed(),
	}, nil
}

func (s *McpServerService) Delete(
	ctx context.Context,
	ptid string,
	req *model.DeleteMcpServerRequest,
) (*model.DeleteMcpServerResponse, error) {
	if strings.TrimSpace(ptid) == "" || req == nil ||
		strings.TrimSpace(req.GetServerId()) == "" {
		return nil, capabilityInvalid("ptid and server_id are required")
	}
	if err := validateMcpIdempotencyKey(req.GetIdempotencyKey()); err != nil {
		return nil, err
	}
	payloadHash, err := mcpMutationHash(req)
	if err != nil {
		return nil, err
	}
	replayed, err := replayMcpCommand(
		s.db.WithContext(ctx),
		ptid,
		"delete",
		req.GetIdempotencyKey(),
		payloadHash,
	)
	if err != nil {
		return nil, err
	}
	if replayed != nil {
		var response model.DeleteMcpServerResponse
		if err := proto.Unmarshal(replayed.ResultPayload, &response); err != nil {
			return nil, capabilityInternal("decode MCP delete replay", err)
		}
		response.Replayed = true
		return &response, nil
	}
	var result *model.DeleteMcpServerResponse
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayMcpCommand(
			tx,
			ptid,
			"delete",
			req.GetIdempotencyKey(),
			payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		record, loadErr := loadMcpServerRecord(tx, ptid, req.GetServerId())
		if loadErr != nil {
			return loadErr
		}
		server, modelErr := mcpServerModel(record)
		if modelErr != nil {
			return modelErr
		}
		if replayed != nil {
			var response model.DeleteMcpServerResponse
			if err := proto.Unmarshal(replayed.ResultPayload, &response); err != nil {
				return capabilityInternal("decode MCP delete replay", err)
			}
			response.Replayed = true
			result = &response
			return nil
		}
		if record.Revision != req.GetExpectedRevision() {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"MCP server revision conflict",
				nil,
			)
		}
		now := s.now()
		if err := retireMcpManifestsTx(
			tx,
			ptid,
			server.GetTools(),
			now,
			"mcp_server_deleted",
		); err != nil {
			return err
		}
		if err := tx.Model(record).Updates(map[string]interface{}{
			"deleted_at": now,
			"updated_at": now,
			"enabled":    false,
		}).Error; err != nil {
			return capabilityInternal("delete MCP server", err)
		}
		server.Enabled = false
		server.UpdatedAt = timestamppb.New(now)
		result = &model.DeleteMcpServerResponse{
			Server:           server,
			RetiredManifests: mcpManifestModels(server),
		}
		resultPayload, marshalErr := proto.Marshal(result)
		if marshalErr != nil {
			return capabilityInternal("encode MCP delete result", marshalErr)
		}
		if err := tx.Create(&persistence.McpServerCommand{
			ID:             uuid.NewString(),
			Ptid:           ptid,
			CommandKind:    "delete",
			IdempotencyKey: req.GetIdempotencyKey(),
			PayloadHash:    payloadHash,
			ServerID:       record.ServerID,
			Revision:       record.Revision,
			ResultPayload:  resultPayload,
			CreatedAt:      now,
		}).Error; err != nil {
			return capabilityInternal("persist MCP delete command", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, manifest := range result.GetRetiredManifests() {
		s.authority.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRetired,
			manifest,
		)
	}
	return result, nil
}

func (s *McpServerService) ExecuteTool(
	ctx context.Context,
	ptid string,
	serverID string,
	revision uint64,
	toolName string,
	arguments json.RawMessage,
) (*domain.ToolResult, error) {
	var record persistence.McpServerRevision
	err := s.db.WithContext(ctx).Where(
		"server_id = ? AND revision = ? AND ptid = ?",
		strings.TrimSpace(serverID),
		revision,
		strings.TrimSpace(ptid),
	).First(&record).Error
	if err != nil {
		return nil, mcpNotFound(err)
	}
	if !record.Enabled ||
		model.ToolExecutionOwner(record.ExecutionOwner) !=
			model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		return nil, capabilityInvalid("MCP server is not Station-executable")
	}
	server, err := mcpServerRevisionModel(&record)
	if err != nil {
		return nil, err
	}
	var secrets mcpSecretConfig
	if len(record.SecretConfigJSON) > 0 {
		if err := json.Unmarshal(record.SecretConfigJSON, &secrets); err != nil {
			return nil, capabilityInternal("decode MCP revision secrets", err)
		}
	}
	output, err := executeMcpRuntimeTool(
		ctx,
		mcpRuntimeConfigFrom(server, secrets),
		toolName,
		arguments,
	)
	if err != nil {
		return nil, fmt.Errorf("execute Station MCP tool: %w", err)
	}
	return &domain.ToolResult{Content: output}, nil
}

func (s *McpServerService) registerMcpManifestsTx(
	tx *gorm.DB,
	server *model.McpServer,
) ([]*model.CapabilityManifest, error) {
	if !server.GetEnabled() ||
		server.GetStatus() != model.McpServerStatus_MCP_SERVER_STATUS_READY {
		return nil, nil
	}
	manifests := mcpManifestModels(server)
	for _, manifest := range manifests {
		if _, _, err := s.authority.registerManifestTx(tx, manifest); err != nil {
			return nil, err
		}
	}
	return manifests, nil
}

func (s *McpServerService) registerServerTools(server *model.McpServer) {
	if server == nil || !server.GetEnabled() ||
		server.GetStatus() != model.McpServerStatus_MCP_SERVER_STATUS_READY {
		return
	}
	for _, descriptor := range server.GetTools() {
		tool := proto.Clone(descriptor).(*model.McpToolDescriptor)
		serverID := server.GetServerId()
		revision := server.GetRevision()
		owner := server.GetExecutionOwner()
		schema := json.RawMessage(tool.GetInputSchemaJson())
		if len(schema) == 0 || !json.Valid(schema) {
			schema = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		s.registry.Register(&domain.ToolDefinition{
			Name:        tool.GetProviderToolName(),
			Description: tool.GetDescription(),
			JSONSchema:  schema,
			Handler: func(
				ctx context.Context,
				meta *domain.ToolCallMeta,
				raw json.RawMessage,
			) (*domain.ToolResult, error) {
				if owner != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
					return &domain.ToolResult{
						Content: "client-owned MCP tools execute through the client capability bridge",
					}, nil
				}
				return s.ExecuteTool(
					ctx,
					meta.ActorID,
					serverID,
					revision,
					tool.GetToolName(),
					raw,
				)
			},
		})
	}
}

func mcpServerModel(record *persistence.McpServer) (*model.McpServer, error) {
	var config mcpPublicConfig
	if err := json.Unmarshal([]byte(record.PublicConfigJSON), &config); err != nil {
		return nil, capabilityInternal("decode MCP public configuration", err)
	}
	var tools []*model.McpToolDescriptor
	if strings.TrimSpace(record.ToolsJSON) != "" {
		if err := json.Unmarshal([]byte(record.ToolsJSON), &tools); err != nil {
			return nil, capabilityInternal("decode MCP tools", err)
		}
	}
	result := &model.McpServer{
		ServerId:       record.ServerID,
		Ptid:           record.Ptid,
		Name:           record.Name,
		Title:          config.Title,
		Description:    config.Description,
		Transport:      model.McpTransport(record.Transport),
		ExecutionOwner: model.ToolExecutionOwner(record.ExecutionOwner),
		Command:        config.Command,
		Args:           append([]string(nil), config.Args...),
		EnvKeys:        append([]string(nil), config.EnvKeys...),
		Url:            config.URL,
		HeaderKeys:     append([]string(nil), config.HeaderKeys...),
		Enabled:        record.Enabled,
		Revision:       record.Revision,
		Status:         model.McpServerStatus(record.Status),
		LastError:      record.LastError,
		Tools:          tools,
		CreatedAt:      timestamppb.New(record.CreatedAt),
		UpdatedAt:      timestamppb.New(record.UpdatedAt),
	}
	if record.LastTestedAt != nil {
		result.LastTestedAt = timestamppb.New(*record.LastTestedAt)
	}
	return result, nil
}

func mcpServerRevisionRecord(
	record *persistence.McpServer,
) *persistence.McpServerRevision {
	return &persistence.McpServerRevision{
		ServerID:         record.ServerID,
		Revision:         record.Revision,
		Ptid:             record.Ptid,
		Name:             record.Name,
		Transport:        record.Transport,
		ExecutionOwner:   record.ExecutionOwner,
		PublicConfigJSON: record.PublicConfigJSON,
		SecretConfigJSON: append([]byte(nil), record.SecretConfigJSON...),
		ToolsJSON:        record.ToolsJSON,
		Enabled:          record.Enabled,
		Status:           record.Status,
		LastError:        record.LastError,
		CreatedAt:        record.UpdatedAt,
	}
}

func mcpServerRevisionModel(
	record *persistence.McpServerRevision,
) (*model.McpServer, error) {
	head := &persistence.McpServer{
		ServerID:         record.ServerID,
		Ptid:             record.Ptid,
		Name:             record.Name,
		Revision:         record.Revision,
		Transport:        record.Transport,
		ExecutionOwner:   record.ExecutionOwner,
		PublicConfigJSON: record.PublicConfigJSON,
		SecretConfigJSON: append([]byte(nil), record.SecretConfigJSON...),
		ToolsJSON:        record.ToolsJSON,
		Enabled:          record.Enabled,
		Status:           record.Status,
		LastError:        record.LastError,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.CreatedAt,
	}
	return mcpServerModel(head)
}

func mcpRuntimeConfigFrom(
	server *model.McpServer,
	secrets mcpSecretConfig,
) mcpRuntimeConfig {
	return mcpRuntimeConfig{
		Transport: server.GetTransport(),
		Command:   server.GetCommand(),
		Args:      append([]string(nil), server.GetArgs()...),
		Env:       cloneStringMap(secrets.Env),
		URL:       server.GetUrl(),
		Headers:   cloneStringMap(secrets.Headers),
	}
}

func decodeMcpSecrets(record *persistence.McpServer) (mcpSecretConfig, error) {
	var secrets mcpSecretConfig
	if len(record.SecretConfigJSON) == 0 {
		return secrets, nil
	}
	if err := json.Unmarshal(record.SecretConfigJSON, &secrets); err != nil {
		return secrets, capabilityInternal("decode MCP secret configuration", err)
	}
	return secrets, nil
}

func mcpToolDescriptors(
	serverID string,
	revision uint64,
	tools []discoveredMcpTool,
) []*model.McpToolDescriptor {
	result := make([]*model.McpToolDescriptor, 0, len(tools))
	for _, tool := range tools {
		result = append(result, &model.McpToolDescriptor{
			ToolName:        tool.Name,
			Description:     tool.Description,
			InputSchemaJson: string(tool.InputSchema),
		})
	}
	return assignMcpToolIdentities(serverID, revision, result)
}

func assignMcpToolIdentities(
	serverID string,
	revision uint64,
	tools []*model.McpToolDescriptor,
) []*model.McpToolDescriptor {
	result := make([]*model.McpToolDescriptor, 0, len(tools))
	seen := make(map[string]struct{})
	for _, raw := range tools {
		if raw == nil || strings.TrimSpace(raw.GetToolName()) == "" {
			continue
		}
		tool := proto.Clone(raw).(*model.McpToolDescriptor)
		tool.ToolName = strings.TrimSpace(tool.GetToolName())
		tool.ProviderToolName = mcpProviderToolName(serverID, revision, tool.ToolName)
		tool.CapabilityId = mcpToolCapabilityID(serverID, tool.ToolName)
		tool.CapabilityVersion = strconv.FormatUint(revision, 10)
		if strings.TrimSpace(tool.GetDescription()) == "" {
			tool.Description = "Invoke MCP tool " + tool.ToolName
		}
		schema := strings.TrimSpace(tool.GetInputSchemaJson())
		if schema == "" || !json.Valid([]byte(schema)) ||
			!strings.HasPrefix(schema, "{") {
			tool.InputSchemaJson = `{"type":"object","properties":{}}`
		}
		if _, exists := seen[tool.ProviderToolName]; exists {
			continue
		}
		seen[tool.ProviderToolName] = struct{}{}
		result = append(result, tool)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetProviderToolName() < result[j].GetProviderToolName()
	})
	return result
}

func normalizeMcpToolDescriptors(
	tools []*model.McpToolDescriptor,
) []*model.McpToolDescriptor {
	result := make([]*model.McpToolDescriptor, 0, len(tools))
	for _, tool := range tools {
		if tool == nil {
			continue
		}
		result = append(result, &model.McpToolDescriptor{
			ToolName:        strings.TrimSpace(tool.GetToolName()),
			Description:     strings.TrimSpace(tool.GetDescription()),
			InputSchemaJson: strings.TrimSpace(tool.GetInputSchemaJson()),
		})
	}
	return result
}

func mcpManifestModels(server *model.McpServer) []*model.CapabilityManifest {
	manifests := make([]*model.CapabilityManifest, 0, len(server.GetTools()))
	for _, tool := range server.GetTools() {
		schemaHash := sha256.Sum256([]byte(tool.GetInputSchemaJson()))
		manifests = append(manifests, &model.CapabilityManifest{
			CapabilityId:     tool.GetCapabilityId(),
			Version:          tool.GetCapabilityVersion(),
			SourceKind:       model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_MCP,
			SourceInstanceId: tool.GetProviderToolName(),
			DisplayMetadata: &model.CapabilityDisplayMetadata{
				Name:        tool.GetToolName(),
				Description: tool.GetDescription(),
			},
			InputSchemaRef:        "inline-sha256:" + hex.EncodeToString(schemaHash[:]),
			OutputSchemaRef:       "schema://mcp/tool-result",
			ExecutionOwner:        server.GetExecutionOwner(),
			RiskClass:             "medium",
			DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
			SecretBoundary:        mcpSecretBoundary(server),
			Availability:          model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE,
			OwnerPtid:             server.GetPtid(),
		})
	}
	return manifests
}

func mcpSecretBoundary(server *model.McpServer) string {
	if server.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		return "station:mcp:" + server.GetServerId()
	}
	return "client:mcp:" + server.GetServerId()
}

func mcpProviderToolName(serverID string, revision uint64, toolName string) string {
	serverHash := sha256.Sum256([]byte(serverID))
	toolHash := sha256.Sum256([]byte(toolName))
	label := strings.Map(func(character rune) rune {
		if character >= 'A' && character <= 'Z' {
			return character + ('a' - 'A')
		}
		if (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') ||
			character == '_' {
			return character
		}
		return '_'
	}, toolName)
	label = strings.Trim(label, "_")
	if len(label) > 23 {
		label = label[:23]
	}
	if label == "" {
		label = "tool"
	}
	revisionLabel := strconv.FormatUint(revision, 36)
	return fmt.Sprintf(
		"mcp_%s_%s_v%s_%s",
		hex.EncodeToString(serverHash[:6]),
		hex.EncodeToString(toolHash[:4]),
		revisionLabel,
		label,
	)
}

func mcpToolCapabilityID(serverID string, toolName string) string {
	sum := sha256.Sum256([]byte(serverID + "\x00" + toolName))
	return "mcp.tool." + hex.EncodeToString(sum[:])
}

func retireMcpManifestsTx(
	tx *gorm.DB,
	ptid string,
	tools []*model.McpToolDescriptor,
	now time.Time,
	reason string,
) error {
	for _, tool := range tools {
		if tool == nil {
			continue
		}
		if err := tx.Model(&persistence.CapabilityManifest{}).
			Where(
				"capability_id = ? AND version = ? AND owner_ptid = ? AND retired_at IS NULL",
				tool.GetCapabilityId(),
				tool.GetCapabilityVersion(),
				ptid,
			).
			Updates(map[string]interface{}{
				"availability":      int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED),
				"retired_at":        now,
				"retired_by_ptid":   ptid,
				"retirement_reason": reason,
			}).Error; err != nil {
			return capabilityInternal("retire MCP tool manifest", err)
		}
	}
	return nil
}

func loadMcpServerRecord(
	db *gorm.DB,
	ptid string,
	serverID string,
) (*persistence.McpServer, error) {
	var record persistence.McpServer
	if err := db.Where(
		"server_id = ? AND ptid = ? AND deleted_at IS NULL",
		strings.TrimSpace(serverID),
		strings.TrimSpace(ptid),
	).First(&record).Error; err != nil {
		return nil, mcpNotFound(err)
	}
	return &record, nil
}

func replayMcpCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*persistence.McpServerCommand, error) {
	var command persistence.McpServerCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ptid,
		commandKind,
		idempotencyKey,
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("load MCP command", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"MCP idempotency key was reused with a different payload",
			nil,
		)
	}
	return &command, nil
}

func mcpMutationHash(message proto.Message) (string, error) {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return "", capabilityInternal("hash MCP mutation", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func validateMcpIdempotencyKey(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxMcpIdempotencyKeyBytes {
		return capabilityInvalid("MCP idempotency_key is required and must be at most 160 bytes")
	}
	return nil
}

func normalizedMcpStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, strings.TrimSpace(value))
	}
	return result
}

func sortedMcpKeys(values map[string]string, fallback []string) []string {
	keys := make([]string, 0, len(values)+len(fallback))
	seen := make(map[string]struct{})
	for key := range values {
		key = strings.TrimSpace(key)
		if key != "" {
			seen[key] = struct{}{}
		}
	}
	for _, key := range fallback {
		key = strings.TrimSpace(key)
		if key != "" {
			seen[key] = struct{}{}
		}
	}
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func mergeMcpSecrets(
	existing map[string]string,
	submitted map[string]string,
) map[string]string {
	result := cloneStringMap(existing)
	if result == nil {
		result = make(map[string]string)
	}
	for key, value := range submitted {
		key = strings.TrimSpace(key)
		if key != "" && value != "" {
			result[key] = value
		}
	}
	return result
}

func redactMcpRuntimeError(value string, secrets mcpSecretConfig) string {
	result := value
	for _, values := range []map[string]string{secrets.Env, secrets.Headers} {
		for _, secret := range values {
			if secret != "" {
				result = strings.ReplaceAll(result, secret, "[REDACTED]")
			}
		}
	}
	return result
}

func mcpNotFound(cause error) error {
	return errcode.New(
		errcode.AgentNotFound,
		http.StatusNotFound,
		"MCP server not found",
		cause,
	)
}
