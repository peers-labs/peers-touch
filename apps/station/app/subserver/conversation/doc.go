// Package conversation implements the unified conversation domain service.
//
// This is the command/query layer for all conversation types (direct and group).
// It receives ConversationCommands from clients, validates them against membership
// and authority rules, produces CommittedConversationEvents, and routes them
// through the envelope service (D-10) for delivery.
//
// Per D-10: conversation logic owns the "what" (validate, sequence, commit);
// the envelope subsystem owns the "how" (durable delivery, retry, federation).
//
// See docs/architecture/federated-im/decisions.md D-08..D-12.
// See model/domain/chat/conversation.proto for the data contract.
package conversation
