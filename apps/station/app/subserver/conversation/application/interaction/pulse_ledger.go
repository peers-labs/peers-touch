package interaction

import (
	"context"
	"sync"
	"time"
)

type pulseLedgerKey struct {
	conversation string
	ptid         string
	deviceID     string
}

type pulseLedgerEntry struct {
	generation  uint64
	expiresAt   time.Time
	isTyping    bool
	publishedAt time.Time
}

// MemoryTypingPulseLedger is a bounded ephemeral deduplication and throttle gate.
// It is intentionally not a durable Conversation store.
type MemoryTypingPulseLedger struct {
	mu             sync.Mutex
	maximumEntries int
	entries        map[pulseLedgerKey]pulseLedgerEntry
}

func NewMemoryTypingPulseLedger(maximumEntries int) (*MemoryTypingPulseLedger, error) {
	if maximumEntries <= 0 {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.new_typing_pulse_ledger",
			"maximum_entries",
			"must be positive",
		)
	}

	return &MemoryTypingPulseLedger{
		maximumEntries: maximumEntries,
		entries:        make(map[pulseLedgerKey]pulseLedgerEntry),
	}, nil
}

func (l *MemoryTypingPulseLedger) Admit(
	ctx context.Context,
	pulse TypingPulse,
	now time.Time,
	minimumInterval time.Duration,
) (TypingResult, error) {
	if err := ctx.Err(); err != nil {
		return TypingResult{}, err
	}
	key := pulseLedgerKey{
		conversation: string(pulse.ConversationID),
		ptid:         string(pulse.Sender.Actor),
		deviceID:     string(pulse.Sender.Device),
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for candidate, entry := range l.entries {
		if !entry.expiresAt.After(now) {
			delete(l.entries, candidate)
		}
	}
	current, exists := l.entries[key]
	if exists {
		switch {
		case pulse.Generation < current.generation:
			return TypingResult{}, NewError(
				ErrorCodeStalePulse,
				"interaction.typing_pulse_ledger.admit",
				"pulse_generation",
				"is older than the latest observed generation",
			)
		case pulse.Generation == current.generation &&
			(pulse.IsTyping != current.isTyping ||
				!pulse.ExpiresAt.Equal(current.expiresAt)):
			return TypingResult{}, NewError(
				ErrorCodeIdempotencyConflict,
				"interaction.typing_pulse_ledger.admit",
				"pulse_generation",
				"already identifies a different pulse",
			)
		case pulse.Generation == current.generation:
			return TypingResult{
				Accepted:  false,
				ExpiresAt: current.expiresAt,
			}, nil
		}
	}
	if !exists && len(l.entries) >= l.maximumEntries {
		return TypingResult{}, NewError(
			ErrorCodeQuotaExceeded,
			"interaction.typing_pulse_ledger.admit",
			"active_pulses",
			"has reached the bounded in-memory limit",
		)
	}
	accepted := !pulse.IsTyping ||
		!exists ||
		now.Sub(current.publishedAt) >= minimumInterval
	entry := pulseLedgerEntry{
		generation: pulse.Generation,
		expiresAt:  pulse.ExpiresAt,
		isTyping:   pulse.IsTyping,
	}
	if accepted {
		entry.publishedAt = now
	} else {
		entry.publishedAt = current.publishedAt
	}
	l.entries[key] = entry

	return TypingResult{
		Accepted:  accepted,
		ExpiresAt: pulse.ExpiresAt,
	}, nil
}

var _ TypingPulseLedger = (*MemoryTypingPulseLedger)(nil)
