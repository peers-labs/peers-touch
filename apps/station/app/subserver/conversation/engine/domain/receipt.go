package domain

import (
	"context"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// ReadCursorRepository persists per-actor read cursors for conversations.
// The cursor tracks the last-read sequence number per conversation per actor.
type ReadCursorRepository interface {
	// UpsertReadCursor persists or advances a read cursor. The implementation
	// must only advance the cursor (never regress); if the submitted sequence
	// is lower than or equal to the persisted value, the write is a no-op.
	UpsertReadCursor(ctx context.Context, cursor *chat.ActorReadCursor) error

	// GetReadCursor returns the persisted read cursor for a given actor in a
	// conversation. Returns ErrNotFound if no cursor exists.
	GetReadCursor(
		ctx context.Context,
		conversationID string,
		readerPTID string,
	) (*chat.ActorReadCursor, error)

	// ListReadCursors returns all persisted read cursors for a conversation.
	ListReadCursors(
		ctx context.Context,
		conversationID string,
	) ([]*chat.ActorReadCursor, error)
}
