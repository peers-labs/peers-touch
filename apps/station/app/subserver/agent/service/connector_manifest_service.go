package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const connectorManifestSupersededReason = "connector_projection_superseded"

type ConnectorManifestService struct {
	db        *gorm.DB
	authority *CapabilityAuthorityService
	now       func() time.Time
}

func NewConnectorManifestService(
	db *gorm.DB,
	authority *CapabilityAuthorityService,
) *ConnectorManifestService {
	return &ConnectorManifestService{
		db:        db,
		authority: authority,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *ConnectorManifestService) Sync(
	ctx context.Context,
	ptid string,
	req *model.SyncConnectorResourceManifestsRequest,
) (*model.SyncConnectorResourceManifestsResponse, error) {
	ptid = strings.TrimSpace(ptid)
	if err := validateConnectorSyncRequest(ptid, req); err != nil {
		return nil, err
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, capabilityInternal("hash Connector projection sync", err)
	}

	var response *model.SyncConnectorResourceManifestsResponse
	var registered []*model.CapabilityManifest
	var retired []*model.CapabilityManifest
	var rebasedBindings []*model.AgentCapabilityBinding
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, err := replayConnectorManifestCommand(
			tx,
			ptid,
			req.GetIdempotencyKey(),
			payloadHash,
		)
		if err != nil || replayed != nil {
			response = replayed
			return err
		}

		current, err := loadCurrentConnectorResources(
			tx,
			ptid,
			req.GetConnectorId(),
			false,
		)
		if err != nil {
			return err
		}
		if err := lockConnectorBindings(tx, ptid, current); err != nil {
			return err
		}
		if err := lockConnectorCapabilityManifests(tx, current); err != nil {
			return err
		}
		locked, err := loadCurrentConnectorResources(
			tx,
			ptid,
			req.GetConnectorId(),
			true,
		)
		if err != nil {
			return err
		}
		if !sameConnectorResourceRows(current, locked) {
			return capabilityConflict("Connector projection changed during sync")
		}

		currentRevision, err := connectorCurrentRevision(locked)
		if err != nil {
			return err
		}
		if currentRevision != req.GetExpectedConnectionRevision() {
			return capabilityConflict("Connector connection revision conflict")
		}
		if req.GetConnectionRevision() <= currentRevision {
			return capabilityConflict("Connector connection revision must advance")
		}

		nextResources, err := normalizeConnectorResources(req, locked)
		if err != nil {
			return err
		}
		now := s.now()
		for i := range locked {
			oldManifest, retireErr := retireConnectorCapabilityTx(
				tx,
				&locked[i],
				ptid,
				req.GetConnectionRevision(),
				now,
			)
			if retireErr != nil {
				return retireErr
			}
			if oldManifest != nil {
				retired = append(retired, oldManifest)
			}
		}
		if len(locked) > 0 {
			result := tx.Model(&persistence.ConnectorResourceManifest{}).
				Where(
					"ptid = ? AND connector_id = ? AND superseded_at IS NULL",
					ptid,
					strings.TrimSpace(req.GetConnectorId()),
				).
				Updates(map[string]interface{}{
					"superseded_at":          now,
					"superseded_by_revision": req.GetConnectionRevision(),
				})
			if result.Error != nil {
				return capabilityInternal("supersede Connector resource manifests", result.Error)
			}
			if result.RowsAffected != int64(len(locked)) {
				return capabilityConflict("Connector resources changed during sync")
			}
		}

		response = &model.SyncConnectorResourceManifestsResponse{}
		for _, resource := range nextResources {
			connectorManifest, capabilityManifest, record, err :=
				buildConnectorProjection(ptid, req, resource, now)
			if err != nil {
				return err
			}
			createdCapability, mutated, err := s.authority.registerManifestTx(
				tx,
				capabilityManifest,
			)
			if err != nil {
				return err
			}
			if mutated {
				registered = append(registered, createdCapability)
			}
			if err := tx.Create(record).Error; err != nil {
				return capabilityInternal("persist Connector resource manifest", err)
			}
			rebased, err := rebaseConnectorBindingsTx(
				tx,
				ptid,
				capabilityIDAndVersion{
					id:      createdCapability.GetCapabilityId(),
					version: createdCapability.GetVersion(),
				},
				now,
			)
			if err != nil {
				return err
			}
			rebasedBindings = append(rebasedBindings, rebased...)
			response.Manifests = append(response.Manifests, connectorManifest)
			response.CapabilityManifests = append(
				response.CapabilityManifests,
				createdCapability,
			)
		}
		sortConnectorSyncResponse(response)
		if err := recordConnectorManifestCommand(
			tx,
			ptid,
			req,
			payloadHash,
			response,
			now,
		); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, manifest := range retired {
		s.authority.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRetired,
			manifest,
		)
	}
	for _, manifest := range registered {
		s.authority.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRegistered,
			manifest,
		)
	}
	for _, binding := range rebasedBindings {
		s.authority.publishBindingInvalidation(
			ctx,
			domain.AgentAuthorityInvalidationBindingUpsert,
			binding,
		)
	}
	return response, nil
}

type capabilityIDAndVersion struct {
	id      string
	version string
}

func rebaseConnectorBindingsTx(
	tx *gorm.DB,
	ptid string,
	capability capabilityIDAndVersion,
	now time.Time,
) ([]*model.AgentCapabilityBinding, error) {
	var bindings []persistence.AgentCapabilityBinding
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"ptid = ? AND capability_id = ? AND tombstoned_at IS NULL AND capability_version <> ?",
		ptid,
		capability.id,
		capability.version,
	).Order("binding_id").Find(&bindings).Error; err != nil {
		return nil, capabilityInternal("load Connector bindings for rebase", err)
	}
	result := make([]*model.AgentCapabilityBinding, 0, len(bindings))
	for i := range bindings {
		nextRevision := bindings[i].Revision + 1
		update := tx.Model(&persistence.AgentCapabilityBinding{}).
			Where(
				"binding_id = ? AND revision = ? AND tombstoned_at IS NULL",
				bindings[i].BindingID,
				bindings[i].Revision,
			).
			Updates(map[string]interface{}{
				"capability_version": capability.version,
				"revision":           nextRevision,
				"updated_at":         now,
			})
		if update.Error != nil {
			return nil, capabilityInternal("rebase Connector binding", update.Error)
		}
		if update.RowsAffected != 1 {
			return nil, capabilityConflict("Connector binding changed during rebase")
		}
		bindings[i].CapabilityVersion = capability.version
		bindings[i].Revision = nextRevision
		bindings[i].UpdatedAt = now
		result = append(result, capabilityBindingModel(&bindings[i]))
	}
	return result, nil
}

func (s *ConnectorManifestService) List(
	ctx context.Context,
	ptid string,
	connectorID string,
) ([]*model.ConnectorResourceManifest, error) {
	ptid = strings.TrimSpace(ptid)
	connectorID = strings.TrimSpace(connectorID)
	if ptid == "" {
		return nil, capabilityInvalid("ptid is required")
	}
	query := s.db.WithContext(ctx).
		Where("ptid = ? AND superseded_at IS NULL", ptid)
	if connectorID != "" {
		query = query.Where("connector_id = ?", connectorID)
	}
	var records []persistence.ConnectorResourceManifest
	if err := query.Order("connector_id, resource_id").Find(&records).Error; err != nil {
		return nil, capabilityInternal("list Connector resource manifests", err)
	}
	result := make([]*model.ConnectorResourceManifest, 0, len(records))
	for i := range records {
		result = append(result, connectorResourceManifestModel(&records[i]))
	}
	return result, nil
}

func connectorReadinessForCapability(
	tx *gorm.DB,
	ptid string,
	capabilityID string,
	capabilityVersion string,
	now time.Time,
) (model.CapabilityReadinessState, string, string, error) {
	var record persistence.ConnectorResourceManifest
	err := tx.Where(
		"ptid = ? AND capability_id = ? AND capability_version = ?",
		ptid,
		capabilityID,
		capabilityVersion,
	).Order("created_at DESC").First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			"connector_manifest_missing", "", nil
	}
	if err != nil {
		return 0, "", "", capabilityInternal("load Connector readiness", err)
	}
	revision := fmt.Sprintf(
		"connector:%s:%d",
		record.OAuthConnectionID,
		record.ConnectionRevision,
	)
	if record.SupersededAt != nil {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_manifest_stale", revision, nil
	}
	if record.ExpiresAt != nil && !record.ExpiresAt.After(now) {
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			"connector_oauth_expired", revision, nil
	}
	state, reason := connectorStatusReadiness(model.ConnectorResourceStatus(record.Status))
	return state, reason, revision, nil
}

func connectorStatusReadiness(
	status model.ConnectorResourceStatus,
) (model.CapabilityReadinessState, string) {
	switch status {
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
			"connector_ready"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_EXPIRED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			"connector_oauth_expired"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_SCOPE_DENIED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_scope_denied"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REMOVED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_resource_removed"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_MANIFEST_STALE:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_manifest_stale"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_DISCONNECTED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			"connector_disconnected"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOKED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_provider_revoked"
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			"connector_revocation_unconfirmed"
	default:
		return model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			"connector_status_unknown"
	}
}

func pinConnectorInvocationTx(
	tx *gorm.DB,
	ptid string,
	toolName string,
	capabilityID string,
	capabilityVersion string,
	arguments []byte,
	now time.Time,
) ([]byte, *persistence.ConnectorResourceManifest, error) {
	var resource persistence.ConnectorResourceManifest
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"ptid = ? AND capability_id = ? AND capability_version = ? AND tool_name = ? AND superseded_at IS NULL",
		ptid,
		capabilityID,
		capabilityVersion,
		toolName,
	).First(&resource).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, invalidToolState("Connector manifest is stale")
	}
	if err != nil {
		return nil, nil, internalToolError("load Connector invocation authority", err)
	}
	if status := model.ConnectorResourceStatus(resource.Status); status != model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY ||
		(resource.ExpiresAt != nil && !resource.ExpiresAt.After(now)) {
		return nil, &resource, invalidToolState("Connector resource is unavailable")
	}

	var supplied map[string]json.RawMessage
	if len(arguments) == 0 {
		supplied = map[string]json.RawMessage{}
	} else if err := json.Unmarshal(arguments, &supplied); err != nil {
		return nil, nil, invalidToolRequest("Connector arguments must be a JSON object")
	}
	for key := range supplied {
		if key != "params" {
			return nil, nil, invalidToolRequest(
				"Connector arguments may contain only resource params",
			)
		}
	}
	params := json.RawMessage(`{}`)
	if raw := supplied["params"]; len(raw) > 0 {
		var value interface{}
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, nil, invalidToolRequest("Connector params are invalid")
		}
		if _, ok := value.(map[string]interface{}); !ok {
			return nil, nil, invalidToolRequest("Connector params must be an object")
		}
		if connectorArgumentsContainSecret(value) {
			return nil, nil, invalidToolRequest(
				"Connector params must not contain credential material",
			)
		}
		params = raw
	}
	pinned, err := json.Marshal(struct {
		ConnectorID        string          `json:"connector_id"`
		OAuthConnectionID  string          `json:"oauth_connection_id"`
		ConnectionRevision uint64          `json:"connection_revision"`
		ResourceID         string          `json:"resource_id"`
		ResourceVersion    string          `json:"resource_version"`
		CapabilityID       string          `json:"capability_id"`
		CapabilityVersion  string          `json:"capability_version"`
		Params             json.RawMessage `json:"params"`
	}{
		ConnectorID:        resource.ConnectorID,
		OAuthConnectionID:  resource.OAuthConnectionID,
		ConnectionRevision: resource.ConnectionRevision,
		ResourceID:         resource.ResourceID,
		ResourceVersion:    resource.ResourceVersion,
		CapabilityID:       resource.CapabilityID,
		CapabilityVersion:  resource.CapabilityVersion,
		Params:             params,
	})
	if err != nil {
		return nil, nil, internalToolError("encode pinned Connector invocation", err)
	}
	return pinned, &resource, nil
}

func connectorApprovalAvailabilityTx(
	tx *gorm.DB,
	call *persistence.ToolCall,
	now time.Time,
) (*model.ErrorPayload, error) {
	if call == nil {
		return nil, invalidToolState("ToolCall is required")
	}
	if !strings.HasPrefix(call.CapabilityID, "connector.resource.") {
		return nil, nil
	}
	var resource persistence.ConnectorResourceManifest
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"ptid = ? AND capability_id = ? AND capability_version = ?",
		call.ActorID,
		call.ManifestID,
		call.ManifestVersion,
	).Order("created_at DESC").First(&resource).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, internalToolError("load Connector approval authority", err)
	}
	status := model.ConnectorResourceStatus(resource.Status)
	if resource.SupersededAt != nil {
		var current persistence.ConnectorResourceManifest
		currentErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"ptid = ? AND connector_id = ? AND resource_id = ? AND superseded_at IS NULL",
			resource.Ptid,
			resource.ConnectorID,
			resource.ResourceID,
		).First(&current).Error
		if currentErr == nil {
			resource = current
			currentStatus := model.ConnectorResourceStatus(resource.Status)
			if currentStatus ==
				model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY {
				status = model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_MANIFEST_STALE
			} else {
				status = currentStatus
			}
		} else if errors.Is(currentErr, gorm.ErrRecordNotFound) {
			status = model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_MANIFEST_STALE
		} else {
			return nil, internalToolError(
				"load current Connector approval authority",
				currentErr,
			)
		}
	} else if resource.ExpiresAt != nil && !resource.ExpiresAt.After(now) {
		status = model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_EXPIRED
	}
	if status == model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY {
		return nil, nil
	}
	return errcode.NewConnectorUnavailablePayload(
		status,
		resource.ConnectorID,
		resource.ResourceID,
		resource.ConnectionRevision,
	), nil
}

func connectorArgumentsContainSecret(value interface{}) bool {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, item := range typed {
			normalized := strings.NewReplacer("-", "", "_", "", " ", "").
				Replace(strings.ToLower(strings.TrimSpace(key)))
			switch normalized {
			case "accesstoken", "refreshtoken", "clientsecret",
				"authorization", "bearer", "apikey", "password":
				return true
			}
			if connectorArgumentsContainSecret(item) {
				return true
			}
		}
	case []interface{}:
		for _, item := range typed {
			if connectorArgumentsContainSecret(item) {
				return true
			}
		}
	}
	return false
}

func validateConnectorSyncRequest(
	ptid string,
	req *model.SyncConnectorResourceManifestsRequest,
) error {
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetConnectorId()) == "" ||
		strings.TrimSpace(req.GetOauthConnectionId()) == "" ||
		req.GetConnectionRevision() == 0 ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxCapabilityIdempotencyKeyBytes {
		return capabilityInvalid(
			"ptid, connector_id, oauth_connection_id, connection_revision and idempotency_key are required",
		)
	}
	if !connectorConnectionStatusAllowed(req.GetConnectionStatus()) {
		return capabilityInvalid("Connector connection status is invalid")
	}
	resourceIDs := make(map[string]struct{}, len(req.GetResources()))
	for _, resource := range req.GetResources() {
		resourceID := strings.TrimSpace(resource.GetResourceId())
		if resourceID == "" ||
			strings.TrimSpace(resource.GetResourceVersion()) == "" ||
			resource.GetStatus() == model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_UNSPECIFIED {
			return capabilityInvalid(
				"Connector resource_id, resource_version and status are required",
			)
		}
		if _, duplicate := resourceIDs[resourceID]; duplicate {
			return capabilityInvalid("Connector resource IDs must be unique")
		}
		resourceIDs[resourceID] = struct{}{}
	}
	return nil
}

func connectorConnectionStatusAllowed(status model.ConnectorResourceStatus) bool {
	switch status {
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY,
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_EXPIRED,
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_DISCONNECTED,
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOKED,
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED:
		return true
	default:
		return false
	}
}

func loadCurrentConnectorResources(
	tx *gorm.DB,
	ptid string,
	connectorID string,
	lock bool,
) ([]persistence.ConnectorResourceManifest, error) {
	query := tx.Where(
		"ptid = ? AND connector_id = ? AND superseded_at IS NULL",
		ptid,
		strings.TrimSpace(connectorID),
	).Order("resource_id")
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var records []persistence.ConnectorResourceManifest
	if err := query.Find(&records).Error; err != nil {
		return nil, capabilityInternal("load current Connector resources", err)
	}
	return records, nil
}

func lockConnectorBindings(
	tx *gorm.DB,
	ptid string,
	resources []persistence.ConnectorResourceManifest,
) error {
	capabilityIDs := make([]string, 0, len(resources))
	seen := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		if _, exists := seen[resource.CapabilityID]; exists {
			continue
		}
		seen[resource.CapabilityID] = struct{}{}
		capabilityIDs = append(capabilityIDs, resource.CapabilityID)
	}
	if len(capabilityIDs) == 0 {
		return nil
	}
	sort.Strings(capabilityIDs)
	var bindings []persistence.AgentCapabilityBinding
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"ptid = ? AND capability_id IN ? AND tombstoned_at IS NULL",
		ptid,
		capabilityIDs,
	).Order("binding_id").Find(&bindings).Error; err != nil {
		return capabilityInternal("lock Connector bindings", err)
	}
	return nil
}

func lockConnectorCapabilityManifests(
	tx *gorm.DB,
	resources []persistence.ConnectorResourceManifest,
) error {
	keys := make([]string, 0, len(resources))
	byKey := make(map[string]persistence.ConnectorResourceManifest, len(resources))
	for _, resource := range resources {
		key := resource.CapabilityID + "\x00" + resource.CapabilityVersion
		keys = append(keys, key)
		byKey[key] = resource
	}
	sort.Strings(keys)
	for _, key := range keys {
		resource := byKey[key]
		var manifest persistence.CapabilityManifest
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"capability_id = ? AND version = ?",
			resource.CapabilityID,
			resource.CapabilityVersion,
		).First(&manifest).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return capabilityConflict("Connector capability manifest is missing")
		}
		if err != nil {
			return capabilityInternal("lock Connector capability manifest", err)
		}
	}
	return nil
}

func connectorCurrentRevision(
	resources []persistence.ConnectorResourceManifest,
) (uint64, error) {
	var revision uint64
	for _, resource := range resources {
		if revision == 0 {
			revision = resource.ConnectionRevision
			continue
		}
		if revision != resource.ConnectionRevision {
			return 0, capabilityConflict(
				"current Connector projection contains mixed connection revisions",
			)
		}
	}
	return revision, nil
}

func sameConnectorResourceRows(
	left []persistence.ConnectorResourceManifest,
	right []persistence.ConnectorResourceManifest,
) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i].ID != right[i].ID ||
			left[i].ConnectionRevision != right[i].ConnectionRevision ||
			left[i].SupersededAt != right[i].SupersededAt {
			return false
		}
	}
	return true
}

func normalizeConnectorResources(
	req *model.SyncConnectorResourceManifestsRequest,
	current []persistence.ConnectorResourceManifest,
) ([]*model.ConnectorResourceProjection, error) {
	granted := normalizedConnectorStringSet(req.GetGrantedScopes())
	next := make(map[string]*model.ConnectorResourceProjection, len(req.GetResources()))
	for _, input := range req.GetResources() {
		resource := proto.Clone(input).(*model.ConnectorResourceProjection)
		resource.ResourceId = strings.TrimSpace(resource.GetResourceId())
		resource.ResourceVersion = strings.TrimSpace(resource.GetResourceVersion())
		resource.RequiredScopes = normalizedConnectorStrings(resource.GetRequiredScopes())
		status := resource.GetStatus()
		if req.GetConnectionStatus() !=
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY {
			status = req.GetConnectionStatus()
		} else if status ==
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY {
			for _, required := range resource.GetRequiredScopes() {
				if _, ok := granted[required]; !ok {
					status = model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_SCOPE_DENIED
					break
				}
			}
		}
		resource.Status = status
		next[resource.GetResourceId()] = resource
	}
	for _, previous := range current {
		if _, exists := next[previous.ResourceID]; exists {
			continue
		}
		var scopes []string
		if err := json.Unmarshal([]byte(previous.ScopesJSON), &scopes); err != nil {
			return nil, capabilityInternal("decode previous Connector scopes", err)
		}
		next[previous.ResourceID] = &model.ConnectorResourceProjection{
			ResourceId:      previous.ResourceID,
			ResourceVersion: previous.ResourceVersion,
			RequiredScopes:  normalizedConnectorStrings(scopes),
			Status:          model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REMOVED,
		}
	}
	result := make([]*model.ConnectorResourceProjection, 0, len(next))
	for _, resource := range next {
		result = append(result, resource)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetResourceId() < result[j].GetResourceId()
	})
	return result, nil
}

func buildConnectorProjection(
	ptid string,
	req *model.SyncConnectorResourceManifestsRequest,
	resource *model.ConnectorResourceProjection,
	now time.Time,
) (
	*model.ConnectorResourceManifest,
	*model.CapabilityManifest,
	*persistence.ConnectorResourceManifest,
	error,
) {
	scopeJSON, err := json.Marshal(resource.GetRequiredScopes())
	if err != nil {
		return nil, nil, nil, capabilityInternal("encode Connector scopes", err)
	}
	identityHash := capabilityHash(
		ptid,
		req.GetOauthConnectionId(),
		resource.GetResourceId(),
	)
	toolName := "connector_resource_" + identityHash[:24]
	capabilityID := "connector.resource." + identityHash
	expiresAt := ""
	if req.GetExpiresAt() != nil {
		expiresAt = req.GetExpiresAt().AsTime().UTC().Format(time.RFC3339Nano)
	}
	capabilityVersion := shortCapabilityHash(
		strconv.FormatUint(req.GetConnectionRevision(), 10),
		resource.GetResourceVersion(),
		strings.Join(resource.GetRequiredScopes(), ","),
		resource.GetStatus().String(),
		expiresAt,
	)
	availability := model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE
	if resource.GetStatus() ==
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY {
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
	}
	capability := &model.CapabilityManifest{
		CapabilityId:          capabilityID,
		Version:               capabilityVersion,
		SourceKind:            model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_CONNECTOR,
		SourceInstanceId:      toolName,
		DisplayMetadata:       &model.CapabilityDisplayMetadata{Name: toolName},
		InputSchemaRef:        "schema://agent/connector-resource/invoke",
		OutputSchemaRef:       "schema://agent/connector-resource/result",
		ExecutionOwner:        model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
		RiskClass:             "connector",
		DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		SecretBoundary:        "oauth-owner",
		Availability:          availability,
		OwnerPtid:             ptid,
	}
	connector := &model.ConnectorResourceManifest{
		Ptid:               ptid,
		ConnectorId:        strings.TrimSpace(req.GetConnectorId()),
		OauthConnectionId:  strings.TrimSpace(req.GetOauthConnectionId()),
		ConnectionRevision: req.GetConnectionRevision(),
		ResourceId:         resource.GetResourceId(),
		ResourceVersion:    resource.GetResourceVersion(),
		Scopes:             append([]string(nil), resource.GetRequiredScopes()...),
		ToolManifests: []*model.ConnectorToolManifestRef{{
			CapabilityId:      capabilityID,
			CapabilityVersion: capabilityVersion,
		}},
		Status:    resource.GetStatus(),
		ExpiresAt: req.GetExpiresAt(),
		CreatedAt: timestamppb.New(now),
	}
	record := &persistence.ConnectorResourceManifest{
		ID:                 generateID("connector-resource"),
		Ptid:               ptid,
		ConnectorID:        connector.GetConnectorId(),
		OAuthConnectionID:  connector.GetOauthConnectionId(),
		ConnectionRevision: connector.GetConnectionRevision(),
		ResourceID:         connector.GetResourceId(),
		ResourceVersion:    connector.GetResourceVersion(),
		ScopesJSON:         string(scopeJSON),
		Status:             int32(connector.GetStatus()),
		CapabilityID:       capabilityID,
		CapabilityVersion:  capabilityVersion,
		ToolName:           toolName,
		CreatedAt:          now,
	}
	if req.GetExpiresAt() != nil {
		value := req.GetExpiresAt().AsTime().UTC()
		record.ExpiresAt = &value
	}
	return connector, capability, record, nil
}

func retireConnectorCapabilityTx(
	tx *gorm.DB,
	resource *persistence.ConnectorResourceManifest,
	ptid string,
	nextRevision uint64,
	now time.Time,
) (*model.CapabilityManifest, error) {
	var manifest persistence.CapabilityManifest
	err := tx.Where(
		"capability_id = ? AND version = ?",
		resource.CapabilityID,
		resource.CapabilityVersion,
	).First(&manifest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, capabilityConflict("Connector capability manifest is missing")
	}
	if err != nil {
		return nil, capabilityInternal("load Connector capability for retirement", err)
	}
	if manifest.RetiredAt != nil {
		return capabilityManifestModel(&manifest), nil
	}
	reason := fmt.Sprintf("%s:%d", connectorManifestSupersededReason, nextRevision)
	result := tx.Model(&persistence.CapabilityManifest{}).
		Where(
			"capability_id = ? AND version = ? AND retired_at IS NULL",
			manifest.CapabilityID,
			manifest.Version,
		).
		Updates(map[string]interface{}{
			"availability":      int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED),
			"retired_at":        now,
			"retired_by_ptid":   ptid,
			"retirement_reason": reason,
		})
	if result.Error != nil {
		return nil, capabilityInternal("retire Connector capability manifest", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, capabilityConflict("Connector capability changed during retirement")
	}
	manifest.Availability = int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED)
	manifest.RetiredAt = &now
	manifest.RetiredByPtid = ptid
	manifest.RetirementReason = reason
	return capabilityManifestModel(&manifest), nil
}

func connectorResourceManifestModel(
	record *persistence.ConnectorResourceManifest,
) *model.ConnectorResourceManifest {
	var scopes []string
	_ = json.Unmarshal([]byte(record.ScopesJSON), &scopes)
	result := &model.ConnectorResourceManifest{
		Ptid:               record.Ptid,
		ConnectorId:        record.ConnectorID,
		OauthConnectionId:  record.OAuthConnectionID,
		ConnectionRevision: record.ConnectionRevision,
		ResourceId:         record.ResourceID,
		ResourceVersion:    record.ResourceVersion,
		Scopes:             scopes,
		ToolManifests: []*model.ConnectorToolManifestRef{{
			CapabilityId:      record.CapabilityID,
			CapabilityVersion: record.CapabilityVersion,
		}},
		Status:    model.ConnectorResourceStatus(record.Status),
		CreatedAt: timestamppb.New(record.CreatedAt),
	}
	if record.ExpiresAt != nil {
		result.ExpiresAt = timestamppb.New(*record.ExpiresAt)
	}
	return result
}

func replayConnectorManifestCommand(
	tx *gorm.DB,
	ptid string,
	idempotencyKey string,
	payloadHash string,
) (*model.SyncConnectorResourceManifestsResponse, error) {
	var command persistence.ConnectorManifestCommand
	err := tx.Where(
		"ptid = ? AND idempotency_key = ?",
		ptid,
		strings.TrimSpace(idempotencyKey),
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("load Connector sync replay", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, capabilityConflict("Connector idempotency key payload mismatch")
	}
	response := &model.SyncConnectorResourceManifestsResponse{}
	if err := proto.Unmarshal(command.ResultPayload, response); err != nil {
		return nil, capabilityInternal("decode Connector sync replay", err)
	}
	return response, nil
}

func recordConnectorManifestCommand(
	tx *gorm.DB,
	ptid string,
	req *model.SyncConnectorResourceManifestsRequest,
	payloadHash string,
	response *model.SyncConnectorResourceManifestsResponse,
	now time.Time,
) error {
	resultPayload, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return capabilityInternal("encode Connector sync result", err)
	}
	command := &persistence.ConnectorManifestCommand{
		ID:                 generateID("connector-command"),
		Ptid:               ptid,
		IdempotencyKey:     strings.TrimSpace(req.GetIdempotencyKey()),
		PayloadHash:        payloadHash,
		ConnectorID:        strings.TrimSpace(req.GetConnectorId()),
		ConnectionRevision: req.GetConnectionRevision(),
		ResultPayload:      resultPayload,
		CreatedAt:          now,
	}
	if err := tx.Create(command).Error; err != nil {
		return capabilityInternal("record Connector sync command", err)
	}
	return nil
}

func sortConnectorSyncResponse(response *model.SyncConnectorResourceManifestsResponse) {
	sort.Slice(response.Manifests, func(i, j int) bool {
		return response.Manifests[i].GetResourceId() <
			response.Manifests[j].GetResourceId()
	})
	sort.Slice(response.CapabilityManifests, func(i, j int) bool {
		return response.CapabilityManifests[i].GetCapabilityId() <
			response.CapabilityManifests[j].GetCapabilityId()
	})
}

func normalizedConnectorStrings(values []string) []string {
	set := normalizedConnectorStringSet(values)
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func normalizedConnectorStringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			result[normalized] = struct{}{}
		}
	}
	return result
}
