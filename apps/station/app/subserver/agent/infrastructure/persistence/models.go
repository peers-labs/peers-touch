package persistence

// AllModels returns all GORM models for AutoMigrate registration.
// 2026-04-11 — Added MemorySnapshot and SkillVersion for rollback support.
// 2026-04-11 — Added GrowthEvent and UserFeedback for Growth Dashboard.
// 2026-04-11 — Added SuspectedItem and DiagnosticReport for growth diagnostic.
// 2026-06-26 — Added AgentOfflineOp for offline operation queue.
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
		&AgentChatConfig{},
		&AgentModelParams{},
		&AgentKnowledgeBinding{},
		&AgentSkillBinding{},
		&AgentMcpBinding{},
		&AgentVoiceConfig{},
		&AgentToolProfile{},
		&AgentOfflineOp{},
		&CollaborationTask{},
		&CollaborationTaskNode{},
	}
}
