package agent

import (
	"context"
	"fmt"
	"strconv"

	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

type actorPTIDResolverAdapter struct{}

func (actorPTIDResolverAdapter) ResolvePTID(ctx context.Context, actorID string) (string, error) {
	numericID, err := strconv.ParseUint(actorID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("actor ID is not numeric: %w", err)
	}
	actor, err := touchactor.GetActorByID(ctx, numericID)
	if err != nil {
		return "", fmt.Errorf("actor lookup failed: %w", err)
	}
	if actor == nil || actor.PTID == "" {
		return "", fmt.Errorf("actor %s has no PTID", actorID)
	}
	return actor.PTID, nil
}
