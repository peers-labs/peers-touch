// tool_dispatch_service.go owns Station policy, decision, targeted dispatch,
// receipt validation, and ToolBatch continuation admission.
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultCapabilityLeaseTTL = 5 * time.Minute
	defaultToolDeadline       = 2 * time.Minute
	defaultReconciliationTTL  = 10 * time.Minute
	maxCapabilityPullLimit    = 100
)

type ToolPolicy string

const (
	ToolPolicyAuto   ToolPolicy = "auto"
	ToolPolicyManual ToolPolicy = "manual"
	ToolPolicyDeny   ToolPolicy = "deny"
)

type ToolRiskLevel string

const (
	ToolRiskLow    ToolRiskLevel = "low"
	ToolRiskMedium ToolRiskLevel = "medium"
	ToolRiskHigh   ToolRiskLevel = "high"
)

type AuthorizedToolProposal struct {
	ToolCallID      string
	ToolName        string
	CapabilityID    string
	SchemaVersion   string
	BindingID       string
	BindingRevision uint64
	ExecutionOwner  model.ToolExecutionOwner
	Arguments       []byte
	ResourceRefs    []*model.ClientResourceRef
}

type ToolBatchProposal struct {
	ActorID                   string
	TurnID                    string
	AttemptID                 string
	ToolBatchID               string
	ConversationID            string
	AgentID                   string
	Provider                  string
	Model                     string
	Effort                    string
	ThinkingMode              string
	SystemPrompt              string
	Iteration                 uint32
	MaxRetries                uint32
	ContextWindowSize         uint32
	TaskID                    string
	StepID                    string
	ClientCapabilitySessionID string
	ReadinessSnapshotID       string
	Deadline                  time.Time
	Calls                     []AuthorizedToolProposal
}

type ProposalDecision struct {
	ToolCallID       string
	ToolName         string
	Arguments        string
	ApprovalID       string
	DecisionRevision uint64
	Status           string
	ExecutionOwner   string
	Reason           string
	FencingToken     uint64
}

type ToolDispatchService struct {
	now             func() time.Time
	capabilityProof *ClientCapabilityProofService
}

func NewToolDispatchService() *ToolDispatchService {
	return &ToolDispatchService{now: func() time.Time { return time.Now().UTC() }}
}

func (s *ToolDispatchService) SetCapabilityProofService(proof *ClientCapabilityProofService) {
	s.capabilityProof = proof
}

func (s *ToolDispatchService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, fmt.Errorf("open agent db: %w", err)
	}
	return db, nil
}

func (s *ToolDispatchService) RegisterCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RegisterClientCapabilityLeaseRequest,
) (*model.RegisterClientCapabilityLeaseResponse, error) {
	if request == nil || request.GetAdvertisement() == nil {
		return nil, invalidToolRequest("capability advertisement is required")
	}
	actorID = strings.TrimSpace(actorID)
	authSessionID = strings.TrimSpace(authSessionID)
	deviceID = strings.TrimSpace(deviceID)
	if actorID == "" || authSessionID == "" || deviceID == "" {
		return nil, invalidToolRequest("authenticated actor, session, and device are required")
	}
	leasePTID := actorID
	if s.capabilityProof != nil {
		leasePTID = s.capabilityProof.ResolveActorPTID(ctx, actorID)
	}
	if s.capabilityProof == nil {
		return nil, internalToolError("verify capability command", fmt.Errorf("proof service is not configured"))
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.RegisterClientCapabilityLeaseResponse{ErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}
	input := request.GetAdvertisement()
	if len(input.GetCapabilities()) == 0 &&
		input.GetPlatform() != model.ClientPlatform_CLIENT_PLATFORM_BROWSER {
		return nil, invalidToolRequest("at least one client capability is required")
	}

	now := s.now()
	expiresAt := now.Add(defaultCapabilityLeaseTTL)
	capabilityBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ClientCapabilityLease{Capabilities: input.GetCapabilities()},
	)
	if err != nil {
		return nil, internalToolError("encode capability advertisement", err)
	}
	lease := &model.ClientCapabilityLease{
		CapabilitySessionId: generateID("capability_session"),
		Ptid:                leasePTID,
		DeviceId:            deviceID,
		Platform:            input.GetPlatform(),
		Capabilities:        input.GetCapabilities(),
		ExpiresAt:           timestamppb.New(expiresAt),
		ConnectionId:        input.GetConnectionId(),
		LeaseId:             generateID("capability_lease"),
		LeaseRevision:       1,
		CapabilitySetHash:   hashBytes(capabilityBytes),
		DeviceSigningKeyId:  input.GetDeviceSigningKeyId(),
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(lease)
	if err != nil {
		return nil, internalToolError("encode capability lease", err)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	response := &model.RegisterClientCapabilityLeaseResponse{Lease: lease}
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return nil, internalToolError("encode capability lease response", err)
	}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		command, replayed, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
			verified,
			now,
		)
		if err != nil {
			return err
		}
		if replayed {
			if len(command.ResponseRef) == 0 {
				return invalidToolState("capability registration replay has no response")
			}
			return proto.Unmarshal(command.ResponseRef, response)
		}
		row := &persistence.ClientCapabilityLease{
			SessionID:          lease.GetCapabilitySessionId(),
			ActorID:            actorID,
			AuthSessionID:      authSessionID,
			DeviceID:           deviceID,
			PlatformKind:       int32(lease.GetPlatform()),
			ConnectionID:       lease.GetConnectionId(),
			LeaseID:            lease.GetLeaseId(),
			LeaseRevision:      lease.GetLeaseRevision(),
			CapabilitySetHash:  lease.GetCapabilitySetHash(),
			DeviceSigningKeyID: lease.GetDeviceSigningKeyId(),
			LeasePayload:       encoded,
			DispatchSequence:   0,
			ExpiresAt:          expiresAt,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if err := tx.Create(row).Error; err != nil {
			return internalToolError("persist capability lease", err)
		}
		if _, err := s.takeOverPreparedCallsForLeaseTx(tx, row, now); err != nil {
			return err
		}
		return storeCapabilityCommandOutcomeTx(
			tx,
			command.CommandID,
			0,
			lease.GetLeaseId(),
			lease.GetLeaseRevision(),
			responseBytes,
		)
	})
	return response, err
}

func (s *ToolDispatchService) ListCapabilitySessions(
	ctx context.Context,
	actorID string,
) (*model.ListClientCapabilitySessionsResponse, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil, invalidToolRequest("authenticated actor is required")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.ClientCapabilityLease
	if err := db.WithContext(ctx).
		Where(
			"actor_id = ? AND revoked_at IS NULL AND expires_at > ?",
			actorID,
			s.now(),
		).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, internalToolError("list active capability sessions", err)
	}
	sessions := make([]*model.ClientCapabilitySession, 0, len(rows))
	for _, row := range rows {
		var lease model.ClientCapabilityLease
		if err := proto.Unmarshal(row.LeasePayload, &lease); err != nil {
			return nil, internalToolError("decode capability session", err)
		}
		sessions = append(sessions, capabilitySessionFromLeaseRow(&row, &lease))
	}
	return &model.ListClientCapabilitySessionsResponse{Sessions: sessions}, nil
}

func (s *ToolDispatchService) GetActiveCapabilitySession(
	ctx context.Context,
	actorID string,
	sessionID string,
) (*model.ClientCapabilitySession, error) {
	actorID = strings.TrimSpace(actorID)
	sessionID = strings.TrimSpace(sessionID)
	if actorID == "" || sessionID == "" {
		return nil, invalidToolRequest("authenticated actor and capability session are required")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.ClientCapabilityLease
	queryErr := db.WithContext(ctx).
		Where(
			"actor_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ?",
			actorID,
			sessionID,
			s.now(),
		).
		First(&row).Error
	if errors.Is(queryErr, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if queryErr != nil {
		return nil, internalToolError("get active capability session", queryErr)
	}
	var lease model.ClientCapabilityLease
	if err := proto.Unmarshal(row.LeasePayload, &lease); err != nil {
		return nil, internalToolError("decode capability session", err)
	}
	return capabilitySessionFromLeaseRow(&row, &lease), nil
}

func capabilitySessionFromLeaseRow(
	row *persistence.ClientCapabilityLease,
	lease *model.ClientCapabilityLease,
) *model.ClientCapabilitySession {
	return &model.ClientCapabilitySession{
		SessionId:         row.SessionID,
		Ptid:              lease.GetPtid(),
		DeviceId:          row.DeviceID,
		PlatformKind:      model.ClientPlatform(row.PlatformKind),
		TypedCapabilities: lease.GetCapabilities(),
		ExpiresAt:         timestamppb.New(row.ExpiresAt),
		ConnectionId:      row.ConnectionID,
		LeaseId:           lease.GetLeaseId(),
		LeaseRevision:     lease.GetLeaseRevision(),
	}
}

func (s *ToolDispatchService) RenewCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RenewClientCapabilityLeaseRequest,
) (*model.RenewClientCapabilityLeaseResponse, error) {
	if request == nil || s.capabilityProof == nil {
		return nil, invalidToolRequest("renew request and proof service are required")
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.RenewClientCapabilityLeaseResponse{ErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	response := &model.RenewClientCapabilityLeaseResponse{}
	now := s.now()
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		command, replayed, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
			verified,
			now,
		)
		if err != nil {
			return err
		}
		if replayed {
			return proto.Unmarshal(command.ResponseRef, response)
		}
		var row persistence.ClientCapabilityLease
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"session_id = ? AND lease_id = ? AND actor_id = ? AND auth_session_id = ? AND device_id = ? AND revoked_at IS NULL",
			request.GetCapabilitySessionId(),
			request.GetLeaseId(),
			actorID,
			authSessionID,
			deviceID,
		).First(&row).Error; err != nil {
			return notFoundToolError("active capability lease", err)
		}
		if row.LeaseRevision != request.GetExpectedLeaseRevision() ||
			row.CapabilitySetHash != request.GetCapabilitySetHash() ||
			row.DeviceSigningKeyID != request.GetDeviceSigningKeyId() {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "capability lease revision or immutable binding changed", nil)
		}
		var lease model.ClientCapabilityLease
		if err := proto.Unmarshal(row.LeasePayload, &lease); err != nil {
			return internalToolError("decode capability lease", err)
		}
		row.LeaseRevision++
		row.ExpiresAt = now.Add(defaultCapabilityLeaseTTL)
		row.UpdatedAt = now
		lease.LeaseRevision = row.LeaseRevision
		lease.ExpiresAt = timestamppb.New(row.ExpiresAt)
		row.LeasePayload, err = proto.MarshalOptions{Deterministic: true}.Marshal(&lease)
		if err != nil {
			return internalToolError("encode renewed capability lease", err)
		}
		if err := tx.Save(&row).Error; err != nil {
			return internalToolError("renew capability lease", err)
		}
		response.Lease = &lease
		encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
		if err != nil {
			return internalToolError("encode capability renewal response", err)
		}
		return storeCapabilityCommandOutcomeTx(tx, command.CommandID, 0, row.LeaseID, row.LeaseRevision, encoded)
	})
	return response, err
}

func (s *ToolDispatchService) RevokeCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RevokeClientCapabilityLeaseRequest,
) (*model.RevokeClientCapabilityLeaseResponse, error) {
	if request == nil || s.capabilityProof == nil {
		return nil, invalidToolRequest("revoke request and proof service are required")
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.RevokeClientCapabilityLeaseResponse{ErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	response := &model.RevokeClientCapabilityLeaseResponse{}
	now := s.now()
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		command, replayed, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE,
			verified,
			now,
		)
		if err != nil {
			return err
		}
		if replayed {
			return proto.Unmarshal(command.ResponseRef, response)
		}
		var row persistence.ClientCapabilityLease
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"session_id = ? AND lease_id = ? AND actor_id = ? AND auth_session_id = ? AND device_id = ? AND revoked_at IS NULL",
			request.GetCapabilitySessionId(),
			request.GetLeaseId(),
			actorID,
			authSessionID,
			deviceID,
		).First(&row).Error; err != nil {
			return notFoundToolError("active capability lease", err)
		}
		if row.LeaseRevision != request.GetExpectedLeaseRevision() {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "capability lease revision changed", nil)
		}
		row.LeaseRevision++
		row.RevokedAt = &now
		row.RevokeReason = int32(request.GetReason())
		row.UpdatedAt = now
		if err := tx.Save(&row).Error; err != nil {
			return internalToolError("revoke capability lease", err)
		}
		response.CapabilitySessionId = row.SessionID
		response.LeaseId = row.LeaseID
		response.LeaseRevision = row.LeaseRevision
		response.RevokedAt = timestamppb.New(now)
		response.Reason = request.GetReason()
		encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
		if err != nil {
			return internalToolError("encode capability revoke response", err)
		}
		return storeCapabilityCommandOutcomeTx(tx, command.CommandID, 0, row.LeaseID, row.LeaseRevision, encoded)
	})
	return response, err
}

func (s *ToolDispatchService) ProposeAuthorizedBatch(
	ctx context.Context,
	proposal ToolBatchProposal,
) ([]ProposalDecision, error) {
	return s.proposeBatch(ctx, proposal)
}

func (s *ToolDispatchService) proposeBatch(
	ctx context.Context,
	proposal ToolBatchProposal,
) ([]ProposalDecision, error) {
	if err := validateToolBatchProposal(proposal); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var decisions []ProposalDecision
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := s.now()
		deadline := proposal.Deadline.UTC()
		if deadline.IsZero() {
			deadline = now.Add(defaultToolDeadline)
		}

		batch := &persistence.ToolBatch{
			ID:                  proposal.ToolBatchID,
			ActorID:             proposal.ActorID,
			TurnID:              proposal.TurnID,
			AttemptID:           proposal.AttemptID,
			ConversationID:      proposal.ConversationID,
			AgentID:             proposal.AgentID,
			Provider:            proposal.Provider,
			Model:               proposal.Model,
			Effort:              proposal.Effort,
			ThinkingMode:        proposal.ThinkingMode,
			SystemPrompt:        proposal.SystemPrompt,
			Iteration:           proposal.Iteration,
			MaxRetries:          proposal.MaxRetries,
			ContextWindowSize:   proposal.ContextWindowSize,
			TaskID:              proposal.TaskID,
			StepID:              proposal.StepID,
			CapabilitySessionID: proposal.ClientCapabilitySessionID,
			ExpectedCallCount:   uint32(len(proposal.Calls)),
			Status:              persistence.ToolBatchStatusOpen,
			CreatedAt:           now,
			UpdatedAt:           now,
		}
		var existing persistence.ToolBatch
		if err := tx.Where("id = ? AND actor_id = ?", batch.ID, batch.ActorID).
			First(&existing).Error; err == nil {
			var replayErr error
			decisions, replayErr = loadToolBatchProposalReplayTx(tx, proposal, &existing)
			return replayErr
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return internalToolError("load existing tool batch", err)
		}
		if err := tx.Create(batch).Error; err != nil {
			if !isUniqueViolation(err) {
				return internalToolError("persist tool batch", err)
			}
			if loadErr := tx.Where(
				"actor_id = ? AND turn_id = ? AND attempt_id = ? AND iteration = ?",
				batch.ActorID,
				batch.TurnID,
				batch.AttemptID,
				batch.Iteration,
			).First(&existing).Error; loadErr != nil {
				return internalToolError("load existing tool batch", loadErr)
			}
			var replayErr error
			decisions, replayErr = loadToolBatchProposalReplayTx(tx, proposal, &existing)
			return replayErr
		}

		var lease *model.ClientCapabilityLease
		decisions = make([]ProposalDecision, 0, len(proposal.Calls))
		for _, call := range proposal.Calls {
			authorization, err := resolveToolCapabilityAuthorizationTx(
				tx,
				proposal,
				call,
				now,
			)
			if err != nil {
				return err
			}
			if authorization.ExecutionOwner ==
				model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
				if lease == nil {
					lease, err = loadActiveCapabilityLeaseTx(
						tx,
						proposal.ActorID,
						proposal.ClientCapabilitySessionID,
						now,
					)
					if err != nil {
						return err
					}
				}
				if err := validateCapabilityCall(lease, call); err != nil {
					return err
				}
			} else if len(call.ResourceRefs) > 0 {
				return invalidToolRequest(
					"Station-owned tools cannot consume client resource references",
				)
			}
			decision, err := s.proposeCallTx(
				tx,
				proposal,
				lease,
				call,
				authorization,
				deadline,
				now,
			)
			if err != nil {
				return err
			}
			decisions = append(decisions, decision)
		}

		for _, decision := range decisions {
			if decision.Status == persistence.ToolCallStatusDenied {
				return blockToolBatchTx(tx, proposal.ToolBatchID, now)
			}
		}
		for index := range decisions {
			if decisions[index].Status != persistence.ToolCallStatusApproved ||
				decisions[index].ExecutionOwner != persistence.ToolOwnerClientCapability {
				continue
			}
			var call persistence.ToolCall
			if err := tx.Where(
				"actor_id = ? AND tool_call_id = ?",
				proposal.ActorID,
				decisions[index].ToolCallID,
			).First(&call).Error; err != nil {
				return internalToolError("load approved client tool call", err)
			}
			if err := s.dispatchCallTx(tx, &call, now); err != nil {
				return err
			}
			decisions[index].Status = call.Status
			decisions[index].FencingToken = call.FencingToken
		}
		return nil
	})
	return decisions, err
}

func loadToolBatchProposalReplayTx(
	tx *gorm.DB,
	proposal ToolBatchProposal,
	batch *persistence.ToolBatch,
) ([]ProposalDecision, error) {
	if batch == nil ||
		batch.ID != proposal.ToolBatchID ||
		batch.ActorID != proposal.ActorID ||
		batch.TurnID != proposal.TurnID ||
		batch.AttemptID != proposal.AttemptID ||
		batch.ConversationID != proposal.ConversationID ||
		batch.AgentID != proposal.AgentID ||
		batch.Provider != proposal.Provider ||
		batch.Model != proposal.Model ||
		batch.Effort != proposal.Effort ||
		batch.ThinkingMode != proposal.ThinkingMode ||
		batch.SystemPrompt != proposal.SystemPrompt ||
		batch.Iteration != proposal.Iteration ||
		batch.MaxRetries != proposal.MaxRetries ||
		batch.ContextWindowSize != proposal.ContextWindowSize ||
		batch.TaskID != proposal.TaskID ||
		batch.StepID != proposal.StepID ||
		batch.CapabilitySessionID != proposal.ClientCapabilitySessionID ||
		batch.ExpectedCallCount != uint32(len(proposal.Calls)) {
		return nil, idempotencyToolError("tool batch identity payload mismatch")
	}

	var records []persistence.ToolCall
	if err := tx.Where(
		"actor_id = ? AND tool_batch_id = ?",
		proposal.ActorID,
		proposal.ToolBatchID,
	).Find(&records).Error; err != nil {
		return nil, internalToolError("load tool batch replay calls", err)
	}
	if len(records) != len(proposal.Calls) {
		return nil, idempotencyToolError("tool batch replay call count mismatch")
	}
	recordsByCallID := make(map[string]*persistence.ToolCall, len(records))
	for index := range records {
		recordsByCallID[records[index].ToolCallID] = &records[index]
	}

	decisions := make([]ProposalDecision, 0, len(proposal.Calls))
	for _, proposed := range proposal.Calls {
		record := recordsByCallID[proposed.ToolCallID]
		if record == nil || !toolProposalMatchesRecord(proposal, proposed, record) {
			return nil, idempotencyToolError("tool batch replay payload mismatch")
		}
		if err := tx.Model(&persistence.ToolCall{}).
			Where("id = ?", record.ID).
			UpdateColumn(
				"duplicate_delivery_count",
				gorm.Expr("duplicate_delivery_count + ?", 1),
			).Error; err != nil {
			return nil, internalToolError("record duplicate tool proposal", err)
		}
		decisions = append(decisions, proposalDecisionFromRecord(record))
	}
	return decisions, nil
}

func toolProposalMatchesRecord(
	proposal ToolBatchProposal,
	proposed AuthorizedToolProposal,
	record *persistence.ToolCall,
) bool {
	resourceRefs, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ClientCapabilityRequest{ResourceRefs: proposed.ResourceRefs},
	)
	return err == nil &&
		record.ActorID == proposal.ActorID &&
		record.TurnID == proposal.TurnID &&
		record.AttemptID == proposal.AttemptID &&
		record.ToolBatchID == proposal.ToolBatchID &&
		record.ToolName == proposed.ToolName &&
		record.CapabilityID == proposed.CapabilityID &&
		record.SchemaVersion == proposed.SchemaVersion &&
		record.ManifestVersion == proposed.SchemaVersion &&
		record.BindingID == proposed.BindingID &&
		record.BindingRevision == proposed.BindingRevision &&
		record.ReadinessSnapID == proposal.ReadinessSnapshotID &&
		record.ExecutionOwner == toolExecutionOwnerStorageValue(proposed.ExecutionOwner) &&
		record.ArgumentsHash == hashBytes(proposed.Arguments) &&
		string(record.BoundedArguments) == string(proposed.Arguments) &&
		string(record.ResourceRefs) == string(resourceRefs)
}

func proposalDecisionFromRecord(record *persistence.ToolCall) ProposalDecision {
	return ProposalDecision{
		ToolCallID:       record.ToolCallID,
		ToolName:         record.ToolName,
		Arguments:        string(record.BoundedArguments),
		ApprovalID:       record.ApprovalID,
		DecisionRevision: record.DecisionRevision,
		Status:           record.Status,
		ExecutionOwner:   record.ExecutionOwner,
		FencingToken:     record.FencingToken,
	}
}

func (s *ToolDispatchService) SubmitDecision(
	ctx context.Context,
	actorID string,
	request *model.SubmitToolApprovalDecisionRequest,
) (*model.SubmitToolApprovalDecisionResponse, error) {
	if err := validateDecisionRequest(actorID, request); err != nil {
		return nil, err
	}
	canonicalHash := decisionPayloadHash(request)
	if request.GetPayloadHash() != canonicalHash {
		return decisionRejection(
			request,
			model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_IDEMPOTENCY_CONFLICT,
		), nil
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var response *model.SubmitToolApprovalDecisionResponse
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, found, err := loadDecisionReplayTx(tx, actorID, request.GetIdempotencyKey(), canonicalHash)
		if err != nil {
			if businessError, ok := err.(*errcode.BizError); ok &&
				businessError.Code == errcode.AgentIdempotencyConflict {
				response = decisionRejection(
					request,
					model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_IDEMPOTENCY_CONFLICT,
				)
				return nil
			}
			return err
		}
		if found {
			response = replayed
			return nil
		}

		var call persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("actor_id = ? AND tool_call_id = ?", actorID, request.GetToolCallId()).
			First(&call).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response = decisionRejection(
					request,
					model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_NOT_FOUND,
				)
				return nil
			}
			return notFoundToolError("tool call", err)
		}
		if call.ApprovalID != request.GetApprovalId() {
			return unauthorizedToolRequest("approval identity mismatch")
		}
		if call.DecisionRevision != request.GetExpectedRevision() {
			response = decisionRejection(
				request,
				model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_STALE_REVISION,
			)
			response.DecisionRevision = call.DecisionRevision
			return nil
		}
		if call.Status != persistence.ToolCallStatusWaitingApproval {
			if call.Status == persistence.ToolCallStatusExpired {
				response = decisionRejection(
					request,
					model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED,
				)
				response.DecisionRevision = call.DecisionRevision
				return nil
			}
			return invalidToolState("tool call is not waiting for approval")
		}

		now := s.now()
		revision := call.DecisionRevision + 1
		status := persistence.ToolCallStatusDenied
		if request.GetApproved() {
			status = persistence.ToolCallStatusApproved
		}
		update := map[string]interface{}{
			"decision_id":           request.GetDecisionId(),
			"decision_revision":     revision,
			"decision_payload_hash": canonicalHash,
			"approved":              request.GetApproved(),
			"status":                status,
			"updated_at":            now,
		}
		if !request.GetApproved() {
			update["ended_at"] = now
		}
		result := tx.Model(&persistence.ToolCall{}).
			Where("id = ? AND decision_revision = ? AND status = ?",
				call.ID,
				request.GetExpectedRevision(),
				persistence.ToolCallStatusWaitingApproval,
			).
			Updates(update)
		if result.Error != nil {
			return internalToolError("commit tool decision", result.Error)
		}
		if result.RowsAffected != 1 {
			response = decisionRejection(
				request,
				model.ToolApprovalDecisionErrorCode_TOOL_APPROVAL_DECISION_ERROR_CODE_STALE_REVISION,
			)
			return nil
		}
		call.DecisionID = request.GetDecisionId()
		call.DecisionRevision = revision
		call.DecisionPayloadHash = canonicalHash
		call.Approved = request.GetApproved()
		call.Status = status

		if request.GetApproved() &&
			call.ExecutionOwner == persistence.ToolOwnerClientCapability {
			if err := s.dispatchCallTx(tx, &call, now); err != nil {
				return err
			}
		} else if !request.GetApproved() {
			if err := blockToolBatchTx(tx, call.ToolBatchID, now); err != nil {
				return err
			}
		} else if call.ExecutionOwner != persistence.ToolOwnerStation {
			return invalidToolState("tool execution owner is invalid")
		}

		response = &model.SubmitToolApprovalDecisionResponse{
			Accepted:         true,
			DecisionRevision: revision,
			ApprovalId:       request.GetApprovalId(),
			ToolCallId:       request.GetToolCallId(),
			DecisionId:       request.GetDecisionId(),
			Approved:         request.GetApproved(),
			IdempotencyKey:   request.GetIdempotencyKey(),
			PayloadHash:      canonicalHash,
		}
		ack, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
		if err != nil {
			return internalToolError("encode decision acknowledgement", err)
		}
		command := &persistence.ToolDecisionCommand{
			ID:                generateID("tool_decision"),
			ActorID:           actorID,
			ToolCallID:        request.GetToolCallId(),
			ApprovalID:        request.GetApprovalId(),
			DecisionID:        request.GetDecisionId(),
			ExpectedRevision:  request.GetExpectedRevision(),
			CommittedRevision: revision,
			Approved:          request.GetApproved(),
			IdempotencyKey:    request.GetIdempotencyKey(),
			PayloadHash:       canonicalHash,
			Acknowledgement:   ack,
			CreatedAt:         now,
		}
		if err := tx.Create(command).Error; err != nil {
			return internalToolError("persist decision acknowledgement", err)
		}
		return nil
	})
	return response, err
}

func (s *ToolDispatchService) PullCapabilityRequests(
	ctx context.Context,
	actorID string,
	deviceID string,
	request *model.PullClientCapabilityRequestsRequest,
) (*model.PullClientCapabilityRequestsResponse, error) {
	if request == nil ||
		strings.TrimSpace(actorID) == "" ||
		strings.TrimSpace(deviceID) == "" ||
		strings.TrimSpace(request.GetCapabilitySessionId()) == "" {
		return nil, invalidToolRequest("actor, device, and capability_session_id are required")
	}
	if supplied := strings.TrimSpace(request.GetDeviceId()); supplied != "" && supplied != deviceID {
		return nil, unauthorizedToolRequest("request device does not match authenticated device")
	}
	if s.capabilityProof == nil {
		return nil, internalToolError("verify capability pull", fmt.Errorf("proof service is not configured"))
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.PullClientCapabilityRequestsResponse{ErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	limit := int(request.GetLimit())
	if limit <= 0 || limit > maxCapabilityPullLimit {
		limit = maxCapabilityPullLimit
	}
	var rows []persistence.ToolDispatchOutbox
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
			verified,
			s.now(),
		); err != nil {
			return err
		}
		lease, err := loadActiveCapabilityLeaseTx(
			tx,
			actorID,
			request.GetCapabilitySessionId(),
			s.now(),
		)
		if err != nil {
			return err
		}
		if lease.GetDeviceId() != deviceID {
			return unauthorizedToolRequest(
				"capability session does not belong to authenticated device",
			)
		}
		if err := tx.Where(
			"actor_id = ? AND capability_session_id = ? AND target_device_id = ? AND dispatch_sequence > ?",
			actorID,
			request.GetCapabilitySessionId(),
			deviceID,
			request.GetAfterSequence(),
		).
			Order("dispatch_sequence ASC").
			Limit(limit).
			Find(&rows).Error; err != nil {
			return internalToolError("load targeted capability requests", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	response := &model.PullClientCapabilityRequestsResponse{}
	for _, row := range rows {
		var envelope model.ClientCapabilityRequest
		if err := proto.Unmarshal(row.Envelope, &envelope); err != nil {
			return nil, internalToolError("decode targeted capability request", err)
		}
		response.Requests = append(response.Requests, &envelope)
		response.LastSequence = row.DispatchSequence
	}
	return response, nil
}

func (s *ToolDispatchService) SubmitReceipt(
	ctx context.Context,
	actorID string,
	deviceID string,
	request *model.SubmitClientCapabilityReceiptRequest,
) (*model.SubmitClientCapabilityReceiptResponse, error) {
	if request == nil || request.GetReceipt() == nil {
		return nil, invalidToolRequest("client capability receipt is required")
	}
	receipt := request.GetReceipt()
	if strings.TrimSpace(actorID) == "" || strings.TrimSpace(deviceID) == "" {
		return nil, unauthorizedToolRequest("authenticated actor and device are required")
	}
	if receipt.GetRecoveryProof() != nil {
		return &model.SubmitClientCapabilityReceiptResponse{
			ErrorCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_REQUIRED,
		}, nil
	}
	if s.capabilityProof == nil {
		return nil, internalToolError("verify capability receipt", fmt.Errorf("proof service is not configured"))
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		actorID,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT,
		request,
		request.GetCommandProof(),
	)
	if err != nil {
		var proofErr *ClientCapabilityCommandProofError
		if errors.As(err, &proofErr) {
			return &model.SubmitClientCapabilityReceiptResponse{CommandErrorCode: proofErr.Code}, nil
		}
		return nil, err
	}
	receiptHash := protoPayloadHash(receipt)

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	response := &model.SubmitClientCapabilityReceiptResponse{}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := bindCapabilityCommandTx(
			tx,
			actorID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT,
			verified,
			s.now(),
		); err != nil {
			return err
		}
		replayed, found, err := loadReceiptReplayTx(tx, receipt, receiptHash)
		if err != nil {
			return err
		}
		if found {
			response = replayed
			return nil
		}

		var outbox persistence.ToolDispatchOutbox
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("request_id = ?", receipt.GetRequestId()).
			First(&outbox).Error; err != nil {
			return notFoundToolError("client capability request", err)
		}
		var call persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tool_call_id = ?", receipt.GetToolCallId()).
			First(&call).Error; err != nil {
			return notFoundToolError("tool call", err)
		}
		var lease persistence.ClientCapabilityLease
		leaseErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"session_id = ? AND actor_id = ? AND device_id = ? AND lease_id = ?",
			call.CapabilitySessionID,
			actorID,
			deviceID,
			call.ExecutorLeaseID,
		).First(&lease).Error
		now := s.now()
		if leaseErr != nil {
			if !errors.Is(leaseErr, gorm.ErrRecordNotFound) {
				return internalToolError("lock capability lease for receipt", leaseErr)
			}
			code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
				return err
			}
			response.ErrorCode = code
			return nil
		}
		if lease.LeaseRevision != call.CapabilityLeaseRevision ||
			lease.RevokedAt != nil ||
			!lease.ExpiresAt.After(now) {
			code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
				return err
			}
			response.ErrorCode = code
			return nil
		}
		if code := validateReceiptTuple(actorID, deviceID, now, &call, &outbox, receipt); code != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_UNSPECIFIED {
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
				return err
			}
			response.ErrorCode = code
			return nil
		}

		switch receipt.GetStatus() {
		case model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED:
			if call.Status != persistence.ToolCallStatusDispatchCommitted {
				code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION
				if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
					return err
				}
				response.ErrorCode = code
				return nil
			}
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, true, "", now); err != nil {
				return err
			}
			result := tx.Model(&persistence.ToolCall{}).
				Where("id = ? AND status = ?", call.ID, persistence.ToolCallStatusDispatchCommitted).
				Updates(map[string]interface{}{
					"status":              persistence.ToolCallStatusPrepared,
					"side_effect_receipt": receipt.GetSideEffectReceiptId(),
					"started_at":          now,
					"updated_at":          now,
				})
			if result.Error != nil {
				return internalToolError("commit prepared receipt", result.Error)
			}
			if result.RowsAffected != 1 {
				return invalidToolState("tool call prepared transition lost")
			}
			if err := tx.Model(&persistence.ToolDispatchOutbox{}).
				Where("request_id = ?", outbox.RequestID).
				Update("acknowledged_at", now).Error; err != nil {
				return internalToolError("acknowledge capability request", err)
			}
			response.Accepted = true
			return nil

		case model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
			model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_FAILED,
			model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_RECONCILED_UNKNOWN:
			if call.Status != persistence.ToolCallStatusPrepared {
				code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION
				if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
					return err
				}
				response.ErrorCode = code
				return nil
			}
			if strings.TrimSpace(receipt.GetResultId()) == "" {
				return invalidToolRequest("terminal receipt result_id is required")
			}
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, true, "", now); err != nil {
				return err
			}
			return s.commitTerminalReceiptTx(tx, &call, receipt, now, response)
		default:
			code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION
			if err := storeReceiptAttemptTx(tx, receipt, receiptHash, false, code.String(), now); err != nil {
				return err
			}
			response.ErrorCode = code
			return nil
		}
	})
	return response, err
}

func (s *ToolDispatchService) ClaimReadyContinuation(
	ctx context.Context,
	leaseDuration time.Duration,
) (*persistence.ToolContinuation, error) {
	if leaseDuration <= 0 {
		return nil, invalidToolRequest("continuation lease duration must be positive")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var claimed persistence.ToolContinuation
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := s.now()
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where(
				"status = ? OR (status = ? AND provider_request_emitted = ? AND lease_expires_at < ?)",
				persistence.ToolContinuationStatusReady,
				persistence.ToolContinuationStatusClaimed,
				false,
				now,
			).
			Order("created_at ASC").
			First(&claimed).Error; err != nil {
			return err
		}
		claimed.Status = persistence.ToolContinuationStatusClaimed
		claimed.LeaseID = generateID("continuation_lease")
		claimed.FencingToken++
		expiresAt := now.Add(leaseDuration)
		claimed.LeaseExpiresAt = &expiresAt
		claimed.UpdatedAt = now
		return tx.Save(&claimed).Error
	})
	return &claimed, err
}

func (s *ToolDispatchService) AwaitAndClaimBatchContinuation(
	ctx context.Context,
	toolBatchID string,
	leaseDuration time.Duration,
) (*persistence.ToolContinuation, []persistence.ToolResult, error) {
	if strings.TrimSpace(toolBatchID) == "" || leaseDuration <= 0 {
		return nil, nil, invalidToolRequest("tool batch and continuation lease duration are required")
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		continuation, results, ready, err := s.claimBatchContinuation(ctx, toolBatchID, leaseDuration)
		if err != nil {
			return nil, nil, err
		}
		if ready {
			return continuation, results, nil
		}
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *ToolDispatchService) claimBatchContinuation(
	ctx context.Context,
	toolBatchID string,
	leaseDuration time.Duration,
) (*persistence.ToolContinuation, []persistence.ToolResult, bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, false, err
	}
	var claimed persistence.ToolContinuation
	var results []persistence.ToolResult
	ready := false
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var batch persistence.ToolBatch
		if err := tx.Where("id = ?", toolBatchID).First(&batch).Error; err != nil {
			return notFoundToolError("tool batch", err)
		}
		if batch.Status == persistence.ToolBatchStatusBlocked {
			return invalidToolState("tool batch is blocked")
		}
		if batch.Status != persistence.ToolBatchStatusReadyForContinuation {
			return nil
		}

		now := s.now()
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tool_batch_id = ? AND status = ?", toolBatchID, persistence.ToolContinuationStatusReady).
			First(&claimed).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil
			}
			return internalToolError("load tool batch continuation", err)
		}
		claimed.Status = persistence.ToolContinuationStatusClaimed
		claimed.LeaseID = generateID("continuation_lease")
		claimed.FencingToken++
		expiresAt := now.Add(leaseDuration)
		claimed.LeaseExpiresAt = &expiresAt
		claimed.UpdatedAt = now
		if err := tx.Save(&claimed).Error; err != nil {
			return internalToolError("claim tool batch continuation", err)
		}
		if err := tx.Where("tool_batch_id = ?", toolBatchID).
			Order("created_at ASC").
			Find(&results).Error; err != nil {
			return internalToolError("load tool batch results", err)
		}
		ready = true
		return nil
	})
	return &claimed, results, ready, err
}

func (s *ToolDispatchService) MarkContinuationEmitted(
	ctx context.Context,
	continuationID string,
	leaseID string,
	fencingToken uint64,
	providerIdempotent bool,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	result := db.WithContext(ctx).Model(&persistence.ToolContinuation{}).
		Where(
			"id = ? AND status = ? AND lease_id = ? AND fencing_token = ?",
			continuationID,
			persistence.ToolContinuationStatusClaimed,
			leaseID,
			fencingToken,
		).
		Updates(map[string]interface{}{
			"provider_request_emitted": true,
			"provider_idempotent":      providerIdempotent,
			"updated_at":               s.now(),
		})
	if result.Error != nil {
		return internalToolError("mark continuation emitted", result.Error)
	}
	if result.RowsAffected != 1 {
		return invalidToolState("continuation lease is stale")
	}
	return nil
}

func (s *ToolDispatchService) CompleteContinuation(
	ctx context.Context,
	continuationID string,
	leaseID string,
	fencingToken uint64,
	providerResponse []byte,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := s.now()
	result := db.WithContext(ctx).Model(&persistence.ToolContinuation{}).
		Where(
			"id = ? AND status = ? AND lease_id = ? AND fencing_token = ?",
			continuationID,
			persistence.ToolContinuationStatusClaimed,
			leaseID,
			fencingToken,
		).
		Updates(map[string]interface{}{
			"status":            persistence.ToolContinuationStatusCompleted,
			"provider_response": providerResponse,
			"completed_at":      now,
			"updated_at":        now,
		})
	if result.Error != nil {
		return internalToolError("complete continuation", result.Error)
	}
	if result.RowsAffected != 1 {
		return invalidToolState("continuation lease is stale")
	}
	return nil
}

func (s *ToolDispatchService) ReconcileExpiredContinuations(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := s.now()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ToolContinuation{}).
			Where(
				"status = ? AND lease_expires_at < ? AND provider_request_emitted = ?",
				persistence.ToolContinuationStatusClaimed,
				now,
				false,
			).
			Updates(map[string]interface{}{
				"status":           persistence.ToolContinuationStatusReady,
				"lease_id":         "",
				"lease_expires_at": nil,
				"updated_at":       now,
			}).Error; err != nil {
			return internalToolError("requeue pre-emission continuations", err)
		}
		if err := tx.Model(&persistence.ToolContinuation{}).
			Where(
				"status = ? AND lease_expires_at < ? AND provider_request_emitted = ? AND provider_idempotent = ?",
				persistence.ToolContinuationStatusClaimed,
				now,
				true,
				true,
			).
			Updates(map[string]interface{}{
				"status":           persistence.ToolContinuationStatusReady,
				"lease_id":         "",
				"lease_expires_at": nil,
				"updated_at":       now,
			}).Error; err != nil {
			return internalToolError("requeue provider-idempotent continuations", err)
		}
		return tx.Model(&persistence.ToolContinuation{}).
			Where(
				"status = ? AND lease_expires_at < ? AND provider_request_emitted = ? AND provider_idempotent = ?",
				persistence.ToolContinuationStatusClaimed,
				now,
				true,
				false,
			).
			Updates(map[string]interface{}{
				"status":     persistence.ToolContinuationStatusReconciliationRequired,
				"updated_at": now,
			}).Error
	})
}

func (s *ToolDispatchService) ExpireStaleApprovals(ctx context.Context, timeout time.Duration) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	now := s.now()
	cutoff := now.Add(-timeout)
	var affected int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var calls []persistence.ToolCall
		if err := tx.Where("status = ? AND updated_at < ?", persistence.ToolCallStatusWaitingApproval, cutoff).
			Find(&calls).Error; err != nil {
			return err
		}
		for _, call := range calls {
			result := tx.Model(&persistence.ToolCall{}).
				Where("id = ? AND status = ?", call.ID, persistence.ToolCallStatusWaitingApproval).
				Updates(map[string]interface{}{
					"status":     persistence.ToolCallStatusExpired,
					"ended_at":   now,
					"updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 1 {
				affected++
				if err := blockToolBatchTx(tx, call.ToolBatchID, now); err != nil {
					return err
				}
			}
		}
		return nil
	})
	return affected, err
}

func (s *ToolDispatchService) SettleExpiredToolCalls(ctx context.Context) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	now := s.now()
	var affected int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var calls []persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"(execution_deadline <= ? AND status IN ?) OR (reconciliation_deadline <= ? AND status = ?)",
				now,
				[]string{
					persistence.ToolCallStatusWaitingApproval,
					persistence.ToolCallStatusDispatchCommitted,
				},
				now,
				persistence.ToolCallStatusPrepared,
			).
			Find(&calls).Error; err != nil {
			return internalToolError("load expired tool calls", err)
		}
		for i := range calls {
			status := persistence.ToolCallStatusExpired
			if calls[i].Status == persistence.ToolCallStatusPrepared {
				status = persistence.ToolCallStatusUnknownSideEffect
			}
			result := tx.Model(&persistence.ToolCall{}).
				Where("id = ? AND status = ?", calls[i].ID, calls[i].Status).
				Updates(map[string]interface{}{
					"status":     status,
					"error_code": "tool_deadline_expired",
					"ended_at":   now,
					"updated_at": now,
				})
			if result.Error != nil {
				return internalToolError("settle expired tool call", result.Error)
			}
			if result.RowsAffected == 0 {
				continue
			}
			affected++
			if err := blockToolBatchTx(tx, calls[i].ToolBatchID, now); err != nil {
				return err
			}
		}
		return nil
	})
	return affected, err
}

func (s *ToolDispatchService) GetPendingByTurn(ctx context.Context, turnID string) ([]persistence.ToolCall, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var calls []persistence.ToolCall
	err = db.WithContext(ctx).
		Where("turn_id = ? AND status IN ?", turnID, []string{
			persistence.ToolCallStatusProposed,
			persistence.ToolCallStatusWaitingApproval,
			persistence.ToolCallStatusApproved,
			persistence.ToolCallStatusDispatchCommitted,
			persistence.ToolCallStatusPrepared,
		}).
		Find(&calls).Error
	return calls, err
}

type StationToolExecutionCompletion struct {
	ResultID       string
	ContinuationID string
	Replayed       bool
}

// ClaimReadyStationTool durably establishes the single execution attempt
// before TurnService invokes a Station-owned handler.
func (s *ToolDispatchService) ClaimReadyStationTool(
	ctx context.Context,
) (*persistence.ToolCall, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var claimed persistence.ToolCall
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var candidate persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Table("agent_tool_calls AS tool_call").
			Select("tool_call.*").
			Joins("JOIN agent_tool_batches AS batch ON batch.id = tool_call.tool_batch_id").
			Where(
				"tool_call.execution_owner = ? AND tool_call.status = ? "+
					"AND tool_call.execution_deadline > ? AND batch.status = ?",
				persistence.ToolOwnerStation,
				persistence.ToolCallStatusApproved,
				now,
				persistence.ToolBatchStatusOpen,
			).
			Order("tool_call.created_at ASC, tool_call.tool_call_id ASC").
			First(&candidate).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		claimID := generateID("execution_claim")
		executorLeaseID := generateID("station_executor")
		receiptID := generateID("station_receipt")
		nextFence := candidate.FencingToken + 1
		nextSequence := candidate.DispatchSequence + 1
		payloadHash := stationToolExecutionPayloadHash(&candidate, nextFence)
		result := tx.Model(&persistence.ToolCall{}).
			Where(
				"id = ? AND execution_owner = ? AND status = ? AND fencing_token = ?",
				candidate.ID,
				persistence.ToolOwnerStation,
				persistence.ToolCallStatusApproved,
				candidate.FencingToken,
			).
			Updates(map[string]interface{}{
				"status":                  persistence.ToolCallStatusPrepared,
				"execution_claim_id":      claimID,
				"executor_lease_id":       executorLeaseID,
				"fencing_token":           nextFence,
				"dispatch_sequence":       nextSequence,
				"dispatch_committed_at":   now,
				"payload_hash":            payloadHash,
				"side_effect_receipt":     receiptID,
				"execution_attempt_count": gorm.Expr("execution_attempt_count + ?", 1),
				"started_at":              now,
				"updated_at":              now,
			})
		if result.Error != nil {
			return internalToolError("claim Station tool execution", result.Error)
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.First(&claimed, "id = ?", candidate.ID).Error; err != nil {
			return internalToolError("reload Station tool execution claim", err)
		}
		return nil
	})
	if strings.TrimSpace(claimed.ToolCallID) == "" {
		return nil, err
	}
	return &claimed, err
}

// CompleteStationToolExecution commits the authoritative result and batch
// continuation under the claim/fence established before the side effect.
func (s *ToolDispatchService) CompleteStationToolExecution(
	ctx context.Context,
	claim *persistence.ToolCall,
	output string,
	executionErr error,
) (*StationToolExecutionCompletion, error) {
	if claim == nil ||
		strings.TrimSpace(claim.ToolCallID) == "" ||
		strings.TrimSpace(claim.ExecutionClaimID) == "" ||
		claim.FencingToken == 0 {
		return nil, invalidToolRequest("complete Station tool execution requires a claim and fence")
	}
	status := persistence.ToolReceiptStatusApplied
	callStatus := persistence.ToolCallStatusSucceeded
	errorCode := ""
	resultContent := output
	if executionErr != nil {
		status = persistence.ToolReceiptStatusFailed
		callStatus = persistence.ToolCallStatusFailed
		errorCode = "station_tool_execution_failed"
		resultContent = fmt.Sprintf("[tool_error] %s: %v", claim.ToolName, executionErr)
	}
	resultHash := hashString(fmt.Sprintf(
		"%s\x00%s\x00%s\x00%s",
		claim.ToolCallID,
		status,
		errorCode,
		resultContent,
	))
	resultID := "tool_result_" + resultHash[:24]

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	completion := &StationToolExecutionCompletion{}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("actor_id = ? AND tool_call_id = ?", claim.ActorID, claim.ToolCallID).
			First(&current).Error; err != nil {
			return notFoundToolError("Station tool call", err)
		}
		var existing persistence.ToolResult
		if err := tx.Where("tool_call_id = ?", current.ToolCallID).First(&existing).Error; err == nil {
			if existing.ID != resultID || existing.PayloadHash != resultHash {
				return idempotencyToolError("Station tool result payload mismatch")
			}
			if err := tx.Model(&persistence.ToolCall{}).
				Where("id = ?", current.ID).
				UpdateColumn(
					"duplicate_delivery_count",
					gorm.Expr("duplicate_delivery_count + ?", 1),
				).Error; err != nil {
				return internalToolError("record duplicate Station tool result", err)
			}
			completion.ResultID = existing.ID
			completion.ContinuationID = continuationIDForBatch(tx, current.ToolBatchID)
			completion.Replayed = true
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return internalToolError("load existing Station tool result", err)
		}
		if current.ExecutionOwner != persistence.ToolOwnerStation ||
			current.Status != persistence.ToolCallStatusPrepared ||
			current.ExecutionClaimID != claim.ExecutionClaimID ||
			current.FencingToken != claim.FencingToken ||
			current.PayloadHash != claim.PayloadHash {
			return invalidToolState("Station tool execution claim is stale")
		}
		committed, err := commitNewToolResultTx(
			tx,
			&current,
			toolTerminalResult{
				ID:            resultID,
				Status:        status,
				CallStatus:    callStatus,
				PayloadHash:   resultHash,
				BoundedResult: []byte(resultContent),
				ErrorCode:     errorCode,
			},
			s.now(),
		)
		if err != nil {
			return err
		}
		completion.ResultID = committed.ResultID
		completion.ContinuationID = committed.ContinuationID
		return nil
	})
	return completion, err
}

func (s *ToolDispatchService) proposeCallTx(
	tx *gorm.DB,
	proposal ToolBatchProposal,
	lease *model.ClientCapabilityLease,
	call AuthorizedToolProposal,
	authorization *toolCapabilityAuthorization,
	deadline time.Time,
	now time.Time,
) (ProposalDecision, error) {
	if authorization == nil {
		return ProposalDecision{}, invalidToolState(
			"tool capability authorization is required",
		)
	}
	risk := authorization.Risk
	policy := authorization.Policy
	status := persistence.ToolCallStatusApproved
	approved := true
	reason := "auto_approved_low_risk"
	if policy == ToolPolicyDeny {
		status = persistence.ToolCallStatusDenied
		approved = false
		reason = "denied_by_policy"
	} else if policy == ToolPolicyManual {
		status = persistence.ToolCallStatusWaitingApproval
		approved = false
		reason = "requires_manual_approval"
	}

	resourceRefs, err := proto.MarshalOptions{Deterministic: true}.Marshal(&model.ClientCapabilityRequest{
		ResourceRefs: call.ResourceRefs,
	})
	if err != nil {
		return ProposalDecision{}, internalToolError("encode client resource references", err)
	}
	approvalID := generateID("approval")
	reconciliationDeadline := deadline.Add(defaultReconciliationTTL)
	row := &persistence.ToolCall{
		ID:                generateID("tool_call"),
		ActorID:           proposal.ActorID,
		TurnID:            proposal.TurnID,
		AttemptID:         proposal.AttemptID,
		ToolBatchID:       proposal.ToolBatchID,
		ToolName:          call.ToolName,
		ToolCallID:        call.ToolCallID,
		CapabilityID:      call.CapabilityID,
		SchemaVersion:     call.SchemaVersion,
		BoundedArguments:  append([]byte(nil), call.Arguments...),
		ResourceRefs:      resourceRefs,
		ArgumentsHash:     hashBytes(call.Arguments),
		RedactedArguments: redactArguments(string(call.Arguments)),
		RiskClass:         string(risk),
		ApprovalPolicy:    string(policy),
		ManifestID:        authorization.ManifestID,
		ManifestVersion:   authorization.ManifestVersion,
		BindingID:         authorization.BindingID,
		BindingRevision:   authorization.BindingRevision,
		ReadinessSnapID:   authorization.ReadinessSnapshotID,
		ApprovalID:        approvalID,
		Approved:          approved,
		ExecutionOwner:    toolExecutionOwnerStorageValue(authorization.ExecutionOwner),
		ReplayPolicy: int32(
			model.ClientExecutionReplayPolicy_CLIENT_EXECUTION_REPLAY_POLICY_NO_REPLAY_AFTER_PREPARED,
		),
		Status:                 status,
		ExecutionDeadline:      &deadline,
		ReconciliationDeadline: &reconciliationDeadline,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	if authorization.ExecutionOwner ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		if lease == nil {
			return ProposalDecision{}, invalidToolState(
				"client capability lease is required for client-owned tool",
			)
		}
		row.CapabilitySessionID = lease.GetCapabilitySessionId()
		row.TargetDeviceID = lease.GetDeviceId()
		row.ExecutorLeaseID = lease.GetLeaseId()
		row.CapabilityLeaseRevision = lease.GetLeaseRevision()
	}
	if policy != ToolPolicyManual {
		row.DecisionRevision = 1
		row.DecisionID = generateID("decision")
		row.DecisionPayloadHash = policyDecisionPayloadHash(row)
	}
	if err := tx.Create(row).Error; err != nil {
		return ProposalDecision{}, internalToolError("persist tool call", err)
	}
	return ProposalDecision{
		ToolCallID:       call.ToolCallID,
		ToolName:         call.ToolName,
		Arguments:        string(call.Arguments),
		ApprovalID:       approvalID,
		DecisionRevision: row.DecisionRevision,
		Status:           row.Status,
		ExecutionOwner:   row.ExecutionOwner,
		Reason:           reason,
		FencingToken:     row.FencingToken,
	}, nil
}

type toolCapabilityAuthorization struct {
	ManifestID          string
	ManifestVersion     string
	BindingID           string
	BindingRevision     uint64
	ReadinessSnapshotID string
	ExecutionOwner      model.ToolExecutionOwner
	Risk                ToolRiskLevel
	Policy              ToolPolicy
}

func resolveToolCapabilityAuthorizationTx(
	tx *gorm.DB,
	proposal ToolBatchProposal,
	call AuthorizedToolProposal,
	now time.Time,
) (*toolCapabilityAuthorization, error) {
	bindingID := strings.TrimSpace(call.BindingID)
	snapshotID := strings.TrimSpace(proposal.ReadinessSnapshotID)
	if bindingID == "" || snapshotID == "" {
		return nil, invalidToolRequest(
			"binding_id and readiness_snapshot_id are required for authorized tool dispatch",
		)
	}

	var binding persistence.AgentCapabilityBinding
	if err := tx.Where(
		"binding_id = ? AND ptid = ? AND agent_id = ? AND tombstoned_at IS NULL",
		bindingID,
		proposal.ActorID,
		proposal.AgentID,
	).First(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidToolState("capability binding is missing or not owned by the actor")
		}
		return nil, internalToolError("load capability binding for tool dispatch", err)
	}
	if !binding.Enabled ||
		binding.CapabilityID != call.CapabilityID ||
		binding.CapabilityVersion != call.SchemaVersion ||
		binding.Revision != call.BindingRevision {
		return nil, invalidToolState("capability binding is disabled or stale")
	}

	var manifest persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND version = ?",
		binding.CapabilityID,
		binding.CapabilityVersion,
	).First(&manifest).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidToolState("capability manifest is missing")
		}
		return nil, internalToolError("load capability manifest for tool dispatch", err)
	}
	if manifest.RetiredAt != nil ||
		model.CapabilityAvailability(manifest.Availability) !=
			model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE {
		return nil, invalidToolState("capability manifest is retired or unavailable")
	}
	executionOwner := model.ToolExecutionOwner(manifest.ExecutionOwner)
	if executionOwner == model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_UNSPECIFIED ||
		executionOwner != call.ExecutionOwner {
		return nil, invalidToolState("capability execution owner is stale or invalid")
	}

	var snapshotRecord persistence.CapabilityReadinessSnapshot
	if err := tx.Where(
		"snapshot_id = ? AND ptid = ? AND agent_id = ?",
		snapshotID,
		proposal.ActorID,
		proposal.AgentID,
	).First(&snapshotRecord).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidToolState("capability readiness snapshot is missing")
		}
		return nil, internalToolError("load readiness snapshot for tool dispatch", err)
	}
	if !snapshotRecord.ExpiresAt.After(now) {
		return nil, invalidToolState("capability readiness snapshot has expired")
	}
	sum := sha256.Sum256(snapshotRecord.Payload)
	if !strings.EqualFold(snapshotRecord.PayloadHash, hex.EncodeToString(sum[:])) {
		return nil, invalidToolState("capability readiness snapshot payload hash mismatch")
	}
	var snapshot model.CapabilityReadinessSnapshot
	if err := proto.Unmarshal(snapshotRecord.Payload, &snapshot); err != nil {
		return nil, internalToolError("decode readiness snapshot for tool dispatch", err)
	}
	if snapshot.GetSnapshotId() != snapshotID ||
		snapshot.GetPtid() != proposal.ActorID ||
		snapshot.GetAgentId() != proposal.AgentID {
		return nil, invalidToolState("capability readiness snapshot authority mismatch")
	}
	if snapshot.GetExpiresAt() == nil ||
		!snapshot.GetExpiresAt().AsTime().Equal(snapshotRecord.ExpiresAt) ||
		!snapshot.GetExpiresAt().AsTime().After(now) {
		return nil, invalidToolState("capability readiness snapshot expiry mismatch")
	}
	if selected := snapshot.GetSelectedClientSessionId(); selected != "" && selected != proposal.ClientCapabilitySessionID {
		return nil, invalidToolState("capability readiness selected client session is stale")
	}

	ready := false
	for _, capability := range snapshot.GetCapabilities() {
		if capability.GetCapabilityId() == binding.CapabilityID &&
			capability.GetCapabilityVersion() == binding.CapabilityVersion &&
			capability.GetBindingId() == binding.BindingID &&
			capability.GetBindingRevision() == binding.Revision {
			ready = capability.GetState() ==
				model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY
			break
		}
	}
	if !ready {
		return nil, invalidToolState("capability is not ready in the selected snapshot")
	}

	policy, err := toolPolicyFromCapabilityBinding(
		model.CapabilityApprovalPolicy(binding.ApprovalPolicy),
	)
	if err != nil {
		return nil, err
	}
	return &toolCapabilityAuthorization{
		ManifestID:          manifest.CapabilityID,
		ManifestVersion:     manifest.Version,
		BindingID:           binding.BindingID,
		BindingRevision:     binding.Revision,
		ReadinessSnapshotID: snapshotID,
		ExecutionOwner:      executionOwner,
		Risk:                ToolRiskLevel(manifest.RiskClass),
		Policy:              policy,
	}, nil
}

func toolExecutionOwnerStorageValue(owner model.ToolExecutionOwner) string {
	switch owner {
	case model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION:
		return persistence.ToolOwnerStation
	case model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY:
		return persistence.ToolOwnerClientCapability
	default:
		return persistence.ToolOwnerUnspecified
	}
}

func toolPolicyFromCapabilityBinding(
	policy model.CapabilityApprovalPolicy,
) (ToolPolicy, error) {
	switch policy {
	case model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_ALLOW_LIST:
		return ToolPolicyAuto, nil
	case model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL:
		return ToolPolicyManual, nil
	case model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_DENY:
		return ToolPolicyDeny, nil
	default:
		return "", invalidToolState("capability binding approval policy is invalid")
	}
}

func (s *ToolDispatchService) dispatchCallTx(
	tx *gorm.DB,
	call *persistence.ToolCall,
	now time.Time,
) error {
	var leaseRow persistence.ClientCapabilityLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("session_id = ? AND actor_id = ? AND device_id = ? AND revoked_at IS NULL AND expires_at > ?",
			call.CapabilitySessionID,
			call.ActorID,
			call.TargetDeviceID,
			now,
		).
		First(&leaseRow).Error; err != nil {
		return notFoundToolError("active capability lease", err)
	}
	var lease model.ClientCapabilityLease
	if err := proto.Unmarshal(leaseRow.LeasePayload, &lease); err != nil {
		return internalToolError("decode capability lease", err)
	}
	if !leaseAllowsCapability(&lease, call.CapabilityID, call.SchemaVersion, len(call.BoundedArguments)) {
		return unauthorizedToolRequest("capability lease does not authorize request")
	}

	call.ExecutionClaimID = generateID("execution_claim")
	return s.issueCapabilityRequestTx(
		tx,
		call,
		&leaseRow,
		now,
		persistence.ToolCallStatusApproved,
		call.FencingToken,
		"",
	)
}

func (s *ToolDispatchService) issueCapabilityRequestTx(
	tx *gorm.DB,
	call *persistence.ToolCall,
	leaseRow *persistence.ClientCapabilityLease,
	now time.Time,
	expectedStatus string,
	expectedFence uint64,
	previousCredentialID string,
) error {
	if strings.TrimSpace(call.ExecutionClaimID) == "" {
		return invalidToolState("tool execution claim is required")
	}
	var lease model.ClientCapabilityLease
	if err := proto.Unmarshal(leaseRow.LeasePayload, &lease); err != nil {
		return internalToolError("decode capability lease", err)
	}
	if !leaseAllowsCapability(&lease, call.CapabilityID, call.SchemaVersion, len(call.BoundedArguments)) {
		return unauthorizedToolRequest("capability lease does not authorize request")
	}
	if call.ExecutionDeadline == nil || call.ReconciliationDeadline == nil {
		return invalidToolState("tool execution deadlines are not configured")
	}

	if previousCredentialID != "" {
		invalidated := tx.Model(&persistence.ReceiptRecoveryCredential{}).
			Where(
				"id = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?",
				previousCredentialID,
				now,
			).
			Update("invalidated_at", now)
		if invalidated.Error != nil {
			return internalToolError("invalidate previous receipt recovery credential", invalidated.Error)
		}
		if invalidated.RowsAffected != 1 {
			return invalidToolState("previous receipt recovery credential is unavailable")
		}
	}

	leaseRow.DispatchSequence++
	sequenceUpdate := tx.Model(&persistence.ClientCapabilityLease{}).
		Where(
			"session_id = ? AND lease_revision = ? AND dispatch_sequence = ? "+
				"AND revoked_at IS NULL AND expires_at > ?",
			leaseRow.SessionID,
			leaseRow.LeaseRevision,
			leaseRow.DispatchSequence-1,
			now,
		).
		Updates(map[string]interface{}{
			"dispatch_sequence": leaseRow.DispatchSequence,
			"updated_at":        now,
		})
	if sequenceUpdate.Error != nil {
		return internalToolError("advance capability dispatch sequence", sequenceUpdate.Error)
	}
	if sequenceUpdate.RowsAffected != 1 {
		return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "capability dispatch sequence changed", nil)
	}
	call.CapabilitySessionID = leaseRow.SessionID
	call.TargetDeviceID = leaseRow.DeviceID
	call.ExecutorLeaseID = leaseRow.LeaseID
	call.CapabilityLeaseRevision = leaseRow.LeaseRevision
	call.FencingToken++
	call.DispatchSequence = leaseRow.DispatchSequence

	resourceRefs := &model.ClientCapabilityRequest{}
	if len(call.ResourceRefs) > 0 {
		if err := proto.Unmarshal(call.ResourceRefs, resourceRefs); err != nil {
			return internalToolError("decode client resource references", err)
		}
	}
	envelope := &model.ClientCapabilityRequest{
		RequestId:               generateID("capability_request"),
		TurnId:                  call.TurnID,
		ToolCallId:              call.ToolCallID,
		CapabilitySessionId:     call.CapabilitySessionID,
		CapabilityId:            call.CapabilityID,
		SchemaVersion:           call.SchemaVersion,
		ResourceRefs:            resourceRefs.GetResourceRefs(),
		BoundedArguments:        append([]byte(nil), call.BoundedArguments...),
		ApprovalId:              call.ApprovalID,
		Sequence:                call.DispatchSequence,
		AttemptId:               call.AttemptID,
		TargetDeviceId:          call.TargetDeviceID,
		DecisionId:              call.DecisionID,
		DecisionRevision:        call.DecisionRevision,
		ExecutionClaimId:        call.ExecutionClaimID,
		ExecutorLeaseId:         call.ExecutorLeaseID,
		FencingToken:            call.FencingToken,
		DispatchSequence:        call.DispatchSequence,
		ExecutionDeadline:       timestamppb.New(call.ExecutionDeadline.UTC()),
		ToolBatchId:             call.ToolBatchID,
		ReplayPolicy:            model.ClientExecutionReplayPolicy(call.ReplayPolicy),
		ExternalIdempotencyKey:  call.ExternalIdempotencyKey,
		ReconciliationDeadline:  timestamppb.New(call.ReconciliationDeadline.UTC()),
		CapabilityLeaseRevision: call.CapabilityLeaseRevision,
	}
	envelope.PayloadHash = protoPayloadHash(envelope)
	nonce := make([]byte, clientCapabilityCommandNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return internalToolError("generate receipt recovery nonce", err)
	}
	credentialID := generateID("receipt_recovery")
	scope := &model.ReceiptRecoveryScopePayload{
		ActorPtid:               call.ActorID,
		DeviceId:                call.TargetDeviceID,
		RequestId:               envelope.GetRequestId(),
		ToolCallId:              call.ToolCallID,
		ExecutionClaimId:        call.ExecutionClaimID,
		CapabilityLeaseRevision: call.CapabilityLeaseRevision,
		FencingToken:            call.FencingToken,
		PayloadHash:             envelope.GetPayloadHash(),
		ReplayPolicy:            envelope.GetReplayPolicy(),
		ExecutionDeadline:       envelope.GetExecutionDeadline(),
		ReconciliationDeadline:  envelope.GetReconciliationDeadline(),
		CredentialId:            credentialID,
		DeviceSigningKeyId:      leaseRow.DeviceSigningKeyID,
		Nonce:                   nonce,
	}
	scopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(scope)
	if err != nil {
		return internalToolError("encode receipt recovery scope", err)
	}
	scopeHash := hashBytes(scopeBytes)
	envelope.RecoveryCredential = &model.ReceiptRecoveryCredential{
		CredentialId:       credentialID,
		DeviceSigningKeyId: leaseRow.DeviceSigningKeyID,
		Nonce:              nonce,
		ScopeHash:          scopeHash,
		ExpiresAt:          envelope.GetReconciliationDeadline(),
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(envelope)
	if err != nil {
		return internalToolError("encode client capability request", err)
	}

	outbox := &persistence.ToolDispatchOutbox{
		RequestID:               envelope.GetRequestId(),
		ActorID:                 call.ActorID,
		CapabilitySessionID:     call.CapabilitySessionID,
		TargetDeviceID:          call.TargetDeviceID,
		DispatchSequence:        call.DispatchSequence,
		ToolCallID:              call.ToolCallID,
		FencingToken:            call.FencingToken,
		CapabilityLeaseRevision: call.CapabilityLeaseRevision,
		PayloadHash:             envelope.GetPayloadHash(),
		Envelope:                encoded,
		ExecutionDeadline:       call.ExecutionDeadline.UTC(),
		ReconciliationDeadline:  call.ReconciliationDeadline.UTC(),
		CreatedAt:               now,
	}
	if err := tx.Create(outbox).Error; err != nil {
		return internalToolError("persist targeted capability request", err)
	}
	recovery := &persistence.ReceiptRecoveryCredential{
		ID:                      credentialID,
		ActorID:                 call.ActorID,
		DeviceID:                call.TargetDeviceID,
		DeviceSigningKeyID:      leaseRow.DeviceSigningKeyID,
		RequestID:               envelope.GetRequestId(),
		ToolCallID:              call.ToolCallID,
		ExecutionClaimID:        call.ExecutionClaimID,
		CapabilityLeaseRevision: call.CapabilityLeaseRevision,
		FencingToken:            call.FencingToken,
		PayloadHash:             envelope.GetPayloadHash(),
		ReplayPolicy:            call.ReplayPolicy,
		ExecutionDeadline:       call.ExecutionDeadline.UTC(),
		ReconciliationDeadline:  call.ReconciliationDeadline.UTC(),
		ScopeHash:               scopeHash,
		NonceHash:               hashBytes(nonce),
		IssuedAt:                now,
		ExpiresAt:               call.ReconciliationDeadline.UTC(),
	}
	if err := tx.Create(recovery).Error; err != nil {
		return internalToolError("persist receipt recovery credential", err)
	}
	query := tx.Model(&persistence.ToolCall{}).
		Where(
			"id = ? AND status = ? AND fencing_token = ? AND result_persisted = ? "+
				"AND execution_deadline > ? AND reconciliation_deadline > ?",
			call.ID,
			expectedStatus,
			expectedFence,
			false,
			now,
			now,
		)
	if previousCredentialID != "" {
		query = query.Where("receipt_recovery_credential_id = ?", previousCredentialID)
	}
	result := query.
		Updates(map[string]interface{}{
			"status":                         persistence.ToolCallStatusDispatchCommitted,
			"capability_session_id":          call.CapabilitySessionID,
			"target_device_id":               call.TargetDeviceID,
			"execution_claim_id":             call.ExecutionClaimID,
			"executor_lease_id":              call.ExecutorLeaseID,
			"fencing_token":                  call.FencingToken,
			"dispatch_sequence":              call.DispatchSequence,
			"dispatch_committed_at":          now,
			"payload_hash":                   envelope.GetPayloadHash(),
			"capability_lease_revision":      call.CapabilityLeaseRevision,
			"receipt_recovery_credential_id": credentialID,
			"execution_attempt_count":        gorm.Expr("execution_attempt_count + ?", 1),
			"side_effect_receipt":            "",
			"started_at":                     nil,
			"updated_at":                     now,
		})
	if result.Error != nil {
		return internalToolError("commit tool dispatch", result.Error)
	}
	if result.RowsAffected != 1 {
		return invalidToolState("tool dispatch state changed")
	}
	call.Status = persistence.ToolCallStatusDispatchCommitted
	call.DispatchCommittedAt = &now
	call.PayloadHash = envelope.GetPayloadHash()
	call.ReceiptRecoveryCredentialID = credentialID
	call.ExecutionAttemptCount++
	call.SideEffectReceipt = ""
	call.StartedAt = nil
	return nil
}

func (s *ToolDispatchService) commitTerminalReceiptTx(
	tx *gorm.DB,
	call *persistence.ToolCall,
	receipt *model.ClientCapabilityReceipt,
	now time.Time,
	response *model.SubmitClientCapabilityReceiptResponse,
) error {
	resultHash := terminalResultHash(receipt)
	var existing persistence.ToolResult
	err := tx.Where("tool_call_id = ?", call.ToolCallID).First(&existing).Error
	if err == nil {
		if existing.ID != receipt.GetResultId() || existing.PayloadHash != resultHash {
			response.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_PAYLOAD_CONFLICT
			return nil
		}
		response.Accepted = true
		response.Replayed = true
		response.ResultId = existing.ID
		response.ContinuationId = continuationIDForBatch(tx, call.ToolBatchID)
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return internalToolError("load existing tool result", err)
	}

	status := persistence.ToolCallStatusFailed
	resultStatus := persistence.ToolReceiptStatusFailed
	switch receipt.GetStatus() {
	case model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED:
		status = persistence.ToolCallStatusSucceeded
		resultStatus = persistence.ToolReceiptStatusApplied
	case model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_RECONCILED_UNKNOWN:
		status = persistence.ToolCallStatusUnknownSideEffect
		resultStatus = persistence.ToolReceiptStatusReconciledUnknown
	}
	commit, err := commitNewToolResultTx(
		tx,
		call,
		toolTerminalResult{
			ID:            receipt.GetResultId(),
			Status:        resultStatus,
			CallStatus:    status,
			PayloadHash:   resultHash,
			BoundedResult: append([]byte(nil), receipt.GetBoundedResult()...),
			ErrorCode:     receipt.GetErrorCode(),
		},
		now,
	)
	if err != nil {
		return err
	}
	response.Accepted = true
	response.ResultId = commit.ResultID
	response.ContinuationId = commit.ContinuationID
	return nil
}

type toolTerminalResult struct {
	ID            string
	Status        string
	CallStatus    string
	PayloadHash   string
	BoundedResult []byte
	ErrorCode     string
}

type toolResultCommit struct {
	ResultID       string
	ContinuationID string
}

func commitNewToolResultTx(
	tx *gorm.DB,
	call *persistence.ToolCall,
	terminal toolTerminalResult,
	now time.Time,
) (*toolResultCommit, error) {
	var batch persistence.ToolBatch
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", call.ToolBatchID).
		First(&batch).Error; err != nil {
		return nil, internalToolError("load tool batch", err)
	}

	resultContent := string(terminal.BoundedResult)
	if terminal.Status != persistence.ToolReceiptStatusApplied &&
		strings.TrimSpace(resultContent) == "" {
		resultContent = terminal.ErrorCode
	}
	toolMessage := fmt.Sprintf("[%s] %s", call.ToolName, resultContent)
	messageSequence, err := nextMessageSeqTx(tx, batch.ConversationID)
	if err != nil {
		return nil, internalToolError("allocate tool result message sequence", err)
	}
	messageID := generateID("msg")
	turnID := call.TurnID
	modelName := batch.Model
	metadataJSON, err := json.Marshal(map[string]string{
		"tool_call_id": call.ToolCallID,
	})
	if err != nil {
		return nil, internalToolError("encode tool result message metadata", err)
	}
	message := &persistence.AgentMessage{
		ID:             messageID,
		ConversationID: batch.ConversationID,
		TurnID:         &turnID,
		ModelName:      &modelName,
		Role:           string(domain.MessageRoleTool),
		Status:         "completed",
		Content:        &toolMessage,
		MetadataJSON:   metadataJSON,
		Seq:            messageSequence,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := tx.Create(message).Error; err != nil {
		return nil, internalToolError("persist tool result message", err)
	}
	result := &persistence.ToolResult{
		ID:            terminal.ID,
		ToolCallID:    call.ToolCallID,
		MessageID:     messageID,
		ToolBatchID:   call.ToolBatchID,
		TurnID:        call.TurnID,
		AttemptID:     call.AttemptID,
		Status:        terminal.Status,
		PayloadHash:   terminal.PayloadHash,
		BoundedResult: append([]byte(nil), terminal.BoundedResult...),
		ErrorCode:     terminal.ErrorCode,
		CreatedAt:     now,
	}
	if err := tx.Create(result).Error; err != nil {
		return nil, internalToolError("persist tool result", err)
	}
	continuationEligible := call.Status == persistence.ToolCallStatusPrepared &&
		batch.Status == persistence.ToolBatchStatusOpen
	updates := map[string]interface{}{
		"result_id":        result.ID,
		"result_ref":       truncateResult(string(terminal.BoundedResult)),
		"error_code":       terminal.ErrorCode,
		"result_persisted": true,
		"ended_at":         now,
		"updated_at":       now,
	}
	if call.Status == persistence.ToolCallStatusPrepared {
		updates["status"] = terminal.CallStatus
	}
	updateResult := tx.Model(&persistence.ToolCall{}).
		Where("id = ? AND result_persisted = ?", call.ID, false).
		Updates(updates)
	if updateResult.Error != nil {
		return nil, internalToolError("commit terminal tool state", updateResult.Error)
	}
	if updateResult.RowsAffected != 1 {
		return nil, invalidToolState("terminal tool result target changed")
	}
	if !continuationEligible {
		return &toolResultCommit{ResultID: result.ID}, nil
	}

	batch.TerminalCallCount++
	if terminal.Status == persistence.ToolReceiptStatusApplied {
		batch.AppliedCallCount++
	}
	batch.UpdatedAt = now
	commit := &toolResultCommit{ResultID: result.ID}
	if terminal.Status != persistence.ToolReceiptStatusApplied {
		batch.Status = persistence.ToolBatchStatusBlocked
		batch.SettledAt = &now
	} else if batch.TerminalCallCount == batch.ExpectedCallCount &&
		batch.AppliedCallCount == batch.ExpectedCallCount {
		batch.Status = persistence.ToolBatchStatusReadyForContinuation
		batch.SettledAt = &now
		continuation := &persistence.ToolContinuation{
			ID:          generateID("tool_continuation"),
			TurnID:      batch.TurnID,
			AttemptID:   batch.AttemptID,
			ToolBatchID: batch.ID,
			Status:      persistence.ToolContinuationStatusReady,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := tx.Create(continuation).Error; err != nil {
			return nil, internalToolError("persist tool batch continuation", err)
		}
		commit.ContinuationID = continuation.ID
	}
	if err := tx.Save(&batch).Error; err != nil {
		return nil, internalToolError("settle tool batch", err)
	}
	return commit, nil
}

func validateToolBatchProposal(proposal ToolBatchProposal) error {
	if strings.TrimSpace(proposal.ActorID) == "" ||
		strings.TrimSpace(proposal.TurnID) == "" ||
		strings.TrimSpace(proposal.AttemptID) == "" ||
		strings.TrimSpace(proposal.ToolBatchID) == "" ||
		strings.TrimSpace(proposal.AgentID) == "" ||
		strings.TrimSpace(proposal.ReadinessSnapshotID) == "" ||
		len(proposal.Calls) == 0 {
		return invalidToolRequest(
			"actor, turn, attempt, batch, agent, readiness snapshot, and calls are required",
		)
	}
	for _, call := range proposal.Calls {
		if strings.TrimSpace(call.ToolCallID) == "" ||
			strings.TrimSpace(call.ToolName) == "" ||
			strings.TrimSpace(call.CapabilityID) == "" ||
			strings.TrimSpace(call.SchemaVersion) == "" ||
			strings.TrimSpace(call.BindingID) == "" ||
			call.BindingRevision == 0 ||
			call.ExecutionOwner ==
				model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_UNSPECIFIED {
			return invalidToolRequest(
				"tool call identity, capability, binding lineage, execution owner, and schema are required",
			)
		}
	}
	return nil
}

func validateDecisionRequest(actorID string, request *model.SubmitToolApprovalDecisionRequest) error {
	if request == nil ||
		strings.TrimSpace(actorID) == "" ||
		strings.TrimSpace(request.GetApprovalId()) == "" ||
		strings.TrimSpace(request.GetToolCallId()) == "" ||
		strings.TrimSpace(request.GetDecisionId()) == "" ||
		strings.TrimSpace(request.GetIdempotencyKey()) == "" ||
		strings.TrimSpace(request.GetPayloadHash()) == "" {
		return invalidToolRequest("complete tool decision identity is required")
	}
	return nil
}

func validateCapabilityCall(lease *model.ClientCapabilityLease, call AuthorizedToolProposal) error {
	if !leaseAllowsCapability(lease, call.CapabilityID, call.SchemaVersion, len(call.Arguments)) {
		return unauthorizedToolRequest("client capability is unavailable or request exceeds its bound")
	}
	for _, ref := range call.ResourceRefs {
		if ref == nil ||
			ref.GetResourceRef() == "" ||
			ref.GetPtid() != lease.GetPtid() ||
			ref.GetDeviceId() != lease.GetDeviceId() ||
			ref.GetCapabilitySessionId() != lease.GetCapabilitySessionId() ||
			ref.GetCapabilityId() != call.CapabilityID {
			return unauthorizedToolRequest("client resource reference is not bound to the selected lease")
		}
	}
	return nil
}

func leaseAllowsCapability(
	lease *model.ClientCapabilityLease,
	capabilityID string,
	schemaVersion string,
	requestBytes int,
) bool {
	for _, capability := range lease.GetCapabilities() {
		if capability.GetCapabilityId() != capabilityID ||
			capability.GetSchemaVersion() != schemaVersion ||
			capability.GetPermission() != model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED {
			continue
		}
		if constraints := capability.GetConstraints(); constraints != nil &&
			constraints.GetMaxRequestBytes() > 0 &&
			uint64(requestBytes) > constraints.GetMaxRequestBytes() {
			return false
		}
		return true
	}
	return false
}

func loadActiveCapabilityLeaseTx(
	tx *gorm.DB,
	actorID string,
	sessionID string,
	now time.Time,
) (*model.ClientCapabilityLease, error) {
	var row persistence.ClientCapabilityLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("session_id = ? AND actor_id = ? AND revoked_at IS NULL AND expires_at > ?", sessionID, actorID, now).
		First(&row).Error; err != nil {
		return nil, notFoundToolError("active capability lease", err)
	}
	var lease model.ClientCapabilityLease
	if err := proto.Unmarshal(row.LeasePayload, &lease); err != nil {
		return nil, internalToolError("decode capability lease", err)
	}
	return &lease, nil
}

func loadDecisionReplayTx(
	tx *gorm.DB,
	actorID string,
	idempotencyKey string,
	payloadHash string,
) (*model.SubmitToolApprovalDecisionResponse, bool, error) {
	var command persistence.ToolDecisionCommand
	err := tx.Where("actor_id = ? AND idempotency_key = ?", actorID, idempotencyKey).First(&command).Error
	if err == gorm.ErrRecordNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, internalToolError("load tool decision replay", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, false, idempotencyToolError("decision idempotency key payload mismatch")
	}
	if err := tx.Model(&persistence.ToolCall{}).
		Where("actor_id = ? AND tool_call_id = ?", actorID, command.ToolCallID).
		UpdateColumn(
			"duplicate_delivery_count",
			gorm.Expr("duplicate_delivery_count + ?", 1),
		).Error; err != nil {
		return nil, false, internalToolError("record duplicate tool decision", err)
	}
	var response model.SubmitToolApprovalDecisionResponse
	if err := proto.Unmarshal(command.Acknowledgement, &response); err != nil {
		return nil, false, internalToolError("decode tool decision replay", err)
	}
	return &response, true, nil
}

func loadReceiptReplayTx(
	tx *gorm.DB,
	receipt *model.ClientCapabilityReceipt,
	receiptHash string,
) (*model.SubmitClientCapabilityReceiptResponse, bool, error) {
	var row persistence.ToolReceiptAttempt
	err := tx.Where("request_id = ? AND sequence = ?", receipt.GetRequestId(), receipt.GetSequence()).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, internalToolError("load client capability receipt replay", err)
	}
	if row.ReceiptHash != receiptHash {
		return nil, false, idempotencyToolError("receipt sequence payload mismatch")
	}
	if err := tx.Model(&persistence.ToolCall{}).
		Where("tool_call_id = ?", row.ToolCallID).
		UpdateColumn(
			"duplicate_delivery_count",
			gorm.Expr("duplicate_delivery_count + ?", 1),
		).Error; err != nil {
		return nil, false, internalToolError("record duplicate tool receipt", err)
	}
	response := &model.SubmitClientCapabilityReceiptResponse{
		Accepted: row.Accepted,
		Replayed: true,
		ResultId: row.ResultID,
	}
	if row.RejectionCode != "" {
		response.ErrorCode = receiptErrorCode(row.RejectionCode)
	}
	if row.ResultID != "" {
		var result persistence.ToolResult
		if err := tx.Where("id = ?", row.ResultID).First(&result).Error; err == nil {
			response.ContinuationId = continuationIDForBatch(tx, result.ToolBatchID)
		}
	}
	return response, true, nil
}

func storeReceiptAttemptTx(
	tx *gorm.DB,
	receipt *model.ClientCapabilityReceipt,
	receiptHash string,
	accepted bool,
	rejectionCode string,
	now time.Time,
) error {
	occurredAt := now
	if receipt.GetOccurredAt() != nil {
		occurredAt = receipt.GetOccurredAt().AsTime().UTC()
	}
	row := &persistence.ToolReceiptAttempt{
		ID:                  generateID("tool_receipt"),
		RequestID:           receipt.GetRequestId(),
		Sequence:            receipt.GetSequence(),
		ToolCallID:          receipt.GetToolCallId(),
		FencingToken:        receipt.GetFencingToken(),
		Status:              receipt.GetStatus().String(),
		PayloadHash:         receipt.GetPayloadHash(),
		ReceiptHash:         receiptHash,
		ResultID:            receipt.GetResultId(),
		SideEffectReceiptID: receipt.GetSideEffectReceiptId(),
		BoundedResult:       append([]byte(nil), receipt.GetBoundedResult()...),
		ErrorCode:           receipt.GetErrorCode(),
		Accepted:            accepted,
		RejectionCode:       rejectionCode,
		OccurredAt:          occurredAt,
		CreatedAt:           now,
	}
	if err := tx.Create(row).Error; err != nil {
		return internalToolError("persist client capability receipt", err)
	}
	return nil
}

func validateReceiptTuple(
	actorID string,
	deviceID string,
	now time.Time,
	call *persistence.ToolCall,
	outbox *persistence.ToolDispatchOutbox,
	receipt *model.ClientCapabilityReceipt,
) model.ClientCapabilityReceiptErrorCode {
	if outbox.ActorID != actorID ||
		call.ActorID != actorID ||
		outbox.ToolCallID != call.ToolCallID ||
		outbox.CapabilitySessionID != call.CapabilitySessionID ||
		outbox.TargetDeviceID != deviceID ||
		receipt.GetTargetDeviceId() != deviceID ||
		receipt.GetCapabilitySessionId() != call.CapabilitySessionID ||
		receipt.GetToolBatchId() != call.ToolBatchID ||
		receipt.GetTurnId() != call.TurnID ||
		receipt.GetDecisionId() != call.DecisionID ||
		receipt.GetDecisionRevision() != call.DecisionRevision ||
		receipt.GetExecutionClaimId() != call.ExecutionClaimID ||
		receipt.GetExecutorLeaseId() != call.ExecutorLeaseID ||
		receipt.GetDispatchSequence() != call.DispatchSequence {
		return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH
	}
	if receipt.GetFencingToken() != call.FencingToken {
		return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_STALE_FENCE
	}
	if receipt.GetPayloadHash() != call.PayloadHash || receipt.GetPayloadHash() != outbox.PayloadHash {
		return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_PAYLOAD_CONFLICT
	}
	if call.CapabilityLeaseRevision != outbox.CapabilityLeaseRevision ||
		call.ExecutionDeadline == nil ||
		!call.ExecutionDeadline.After(now) ||
		!outbox.ExecutionDeadline.After(now) {
		return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_EXPIRED
	}
	return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_UNSPECIFIED
}

func blockToolBatchTx(tx *gorm.DB, batchID string, now time.Time) error {
	return tx.Model(&persistence.ToolBatch{}).
		Where("id = ? AND status = ?", batchID, persistence.ToolBatchStatusOpen).
		Updates(map[string]interface{}{
			"status":     persistence.ToolBatchStatusBlocked,
			"settled_at": now,
			"updated_at": now,
		}).Error
}

func continuationIDForBatch(tx *gorm.DB, batchID string) string {
	var continuation persistence.ToolContinuation
	if err := tx.Select("id").Where("tool_batch_id = ?", batchID).First(&continuation).Error; err != nil {
		return ""
	}
	return continuation.ID
}

func decisionPayloadHash(request *model.SubmitToolApprovalDecisionRequest) string {
	return hashString(fmt.Sprintf(
		"%s\x00%s\x00%s\x00%d\x00%t",
		request.GetApprovalId(),
		request.GetToolCallId(),
		request.GetDecisionId(),
		request.GetExpectedRevision(),
		request.GetApproved(),
	))
}

func policyDecisionPayloadHash(call *persistence.ToolCall) string {
	if call == nil {
		return ""
	}
	return hashString(fmt.Sprintf(
		"%s\x00%s\x00%s\x00%s\x00%d\x00%s\x00%s",
		call.ToolCallID,
		call.ApprovalPolicy,
		call.ManifestID,
		call.ManifestVersion,
		call.BindingRevision,
		call.ReadinessSnapID,
		call.ArgumentsHash,
	))
}

func stationToolExecutionPayloadHash(
	call *persistence.ToolCall,
	fencingToken uint64,
) string {
	if call == nil {
		return ""
	}
	return hashString(fmt.Sprintf(
		"%s\x00%s\x00%s\x00%s\x00%d\x00%s\x00%d\x00%s",
		call.ToolCallID,
		call.ManifestID,
		call.ManifestVersion,
		call.BindingID,
		call.BindingRevision,
		call.ReadinessSnapID,
		fencingToken,
		call.ArgumentsHash,
	))
}

func decisionRejection(
	request *model.SubmitToolApprovalDecisionRequest,
	code model.ToolApprovalDecisionErrorCode,
) *model.SubmitToolApprovalDecisionResponse {
	return &model.SubmitToolApprovalDecisionResponse{
		Accepted:         false,
		DecisionRevision: request.GetExpectedRevision(),
		ApprovalId:       request.GetApprovalId(),
		ToolCallId:       request.GetToolCallId(),
		DecisionId:       request.GetDecisionId(),
		Approved:         request.GetApproved(),
		IdempotencyKey:   request.GetIdempotencyKey(),
		PayloadHash:      request.GetPayloadHash(),
		ErrorCode:        code,
	}
}

func terminalResultHash(receipt *model.ClientCapabilityReceipt) string {
	return hashString(fmt.Sprintf(
		"%s\x00%s\x00%s\x00%x",
		receipt.GetResultId(),
		receipt.GetStatus().String(),
		receipt.GetErrorCode(),
		receipt.GetBoundedResult(),
	))
}

func protoPayloadHash(message proto.Message) string {
	cloned := proto.Clone(message)
	switch value := cloned.(type) {
	case *model.ClientCapabilityRequest:
		value.PayloadHash = ""
		value.RecoveryCredential = nil
	}
	encoded, _ := proto.MarshalOptions{Deterministic: true}.Marshal(cloned)
	return hashBytes(encoded)
}

func receiptErrorCode(value string) model.ClientCapabilityReceiptErrorCode {
	if number, ok := model.ClientCapabilityReceiptErrorCode_value[value]; ok {
		return model.ClientCapabilityReceiptErrorCode(number)
	}
	return model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_UNSPECIFIED
}

func redactArguments(args string) string {
	return redactDiagnosticText(args)
}

func truncateResult(value string) string {
	const maxLen = 10000
	if len(value) > maxLen {
		return value[:maxLen] + "\n...[truncated]"
	}
	return value
}

func hashString(data string) string {
	return hashBytes([]byte(data))
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func invalidToolRequest(message string) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, message, nil)
}

func unauthorizedToolRequest(message string) error {
	return errcode.New(errcode.AgentUnauthorized, http.StatusForbidden, message, nil)
}

func idempotencyToolError(message string) error {
	return errcode.New(errcode.AgentIdempotencyConflict, http.StatusConflict, message, nil)
}

func invalidToolState(message string) error {
	return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, message, nil)
}

func notFoundToolError(entity string, cause error) error {
	return errcode.New(errcode.AgentNotFound, http.StatusNotFound, entity+" not found", cause)
}

func internalToolError(operation string, cause error) error {
	return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, operation, cause)
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") ||
		strings.Contains(message, "duplicate key")
}
