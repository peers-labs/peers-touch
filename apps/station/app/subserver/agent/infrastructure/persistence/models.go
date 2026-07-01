package persistence

// AllModels returns all GORM models for AutoMigrate registration.
// 2026-04-11 — Added MemorySnapshot and SkillVersion for rollback support.
// 2026-04-11 — Added GrowthEvent and UserFeedback for Growth Dashboard.
// 2026-04-11 — Added SuspectedItem and DiagnosticReport for growth diagnostic.
// 2026-06-26 — Added AgentOfflineOp for offline operation queue.
// 2026-06-30 — Added TaskRun/ExecutionStep/ExecutorLease/TaskCheckpoint for chat root task.
func AllModels() []interface{} {
	return []interface{}{
		&Agent{},
		&Conversation{},
		&AgentMessage{},
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
		&TaskRun{},
		&ExecutionStep{},
		&ExecutorLease{},
		&TaskCheckpoint{},
	}
}
