package domain

import "time"

const (
	MemoryTargetMemory = "memory"
	MemoryTargetUser   = "user"

	MemoryCharLimitMemory = 2200
	MemoryCharLimitUser   = 1375

	MemorySeparator = "\n§\n"
)

type MemoryLayer string

const (
	MemoryLayerIdentity   MemoryLayer = "identity"
	MemoryLayerContext    MemoryLayer = "context"
	MemoryLayerExperience MemoryLayer = "experience"
	MemoryLayerPreference MemoryLayer = "preference"
	MemoryLayerActivity   MemoryLayer = "activity"
)

var MemoryLayers = []MemoryLayer{
	MemoryLayerIdentity,
	MemoryLayerContext,
	MemoryLayerExperience,
	MemoryLayerPreference,
	MemoryLayerActivity,
}

// MemoryStatus is the durable lifecycle gate. Only Confirmed entries may be
// consumed by a Turn. Candidates await human confirmation; Rejected entries
// are retained for audit but excluded from every consumption path.
type MemoryStatus string

const (
	MemoryStatusCandidate MemoryStatus = "candidate"
	MemoryStatusConfirmed MemoryStatus = "confirmed"
	MemoryStatusRejected  MemoryStatus = "rejected"
)

// NormalizeMemoryStatus resolves an empty/unknown value to Confirmed so that
// rows written before the lifecycle gate (and explicit writes) stay active.
func NormalizeMemoryStatus(value string) MemoryStatus {
	switch MemoryStatus(value) {
	case MemoryStatusCandidate:
		return MemoryStatusCandidate
	case MemoryStatusRejected:
		return MemoryStatusRejected
	default:
		return MemoryStatusConfirmed
	}
}

type MemoryItem struct {
	MemoryID       string
	AgentID        string
	Target         string
	Layer          MemoryLayer
	SessionID      string
	Content        string
	SourceTurnID   string
	Source         string // "turn" | "review" | "flush" | "manual"
	SourceReviewID string
	Summary        string
	Relevance      float64
	IsFrozen       bool
	TrustScore     float64 // [0.0, 1.0], initial 0.5
	RetrievalCount int
	LastAccessedAt *time.Time
	HelpfulCount   int
	HarmfulCount   int
	Status         MemoryStatus
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
	AgentID        string
	MemoryContent  string
	UserContent    string
	PersonaContent string
	RelevantItems  []MemoryItem
	CapturedAt     time.Time
	// Degraded is true when retrieval failed and the snapshot intentionally
	// carries no injected memory rather than a full arbitrary snapshot.
	Degraded bool
}

type MemoryAction string

const (
	MemoryActionAdd     MemoryAction = "add"
	MemoryActionReplace MemoryAction = "replace"
	MemoryActionRemove  MemoryAction = "remove"
)

type MemoryListOptions struct {
	AgentID  string
	Target   string
	Layer    MemoryLayer
	Status   MemoryStatus
	Page     int
	PageSize int
	OrderBy  string
	Since    *time.Time
	Until    *time.Time
}

type MemorySearchOptions struct {
	AgentID string
	Query   string
	Layers  []MemoryLayer
	Limit   int
	Effort  string
	Since   *time.Time
	Until   *time.Time
}

type MemoryScoreExplain struct {
	VectorScore   float64
	KeywordScore  float64
	WeightedScore float64
	DecayFactor   float64
	AfterDecay    float64
	AfterRerank   float64
	FinalScore    float64
	TrustFactor   float64
}

type ScoredMemory struct {
	Memory  MemoryItem
	Score   float64
	Explain MemoryScoreExplain
}

type MemoryPersona struct {
	Tagline   string
	Narrative string
	UpdatedAt time.Time
}

type MemoryStats struct {
	Total        int
	ByLayer      map[MemoryLayer]int
	StorageBytes int64
}

type MemoryEventType string

const (
	MemoryEventExtraction         MemoryEventType = "extraction"
	MemoryEventRetrieval          MemoryEventType = "retrieval"
	MemoryEventAccess             MemoryEventType = "access"
	MemoryEventDedupSkip          MemoryEventType = "dedup_skip"
	MemoryEventDeletion           MemoryEventType = "deletion"
	MemoryEventPersonaUpdate      MemoryEventType = "persona_update"
	MemoryEventFeedback           MemoryEventType = "feedback"
	MemoryEventCandidateConfirmed MemoryEventType = "candidate_confirmed"
	MemoryEventCandidateRejected  MemoryEventType = "candidate_rejected"
	MemoryEventRetrievalDegraded  MemoryEventType = "retrieval_degraded"
)

type MemoryEvent struct {
	ID        string
	Type      MemoryEventType
	MemoryID  string
	SessionID string
	AgentID   string
	Layer     MemoryLayer
	Detail    string
	LatencyMs int64
	Timestamp time.Time
}

type MemoryEventQueryOptions struct {
	Type    MemoryEventType
	AgentID string
	Limit   int
	Offset  int
	Since   *time.Time
	Until   *time.Time
}
