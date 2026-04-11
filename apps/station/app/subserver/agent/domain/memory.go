package domain

import "time"

const (
	MemoryTargetMemory = "memory"
	MemoryTargetUser   = "user"

	MemoryCharLimitMemory = 2200
	MemoryCharLimitUser   = 1375

	MemorySeparator = "\n§\n"
)

type MemoryItem struct {
	MemoryID       string
	AgentID        string
	Target         string
	Content        string
	SourceTurnID   string
	Source         string // "turn" | "review" | "flush" | "manual"
	SourceReviewID string
	IsFrozen       bool
	TrustScore     float64 // [0.0, 1.0], initial 0.5
	RetrievalCount int
	HelpfulCount   int
	HarmfulCount   int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

const (
	MemorySourceTurn   = "turn"
	MemorySourceReview = "review"
	MemorySourceFlush  = "flush"
	MemorySourceManual = "manual"

	MemoryDefaultTrustScore       = 0.5
	MemoryReviewInitialTrustScore = 0.4
	TrustScorePositiveDelta       = 0.05
	TrustScoreNegativeDelta       = 0.10
)

type MemorySnapshot struct {
	AgentID       string
	MemoryContent string
	UserContent   string
	CapturedAt    time.Time
}

type MemoryAction string

const (
	MemoryActionAdd     MemoryAction = "add"
	MemoryActionReplace MemoryAction = "replace"
	MemoryActionRemove  MemoryAction = "remove"
)
