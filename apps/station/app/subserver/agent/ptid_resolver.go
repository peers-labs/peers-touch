package agent

import (
	"context"
	"fmt"
	"strconv"

	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type actorPTIDResolverAdapter struct{}

func (actorPTIDResolverAdapter) ResolvePTID(ctx context.Context, actorID string) (string, error) {
	numericID, err := strconv.ParseUint(actorID, 10, 64)
	if err != nil {
		logger.Warnf(ctx, "actorPTIDResolver: actor ID %q is not numeric: %v", actorID, err)
		return "", fmt.Errorf("actor ID is not numeric: %w", err)
	}
	actor, err := touchactor.GetActorByID(ctx, numericID)
	if err != nil {
		logger.Warnf(ctx, "actorPTIDResolver: GetActorByID(%d) failed: %v", numericID, err)
		return "", fmt.Errorf("actor lookup failed: %w", err)
	}
	if actor == nil || actor.PTID == "" {
		logger.Warnf(ctx, "actorPTIDResolver: actor %d has no PTID", numericID)
		return "", fmt.Errorf("actor %s has no PTID", actorID)
	}
	return actor.PTID, nil
}
