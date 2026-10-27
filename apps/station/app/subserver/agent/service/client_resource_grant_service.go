package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// Resource grants may outlive the five-minute lease because they are
	// re-declared on every register/renew; the skew bounds stale grants when
	// a worker stops renewing.
	maxResourceGrantLeaseSkew = 24 * time.Hour
	// One grant per resource-constrained capability; this mirrors the
	// capability set the Desktop worker advertises today.
	maxResourceGrantsPerDeclare = 32
	workspaceResourceKind       = "workspace"
)

// DeclareCapabilityResourceGrants persists the opaque workspace resource
// grants a device resolved for one of its active capability sessions. The
// local absolute path behind an opaque reference never reaches Station.
func (s *ToolDispatchService) DeclareCapabilityResourceGrants(
	ctx context.Context,
	actorID string,
	deviceID string,
	request *model.DeclareClientResourceGrantsRequest,
) (*model.DeclareClientResourceGrantsResponse, error) {
	if request == nil ||
		strings.TrimSpace(actorID) == "" ||
		strings.TrimSpace(deviceID) == "" {
		return nil, invalidToolRequest("actor and device are required")
	}
	sessionID := strings.TrimSpace(request.GetCapabilitySessionId())
	if sessionID == "" {
		return nil, invalidToolRequest("capability_session_id is required")
	}
	if supplied := strings.TrimSpace(request.GetDeviceId()); supplied != "" && supplied != deviceID {
		return nil, unauthorizedToolRequest("request device does not match authenticated device")
	}
	if len(request.GetGrants()) == 0 {
		return nil, invalidToolRequest("at least one resource grant is required")
	}
	if len(request.GetGrants()) > maxResourceGrantsPerDeclare {
		return nil, invalidToolRequest("too many resource grants")
	}
	if s.capabilityProof == nil {
		return nil, internalToolError("verify resource grant declaration", fmt.Errorf("proof service is not configured"))
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.DeclareClientResourceGrantsResponse{ErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}

	now := s.now()
	response := &model.DeclareClientResourceGrantsResponse{AcceptedCount: uint32(len(request.GetGrants()))}
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return nil, internalToolError("encode resource grant declaration response", err)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		command, replayed, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS,
			verified,
			now,
		)
		if err != nil {
			return err
		}
		if replayed {
			if len(command.ResponseRef) > 0 {
				return proto.Unmarshal(command.ResponseRef, response)
			}
			return nil
		}

		var leaseRow persistence.ClientCapabilityLease
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"session_id = ? AND actor_id = ? AND device_id = ? AND revoked_at IS NULL AND expires_at > ? AND "+
					persistence.ActiveLeaseParentAuthSessionCondition,
				sessionID,
				actorID,
				deviceID,
				now,
				now,
			).
			First(&leaseRow).Error; err != nil {
			return notFoundToolError("active capability lease", err)
		}
		var lease model.ClientCapabilityLease
		if err := proto.Unmarshal(leaseRow.LeasePayload, &lease); err != nil {
			return internalToolError("decode capability lease", err)
		}

		seenCapabilities := make(map[string]struct{}, len(request.GetGrants()))
		for _, grant := range request.GetGrants() {
			if err := validateResourceGrant(grant, &lease, sessionID, actorID, deviceID, now); err != nil {
				return err
			}
			if _, exists := seenCapabilities[grant.GetCapabilityId()]; exists {
				return invalidToolRequest("duplicate resource grant for capability")
			}
			seenCapabilities[grant.GetCapabilityId()] = struct{}{}

			expiresAt := grant.GetExpiresAt().AsTime()
			row := persistence.ClientCapabilityResourceGrant{
				SessionID:         sessionID,
				CapabilityID:      grant.GetCapabilityId(),
				ActorID:           actorID,
				DeviceID:          deviceID,
				ResourceRef:       grant.GetResourceRef(),
				PermissionGrantID: grant.GetPermissionGrantId(),
				IntegrityHash:     grant.GetIntegrityHash(),
				ExpiresAt:         expiresAt,
				CreatedAt:         now,
				UpdatedAt:         now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "session_id"},
					{Name: "capability_id"},
				},
				DoUpdates: clause.AssignmentColumns([]string{
					"actor_id",
					"device_id",
					"resource_ref",
					"permission_grant_id",
					"integrity_hash",
					"expires_at",
					"updated_at",
				}),
			}).Create(&row).Error; err != nil {
				return internalToolError("persist capability resource grant", err)
			}
		}
		return storeCapabilityCommandOutcomeTx(tx, command.CommandID, 0, leaseRow.LeaseID, leaseRow.LeaseRevision, responseBytes)
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func validateResourceGrant(
	grant *model.ClientResourceRef,
	lease *model.ClientCapabilityLease,
	sessionID string,
	actorPTID string,
	deviceID string,
	now time.Time,
) error {
	if grant == nil ||
		strings.TrimSpace(grant.GetResourceRef()) == "" ||
		strings.TrimSpace(grant.GetPermissionGrantId()) == "" ||
		strings.TrimSpace(grant.GetIntegrityHash()) == "" {
		return invalidToolRequest("resource grant identity is incomplete")
	}
	if grant.GetPtid() != lease.GetPtid() ||
		grant.GetPtid() != actorPTID ||
		grant.GetDeviceId() != deviceID ||
		grant.GetCapabilitySessionId() != sessionID {
		return unauthorizedToolRequest("resource grant is not bound to the active lease")
	}
	expiresAt := grant.GetExpiresAt()
	if expiresAt == nil {
		return invalidToolRequest("resource grant expiry is required")
	}
	if err := expiresAt.CheckValid(); err != nil {
		return invalidToolRequest("resource grant expiry is invalid")
	}
	expiry := expiresAt.AsTime()
	if !expiry.After(now) {
		return invalidToolRequest("resource grant already expired")
	}
	leaseExpiry := lease.GetExpiresAt().AsTime()
	if expiry.After(leaseExpiry.Add(maxResourceGrantLeaseSkew)) {
		return invalidToolRequest("resource grant expiry exceeds the allowed lease skew")
	}
	if !leasedCapabilityDeclaresWorkspaceGrant(
		lease,
		grant.GetCapabilityId(),
	) {
		return unauthorizedToolRequest("capability does not accept a workspace resource grant")
	}
	return nil
}

func leasedCapabilityDeclaresWorkspaceGrant(lease *model.ClientCapabilityLease, capabilityID string) bool {
	for _, capability := range lease.GetCapabilities() {
		if capability.GetCapabilityId() != capabilityID ||
			capability.GetPermission() !=
				model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED {
			continue
		}
		for _, kind := range capability.GetConstraints().GetAllowedResourceKinds() {
			if kind == workspaceResourceKind {
				return true
			}
		}
	}
	return false
}

// activeResourceGrantTx loads the single non-expired resource grant the
// device declared for one capability session and rebuilds the wire reference
// scoped to the active lease.
func activeResourceGrantTx(
	tx *gorm.DB,
	lease *model.ClientCapabilityLease,
	capabilityID string,
	now time.Time,
) (*model.ClientResourceRef, error) {
	var row persistence.ClientCapabilityResourceGrant
	if err := tx.
		Where(
			"session_id = ? AND capability_id = ? AND expires_at > ?",
			lease.GetCapabilitySessionId(),
			capabilityID,
			now,
		).
		Take(&row).Error; err != nil {
		return nil, notFoundToolError("active capability resource grant", err)
	}
	return &model.ClientResourceRef{
		ResourceRef:         row.ResourceRef,
		Ptid:                lease.GetPtid(),
		DeviceId:            lease.GetDeviceId(),
		CapabilitySessionId: lease.GetCapabilitySessionId(),
		CapabilityId:        capabilityID,
		ExpiresAt:           timestamppb.New(row.ExpiresAt),
		PermissionGrantId:   row.PermissionGrantID,
		IntegrityHash:       row.IntegrityHash,
	}, nil
}
