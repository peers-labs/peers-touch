package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	capabilityAcceptanceEnvironment   = "home-station"
	capabilityAcceptancePrefix        = "acceptance."
	capabilityAcceptanceBindingPrefix = capabilityAcceptancePrefix + "j02."
	capabilityAcceptanceHookTTL       = 2 * time.Minute
	capabilityAcceptanceWaitTimeout   = 2 * time.Minute

	capabilityBarrierBindingAck               = "binding-ack"
	capabilityBarrierManifestAbsent           = "manifest-missing"
	capabilityBarrierVersionStale             = "manifest-version-stale"
	capabilityBarrierDecisionBeforeCommit     = "decision-before-commit"
	capabilityBarrierDecisionBeforeClaim      = "decision-committed-before-claim"
	capabilityBarrierClaimBeforeDelivery      = "claim-outbox-committed-before-delivery"
	capabilityBarrierPreparedBeforeEffect     = "executor-prepared-before-effect"
	capabilityBarrierEffectBeforeApplied      = "executor-effect-before-applied"
	capabilityBarrierAppliedBeforeResult      = "executor-applied-before-result"
	capabilityBarrierResultBeforeContinue     = "result-committed-before-continuation"
	capabilityBarrierCancelResultRace         = "cancel-result-race"
	capabilityBarrierRevokeDispatchRace       = "revoke-dispatch-race"
	capabilityBarrierDeleteDispatchRace       = "binding-delete-dispatch-race"
	capabilityBarrierExecutorBeforeDispatch   = "executor-before-dispatch"
	capabilityBarrierBusinessLeaseTerminal    = "business-lease-before-terminal"
	capabilityBarrierCancelBeforeCleanup      = "cancel-before-cleanup"
	capabilityBarrierDeadlineBeforeTerminal   = "execution-deadline-before-terminal"
	capabilityBarrierDisconnectAfterCreate    = "executor-disconnect-after-creation"
	capabilityBarrierReceiptRecoveryTerminal  = "receipt-recovery-before-terminal"
	capabilityBarrierCleanupLeaseDeadline     = "cleanup-lease-before-deadline"
	capabilityBarrierStaleFenceBeforeEvent    = "stale-fence-before-event"
	capabilityBarrierOperationPrepared        = "operation-prepared-before-effect"
	capabilityBarrierOperationCleanup         = "operation-cleanup-before-settlement"
	capabilityBarrierOperationReconnect       = "operation-timeout-before-reconnect"
	capabilityBarrierConnectorDisconnect      = "connector-disconnect-before-dispatch"
	capabilityBarrierEvaluationSchedulerClaim = "evaluation-scheduler-claim-before-turn"
	capabilityBarrierEvaluationTurnCreated    = "evaluation-turn-created-before-attempt-bind"
	capabilityBarrierEvaluationCompletion     = "evaluation-completion-before-commit"
	capabilityBarrierEvaluationCancel         = "evaluation-cancel-before-commit"
	capabilityBarrierEvaluationRetryCreate    = "evaluation-retry-before-child-create"
	capabilityBarrierEvaluationRetryReturn    = "evaluation-retry-after-child-create"
	capabilityEvaluationCancelDeadline        = "evaluation-cancel-ack-deadline"
)

type capabilityAcceptanceTupleDefinition struct {
	barrier string
}

var capabilityAcceptanceFamilies = map[model.CapabilityAcceptanceScenarioFamily]map[string]capabilityAcceptanceTupleDefinition{
	model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02: {
		"AS-03": {}, "AS-10": {}, "AS-11": {},
		"ERR-CAT01": {barrier: capabilityBarrierManifestAbsent},
		"ERR-CAT02": {barrier: capabilityBarrierVersionStale},
		"ERR-CAT03": {},
		"ERR-B01":   {}, "ERR-B02": {}, "ERR-B03": {},
		"TAX-01": {}, "TAX-02": {barrier: capabilityBarrierBindingAck},
		"TAX-03": {}, "TAX-04": {}, "TAX-05": {
			barrier: capabilityBarrierManifestAbsent,
		}, "TAX-06": {},
	},
	model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03: {
		"AS-05A": {}, "AS-05": {},
		"CR-00":       {barrier: capabilityBarrierDecisionBeforeCommit},
		"CR-01":       {barrier: capabilityBarrierDecisionBeforeClaim},
		"CR-02":       {barrier: capabilityBarrierClaimBeforeDelivery},
		"CR-03":       {barrier: capabilityBarrierPreparedBeforeEffect},
		"CR-04N":      {barrier: capabilityBarrierEffectBeforeApplied},
		"CR-04I":      {barrier: capabilityBarrierEffectBeforeApplied},
		"CR-05":       {barrier: capabilityBarrierAppliedBeforeResult},
		"CR-06":       {barrier: capabilityBarrierResultBeforeContinue},
		"R-03":        {barrier: capabilityBarrierCancelResultRace},
		"R-05":        {barrier: capabilityBarrierRevokeDispatchRace},
		"R-07":        {barrier: capabilityBarrierDeleteDispatchRace},
		"ERR-O01":     {barrier: capabilityBarrierExecutorBeforeDispatch},
		"ERR-O02":     {barrier: capabilityBarrierBusinessLeaseTerminal},
		"ERR-O03":     {barrier: capabilityBarrierCancelBeforeCleanup},
		"ERR-O04":     {barrier: capabilityBarrierDeadlineBeforeTerminal},
		"ERR-O05":     {barrier: capabilityBarrierDisconnectAfterCreate},
		"ERR-O06":     {barrier: capabilityBarrierReceiptRecoveryTerminal},
		"ERR-O07":     {barrier: capabilityBarrierEffectBeforeApplied},
		"ERR-O08":     {barrier: capabilityBarrierStaleFenceBeforeEvent},
		"REPLAY-O07I": {barrier: capabilityBarrierEffectBeforeApplied},
	},
	model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04: {
		"AS-04": {}, "AS-04-UNAVAILABLE": {}, "TAX-04": {},
		"R-01":         {barrier: capabilityBarrierOperationPrepared},
		"R-02":         {barrier: capabilityBarrierOperationCleanup},
		"R-03":         {barrier: capabilityBarrierCancelResultRace},
		"R-04":         {barrier: capabilityBarrierOperationReconnect},
		"ERR-O01":      {barrier: capabilityBarrierExecutorBeforeDispatch},
		"ERR-O02":      {barrier: capabilityBarrierBusinessLeaseTerminal},
		"ERR-O03":      {barrier: capabilityBarrierCancelBeforeCleanup},
		"ERR-O04":      {barrier: capabilityBarrierDeadlineBeforeTerminal},
		"ERR-O05":      {barrier: capabilityBarrierDisconnectAfterCreate},
		"ERR-O06":      {barrier: capabilityBarrierCleanupLeaseDeadline},
		"ERR-O07":      {barrier: capabilityBarrierEffectBeforeApplied},
		"ERR-O08":      {barrier: capabilityBarrierStaleFenceBeforeEvent},
		"AS-15-V2-M01": {},
	},
	model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05: {
		"AS-06":     {},
		"R-06":      {barrier: capabilityBarrierConnectorDisconnect},
		"R-07":      {barrier: capabilityBarrierDeleteDispatchRace},
		"ERR-CON01": {}, "ERR-CON02": {}, "ERR-CON03": {}, "ERR-CON04": {},
		"AS-15-V2-C01": {},
	},
	model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06: {
		"AS-07": {}, "AS-08": {}, "AS-14": {},
		"R-08": {}, "R-09": {}, "R-10": {},
		"ERR-E01": {}, "ERR-E02": {}, "ERR-E03": {}, "ERR-E04": {}, "ERR-E05": {},
		"AS-15-V2-E01": {},
	},
}

var errCapabilityAcceptanceWorkerInterrupted = errors.New(
	"capability acceptance worker generation interrupted",
)

type capabilityAcceptanceScenario struct {
	handle                string
	runID                 string
	scenarioExecutionID   string
	actorPTID             string
	family                model.CapabilityAcceptanceScenarioFamily
	runtimeProfile        model.CapabilityAcceptanceRuntimeProfile
	cell                  string
	platform              string
	locale                string
	ordering              string
	sampleID              string
	capabilityID          string
	requestedVersion      string
	actualVersion         string
	targetDeviceID        string
	capabilitySessionID   string
	toolCallID            string
	operationID           string
	evaluationRunIDs      map[string]struct{}
	resourceIDs           []string
	barrierName           string
	barrierReached        chan struct{}
	barrierReachedOnce    sync.Once
	barrierDecision       chan bool
	barrierEncountered    bool
	hookTicketHash        [sha256.Size]byte
	hookTicketExpiresAt   time.Time
	executorHookArmed     bool
	barrierActionApplied  bool
	executorUnavailable   bool
	clockAdvanced         bool
	scenarioNow           time.Time
	barrierReleased       bool
	workerInterrupted     bool
	interruptionDelivered bool
	cleanupStarted        bool
	cleanup               chan struct{}
	cleanupOnce           sync.Once
	createdAt             time.Time
}

// CapabilityAcceptanceScenarioService owns only run-scoped setup,
// deterministic barriers, and cleanup for the reviewed J02-J06 matrices.
type CapabilityAcceptanceScenarioService struct {
	authority  *CapabilityAuthorityService
	dispatch   *ToolDispatchService
	operations *CapabilityOperationService
	connectors *ConnectorManifestService
	evaluation *EvaluationService
	runID      string
	now        func() time.Time
	mu         sync.RWMutex
	byHandle   map[string]*capabilityAcceptanceScenario
	byExecID   map[string]string
	byCapID    map[string]string
	byActor    map[string]string
	byEvalRun  map[string]string
	cleaned    map[string]*capabilityAcceptanceScenario
}

func NewCapabilityAcceptanceScenarioServiceFromEnvironment(
	authority *CapabilityAuthorityService,
) *CapabilityAcceptanceScenarioService {
	if strings.TrimSpace(os.Getenv("PT_ACCEPTANCE_ENVIRONMENT")) !=
		capabilityAcceptanceEnvironment ||
		strings.TrimSpace(os.Getenv("PT_AGENT_CAPABILITY_SCENARIO_CONTROL")) != "1" {
		return nil
	}
	runID := strings.TrimSpace(os.Getenv("PT_ACCEPTANCE_RUN_ID"))
	if runID == "" {
		return nil
	}
	service := &CapabilityAcceptanceScenarioService{
		authority: authority,
		runID:     runID,
		now:       func() time.Time { return time.Now().UTC() },
		byHandle:  make(map[string]*capabilityAcceptanceScenario),
		byExecID:  make(map[string]string),
		byCapID:   make(map[string]string),
		byActor:   make(map[string]string),
		byEvalRun: make(map[string]string),
		cleaned:   make(map[string]*capabilityAcceptanceScenario),
	}
	authority.SetAcceptanceMutationGuard(service)
	return service
}

func NewCapabilityAcceptanceScenarioService(
	authority *CapabilityAuthorityService,
	runID string,
) *CapabilityAcceptanceScenarioService {
	service := &CapabilityAcceptanceScenarioService{
		authority: authority,
		runID:     strings.TrimSpace(runID),
		now:       func() time.Time { return time.Now().UTC() },
		byHandle:  make(map[string]*capabilityAcceptanceScenario),
		byExecID:  make(map[string]string),
		byCapID:   make(map[string]string),
		byActor:   make(map[string]string),
		byEvalRun: make(map[string]string),
		cleaned:   make(map[string]*capabilityAcceptanceScenario),
	}
	authority.SetAcceptanceMutationGuard(service)
	return service
}

func (s *CapabilityAcceptanceScenarioService) SetToolDispatchService(
	dispatch *ToolDispatchService,
) {
	if s != nil {
		s.dispatch = dispatch
	}
}

func (s *CapabilityAcceptanceScenarioService) SetCapabilityOperationService(
	operations *CapabilityOperationService,
) {
	if s != nil {
		s.operations = operations
	}
}

func (s *CapabilityAcceptanceScenarioService) SetConnectorManifestService(
	connectors *ConnectorManifestService,
) {
	if s != nil {
		s.connectors = connectors
	}
}

func (s *CapabilityAcceptanceScenarioService) SetEvaluationService(
	evaluation *EvaluationService,
) {
	if s != nil {
		s.evaluation = evaluation
	}
}

func (s *CapabilityAcceptanceScenarioService) BindEvaluationRun(
	ptid string,
	runID string,
) error {
	if s == nil {
		return nil
	}
	ptid = strings.TrimSpace(ptid)
	runID = strings.TrimSpace(runID)
	if ptid == "" || runID == "" {
		return capabilityInvalid("evaluation acceptance run identity is incomplete")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	handle := s.byActor[ptid]
	scenario := s.byHandle[handle]
	if scenario == nil ||
		scenario.family !=
			model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06 ||
		scenario.cleanupStarted {
		return nil
	}
	if existing := s.byEvalRun[runID]; existing != "" && existing != handle {
		return capabilityInvalid(
			"evaluation run is already bound to another acceptance scenario",
		)
	}
	scenario.evaluationRunIDs[runID] = struct{}{}
	s.byEvalRun[runID] = handle
	return nil
}

func (s *CapabilityAcceptanceScenarioService) ReachEvaluationBarrier(
	ctx context.Context,
	ptid string,
	runID string,
	barrier string,
) (bool, error) {
	if s == nil {
		return false, nil
	}
	s.mu.Lock()
	handle := s.byEvalRun[strings.TrimSpace(runID)]
	scenario := s.byHandle[handle]
	if scenario == nil ||
		scenario.actorPTID != strings.TrimSpace(ptid) ||
		scenario.family !=
			model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06 ||
		scenario.barrierName != strings.TrimSpace(barrier) ||
		scenario.cleanupStarted ||
		scenario.barrierEncountered {
		s.mu.Unlock()
		return false, nil
	}
	scenario.barrierEncountered = true
	s.mu.Unlock()
	return s.reachBarrier(ctx, scenario)
}

func (s *CapabilityAcceptanceScenarioService) EvaluationTargetInvalid(
	ptid string,
	runID string,
) bool {
	return s.evaluationScenarioMatches(ptid, runID, "ERR-E02", "")
}

func (s *CapabilityAcceptanceScenarioService) EvaluationExecutorUnavailable(
	ptid string,
	runID string,
) bool {
	return s.evaluationScenarioMatches(ptid, runID, "ERR-E05", "")
}

func (s *CapabilityAcceptanceScenarioService) SuppressesEvaluationCancelAck(
	ptid string,
	runID string,
) bool {
	return s.evaluationScenarioMatches(ptid, runID, "R-09", "A")
}

func (s *CapabilityAcceptanceScenarioService) EvaluationNow(
	ptid string,
	runID string,
	fallback time.Time,
) time.Time {
	if s == nil {
		return fallback
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	handle := s.byEvalRun[strings.TrimSpace(runID)]
	scenario := s.byHandle[handle]
	if scenario == nil ||
		scenario.actorPTID != strings.TrimSpace(ptid) ||
		!scenario.clockAdvanced ||
		!scenario.scenarioNow.After(fallback) {
		return fallback
	}
	return scenario.scenarioNow
}

func (s *CapabilityAcceptanceScenarioService) BindCapabilityOperation(
	ptid string,
	operationID string,
	targetDeviceID string,
	capabilitySessionID string,
) error {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil ||
		scenario.family !=
			model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04 ||
		scenario.barrierName == "" {
		return nil
	}
	operationID = strings.TrimSpace(operationID)
	targetDeviceID = strings.TrimSpace(targetDeviceID)
	capabilitySessionID = strings.TrimSpace(capabilitySessionID)
	if targetDeviceID == "" || capabilitySessionID == "" {
		return capabilityInvalid(
			"capability acceptance operation target is incomplete",
		)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byHandle[scenario.handle] != scenario || scenario.cleanupStarted {
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if (scenario.operationID != "" && operationID != "" &&
		scenario.operationID != operationID) ||
		(scenario.targetDeviceID != "" &&
			scenario.targetDeviceID != targetDeviceID) ||
		(scenario.capabilitySessionID != "" &&
			scenario.capabilitySessionID != capabilitySessionID) {
		return capabilityInvalid(
			"capability acceptance operation does not match the selected executor",
		)
	}
	if operationID != "" {
		scenario.operationID = operationID
	}
	scenario.targetDeviceID = targetDeviceID
	scenario.capabilitySessionID = capabilitySessionID
	return nil
}

func (s *CapabilityAcceptanceScenarioService) MatchesCapabilityOperation(
	ptid string,
	operationID string,
) bool {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil ||
		scenario.family !=
			model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04 {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.byHandle[scenario.handle] == scenario &&
		!scenario.cleanupStarted &&
		scenario.operationID != "" &&
		scenario.operationID == strings.TrimSpace(operationID)
}

func (s *CapabilityAcceptanceScenarioService) Prepare(
	ctx context.Context,
	ptid string,
	req *model.PrepareCapabilityAcceptanceScenarioRequest,
) (*model.PrepareCapabilityAcceptanceScenarioResponse, error) {
	ptid = strings.TrimSpace(ptid)
	if s == nil || s.authority == nil || s.runID == "" {
		return nil, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario control is unavailable",
			nil,
		)
	}
	if err := s.validatePrepare(ptid, req); err != nil {
		return nil, err
	}
	executionID := strings.TrimSpace(req.GetScenarioExecutionId())
	s.mu.Lock()
	if _, exists := s.byExecID[executionID]; exists {
		s.mu.Unlock()
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"scenario execution identity is already active",
			nil,
		)
	}
	if handle := s.byActor[ptid]; handle != "" {
		s.mu.Unlock()
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"actor already has an active capability acceptance scenario",
			nil,
		)
	}
	scenario, hookTicket := s.newScenario(ptid, req)
	s.byHandle[scenario.handle] = scenario
	s.byExecID[executionID] = scenario.handle
	s.byActor[ptid] = scenario.handle
	if scenario.capabilityID != "" {
		s.byCapID[scenario.capabilityID] = scenario.handle
	}
	s.mu.Unlock()

	if err := s.prepareProductState(ctx, scenario); err != nil {
		s.removeScenario(scenario)
		return nil, err
	}
	return &model.PrepareCapabilityAcceptanceScenarioResponse{
		ScenarioHandle:      scenario.handle,
		OpaqueResourceIds:   append([]string(nil), scenario.resourceIDs...),
		SourceInventoryHash: scenarioSourceInventoryHash(scenario),
		ExecutorHookTicket:  hookTicket,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) ArmExecutorHook(
	ptid string,
	req *model.ArmCapabilityAcceptanceExecutorHookRequest,
) (*model.ArmCapabilityAcceptanceExecutorHookResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	ticket := strings.TrimSpace(req.GetExecutorHookTicket())
	if ticket == "" || scenario.barrierName == "" ||
		!capabilityScenarioRequiresExecutorHook(
			scenario.runtimeProfile,
			scenario.barrierName,
		) {
		return nil, capabilityInvalid("executor hook is not available for this scenario")
	}
	ticketHash := sha256.Sum256([]byte(ticket))
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byHandle[scenario.handle] != scenario || scenario.cleanupStarted {
		return nil, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if scenario.executorHookArmed ||
		!s.now().Before(scenario.hookTicketExpiresAt) ||
		subtle.ConstantTimeCompare(ticketHash[:], scenario.hookTicketHash[:]) != 1 {
		return nil, errcode.New(
			errcode.AgentUnauthorized,
			http.StatusForbidden,
			"capability acceptance executor hook ticket is invalid",
			nil,
		)
	}
	scenario.executorHookArmed = true
	scenario.hookTicketHash = [sha256.Size]byte{}
	return &model.ArmCapabilityAcceptanceExecutorHookResponse{
		ScenarioHandle: scenario.handle,
		Barrier:        scenario.barrierName,
		Family:         scenario.family,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) WaitBarrier(
	ctx context.Context,
	ptid string,
	req *model.WaitCapabilityAcceptanceBarrierRequest,
) (*model.WaitCapabilityAcceptanceBarrierResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	if err := validateScenarioBarrier(scenario, req.GetBarrier()); err != nil {
		return nil, err
	}
	timer := time.NewTimer(capabilityAcceptanceWaitTimeout)
	defer timer.Stop()
	select {
	case <-scenario.barrierReached:
		return &model.WaitCapabilityAcceptanceBarrierResponse{
			ScenarioHandle: scenario.handle,
			Barrier:        scenario.barrierName,
			Reached:        true,
		}, nil
	case <-scenario.cleanup:
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability acceptance scenario was cleaned before reaching its barrier",
			nil,
		)
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability acceptance barrier was not reached",
			nil,
		)
	}
}

func (s *CapabilityAcceptanceScenarioService) ReachExecutorBarrier(
	ctx context.Context,
	ptid string,
	req *model.ReachCapabilityAcceptanceExecutorBarrierRequest,
) (*model.ReachCapabilityAcceptanceExecutorBarrierResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	if err := validateScenarioBarrier(scenario, req.GetBarrier()); err != nil {
		return nil, err
	}
	if !capabilityScenarioRequiresExecutorHook(
		scenario.runtimeProfile,
		scenario.barrierName,
	) {
		return nil, capabilityInvalid(
			"executor barrier is not available for this runtime profile",
		)
	}
	interrupted, err := s.reachBarrier(ctx, scenario)
	if err != nil {
		return nil, err
	}
	return &model.ReachCapabilityAcceptanceExecutorBarrierResponse{
		ScenarioHandle: scenario.handle,
		Barrier:        scenario.barrierName,
		Interrupted:    interrupted,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) ReleaseBarrier(
	ctx context.Context,
	ptid string,
	req *model.ReleaseCapabilityAcceptanceBarrierRequest,
) (*model.ReleaseCapabilityAcceptanceBarrierResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	barrier := strings.TrimSpace(req.GetBarrier())
	if err := validateScenarioBarrier(scenario, barrier); err != nil {
		return nil, err
	}
	if err := s.applyBarrierAction(ctx, scenario); err != nil {
		return nil, err
	}
	switch barrier {
	case capabilityBarrierManifestAbsent:
		if err := s.authority.purgeAcceptanceManifest(
			ctx,
			scenario.actorPTID,
			scenario.capabilityID,
		); err != nil {
			return nil, err
		}
	case capabilityBarrierVersionStale:
		if err := s.authority.purgeAcceptanceManifestVersion(
			ctx,
			scenario.actorPTID,
			scenario.capabilityID,
			scenario.requestedVersion,
		); err != nil {
			return nil, err
		}
	}
	if err := s.releaseBarrier(scenario); err != nil {
		return nil, err
	}
	return &model.ReleaseCapabilityAcceptanceBarrierResponse{
		ScenarioHandle: scenario.handle,
		Barrier:        barrier,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) AdvanceClock(
	ctx context.Context,
	ptid string,
	req *model.AdvanceCapabilityAcceptanceScenarioClockRequest,
) (*model.AdvanceCapabilityAcceptanceScenarioClockResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	milestone := strings.TrimSpace(req.GetMilestone())
	if scenario.family !=
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06 ||
		scenario.cell != "R-09" ||
		scenario.ordering != "A" ||
		milestone != capabilityEvaluationCancelDeadline {
		return nil, capabilityInvalid(
			"capability acceptance clock milestone is not reviewed",
		)
	}
	s.mu.Lock()
	if len(scenario.evaluationRunIDs) == 0 || scenario.clockAdvanced ||
		s.evaluation == nil || !scenario.barrierEncountered ||
		!scenario.barrierReleased {
		s.mu.Unlock()
		return nil, capabilityInvalid(
			"capability acceptance clock cannot advance in the current state",
		)
	}
	runIDs := make([]string, 0, len(scenario.evaluationRunIDs))
	for runID := range scenario.evaluationRunIDs {
		runIDs = append(runIDs, runID)
	}
	s.mu.Unlock()
	sort.Strings(runIDs)
	deadline, found, err := s.evaluation.acceptanceCancelDeadline(
		ctx,
		scenario.actorPTID,
		runIDs,
	)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, capabilityInvalid(
			"capability acceptance cancellation deadline is not committed",
		)
	}
	s.mu.Lock()
	if s.byHandle[scenario.handle] != scenario ||
		scenario.cleanupStarted ||
		scenario.clockAdvanced {
		s.mu.Unlock()
		return nil, capabilityInvalid(
			"capability acceptance clock cannot advance in the current state",
		)
	}
	scenario.clockAdvanced = true
	scenario.scenarioNow = deadline.Add(time.Second)
	s.mu.Unlock()
	s.evaluation.signalWorker()
	return &model.AdvanceCapabilityAcceptanceScenarioClockResponse{
		ScenarioHandle: scenario.handle,
		Milestone:      milestone,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) InterruptWorker(
	ptid string,
	req *model.InterruptCapabilityAcceptanceWorkerRequest,
) (*model.InterruptCapabilityAcceptanceWorkerResponse, error) {
	scenario, err := s.lookup(strings.TrimSpace(ptid), req.GetScenarioHandle())
	if err != nil {
		return nil, err
	}
	if err := validateScenarioBarrier(scenario, req.GetBarrier()); err != nil {
		return nil, err
	}
	if err := s.applyBarrierAction(context.Background(), scenario); err != nil {
		return nil, err
	}
	if err := s.resolveBarrier(scenario, true); err != nil {
		return nil, err
	}
	return &model.InterruptCapabilityAcceptanceWorkerResponse{
		ScenarioHandle: scenario.handle,
		Barrier:        scenario.barrierName,
		Interrupted:    true,
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) Cleanup(
	ctx context.Context,
	ptid string,
	req *model.CleanupCapabilityAcceptanceScenarioRequest,
) (*model.CleanupCapabilityAcceptanceScenarioResponse, error) {
	scenario, alreadyCleaned, err := s.lookupForCleanup(
		strings.TrimSpace(ptid),
		req.GetScenarioHandle(),
	)
	if err != nil {
		return nil, err
	}
	if alreadyCleaned {
		return &model.CleanupCapabilityAcceptanceScenarioResponse{
			ScenarioHandle:           scenario.handle,
			CleanedOpaqueResourceIds: append([]string(nil), scenario.resourceIDs...),
		}, nil
	}
	s.beginCleanup(scenario)
	if scenario.capabilityID != "" {
		if err := s.authority.purgeAcceptanceScenario(
			ctx,
			scenario.actorPTID,
			[]string{scenario.capabilityID},
		); err != nil {
			return nil, err
		}
	}
	s.removeScenario(scenario)
	return &model.CleanupCapabilityAcceptanceScenarioResponse{
		ScenarioHandle:           scenario.handle,
		CleanedOpaqueResourceIds: append([]string(nil), scenario.resourceIDs...),
	}, nil
}

func (s *CapabilityAcceptanceScenarioService) BeforeBindingMutation(
	ctx context.Context,
	ptid string,
	req *model.UpsertAgentCapabilityBindingRequest,
) error {
	if req == nil || req.GetBinding() == nil {
		return nil
	}
	scenario := s.scenarioForCapability(req.GetBinding().GetCapabilityId())
	if scenario == nil {
		return nil
	}
	if scenario.actorPTID != strings.TrimSpace(ptid) {
		return errcode.NewOwnershipForbiddenActor(
			"capability_acceptance_scenario",
			scenario.handle,
		)
	}
	if scenario.barrierName != capabilityBarrierBindingAck ||
		scenario.barrierReached == nil {
		return nil
	}
	interrupted, err := s.reachBarrier(ctx, scenario)
	if err != nil {
		return err
	}
	if interrupted {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability acceptance binding worker was interrupted",
			nil,
		)
	}
	return nil
}

func (s *CapabilityAcceptanceScenarioService) ReachStationBarrier(
	ctx context.Context,
	ptid string,
	family model.CapabilityAcceptanceScenarioFamily,
	barrier string,
) (bool, error) {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil || scenario.family != family ||
		scenario.barrierName != strings.TrimSpace(barrier) {
		return false, nil
	}
	return s.reachBarrier(ctx, scenario)
}

func (s *CapabilityAcceptanceScenarioService) MatchesStationBarrier(
	ptid string,
	family model.CapabilityAcceptanceScenarioFamily,
	barrier string,
) bool {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	return scenario != nil &&
		scenario.family == family &&
		scenario.barrierName == strings.TrimSpace(barrier)
}

func (s *CapabilityAcceptanceScenarioService) ForcesExecutorUnavailable(
	ptid string,
) bool {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.byHandle[scenario.handle] == scenario &&
		scenario.executorUnavailable
}

func (s *CapabilityAcceptanceScenarioService) ReachStationTupleBarrier(
	ctx context.Context,
	ptid string,
	family model.CapabilityAcceptanceScenarioFamily,
	cell string,
	ordering string,
) (bool, error) {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil ||
		scenario.family != family ||
		scenario.cell != strings.TrimSpace(cell) ||
		scenario.ordering != strings.TrimSpace(ordering) {
		return false, nil
	}
	return s.reachBarrier(ctx, scenario)
}

func (s *CapabilityAcceptanceScenarioService) BindToolCall(
	ptid string,
	family model.CapabilityAcceptanceScenarioFamily,
	cell string,
	ordering string,
	toolCallID string,
) error {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	toolCallID = strings.TrimSpace(toolCallID)
	if scenario == nil ||
		scenario.family != family ||
		scenario.cell != strings.TrimSpace(cell) ||
		scenario.ordering != strings.TrimSpace(ordering) {
		return nil
	}
	if toolCallID == "" {
		return capabilityInvalid(
			"capability acceptance ToolCall identity is required",
		)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byHandle[scenario.handle] != scenario || scenario.cleanupStarted {
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if scenario.toolCallID != "" && scenario.toolCallID != toolCallID {
		return capabilityInvalid(
			"capability acceptance scenario ToolCall identity changed",
		)
	}
	scenario.toolCallID = toolCallID
	return nil
}

func (s *CapabilityAcceptanceScenarioService) MatchesStationTuple(
	ptid string,
	family model.CapabilityAcceptanceScenarioFamily,
	cell string,
	ordering string,
) bool {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	return scenario != nil &&
		scenario.family == family &&
		scenario.cell == strings.TrimSpace(cell) &&
		scenario.ordering == strings.TrimSpace(ordering)
}

func (s *CapabilityAcceptanceScenarioService) ToolReplayPolicy(
	ptid string,
) (model.ClientExecutionReplayPolicy, string, bool) {
	scenario := s.scenarioForActor(strings.TrimSpace(ptid))
	if scenario == nil ||
		scenario.family !=
			model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03 ||
		(scenario.cell != "CR-04I" && scenario.cell != "REPLAY-O07I") {
		return model.ClientExecutionReplayPolicy_CLIENT_EXECUTION_REPLAY_POLICY_UNSPECIFIED,
			"", false
	}
	keyHash := sha256.Sum256([]byte(
		scenario.runID + "\x00" + scenario.scenarioExecutionID,
	))
	return model.ClientExecutionReplayPolicy_CLIENT_EXECUTION_REPLAY_POLICY_WITH_EXTERNAL_IDEMPOTENCY,
		"acceptance-" + hex.EncodeToString(keyHash[:16]),
		true
}

func (s *CapabilityAcceptanceScenarioService) applyBarrierAction(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	if !capabilityScenarioHasBarrierAction(scenario) {
		return nil
	}
	s.mu.Lock()
	if s.byHandle[scenario.handle] != scenario || scenario.cleanupStarted {
		s.mu.Unlock()
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if scenario.barrierActionApplied {
		s.mu.Unlock()
		return capabilityInvalid(
			"capability acceptance barrier action is already applied",
		)
	}
	scenario.barrierActionApplied = true
	s.mu.Unlock()

	var err error
	switch scenario.family {
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03:
		err = s.applyGovernedToolBarrierAction(ctx, scenario)
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04:
		err = s.applyMCPOperationBarrierAction(ctx, scenario)
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05:
		err = s.applyConnectorBarrierAction(ctx, scenario)
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06:
		err = s.applyEvaluationBarrierAction(ctx, scenario)
	}
	if err != nil {
		s.mu.Lock()
		scenario.barrierActionApplied = false
		s.mu.Unlock()
	}
	return err
}

func capabilityScenarioHasBarrierAction(
	scenario *capabilityAcceptanceScenario,
) bool {
	if scenario == nil {
		return false
	}
	switch scenario.family {
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03:
		switch scenario.cell {
		case "R-05", "ERR-O01", "ERR-O02", "ERR-O04", "ERR-O05",
			"ERR-O06", "ERR-O08", "R-07":
			return true
		}
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04:
		switch scenario.cell {
		case "ERR-O01", "ERR-O02", "ERR-O04", "ERR-O05", "ERR-O06",
			"ERR-O07", "ERR-O08":
			return true
		case "R-01", "R-02":
			return scenario.ordering == "A"
		case "R-04":
			return true
		}
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05:
		return scenario.cell == "R-07"
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06:
		return scenario.cell == "R-08"
	}
	return false
}

func (s *CapabilityAcceptanceScenarioService) applyEvaluationBarrierAction(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	if scenario.cell != "R-08" {
		return nil
	}
	if s.evaluation == nil {
		return capabilityInvalid(
			"capability acceptance Evaluation owner is unavailable",
		)
	}
	return s.evaluation.ReconcileEvaluationRuns(ctx)
}

func (s *CapabilityAcceptanceScenarioService) applyGovernedToolBarrierAction(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	switch scenario.cell {
	case "R-05", "ERR-O01", "ERR-O05":
		if s.dispatch == nil {
			return capabilityInvalid(
				"capability acceptance ToolDispatch owner is unavailable",
			)
		}
		if err := s.dispatch.revokeAcceptanceScenarioSession(
			ctx,
			scenario.actorPTID,
			scenario.cell == "R-05" && scenario.ordering == "B",
		); err != nil {
			return err
		}
		s.mu.Lock()
		scenario.executorUnavailable = true
		s.mu.Unlock()
	case "R-07":
		if s.dispatch == nil {
			return capabilityInvalid(
				"capability acceptance ToolDispatch owner is unavailable",
			)
		}
		bindingID, bindingRevision, err :=
			s.dispatch.acceptanceScenarioBinding(
				ctx,
				scenario.actorPTID,
				scenario.toolCallID,
			)
		if err != nil {
			return err
		}
		_, err = s.authority.DeleteBinding(
			ctx,
			scenario.actorPTID,
			&model.DeleteAgentCapabilityBindingRequest{
				BindingId:               bindingID,
				ExpectedBindingRevision: bindingRevision,
				IdempotencyKey: "acceptance-" +
					scenario.scenarioExecutionID + "-binding-delete",
				Reason: "acceptance_race",
			},
		)
		return err
	case "ERR-O02":
		return s.dispatch.expireAcceptanceScenarioLease(
			ctx,
			scenario.actorPTID,
		)
	case "ERR-O04":
		return s.dispatch.expireAcceptanceScenarioDeadlines(
			ctx,
			scenario.actorPTID,
		)
	case "ERR-O06":
		return s.dispatch.expireAcceptanceScenarioRecoveryCredential(
			ctx,
			scenario.actorPTID,
		)
	case "ERR-O08":
		return s.dispatch.advanceAcceptanceScenarioFence(
			ctx,
			scenario.actorPTID,
		)
	}
	return nil
}

func (s *CapabilityAcceptanceScenarioService) applyMCPOperationBarrierAction(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	if s.operations == nil {
		return capabilityInvalid(
			"capability acceptance operation owner is unavailable",
		)
	}
	switch scenario.cell {
	case "R-01":
		return s.operations.takeOverAcceptanceScenarioBeforeEffect(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
		)
	case "R-02":
		return s.operations.takeOverAcceptanceScenarioCleanup(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
		)
	case "R-04", "ERR-O04":
		if scenario.cell == "R-04" {
			if err := s.operations.disconnectAcceptanceScenarioExecutor(
				ctx,
				scenario.actorPTID,
				scenario.operationID,
				scenario.targetDeviceID,
				scenario.capabilitySessionID,
				true,
			); err != nil {
				return err
			}
		}
		return s.operations.expireAcceptanceScenarioExecutionDeadline(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
		)
	case "ERR-O01":
		return s.operations.disconnectAcceptanceScenarioExecutor(
			ctx,
			scenario.actorPTID,
			"",
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
			false,
		)
	case "ERR-O02":
		return s.operations.fenceAcceptanceScenarioBusinessLease(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
		)
	case "ERR-O05":
		return s.operations.disconnectAcceptanceScenarioExecutor(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
			true,
		)
	case "ERR-O06":
		return s.operations.expireAcceptanceScenarioCleanupLease(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
		)
	case "ERR-O07":
		return s.operations.settleAcceptanceScenarioUnknownSideEffect(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
		)
	case "ERR-O08":
		return s.operations.settleAcceptanceScenarioUnknownSideEffect(
			ctx,
			scenario.actorPTID,
			scenario.operationID,
			scenario.targetDeviceID,
			scenario.capabilitySessionID,
		)
	}
	return nil
}

func (s *CapabilityAcceptanceScenarioService) applyConnectorBarrierAction(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	if scenario.cell != "R-07" {
		return nil
	}
	if s.dispatch == nil {
		return capabilityInvalid(
			"capability acceptance ToolDispatch owner is unavailable",
		)
	}
	bindingID, bindingRevision, err :=
		s.dispatch.acceptanceScenarioBinding(
			ctx,
			scenario.actorPTID,
			scenario.toolCallID,
		)
	if err != nil {
		return err
	}
	_, err = s.authority.DeleteBinding(
		ctx,
		scenario.actorPTID,
		&model.DeleteAgentCapabilityBindingRequest{
			BindingId:               bindingID,
			ExpectedBindingRevision: bindingRevision,
			IdempotencyKey: "acceptance-" +
				scenario.scenarioExecutionID + "-binding-delete",
			Reason: "acceptance_race",
		},
	)
	return err
}

func (s *CapabilityAcceptanceScenarioService) BindingTarget(
	ptid string,
	capabilityID string,
) (string, string) {
	scenario := s.scenarioForCapability(capabilityID)
	if scenario == nil || scenario.actorPTID != strings.TrimSpace(ptid) {
		return "", "manifest_unavailable"
	}
	return scenario.targetDeviceID, "target_capability_unavailable"
}

func (s *CapabilityAcceptanceScenarioService) validatePrepare(
	ptid string,
	req *model.PrepareCapabilityAcceptanceScenarioRequest,
) error {
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetRunId()) == "" ||
		strings.TrimSpace(req.GetScenarioExecutionId()) == "" ||
		strings.TrimSpace(req.GetCell()) == "" ||
		strings.TrimSpace(req.GetPlatform()) == "" ||
		strings.TrimSpace(req.GetLocale()) == "" ||
		strings.TrimSpace(req.GetOrdering()) == "" ||
		strings.TrimSpace(req.GetSampleId()) == "" {
		return capabilityInvalid(
			"ptid and complete capability acceptance tuple identity are required",
		)
	}
	if strings.TrimSpace(req.GetRunId()) != s.runID {
		return errcode.New(
			errcode.AgentUnauthorized,
			http.StatusForbidden,
			"capability acceptance run identity mismatch",
			nil,
		)
	}
	return validateCapabilityAcceptanceTuple(req)
}

func validateCapabilityAcceptanceTuple(
	req *model.PrepareCapabilityAcceptanceScenarioRequest,
) error {
	family := req.GetFamily()
	definitions, ok := capabilityAcceptanceFamilies[family]
	if !ok {
		return capabilityInvalid("capability acceptance scenario family is not reviewed")
	}
	cell := strings.TrimSpace(req.GetCell())
	if _, ok := definitions[cell]; !ok {
		return capabilityInvalid("capability acceptance cell is not reviewed for its family")
	}
	platform := strings.TrimSpace(req.GetPlatform())
	profile := req.GetRuntimeAttestationProfile()
	ordering := strings.TrimSpace(req.GetOrdering())
	if !capabilityAcceptancePlatformProfileAllowed(
		family,
		platform,
		profile,
		cell,
		ordering,
	) {
		return capabilityInvalid(
			"capability acceptance platform and runtime profile are not reviewed",
		)
	}
	locale := strings.TrimSpace(req.GetLocale())
	switch {
	case platform == "mobile_contract":
		if locale != "contract" || ordering != "single" {
			return capabilityInvalid(
				"mobile capability acceptance tuple dimensions are not reviewed",
			)
		}
	case strings.HasPrefix(cell, "CR-"):
		if locale != "neutral" || ordering != "single" {
			return capabilityInvalid(
				"crash capability acceptance tuple dimensions are not reviewed",
			)
		}
	case strings.HasPrefix(cell, "R-"):
		if (locale != "en" && locale != "zh-CN") ||
			(ordering != "A" && ordering != "B") {
			return capabilityInvalid(
				"race capability acceptance tuple dimensions are not reviewed",
			)
		}
	default:
		if (locale != "en" && locale != "zh-CN") || ordering != "single" {
			return capabilityInvalid(
				"capability acceptance tuple dimensions are not reviewed",
			)
		}
	}
	if strings.TrimSpace(req.GetSampleId()) != "sample-001" {
		return capabilityInvalid("capability acceptance sample is not reviewed")
	}
	return nil
}

func capabilityAcceptancePlatformProfileAllowed(
	family model.CapabilityAcceptanceScenarioFamily,
	platform string,
	profile model.CapabilityAcceptanceRuntimeProfile,
	cell string,
	ordering string,
) bool {
	switch family {
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02:
		return (platform == "desktop_app" || platform == "browser") &&
			profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CONTROL_PLANE
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03:
		if capabilityAcceptanceJ03ZeroExecution(cell, ordering) {
			return (platform == "desktop_app" || platform == "browser") &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN
		}
		switch platform {
		case "desktop_app":
			return profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
		case "browser":
			return profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CAPABILITY_TURN
		case "mobile_contract":
			return (cell == "AS-15-V2-T04" || cell == "AS-15-V2-O01") &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CONTRACT_ONLY
		}
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04:
		switch platform {
		case "desktop_app":
			return profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
		case "browser":
			return (cell == "AS-04-UNAVAILABLE" || cell == "TAX-04") &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_UNAVAILABLE_RUNTIME
		case "mobile_contract":
			return (cell == "AS-04-UNAVAILABLE" ||
				cell == "TAX-04" ||
				cell == "AS-15-V2-M01") &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CONTRACT_ONLY
		}
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05:
		if capabilityAcceptanceJ05ZeroExecution(cell, ordering) {
			return (platform == "desktop_app" || platform == "browser") &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN
		}
		if platform == "desktop_app" || platform == "browser" {
			return profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN
		}
		return platform == "mobile_contract" &&
			cell == "AS-15-V2-C01" &&
			profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CONTRACT_ONLY
	case model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06:
		if platform == "mobile_contract" {
			return cell == "AS-15-V2-E01" &&
				profile ==
					model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CONTRACT_ONLY
		}
		if platform != "desktop_app" && platform != "browser" {
			return false
		}
		if cell == "ERR-E01" || cell == "ERR-E02" || cell == "ERR-E05" {
			return profile ==
				model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_CONTROL_PLANE
		}
		return profile ==
			model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_STATION_TURN
	}
	return false
}

func capabilityAcceptanceJ03ZeroExecution(cell string, ordering string) bool {
	return cell == "ERR-O01" ||
		cell == "ERR-O05" ||
		((cell == "R-05" || cell == "R-07") && ordering == "A")
}

func capabilityAcceptanceJ05ZeroExecution(cell string, ordering string) bool {
	return strings.HasPrefix(cell, "ERR-CON") ||
		((cell == "R-06" || cell == "R-07") && ordering == "A")
}

func capabilityScenarioRequiresExecutorHook(
	profile model.CapabilityAcceptanceRuntimeProfile,
	barrier string,
) bool {
	if profile !=
		model.CapabilityAcceptanceRuntimeProfile_CAPABILITY_ACCEPTANCE_RUNTIME_PROFILE_CLIENT_CAPABILITY_TURN {
		return false
	}
	switch barrier {
	case capabilityBarrierDecisionBeforeCommit,
		capabilityBarrierDecisionBeforeClaim,
		capabilityBarrierClaimBeforeDelivery,
		capabilityBarrierResultBeforeContinue,
		capabilityBarrierDeleteDispatchRace,
		capabilityBarrierExecutorBeforeDispatch,
		capabilityBarrierDisconnectAfterCreate,
		capabilityBarrierConnectorDisconnect:
		return false
	default:
		return barrier != ""
	}
}

func validateScenarioBarrier(
	scenario *capabilityAcceptanceScenario,
	barrier string,
) error {
	if scenario == nil || scenario.barrierName == "" ||
		strings.TrimSpace(barrier) != scenario.barrierName {
		return capabilityInvalid("unknown capability acceptance barrier")
	}
	return nil
}

func (s *CapabilityAcceptanceScenarioService) newScenario(
	ptid string,
	req *model.PrepareCapabilityAcceptanceScenarioRequest,
) (*capabilityAcceptanceScenario, string) {
	executionHash := sha256.Sum256([]byte(req.GetScenarioExecutionId()))
	suffix := hex.EncodeToString(executionHash[:8])
	cell := strings.TrimSpace(req.GetCell())
	family := req.GetFamily()
	definition := capabilityAcceptanceFamilies[family][cell]
	if family ==
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06 {
		definition.barrier = capabilityEvaluationBarrier(
			cell,
			strings.TrimSpace(req.GetOrdering()),
		)
	}
	requestedVersion := "1"
	actualVersion := requestedVersion
	if family ==
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02 &&
		cell == "ERR-CAT02" {
		actualVersion = "2"
	}
	capabilityID := ""
	targetDeviceID := ""
	if family ==
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02 {
		capabilityID = capabilityAcceptanceBindingPrefix +
			strings.ToLower(cell) + "." + suffix
		targetDeviceID = generateID("acceptance-device")
	}
	hookTicket := ""
	hookTicketHash := [sha256.Size]byte{}
	hookTicketExpiresAt := time.Time{}
	if definition.barrier != "" &&
		capabilityScenarioRequiresExecutorHook(
			req.GetRuntimeAttestationProfile(),
			definition.barrier,
		) {
		hookTicket = generateID("executor_hook")
		hookTicketHash = sha256.Sum256([]byte(hookTicket))
		hookTicketExpiresAt = s.now().Add(capabilityAcceptanceHookTTL)
	}
	scenario := &capabilityAcceptanceScenario{
		handle:              generateID("capability-scenario"),
		runID:               s.runID,
		scenarioExecutionID: strings.TrimSpace(req.GetScenarioExecutionId()),
		actorPTID:           ptid,
		family:              family,
		runtimeProfile:      req.GetRuntimeAttestationProfile(),
		cell:                cell,
		platform:            strings.TrimSpace(req.GetPlatform()),
		locale:              strings.TrimSpace(req.GetLocale()),
		ordering:            strings.TrimSpace(req.GetOrdering()),
		sampleID:            strings.TrimSpace(req.GetSampleId()),
		capabilityID:        capabilityID,
		requestedVersion:    requestedVersion,
		actualVersion:       actualVersion,
		targetDeviceID:      targetDeviceID,
		evaluationRunIDs:    make(map[string]struct{}),
		barrierName:         definition.barrier,
		hookTicketHash:      hookTicketHash,
		hookTicketExpiresAt: hookTicketExpiresAt,
		cleanup:             make(chan struct{}),
		createdAt:           s.now(),
	}
	if scenario.barrierName != "" {
		scenario.barrierReached = make(chan struct{})
		scenario.barrierDecision = make(chan bool, 1)
	}
	scenario.resourceIDs = []string{
		"family:" + scenario.family.String(),
		"runtime_profile:" + scenario.runtimeProfile.String(),
	}
	if scenario.capabilityID != "" {
		scenario.resourceIDs = append(
			scenario.resourceIDs,
			"capability_id:"+scenario.capabilityID,
			"requested_version:"+scenario.requestedVersion,
			"actual_version:"+scenario.actualVersion,
			"target_device_id:"+scenario.targetDeviceID,
		)
	}
	if scenario.barrierName != "" {
		scenario.resourceIDs = append(
			scenario.resourceIDs,
			"barrier:"+scenario.barrierName,
		)
	}
	return scenario, hookTicket
}

func capabilityEvaluationBarrier(cell string, ordering string) string {
	switch cell {
	case "R-08":
		if ordering == "A" {
			return capabilityBarrierEvaluationSchedulerClaim
		}
		return capabilityBarrierEvaluationTurnCreated
	case "R-09":
		if ordering == "A" {
			return capabilityBarrierEvaluationCompletion
		}
		return capabilityBarrierEvaluationCancel
	case "R-10":
		if ordering == "A" {
			return capabilityBarrierEvaluationRetryCreate
		}
		return capabilityBarrierEvaluationRetryReturn
	default:
		return ""
	}
}

func (s *CapabilityAcceptanceScenarioService) prepareProductState(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	if scenario.family ==
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05 {
		return s.prepareConnectorProductState(ctx, scenario)
	}
	if scenario.family !=
		model.CapabilityAcceptanceScenarioFamily_CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02 {
		return nil
	}
	availability := model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
	switch scenario.cell {
	case "TAX-03":
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_DEGRADED
	case "ERR-B02":
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE
	case "TAX-06":
		availability = model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED
	}
	manifest := &model.CapabilityManifest{
		CapabilityId:     scenario.capabilityID,
		Version:          scenario.actualVersion,
		SourceKind:       model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
		SourceInstanceId: "acceptance-scenario:" + scenario.scenarioExecutionID,
		DisplayMetadata: &model.CapabilityDisplayMetadata{
			Name:        "Capability acceptance fixture",
			Description: "Run-scoped capability scenario",
		},
		ExecutionOwner:        model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
		RiskClass:             "acceptance",
		DefaultApprovalPolicy: model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL,
		SecretBoundary:        "none",
		Availability:          availability,
		OwnerPtid:             scenario.actorPTID,
	}
	if scenario.cell == "TAX-04" {
		manifest.RequiredRuntimeCapabilities = []string{
			"acceptance.missing-runtime-capability",
		}
	}
	if scenario.cell == "ERR-CAT03" {
		manifest.SourceKind =
			model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_UNSPECIFIED
		_, err := s.authority.RegisterManifest(ctx, manifest)
		var biz *errcode.BizError
		if !errors.As(err, &biz) ||
			biz.Code != errcode.AgentCapabilityManifestSchemaInvalid {
			return capabilityInternal(
				"invalid acceptance manifest did not produce typed schema error",
				err,
			)
		}
		return nil
	}
	if scenario.cell == "ERR-CAT02" {
		requested := *manifest
		requested.Version = scenario.requestedVersion
		if _, err := s.authority.RegisterManifest(ctx, &requested); err != nil {
			return err
		}
	}
	_, err := s.authority.RegisterManifest(ctx, manifest)
	return err
}

func (s *CapabilityAcceptanceScenarioService) prepareConnectorProductState(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) error {
	switch scenario.cell {
	case "ERR-CON01", "ERR-CON02", "ERR-CON03", "ERR-CON04":
	default:
		return nil
	}
	if s.connectors == nil {
		return capabilityInvalid(
			"capability acceptance Connector owner is unavailable",
		)
	}
	current, err := s.connectors.List(ctx, scenario.actorPTID, "")
	if err != nil {
		return err
	}
	if len(current) == 0 {
		return capabilityInvalid(
			"capability acceptance Connector fixture is missing",
		)
	}
	connectorID := strings.TrimSpace(current[0].GetConnectorId())
	connectionID := strings.TrimSpace(current[0].GetOauthConnectionId())
	connectionRevision := current[0].GetConnectionRevision()
	if connectorID == "" || connectionID == "" || connectionRevision == 0 {
		return capabilityInvalid(
			"capability acceptance Connector fixture identity is incomplete",
		)
	}
	grantedScopes := make([]string, 0)
	resources := make([]*model.ConnectorResourceProjection, 0, len(current))
	for _, resource := range current {
		if resource.GetConnectorId() != connectorID ||
			resource.GetOauthConnectionId() != connectionID ||
			resource.GetConnectionRevision() != connectionRevision {
			return capabilityInvalid(
				"capability acceptance Connector fixture is ambiguous",
			)
		}
		grantedScopes = append(grantedScopes, resource.GetScopes()...)
		if scenario.cell == "ERR-CON03" &&
			resource.GetResourceId() == "connection.status" {
			continue
		}
		resources = append(resources, &model.ConnectorResourceProjection{
			ResourceId:      resource.GetResourceId(),
			ResourceVersion: resource.GetResourceVersion(),
			RequiredScopes:  append([]string(nil), resource.GetScopes()...),
			Status:          model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY,
		})
	}
	connectionStatus :=
		model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_READY
	expiresAt := current[0].GetExpiresAt()
	if scenario.cell == "ERR-CON01" {
		connectionStatus =
			model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_EXPIRED
		expiresAt = timestamppb.New(s.now().Add(-time.Minute))
	}
	if scenario.cell == "ERR-CON02" {
		grantedScopes = nil
	}
	_, err = s.connectors.Sync(
		ctx,
		scenario.actorPTID,
		&model.SyncConnectorResourceManifestsRequest{
			ConnectorId:                connectorID,
			OauthConnectionId:          connectionID,
			ExpectedConnectionRevision: connectionRevision,
			ConnectionRevision:         connectionRevision + 1,
			GrantedScopes:              normalizedConnectorStrings(grantedScopes),
			ConnectionStatus:           connectionStatus,
			ExpiresAt:                  expiresAt,
			Resources:                  resources,
			IdempotencyKey: "acceptance-" +
				scenario.scenarioExecutionID + "-connector-state",
		},
	)
	return err
}

func (s *CapabilityAcceptanceScenarioService) lookup(
	ptid string,
	handle string,
) (*capabilityAcceptanceScenario, error) {
	s.mu.RLock()
	scenario := s.byHandle[strings.TrimSpace(handle)]
	s.mu.RUnlock()
	if scenario == nil || scenario.actorPTID != ptid {
		return nil, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	return scenario, nil
}

func (s *CapabilityAcceptanceScenarioService) releaseBarrier(
	scenario *capabilityAcceptanceScenario,
) error {
	return s.resolveBarrier(scenario, false)
}

func (s *CapabilityAcceptanceScenarioService) resolveBarrier(
	scenario *capabilityAcceptanceScenario,
	interrupted bool,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byHandle[scenario.handle] != scenario || scenario.cleanupStarted {
		return errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if scenario.barrierReleased || scenario.workerInterrupted {
		return capabilityInvalid("capability acceptance barrier is already resolved")
	}
	scenario.barrierReleased = true
	scenario.workerInterrupted = interrupted
	scenario.barrierDecision <- interrupted
	return nil
}

func (s *CapabilityAcceptanceScenarioService) beginCleanup(
	scenario *capabilityAcceptanceScenario,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	scenario.cleanupStarted = true
	scenario.cleanupOnce.Do(func() {
		close(scenario.cleanup)
	})
}

func (s *CapabilityAcceptanceScenarioService) reachBarrier(
	ctx context.Context,
	scenario *capabilityAcceptanceScenario,
) (bool, error) {
	if scenario == nil || scenario.barrierName == "" ||
		scenario.barrierReached == nil {
		return false, nil
	}
	s.mu.Lock()
	active := s.byHandle[scenario.handle] == scenario
	armed := scenario.executorHookArmed
	requiresExecutorHook := capabilityScenarioRequiresExecutorHook(
		scenario.runtimeProfile,
		scenario.barrierName,
	)
	if active && scenario.barrierReleased {
		s.mu.Unlock()
		return false, nil
	}
	if active && scenario.workerInterrupted {
		if scenario.interruptionDelivered {
			s.mu.Unlock()
			return false, nil
		}
		scenario.interruptionDelivered = true
		s.mu.Unlock()
		return true, nil
	}
	s.mu.Unlock()
	if !active {
		return false, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"capability acceptance scenario not found",
			nil,
		)
	}
	if requiresExecutorHook && !armed {
		return false, capabilityInvalid(
			"capability acceptance executor hook is not armed",
		)
	}
	scenario.barrierReachedOnce.Do(func() {
		close(scenario.barrierReached)
	})
	timer := time.NewTimer(capabilityAcceptanceWaitTimeout)
	defer timer.Stop()
	select {
	case interrupted := <-scenario.barrierDecision:
		if interrupted {
			s.mu.Lock()
			scenario.interruptionDelivered = true
			s.mu.Unlock()
		}
		return interrupted, nil
	case <-scenario.cleanup:
		return false, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability acceptance scenario was cleaned before barrier release",
			nil,
		)
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return false, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability acceptance barrier timed out",
			nil,
		)
	}
}

func (s *CapabilityAcceptanceScenarioService) scenarioForCapability(
	capabilityID string,
) *capabilityAcceptanceScenario {
	s.mu.RLock()
	defer s.mu.RUnlock()
	handle := s.byCapID[strings.TrimSpace(capabilityID)]
	return s.byHandle[handle]
}

func (s *CapabilityAcceptanceScenarioService) scenarioForActor(
	ptid string,
) *capabilityAcceptanceScenario {
	s.mu.RLock()
	defer s.mu.RUnlock()
	handle := s.byActor[strings.TrimSpace(ptid)]
	return s.byHandle[handle]
}

func (s *CapabilityAcceptanceScenarioService) evaluationScenarioMatches(
	ptid string,
	runID string,
	cell string,
	ordering string,
) bool {
	if s == nil {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	handle := s.byEvalRun[strings.TrimSpace(runID)]
	scenario := s.byHandle[handle]
	if scenario == nil ||
		scenario.cleanupStarted ||
		scenario.actorPTID != strings.TrimSpace(ptid) ||
		scenario.cell != cell {
		return false
	}
	return ordering == "" || scenario.ordering == ordering
}

func (s *CapabilityAcceptanceScenarioService) removeScenario(
	scenario *capabilityAcceptanceScenario,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byHandle, scenario.handle)
	delete(s.byExecID, scenario.scenarioExecutionID)
	delete(s.byActor, scenario.actorPTID)
	if scenario.capabilityID != "" {
		delete(s.byCapID, scenario.capabilityID)
	}
	for runID := range scenario.evaluationRunIDs {
		if s.byEvalRun[runID] == scenario.handle {
			delete(s.byEvalRun, runID)
		}
	}
	s.cleaned[scenario.handle] = scenario
}

func (s *CapabilityAcceptanceScenarioService) lookupForCleanup(
	ptid string,
	handle string,
) (*capabilityAcceptanceScenario, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	handle = strings.TrimSpace(handle)
	scenario := s.byHandle[handle]
	if scenario != nil && scenario.actorPTID == ptid {
		return scenario, false, nil
	}
	scenario = s.cleaned[handle]
	if scenario != nil && scenario.actorPTID == ptid {
		return scenario, true, nil
	}
	return nil, false, errcode.New(
		errcode.AgentNotFound,
		http.StatusNotFound,
		"capability acceptance scenario not found",
		nil,
	)
}

func scenarioSourceInventoryHash(
	scenario *capabilityAcceptanceScenario,
) string {
	values := []string{
		scenario.runID,
		scenario.scenarioExecutionID,
		scenario.actorPTID,
		scenario.cell,
		scenario.platform,
		scenario.locale,
		scenario.ordering,
		scenario.sampleID,
		scenario.family.String(),
		scenario.runtimeProfile.String(),
		scenario.barrierName,
		scenario.capabilityID,
		scenario.requestedVersion,
		scenario.actualVersion,
		scenario.targetDeviceID,
	}
	sort.Strings(values)
	sum := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(sum[:])
}
