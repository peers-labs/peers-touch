package application

import (
	"context"
	"fmt"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func stationModerationBlocksStation(
	ctx context.Context,
	repo domain.StationModerationRepository,
	stationDomain string,
	stationPeerID string,
) (bool, error) {
	if repo == nil {
		return false, nil
	}
	stationDomain = strings.TrimSpace(stationDomain)
	stationPeerID = strings.TrimSpace(stationPeerID)
	if stationDomain == "" && stationPeerID == "" {
		return false, nil
	}
	blocked, err := repo.IsBlockedStation(ctx, stationDomain, stationPeerID)
	if err != nil {
		return false, fmt.Errorf("check blocked station: %w", err)
	}
	return blocked, nil
}

func actorStationModerated(
	ctx context.Context,
	repo domain.StationModerationRepository,
	actorID uint64,
) (bool, error) {
	if repo == nil || actorID == 0 {
		return false, nil
	}
	a, err := actor.GetActorByID(ctx, actorID)
	if err != nil {
		return false, fmt.Errorf("lookup actor station: %w", err)
	}
	if a == nil {
		return false, nil
	}
	return stationModerationBlocksStation(ctx, repo, a.HomeStationDomain, a.HomeStationPeerID)
}

func postAuthorStationModerated(
	ctx context.Context,
	repo domain.StationModerationRepository,
	post *model.Post,
) (bool, error) {
	if repo == nil || post == nil {
		return false, nil
	}
	if author := post.GetAuthor(); author != nil {
		if blocked, err := stationModerationBlocksStation(ctx, repo, author.GetHomeStationDomain(), ""); blocked || err != nil {
			return blocked, err
		}
	}
	authorID := parseActorID(post.GetAuthorId())
	if authorID == 0 && post.GetAuthor() != nil {
		authorID = parseActorID(post.GetAuthor().GetId())
	}
	return actorStationModerated(ctx, repo, authorID)
}
