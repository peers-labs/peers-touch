package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

type GateRunner struct {
	checkExecutor GateCheckExecutor
}

type GateCheckExecutor interface {
	ExecuteGateCheck(ctx context.Context, check GateCheck) GateCheckResult
}

type GateCheck struct {
	Name      string
	Type      string
	TypedType model.TaskGateCheckType
	Detail    string
}

type GateCheckResult struct {
	Name   string
	Status string
	Detail string
}

type GateRunRequest struct {
	Task        *persistence.CollaborationTask
	Node        *persistence.CollaborationTaskNode
	ProducedBy  string
	GateID      string
	GatePlanID  string
	Name        string
	GateType    model.TaskGateType
	Evaluator   *model.TaskGateEvaluatorSpec
	Blocking    bool
	ArtifactIDs []string
	Checks      []GateCheck
}

type GatePlanRunRequest struct {
	Task       *persistence.CollaborationTask
	Node       *persistence.CollaborationTaskNode
	ProducedBy string
	Plan       *model.TaskGatePlan
}

type GateRunResult struct {
	Event    collaborationProjectionEvent
	Decision nodeResultGateDecision
	Gate     *model.TaskGateResult
	Payload  map[string]interface{}
}

func NewGateRunner(executor GateCheckExecutor) *GateRunner {
	if executor == nil {
		executor = deterministicGateCheckExecutor{}
	}
	return &GateRunner{checkExecutor: executor}
}

func GatePlanFromPersistence(record persistence.TaskGatePlan) (*model.TaskGatePlan, error) {
	plan := &model.TaskGatePlan{}
	if strings.TrimSpace(record.PlanJSON) != "" {
		if err := protojson.Unmarshal([]byte(record.PlanJSON), plan); err != nil {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate plan plan_json is invalid", err)
		}
	}
	if plan.GetGatePlanId() == "" {
		plan.GatePlanId = record.GatePlanID
	}
	if plan.GetTaskId() == "" {
		plan.TaskId = record.TaskID
	}
	if plan.GetStepId() == "" {
		plan.StepId = record.StepID
	}
	if plan.GetSource() == "" {
		plan.Source = record.Source
	}
	if plan.GetStatus() == "" {
		plan.Status = record.Status
	}
	return plan, nil
}

func (r *GateRunner) RunPlan(ctx context.Context, req GatePlanRunRequest) ([]GateRunResult, error) {
	if req.Plan == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate plan is required", nil)
	}
	if req.Task == nil || req.Node == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate plan task and node are required", nil)
	}
	if taskID := strings.TrimSpace(req.Plan.GetTaskId()); taskID != "" && taskID != strings.TrimSpace(req.Task.ID) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate plan task_id does not match task", nil)
	}
	if stepID := strings.TrimSpace(req.Plan.GetStepId()); stepID != "" && stepID != strings.TrimSpace(req.Node.ID) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate plan step_id does not match node", nil)
	}
	results := make([]GateRunResult, 0, len(req.Plan.GetGates()))
	for _, gate := range req.Plan.GetGates() {
		runReq, err := gateRunRequestFromSpec(req.Task, req.Node, req.ProducedBy, req.Plan.GetGatePlanId(), gate)
		if err != nil {
			return nil, err
		}
		result, err := r.Run(ctx, runReq)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}

func (r *GateRunner) Run(ctx context.Context, req GateRunRequest) (GateRunResult, error) {
	if r == nil {
		r = NewGateRunner(nil)
	}
	if req.Task == nil || req.Node == nil {
		return GateRunResult{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate runner task and node are required", nil)
	}
	taskID := strings.TrimSpace(req.Task.ID)
	nodeID := strings.TrimSpace(req.Node.ID)
	if taskID == "" || nodeID == "" {
		return GateRunResult{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate runner task_id and node_id are required", nil)
	}
	gateID := strings.TrimSpace(req.GateID)
	if gateID == "" {
		gateID = fmt.Sprintf("%s-%s-gate", taskID, nodeID)
	}
	gateName := strings.TrimSpace(req.Name)
	if gateName == "" {
		gateName = "Station GateRunner"
	}

	checks := make([]*model.TaskGateCheck, 0, len(req.Checks))
	overallStatus := "passed"
	for _, check := range req.Checks {
		result := r.checkExecutor.ExecuteGateCheck(ctx, check)
		status := normalizeGateStatus(result.Status)
		if status == "" {
			status = "failed"
		}
		if status != "passed" {
			overallStatus = "failed"
		}
		checks = append(checks, &model.TaskGateCheck{
			Name:   firstNonEmptyString(result.Name, check.Name, gateCheckTypeName(check.TypedType), check.Type),
			Status: status,
			Detail: strings.TrimSpace(firstNonEmptyString(result.Detail, check.Detail)),
		})
	}
	if len(req.Checks) == 0 {
		checks = append(checks, &model.TaskGateCheck{
			Name:   "no_checks",
			Status: "passed",
			Detail: "No deterministic checks configured.",
		})
	}

	gate := &model.TaskGateResult{
		GateId:      gateID,
		GatePlanId:  strings.TrimSpace(req.GatePlanID),
		Name:        gateName,
		Status:      overallStatus,
		Summary:     gateRunSummary(gateName, overallStatus),
		ArtifactIds: compactStringSlice(req.ArtifactIDs),
		Blocking:    req.Blocking,
		Checks:      checks,
	}
	payloads := nodeResultGatePayloads([]*model.TaskGateResult{gate})
	payload := map[string]interface{}{}
	if len(payloads) > 0 {
		payload = payloads[0]
	}
	payload["block_kind"] = "gate_result"
	payload["source"] = "station.gate_runner"
	payload["task_id"] = taskID
	payload["node_id"] = nodeID
	if producedBy := strings.TrimSpace(req.ProducedBy); producedBy != "" {
		payload["produced_by"] = producedBy
	}
	addGateRunnerTypedMetadata(payload, req.GateType, req.Evaluator)
	if err := validateNodeResultGatePayload(payload); err != nil {
		return GateRunResult{}, err
	}

	decision := gateDecisionFromPayload(payload)
	return GateRunResult{
		Event: collaborationProjectionEvent{
			EventType: domain.EventTypeCollaborationGateResult,
			Payload:   payload,
		},
		Decision: decision,
		Gate:     gate,
		Payload:  payload,
	}, nil
}

func (r *GateRunner) RunAndAppendTx(
	ctx context.Context,
	tx *gorm.DB,
	writer *TaskEventWriter,
	agentID string,
	req GateRunRequest,
) (committedTaskEvent, nodeResultGateDecision, error) {
	result, err := r.Run(ctx, req)
	if err != nil {
		return committedTaskEvent{}, nodeResultGateDecision{}, err
	}
	if tx == nil || writer == nil {
		return committedTaskEvent{}, nodeResultGateDecision{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate runner tx and writer are required", nil)
	}
	event, err := appendCommittedTaskEventTx(
		ctx,
		tx,
		writer,
		agentID,
		string(result.Event.EventType),
		result.Event.Payload,
		req.Task.ID,
		req.Node.ID,
	)
	if err != nil {
		return committedTaskEvent{}, nodeResultGateDecision{}, err
	}
	if err := NewAcceptancePredicateEvaluator().EvaluateTaskTx(ctx, tx, req.Task.ID); err != nil {
		return committedTaskEvent{}, nodeResultGateDecision{}, err
	}
	return event, result.Decision, nil
}

type deterministicGateCheckExecutor struct{}

func (deterministicGateCheckExecutor) ExecuteGateCheck(_ context.Context, check GateCheck) GateCheckResult {
	checkType := gateCheckTypeName(check.TypedType)
	if checkType == "" {
		checkType = strings.ToLower(strings.TrimSpace(check.Type))
	}
	status := normalizeGateStatus(checkType)
	if status == "" {
		status = normalizeGateStatus(check.Detail)
	}
	if status == "" {
		switch checkType {
		case "", "schema", "typecheck", "contract-gate":
			status = "passed"
		default:
			status = "failed"
		}
	}
	return GateCheckResult{
		Name:   firstNonEmptyString(check.Name, checkType, "deterministic"),
		Status: status,
		Detail: check.Detail,
	}
}

func addGateRunnerTypedMetadata(payload map[string]interface{}, gateType model.TaskGateType, evaluator *model.TaskGateEvaluatorSpec) {
	if payload == nil {
		return
	}
	if name := gateTypeName(gateType); name != "" {
		payload["gate_type"] = name
	}
	if evaluator == nil {
		return
	}
	if kind := gateEvaluatorKindName(evaluator.GetKind()); kind != "" {
		payload["evaluator_kind"] = kind
	}
	if evaluatorID := strings.TrimSpace(evaluator.GetEvaluatorId()); evaluatorID != "" {
		payload["evaluator_id"] = evaluatorID
	}
	if policyID := strings.TrimSpace(evaluator.GetPolicyId()); policyID != "" {
		payload["policy_id"] = policyID
	}
	if provider := evaluator.GetProvider(); provider != nil {
		if providerID := strings.TrimSpace(provider.GetProviderId()); providerID != "" {
			payload["provider_id"] = providerID
		}
		if modelName := strings.TrimSpace(provider.GetModel()); modelName != "" {
			payload["model"] = modelName
		}
		if effort := strings.TrimSpace(provider.GetReasoningEffort()); effort != "" {
			payload["reasoning_effort"] = effort
		}
		if capabilities := compactStringSlice(provider.GetRequiredCapabilities()); len(capabilities) > 0 {
			payload["provider_capabilities"] = capabilities
		}
	}
	if capabilities := compactStringSlice(evaluator.GetRequiredCapabilities()); len(capabilities) > 0 {
		payload["evaluator_capabilities"] = capabilities
	}
}

func gateTypeName(value model.TaskGateType) string {
	switch value {
	case model.TaskGateType_TASK_GATE_TYPE_ACCEPTANCE:
		return "acceptance"
	case model.TaskGateType_TASK_GATE_TYPE_POLICY:
		return "policy"
	case model.TaskGateType_TASK_GATE_TYPE_CONTRACT:
		return "contract"
	case model.TaskGateType_TASK_GATE_TYPE_QUALITY:
		return "quality"
	case model.TaskGateType_TASK_GATE_TYPE_CUSTOM:
		return "custom"
	default:
		return ""
	}
}

func gateCheckTypeName(value model.TaskGateCheckType) string {
	switch value {
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_SCHEMA:
		return "schema"
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_TYPECHECK:
		return "typecheck"
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_CONTRACT_GATE:
		return "contract-gate"
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_POLICY:
		return "policy"
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_ARTIFACT:
		return "artifact"
	case model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_CUSTOM:
		return "custom"
	default:
		return ""
	}
}

func gateEvaluatorKindName(value model.TaskGateEvaluatorKind) string {
	switch value {
	case model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_DETERMINISTIC:
		return "deterministic"
	case model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_PROVIDER:
		return "provider"
	case model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_HUMAN:
		return "human"
	case model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_POLICY:
		return "policy"
	case model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_CUSTOM:
		return "custom"
	default:
		return ""
	}
}

func normalizeGateStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "passed", "pass", "success", "accepted", "ok":
		return "passed"
	case "failed", "fail", "error", "rejected", "blocked":
		return "failed"
	case "warning", "warn":
		return "warning"
	default:
		return ""
	}
}

func gateRunSummary(name string, status string) string {
	if status == "passed" {
		return fmt.Sprintf("%s passed.", strings.TrimSpace(name))
	}
	return fmt.Sprintf("%s failed.", strings.TrimSpace(name))
}

func compactStringSlice(values []string) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}

func gateRunRequestFromSpec(
	task *persistence.CollaborationTask,
	node *persistence.CollaborationTaskNode,
	producedBy string,
	gatePlanID string,
	spec *model.TaskGateSpec,
) (GateRunRequest, error) {
	if spec == nil {
		return GateRunRequest{}, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate spec is required", nil)
	}
	checks := make([]GateCheck, 0, len(spec.GetChecks()))
	for _, check := range spec.GetChecks() {
		if check == nil {
			continue
		}
		checks = append(checks, GateCheck{
			Name:      firstNonEmptyString(check.GetName(), check.GetCheckId()),
			Type:      check.GetCheckType(),
			TypedType: check.GetTypedCheckType(),
			Detail:    check.GetDetail(),
		})
	}
	return GateRunRequest{
		Task:        task,
		Node:        node,
		ProducedBy:  producedBy,
		GatePlanID:  gatePlanID,
		GateID:      spec.GetGateId(),
		Name:        spec.GetName(),
		GateType:    spec.GetTypedGateType(),
		Evaluator:   spec.GetEvaluatorSpec(),
		Blocking:    spec.GetBlockingLevel() == model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK,
		ArtifactIDs: spec.GetArtifactIds(),
		Checks:      checks,
	}, nil
}
