package securecontent

type PlanState string

const (
	PlanStatePreparing      PlanState = "preparing"
	PlanStatePrekeysClaimed PlanState = "prekeys_claimed"
	PlanStatePrepared       PlanState = "prepared"
	PlanStateConsumed       PlanState = "consumed"
	PlanStateRetryWait      PlanState = "retry_wait"
	PlanStateExpired        PlanState = "expired"
	PlanStateRejectedStale  PlanState = "rejected_stale"
)

// TransferState values intentionally preserve the existing Conversation wire
// and persistence representation.
type TransferState int32

const (
	TransferStateQueued         TransferState = 1
	TransferStateTransferring   TransferState = 2
	TransferStateVerifying      TransferState = 3
	TransferStateComplete       TransferState = 4
	TransferStateRetryWait      TransferState = 5
	TransferStateCancelled      TransferState = 6
	TransferStateTerminal       TransferState = 7
	TransferStateCleanupClaimed TransferState = 8
	TransferStateCleanupFailed  TransferState = 9
)

type ObjectState string

const (
	ObjectStateCompleteUnattached ObjectState = "complete_unattached"
	ObjectStateAttached           ObjectState = "attached"
	ObjectStateCleanupClaimed     ObjectState = "cleanup_claimed"
	ObjectStateGarbageCollected   ObjectState = "garbage_collected"
	ObjectStateCleanupFailed      ObjectState = "cleanup_failed"
)

func ValidatePlanTransition(from PlanState, to PlanState) error {
	if from == to && validPlanState(from) {
		return nil
	}

	allowed := false
	switch from {
	case PlanStatePreparing:
		allowed = to == PlanStatePrekeysClaimed || to == PlanStateRetryWait
	case PlanStatePrekeysClaimed:
		allowed = to == PlanStatePrepared || to == PlanStateRetryWait
	case PlanStateRetryWait:
		allowed = to == PlanStatePreparing || to == PlanStatePrekeysClaimed
	case PlanStatePrepared:
		allowed = to == PlanStateConsumed ||
			to == PlanStateExpired ||
			to == PlanStateRejectedStale
	}
	if !allowed {
		return invalidTransition("plan", string(from), string(to))
	}

	return nil
}

func ValidateTransferTransition(from TransferState, to TransferState) error {
	if from == to && validTransferState(from) {
		return nil
	}

	allowed := false
	switch from {
	case TransferStateQueued:
		allowed = to == TransferStateTransferring ||
			to == TransferStateCancelled ||
			to == TransferStateCleanupClaimed
	case TransferStateTransferring:
		allowed = to == TransferStateVerifying ||
			to == TransferStateCancelled ||
			to == TransferStateCleanupClaimed
	case TransferStateVerifying:
		allowed = to == TransferStateComplete ||
			to == TransferStateCleanupClaimed
	case TransferStateComplete:
		allowed = to == TransferStateTerminal
	case TransferStateRetryWait:
		allowed = to == TransferStateCleanupClaimed
	case TransferStateCancelled, TransferStateTerminal:
		allowed = to == TransferStateCleanupClaimed
	case TransferStateCleanupClaimed:
		allowed = to == TransferStateTerminal ||
			to == TransferStateRetryWait ||
			to == TransferStateCleanupFailed
	}
	if !allowed {
		return invalidTransition("transfer", transferStateName(from), transferStateName(to))
	}

	return nil
}

func ValidateObjectTransition(from ObjectState, to ObjectState) error {
	if from == to && validObjectState(from) {
		return nil
	}

	allowed := false
	switch from {
	case ObjectStateCompleteUnattached:
		allowed = to == ObjectStateAttached || to == ObjectStateCleanupClaimed
	case ObjectStateCleanupClaimed:
		allowed = to == ObjectStateGarbageCollected ||
			to == ObjectStateCompleteUnattached ||
			to == ObjectStateCleanupFailed
	}
	if !allowed {
		return invalidTransition("object", string(from), string(to))
	}

	return nil
}

func validPlanState(state PlanState) bool {
	switch state {
	case PlanStatePreparing,
		PlanStatePrekeysClaimed,
		PlanStatePrepared,
		PlanStateConsumed,
		PlanStateRetryWait,
		PlanStateExpired,
		PlanStateRejectedStale:
		return true
	default:
		return false
	}
}

func validTransferState(state TransferState) bool {
	return state >= TransferStateQueued && state <= TransferStateCleanupFailed
}

func validObjectState(state ObjectState) bool {
	switch state {
	case ObjectStateCompleteUnattached,
		ObjectStateAttached,
		ObjectStateCleanupClaimed,
		ObjectStateGarbageCollected,
		ObjectStateCleanupFailed:
		return true
	default:
		return false
	}
}

func invalidTransition(kind string, from string, to string) error {
	return NewError(
		ErrorCodeInvalidState,
		"securecontent.validate_"+kind+"_transition",
		"state",
		"transition "+from+" -> "+to+" is not allowed",
	)
}

func transferStateName(state TransferState) string {
	switch state {
	case TransferStateQueued:
		return "queued"
	case TransferStateTransferring:
		return "transferring"
	case TransferStateVerifying:
		return "verifying"
	case TransferStateComplete:
		return "complete"
	case TransferStateRetryWait:
		return "retry_wait"
	case TransferStateCancelled:
		return "cancelled"
	case TransferStateTerminal:
		return "terminal"
	case TransferStateCleanupClaimed:
		return "cleanup_claimed"
	case TransferStateCleanupFailed:
		return "cleanup_failed"
	default:
		return "unspecified"
	}
}
