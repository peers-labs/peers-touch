// Change-log:
// 2026-04-11 — Initial implementation: ReviewType, ReviewResult, NudgeState
//   with threshold-based nudge triggers.
// 2026-04-11 — Fix: NudgeState data race. Fields are shared between the main
//   goroutine (TurnService.ExecuteTurn increments counters) and the background
//   review goroutine (ReviewService.runReview resets counters). Added sync.Mutex
//   and encapsulated all field access behind thread-safe methods.

package domain

import (
	"sync"
	"time"
)

type ReviewType string

const (
	ReviewTypeMemory   ReviewType = "memory"
	ReviewTypeSkill    ReviewType = "skill"
	ReviewTypeCombined ReviewType = "combined"
)

type ReviewResult struct {
	ReviewID       string
	TurnID         string
	ConversationID string
	AgentID        string
	ReviewType     ReviewType
	ActionsTaken   []string
	SourceItems    []string // IDs of memory/skill items created by this review
	OutcomeTracked bool     // true if a subsequent turn validated review output
	ErrorReason    string
	RetryAttempted bool
	CredentialID   string
	TriggeredAt    time.Time
	CompletedAt    *time.Time
}

// NudgeState tracks turn/iteration counters that decide when to trigger a
// background review. All fields are guarded by mu because the main goroutine
// (TurnService.ExecuteTurn) increments counters while the background review
// goroutine (ReviewService.runReview) resets them concurrently.
type NudgeState struct {
	mu                        sync.Mutex
	turnsSinceMemoryReview    int
	itersSinceSkillReview     int
	memoryNudgeInterval       int
	skillNudgeInterval        int
	consecutiveIneffective    int // consecutive reviews that produced nothing useful
	maxConsecutiveIneffective int // after this many, double the nudge intervals
}

const (
	defaultNudgeInterval          = 10
	maxAdaptiveNudgeInterval      = 40
	ineffectiveThresholdForBackoff = 3
)

func NewNudgeState() *NudgeState {
	return &NudgeState{
		memoryNudgeInterval:       defaultNudgeInterval,
		skillNudgeInterval:        defaultNudgeInterval,
		maxConsecutiveIneffective: ineffectiveThresholdForBackoff,
	}
}

// RecordReviewOutcome tracks whether a review was effective or not.
// If consecutive ineffective reviews exceed the threshold, nudge intervals
// are doubled (up to maxAdaptiveNudgeInterval). An effective review resets.
func (n *NudgeState) RecordReviewOutcome(effective bool) {
	n.mu.Lock()
	defer n.mu.Unlock()

	if effective {
		n.consecutiveIneffective = 0
		n.memoryNudgeInterval = defaultNudgeInterval
		n.skillNudgeInterval = defaultNudgeInterval
		return
	}

	n.consecutiveIneffective++
	if n.consecutiveIneffective >= n.maxConsecutiveIneffective {
		if n.memoryNudgeInterval < maxAdaptiveNudgeInterval {
			n.memoryNudgeInterval *= 2
			if n.memoryNudgeInterval > maxAdaptiveNudgeInterval {
				n.memoryNudgeInterval = maxAdaptiveNudgeInterval
			}
		}
		if n.skillNudgeInterval < maxAdaptiveNudgeInterval {
			n.skillNudgeInterval *= 2
			if n.skillNudgeInterval > maxAdaptiveNudgeInterval {
				n.skillNudgeInterval = maxAdaptiveNudgeInterval
			}
		}
	}
}

// IncrementTurnCounter atomically increments the memory-review turn counter.
func (n *NudgeState) IncrementTurnCounter() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.turnsSinceMemoryReview++
}

// IncrementIterCounter atomically increments the skill-review iteration counter
// by toolIterations + 1 (one base iteration plus one per tool round).
func (n *NudgeState) IncrementIterCounter(toolIterations int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.itersSinceSkillReview += toolIterations + 1
}

// ShouldTriggerMemoryReview returns true when the turn counter has reached
// the memory nudge interval threshold.
func (n *NudgeState) ShouldTriggerMemoryReview() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.turnsSinceMemoryReview >= n.memoryNudgeInterval
}

// ShouldTriggerSkillReview returns true when the iteration counter has reached
// the skill nudge interval threshold.
func (n *NudgeState) ShouldTriggerSkillReview() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.itersSinceSkillReview >= n.skillNudgeInterval
}

// ResetMemoryCounter atomically zeroes the memory-review turn counter.
func (n *NudgeState) ResetMemoryCounter() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.turnsSinceMemoryReview = 0
}

// ResetSkillCounter atomically zeroes the skill-review iteration counter.
func (n *NudgeState) ResetSkillCounter() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.itersSinceSkillReview = 0
}

// ForceMemoryReview sets the counter above the threshold so the next
// ShouldTriggerMemoryReview call returns true. Used by the scheduler to
// force a SILENT review without waiting for organic turn accumulation.
func (n *NudgeState) ForceMemoryReview() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.turnsSinceMemoryReview = n.memoryNudgeInterval
}

// GetCounters returns a consistent snapshot of both counters under a single lock.
func (n *NudgeState) GetCounters() (turnsSinceMemory, itersSinceSkill int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.turnsSinceMemoryReview, n.itersSinceSkillReview
}
