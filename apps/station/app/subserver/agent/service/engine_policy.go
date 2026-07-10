package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const (
	enginePolicyRuntimeEnabledMetaKey = "engine_policy_runtime"
	enginePolicyAuthorityRoleMetaKey  = "engine_policy_authority_role"

	enginePolicyPhaseReached       = "reached"
	enginePolicyPhaseAwaitingHuman = "awaiting_human"
)

type enginePolicyTurn struct {
	Role        string
	Stance      string
	Text        string
	EvidenceRef string
	Escalates   bool
}

func enginePolicyTurnFromProto(turn *model.EnginePolicyTurn) (enginePolicyTurn, bool) {
	if turn == nil {
		return enginePolicyTurn{}, false
	}
	stance := enginePolicyStanceFromProto(turn.GetStance())
	if !isEnginePolicyStance(stance) {
		return enginePolicyTurn{}, false
	}
	return enginePolicyTurn{
		Role:        turn.GetRole(),
		Stance:      stance,
		Text:        turn.GetText(),
		EvidenceRef: turn.GetEvidenceRef(),
		Escalates:   turn.GetEscalates(),
	}, true
}

func validateEnginePolicyTurnProto(turn *model.EnginePolicyTurn) string {
	if turn == nil {
		return ""
	}
	if strings.TrimSpace(enginePolicyStanceFromProto(turn.GetStance())) == "" {
		return "engine_policy_turn.stance must be proposal, objection, counter or signoff"
	}
	if strings.TrimSpace(turn.GetRole()) == "" {
		return "engine_policy_turn.role is required"
	}
	if strings.TrimSpace(turn.GetText()) == "" {
		return "engine_policy_turn.text is required"
	}
	return ""
}

func enginePolicyStanceFromProto(stance model.EnginePolicyStance) string {
	switch stance {
	case model.EnginePolicyStance_ENGINE_POLICY_STANCE_PROPOSAL:
		return "proposal"
	case model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION:
		return "objection"
	case model.EnginePolicyStance_ENGINE_POLICY_STANCE_COUNTER:
		return "counter"
	case model.EnginePolicyStance_ENGINE_POLICY_STANCE_SIGNOFF:
		return "signoff"
	default:
		return ""
	}
}

type enginePolicyTurnPayload struct {
	Role             string `json:"role"`
	Stance           string `json:"stance"`
	Text             string `json:"text"`
	EvidenceRef      string `json:"evidenceRef,omitempty"`
	EvidenceRefSnake string `json:"evidence_ref,omitempty"`
	Escalates        bool   `json:"escalates,omitempty"`
}

type collaborationSessionEventPayload struct {
	Type                      string `json:"type"`
	Phase                     string `json:"phase"`
	Role                      string `json:"role,omitempty"`
	EngineType                string `json:"engineType,omitempty"`
	EngineTypeSnake           string `json:"engine_type,omitempty"`
	RoundIndex                int32  `json:"roundIndex,omitempty"`
	RoundIndexSnake           int32  `json:"round_index,omitempty"`
	ConvergenceMechanism      string `json:"convergenceMechanism,omitempty"`
	ConvergenceMechanismSnake string `json:"convergence_mechanism,omitempty"`
	EvidenceRef               string `json:"evidenceRef,omitempty"`
	EvidenceRefSnake          string `json:"evidence_ref,omitempty"`
	Summary                   string `json:"summary,omitempty"`
	RequiresHuman             bool   `json:"requiresHuman,omitempty"`
	RequiresHumanSnake        bool   `json:"requires_human,omitempty"`
}

type enginePolicyEvaluation struct {
	Enabled              bool
	Phase                string
	AuthoritySignoff     bool
	PendingObjections    int
	EvidenceObjections   int
	HardVetoObjections   int
	AcceptanceVetoes     int
	Counters             int
	DowngradedConcerns   int
	Verdict              string
	AuthorityRole        string
	ConvergenceMechanism string
}

type enginePolicyAuthorityMatrix struct {
	TerminalSignoffRoles  map[string]struct{}
	HardVetoRoles         map[string]struct{}
	AcceptanceVetoRoles   map[string]struct{}
	JudgmentForbiddenRole map[string]struct{}
}

func defaultEnginePolicyAuthorityMatrix() enginePolicyAuthorityMatrix {
	return enginePolicyAuthorityMatrix{
		TerminalSignoffRoles:  stringSet("goal_owner"),
		HardVetoRoles:         stringSet("risk"),
		AcceptanceVetoRoles:   stringSet("verifier"),
		JudgmentForbiddenRole: stringSet("executor"),
	}
}

func stringSet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if normalized := strings.ToLower(strings.TrimSpace(value)); normalized != "" {
			set[normalized] = struct{}{}
		}
	}
	return set
}

func (matrix enginePolicyAuthorityMatrix) canonicalRole(raw string) string {
	if role, err := normalizeAtelierAgentRole(raw); err == nil && strings.TrimSpace(role) != "" {
		return role
	}
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(raw)), "-", "_")
}

func (matrix enginePolicyAuthorityMatrix) hasRole(set map[string]struct{}, role string) bool {
	_, ok := set[matrix.canonicalRole(role)]
	return ok
}

func (matrix enginePolicyAuthorityMatrix) canTerminalSignoff(role string, authorityRole string) bool {
	role = matrix.canonicalRole(role)
	authorityRole = matrix.canonicalRole(authorityRole)
	if authorityRole != "" && role != authorityRole {
		return false
	}
	return matrix.hasRole(matrix.TerminalSignoffRoles, role)
}

func (matrix enginePolicyAuthorityMatrix) isJudgmentForbidden(role string) bool {
	return matrix.hasRole(matrix.JudgmentForbiddenRole, role)
}

func (matrix enginePolicyAuthorityMatrix) isHardVeto(role string) bool {
	return matrix.hasRole(matrix.HardVetoRoles, role)
}

func (matrix enginePolicyAuthorityMatrix) isAcceptanceVeto(role string) bool {
	return matrix.hasRole(matrix.AcceptanceVetoRoles, role)
}

type enginePolicySchedule struct {
	Engine               model.CollaborationEngineType
	Parallel             bool
	DefaultRoles         []string
	ConvergenceMechanism string
}

func enginePolicyScheduleForEngine(engine model.CollaborationEngineType) enginePolicySchedule {
	switch engine {
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE:
		return enginePolicySchedule{
			Engine:               engine,
			Parallel:             true,
			DefaultRoles:         []string{"planner", "architect", "risk", "verifier", "executor"},
			ConvergenceMechanism: "roundtable_parallel_proposals_then_authority_signoff",
		}
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE:
		return enginePolicySchedule{
			Engine:               engine,
			Parallel:             false,
			DefaultRoles:         []string{"planner", "risk", "verifier"},
			ConvergenceMechanism: "debate_then_integrator_judge_signoff",
		}
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM:
		return enginePolicySchedule{
			Engine:               engine,
			Parallel:             true,
			DefaultRoles:         []string{"executor", "executor", "executor", "verifier", "risk"},
			ConvergenceMechanism: "swarm_parallel_execution_then_integrator_merge",
		}
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY:
		return enginePolicySchedule{
			Engine:               engine,
			Parallel:             false,
			DefaultRoles:         []string{"planner", "executor", "verifier"},
			ConvergenceMechanism: "hierarchical_serial_execution_then_integrator_signoff",
		}
	case model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH:
		return enginePolicySchedule{
			Engine:               engine,
			Parallel:             true,
			DefaultRoles:         []string{"architect", "planner", "risk", "verifier", "executor"},
			ConvergenceMechanism: "expert_mesh_parallel_review_then_integrator_merge",
		}
	default:
		return enginePolicySchedule{
			Engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
			Parallel:             false,
			DefaultRoles:         []string{"architect", "planner", "executor", "verifier", "risk"},
			ConvergenceMechanism: "expert_hierarchy_serial_review_then_authority_signoff",
		}
	}
}

func (schedule enginePolicySchedule) roleForIndex(index int) string {
	if index >= 0 && index < len(schedule.DefaultRoles) {
		return schedule.DefaultRoles[index]
	}
	return roleForIndex(index)
}

func evaluateCollaborationEnginePolicy(task *persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode, events ...persistence.TaskEvent) enginePolicyEvaluation {
	taskMeta := map[string]string{}
	if task != nil {
		_ = json.Unmarshal([]byte(task.MetaJSON), &taskMeta)
	}
	if !enginePolicyRuntimeEnabledFromMeta(taskMeta) {
		return enginePolicyEvaluation{}
	}
	authorityMatrix := defaultEnginePolicyAuthorityMatrix()
	authorityRole := authorityMatrix.canonicalRole(firstNonEmptyString(taskMeta[enginePolicyAuthorityRoleMetaKey], taskMeta["authority_role"], "goal_owner"))
	result := enginePolicyEvaluation{
		Enabled:              true,
		Phase:                enginePolicyPhaseAwaitingHuman,
		AuthorityRole:        authorityRole,
		ConvergenceMechanism: "terminal_signoff && pending_authority_objections == 0",
		Verdict:              "未产生终裁意见",
	}

	turns := enginePolicyTurnsFromTaskEvents(events)
	if len(turns) == 0 {
		turns = enginePolicyTurnsFromNodes(nodes)
	}
	for _, turn := range turns {
		role := authorityMatrix.canonicalRole(turn.Role)
		if authorityMatrix.isJudgmentForbidden(role) && turn.Stance != "proposal" {
			result.DowngradedConcerns++
			continue
		}
		switch turn.Stance {
		case "objection":
			if strings.TrimSpace(turn.EvidenceRef) == "" {
				result.DowngradedConcerns++
				continue
			}
			result.EvidenceObjections++
			if authorityMatrix.isHardVeto(role) {
				result.HardVetoObjections++
			}
			if authorityMatrix.isAcceptanceVeto(role) {
				result.AcceptanceVetoes++
			}
		case "counter":
			result.Counters++
		case "signoff":
			if authorityMatrix.canTerminalSignoff(role, authorityRole) && !turn.Escalates {
				result.AuthoritySignoff = true
				if strings.TrimSpace(turn.Text) != "" {
					result.Verdict = strings.TrimSpace(turn.Text)
				}
			}
		}
	}

	result.PendingObjections = result.EvidenceObjections - result.Counters
	if result.PendingObjections < 0 {
		result.PendingObjections = 0
	}
	if result.AuthoritySignoff && result.PendingObjections == 0 {
		result.Phase = enginePolicyPhaseReached
	}
	return result
}

func enginePolicyRuntimeEnabled(task *persistence.CollaborationTask) bool {
	taskMeta := map[string]string{}
	if task != nil {
		_ = json.Unmarshal([]byte(task.MetaJSON), &taskMeta)
	}
	return enginePolicyRuntimeEnabledFromMeta(taskMeta)
}

func enginePolicyRuntimeEnabledFromMeta(taskMeta map[string]string) bool {
	return strings.ToLower(strings.TrimSpace(taskMeta[enginePolicyRuntimeEnabledMetaKey])) == "enabled"
}

func loadEnginePolicyTaskEvents(ctx context.Context, db *gorm.DB, taskID string) ([]persistence.TaskEvent, error) {
	if db == nil || strings.TrimSpace(taskID) == "" {
		return nil, nil
	}
	var events []persistence.TaskEvent
	if err := db.WithContext(ctx).
		Where("task_id = ? AND event_type IN ?", strings.TrimSpace(taskID), []int32{
			int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
			int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED),
		}).
		Order("event_seq ASC").
		Find(&events).Error; err != nil {
		return nil, err
	}
	return events, nil
}

func enginePolicyTurnsFromTaskEvents(events []persistence.TaskEvent) []enginePolicyTurn {
	turns := []enginePolicyTurn{}
	for index := range events {
		if turn, ok := enginePolicyTurnFromTaskEvent(events[index]); ok {
			turns = append(turns, turn)
		}
	}
	return turns
}

func enginePolicyTurnFromTaskEvent(event persistence.TaskEvent) (enginePolicyTurn, bool) {
	if strings.TrimSpace(event.Payload) == "" {
		return enginePolicyTurn{}, false
	}
	var payload struct {
		Role             string                   `json:"role"`
		ResultSummary    string                   `json:"result_summary"`
		EnginePolicyTurn *enginePolicyTurnPayload `json:"engine_policy_turn"`
	}
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		return enginePolicyTurn{}, false
	}
	if payload.EnginePolicyTurn != nil {
		return enginePolicyTurnFromPayload(*payload.EnginePolicyTurn, payload.Role)
	}
	return enginePolicyTurnFromSummary(payload.Role, payload.ResultSummary)
}

func enginePolicyTurnsFromNodes(nodes []persistence.CollaborationTaskNode) []enginePolicyTurn {
	turns := []enginePolicyTurn{}
	for index := range nodes {
		if turn, ok := enginePolicyTurnFromNode(nodes[index]); ok {
			turns = append(turns, turn)
		}
	}
	return turns
}

func enginePolicyTurnFromNode(node persistence.CollaborationTaskNode) (enginePolicyTurn, bool) {
	return enginePolicyTurnFromSummary(node.Role, node.ResultSummary)
}

func enginePolicyTurnFromSummary(role string, summary string) (enginePolicyTurn, bool) {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return enginePolicyTurn{}, false
	}
	if strings.HasPrefix(summary, "{") {
		var payload enginePolicyTurnPayload
		if err := json.Unmarshal([]byte(summary), &payload); err == nil {
			if turn, ok := enginePolicyTurnFromPayload(payload, role); ok {
				if strings.TrimSpace(turn.Text) == "" {
					turn.Text = summary
				}
				return turn, true
			}
		}
	}
	stance := strings.ToLower(strings.TrimSpace(role))
	if !isEnginePolicyStance(stance) {
		return enginePolicyTurn{}, false
	}
	return enginePolicyTurn{
		Role:   role,
		Stance: stance,
		Text:   summary,
	}, true
}

func enginePolicyTurnFromPayload(payload enginePolicyTurnPayload, fallbackRole string) (enginePolicyTurn, bool) {
	stance := strings.ToLower(strings.TrimSpace(payload.Stance))
	if !isEnginePolicyStance(stance) {
		return enginePolicyTurn{}, false
	}
	return enginePolicyTurn{
		Role:        firstNonEmptyString(payload.Role, fallbackRole),
		Stance:      stance,
		Text:        strings.TrimSpace(payload.Text),
		EvidenceRef: firstNonEmptyString(payload.EvidenceRef, payload.EvidenceRefSnake),
		Escalates:   payload.Escalates,
	}, true
}

func enginePolicyTurnProtoFromTaskEventPayload(rawPayload string) *model.EnginePolicyTurn {
	rawPayload = strings.TrimSpace(rawPayload)
	if rawPayload == "" {
		return nil
	}
	var payload struct {
		Role             string                   `json:"role"`
		EnginePolicyTurn *enginePolicyTurnPayload `json:"engine_policy_turn"`
	}
	if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil || payload.EnginePolicyTurn == nil {
		return nil
	}
	turn, ok := enginePolicyTurnFromPayload(*payload.EnginePolicyTurn, payload.Role)
	if !ok {
		return nil
	}
	return enginePolicyTurnToProto(turn)
}

func collaborationSessionEventProtoFromTaskEventPayload(rawPayload string) *model.CollaborationSessionEvent {
	rawPayload = strings.TrimSpace(rawPayload)
	if rawPayload == "" {
		return nil
	}
	var payload struct {
		Role                      string                            `json:"role"`
		CollaborationSessionEvent *collaborationSessionEventPayload `json:"collaboration_session_event"`
	}
	if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil || payload.CollaborationSessionEvent == nil {
		return nil
	}
	sessionEvent := payload.CollaborationSessionEvent
	eventType := collaborationSessionEventTypeToProto(sessionEvent.Type)
	phase := collaborationSessionPhaseToProto(sessionEvent.Phase)
	if eventType == model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_UNSPECIFIED ||
		phase == model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_UNSPECIFIED {
		return nil
	}
	roundIndex := sessionEvent.RoundIndex
	if roundIndex == 0 {
		roundIndex = sessionEvent.RoundIndexSnake
	}
	requiresHuman := sessionEvent.RequiresHuman || sessionEvent.RequiresHumanSnake
	return &model.CollaborationSessionEvent{
		Type:                 eventType,
		Phase:                phase,
		Role:                 firstNonEmptyString(sessionEvent.Role, payload.Role),
		EngineType:           collaborationEngineTypeFromString(firstNonEmptyString(sessionEvent.EngineType, sessionEvent.EngineTypeSnake)),
		RoundIndex:           roundIndex,
		ConvergenceMechanism: firstNonEmptyString(sessionEvent.ConvergenceMechanism, sessionEvent.ConvergenceMechanismSnake),
		EvidenceRef:          firstNonEmptyString(sessionEvent.EvidenceRef, sessionEvent.EvidenceRefSnake),
		Summary:              strings.TrimSpace(sessionEvent.Summary),
		RequiresHuman:        requiresHuman,
	}
}

func collaborationSessionEventTypeToProto(value string) model.CollaborationSessionEventType {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "round_started":
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_ROUND_STARTED
	case "voice_recorded":
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_VOICE_RECORDED
	case "convergence_evaluated":
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_CONVERGENCE_EVALUATED
	case "awaiting_human":
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_AWAITING_HUMAN
	case "reached":
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_REACHED
	default:
		return model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_UNSPECIFIED
	}
}

func collaborationSessionPhaseToProto(value string) model.CollaborationSessionPhase {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "gathering":
		return model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_GATHERING
	case "converging":
		return model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_CONVERGING
	case "awaiting_human":
		return model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_AWAITING_HUMAN
	case "reached":
		return model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_REACHED
	default:
		return model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_UNSPECIFIED
	}
}

func collaborationEngineTypeFromString(value string) model.CollaborationEngineType {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "expert_hierarchy":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY
	case "roundtable":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE
	case "debate_judge":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE
	case "swarm":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM
	case "hierarchy":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY
	case "expert_mesh":
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH
	default:
		return model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED
	}
}

func enginePolicyTurnToProto(turn enginePolicyTurn) *model.EnginePolicyTurn {
	return &model.EnginePolicyTurn{
		Role:        strings.TrimSpace(turn.Role),
		Stance:      enginePolicyStanceToProto(turn.Stance),
		Text:        strings.TrimSpace(turn.Text),
		EvidenceRef: strings.TrimSpace(turn.EvidenceRef),
		Escalates:   turn.Escalates,
	}
}

func enginePolicyStanceToProto(stance string) model.EnginePolicyStance {
	switch strings.ToLower(strings.TrimSpace(stance)) {
	case "proposal":
		return model.EnginePolicyStance_ENGINE_POLICY_STANCE_PROPOSAL
	case "objection":
		return model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION
	case "counter":
		return model.EnginePolicyStance_ENGINE_POLICY_STANCE_COUNTER
	case "signoff":
		return model.EnginePolicyStance_ENGINE_POLICY_STANCE_SIGNOFF
	default:
		return model.EnginePolicyStance_ENGINE_POLICY_STANCE_UNSPECIFIED
	}
}

func enginePolicyTurnPayloadFromTurn(turn enginePolicyTurn) map[string]interface{} {
	payload := map[string]interface{}{
		"role":   strings.TrimSpace(turn.Role),
		"stance": strings.TrimSpace(turn.Stance),
		"text":   strings.TrimSpace(turn.Text),
	}
	if strings.TrimSpace(turn.EvidenceRef) != "" {
		payload["evidenceRef"] = strings.TrimSpace(turn.EvidenceRef)
	}
	if turn.Escalates {
		payload["escalates"] = true
	}
	return payload
}

func isEnginePolicyStance(stance string) bool {
	switch stance {
	case "proposal", "objection", "counter", "signoff":
		return true
	default:
		return false
	}
}

func enginePolicyEvaluationMeta(result enginePolicyEvaluation) map[string]string {
	if !result.Enabled {
		return nil
	}
	return map[string]string{
		"engine_policy_phase":                 result.Phase,
		"engine_policy_authority_role":        result.AuthorityRole,
		"engine_policy_authority_signoff":     strconv.FormatBool(result.AuthoritySignoff),
		"engine_policy_pending_objections":    fmt.Sprintf("%d", result.PendingObjections),
		"engine_policy_evidence_objections":   fmt.Sprintf("%d", result.EvidenceObjections),
		"engine_policy_hard_veto_objections":  fmt.Sprintf("%d", result.HardVetoObjections),
		"engine_policy_acceptance_vetoes":     fmt.Sprintf("%d", result.AcceptanceVetoes),
		"engine_policy_counters":              fmt.Sprintf("%d", result.Counters),
		"engine_policy_downgraded_concerns":   fmt.Sprintf("%d", result.DowngradedConcerns),
		"engine_policy_convergence_mechanism": result.ConvergenceMechanism,
		"engine_policy_verdict":               result.Verdict,
	}
}

func enginePolicyLoadErrorMeta(err error) map[string]string {
	reason := "failed to load durable EnginePolicy task events"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		reason = err.Error()
	}
	return map[string]string{
		"engine_policy_phase":  enginePolicyPhaseAwaitingHuman,
		"engine_policy_error":  reason,
		"engine_policy_source": "agent_task_events",
	}
}
