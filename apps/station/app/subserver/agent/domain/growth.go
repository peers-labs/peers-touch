// Changelog:
// 2026-04-11 — Initial implementation: domain types for the Growth Dashboard.
//   FeedbackSignal validation type for handler-level input checks.

package domain

// ---------------------------------------------------------------------------
// Feedback — explicit user signal for a turn
// ---------------------------------------------------------------------------

// FeedbackSignal enumerates valid feedback signals.
type FeedbackSignal string

const (
	FeedbackPositive FeedbackSignal = "positive"
	FeedbackNegative FeedbackSignal = "negative"
)

// IsValid returns true when the signal is one of the allowed values.
func (f FeedbackSignal) IsValid() bool {
	return f == FeedbackPositive || f == FeedbackNegative
}
