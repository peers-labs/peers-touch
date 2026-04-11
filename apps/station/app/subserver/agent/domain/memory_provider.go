// Changelog:
// 2026-04-11 — Created MemoryProvider interface: lifecycle hooks for external
//   memory backends (Honcho, Mem0, Hindsight). The built-in MemoryService
//   always operates independently; an external provider is optional and at
//   most one may be active at a time.
// 2026-04-11 — MemoryWriteEvent moved here from service layer so that
//   the provider interface can reference it without circular imports.

package domain

// MemoryProvider defines the lifecycle hooks for external memory backends
// (e.g. Honcho, Mem0, Hindsight). The built-in memory store (MemoryService)
// always operates independently; an external provider is optional and at most
// one may be active at a time.
type MemoryProvider interface {
	// Initialize prepares the provider for the given session.
	Initialize(sessionID string) error

	// SystemPromptBlock returns a provider-specific block to inject into the
	// system prompt (e.g. retrieved memories, personality context).
	SystemPromptBlock() string

	// Prefetch performs a synchronous semantic retrieval for the given query.
	Prefetch(query string) (string, error)

	// QueuePrefetch enqueues an asynchronous prefetch that the provider will
	// resolve in the background before the next turn.
	QueuePrefetch(query string)

	// SyncTurn persists both sides of a conversational turn.
	SyncTurn(userMessage, assistantMessage string) error

	// OnTurnStart is called at the beginning of each turn with the user message.
	OnTurnStart(turnID, message string)

	// OnPreCompress is called before the conversation window is compressed,
	// giving the provider a chance to archive evicted messages.
	OnPreCompress(messages []Message) error

	// OnSessionEnd is called when the conversation session ends, providing
	// the final message window for archival.
	OnSessionEnd(messages []Message) error

	// OnMemoryWrite is called after every successful Add / Replace / Remove
	// in the built-in memory store, so external backends can stay in sync.
	OnMemoryWrite(event MemoryWriteEvent) error

	// OnDelegation is called when an agent delegates a sub-task to another
	// agent, allowing the provider to record the delegation context.
	OnDelegation(taskDescription, resultSummary string) error

	// Shutdown performs a graceful teardown of the provider.
	Shutdown() error
}

// MemoryWriteEvent captures a memory mutation for external provider
// synchronisation and future event/hook support.
type MemoryWriteEvent struct {
	Action  MemoryAction
	Target  string
	Content string
	OldText string
}
