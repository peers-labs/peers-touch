package persistence

// AllModels returns all GORM models for AutoMigrate registration.
// 2026-04-11 — Added MemorySnapshot and SkillVersion for rollback support.
// 2026-04-11 — Added GrowthEvent and UserFeedback for Growth Dashboard.
// 2026-04-11 — Added SuspectedItem and DiagnosticReport for growth diagnostic.
// 2026-06-26 — Added AgentOfflineOp for offline operation queue.
// 2026-06-30 — Added TaskRun/ExecutionStep/ExecutorLease/TaskCheckpoint for chat root task.
// 2026-07-04 — Added InterruptRequest for durable interrupt lifecycle state.
// 2026-07-04 — Added TaskArtifact for durable artifact evidence indexing.
// 2026-07-04 — Added TaskGatePlan for durable Station-owned gate plans.
// 2026-07-04 — Added TaskGateResult for durable gate result query indexing.
// 2026-07-04 — Added TaskArtifactBlob for Station-owned artifact body storage.
// 2026-07-04 — Added TaskProviderPlan for durable Station-owned provider plans.
// 2026-07-04 — Added ProjectBlocker/ProjectResidualRisk for Station-owned acceptance query indexes.
// 2026-07-04 — Added ProjectState for Station-owned Project/Milestone state query index.
// 2026-07-04 — Added AcceptancePredicate for Station-owned acceptance registry/query index.
// 2026-07-04 — Added AtelierMilestone/AtelierTaskGraph indexes for Station-owned project structure projection.
// 2026-07-04 — Added AtelierPolicy/AtelierDefect indexes for Station-owned project policy projection.
// 2026-07-05 — Added DirectRun for Station-owned direct model runtime records.
// 2026-07-05 — Added TaskBudgetUsage for Station-owned budget usage evidence indexing.
// 2026-08-14 — Added EcosystemAgentGroup, EcosystemTopicComment, EcosystemEvalDataset, EcosystemCustomPlugin for M11 localStorage→Station migration.
// 2026-08-16 — Added AgentThread for R11 durable conversation Thread (sub-conversation) support.
// 2026-08-16 — Added AgentTask for O3 user-created single-agent task lifecycle (localStorage→Station).
func AllModels() []interface{} {
	return []interface{}{
		&Agent{},
		&Conversation{},
		&AgentMessage{},
		&AgentThread{},
		&AgentTask{},
		&Memory{},
		&MemoryEvent{},
		&MemorySnapshot{},
		&Skill{},
		&SkillVersion{},
		&Review{},
		&Credential{},
		&AgentProvider{},
		&AgentTurn{},
		&TurnTrace{},
		&GrowthEvent{},
		&UserFeedback{},
		&SuspectedItem{},
		&DiagnosticReport{},
		&AgentWorkspace{},
		&AgentWorkspaceFile{},
		&AgentKnowledgeBinding{},
		&AgentSkillBinding{},
		&AgentMcpBinding{},
		&AgentOfflineOp{},
		&CollaborationTask{},
		&CollaborationTaskNode{},
		&TaskEvent{},
		&TurnEvent{},
		&InterruptRequest{},
		&TaskArtifact{},
		&TaskArtifactBlob{},
		&TaskBudgetUsage{},
		&TaskProviderPlan{},
		&DirectRun{},
		&ProjectState{},
		&AcceptancePredicate{},
		&AtelierMilestone{},
		&AtelierTaskGraphNode{},
		&AtelierTaskGraphEdge{},
		&AtelierPolicy{},
		&AtelierPolicyRule{},
		&AtelierDefect{},
		&ProjectBlocker{},
		&ProjectResidualRisk{},
		&TaskGatePlan{},
		&TaskGateResult{},
		&TaskRun{},
		&ExecutionStep{},
		&ExecutorLease{},
		&TaskCheckpoint{},
		&AgentModel{},
		&EcosystemAgentGroup{},
		&EcosystemTopicComment{},
		&EcosystemEvalDataset{},
		&EcosystemCustomPlugin{},
	}
}
