package actor

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type FederationCatalogActor struct {
	ActorPTID         string
	FederatedHandle   string
	DisplayName       string
	AvatarURL         string
	HomeStationPeerID string
	Region            string
}

type FederationCatalogQuery struct {
	FederationID string
	Prefix       string
	RegionPrefix string
	AfterHandle  string
	AfterPTID    string
	Limit        int
}

type federationCatalogIndexEntry struct {
	FederationCatalogActor
	actorID            uint64
	sortKey            string
	visibleFederations map[string]struct{}
}

type federationCatalogIndex struct {
	mu      sync.RWMutex
	entries []federationCatalogIndexEntry
}

var processFederationCatalogIndex federationCatalogIndex

func RemoveFederationCatalogActor(actorID uint64) {
	processFederationCatalogIndex.mu.Lock()
	defer processFederationCatalogIndex.mu.Unlock()
	current := processFederationCatalogIndex.entries
	filtered := make([]federationCatalogIndexEntry, 0, len(current))
	for i := range current {
		if current[i].actorID != actorID {
			filtered = append(filtered, current[i])
		}
	}
	processFederationCatalogIndex.entries = filtered
}

func RebuildFederationCatalogIndex(ctx context.Context) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	var actors []db.Actor
	if err := rds.WithContext(ctx).
		Where("origin = ? AND visibility = ?", OriginLocal, VisibilityIndexed).
		Find(&actors).Error; err != nil {
		return err
	}

	entries := make([]federationCatalogIndexEntry, 0, len(actors))
	for i := range actors {
		entry, err := loadFederationCatalogIndexEntry(ctx, rds, &actors[i])
		if err != nil {
			return err
		}
		if entry != nil {
			entries = append(entries, *entry)
		}
	}
	sortFederationCatalogEntries(entries)

	processFederationCatalogIndex.mu.Lock()
	processFederationCatalogIndex.entries = entries
	processFederationCatalogIndex.mu.Unlock()
	return nil
}

func RefreshFederationCatalogActor(ctx context.Context, actorID uint64) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	var actor db.Actor
	err = rds.WithContext(ctx).First(&actor, actorID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	var next *federationCatalogIndexEntry
	if err == nil &&
		actor.Origin == OriginLocal &&
		actor.Visibility == VisibilityIndexed {
		next, err = loadFederationCatalogIndexEntry(ctx, rds, &actor)
		if err != nil {
			return err
		}
	}

	processFederationCatalogIndex.mu.Lock()
	defer processFederationCatalogIndex.mu.Unlock()
	current := processFederationCatalogIndex.entries
	filtered := make([]federationCatalogIndexEntry, 0, len(current)+1)
	for i := range current {
		if current[i].actorID != actorID {
			filtered = append(filtered, current[i])
		}
	}
	if next != nil {
		filtered = append(filtered, *next)
	}
	sortFederationCatalogEntries(filtered)
	processFederationCatalogIndex.entries = filtered
	return nil
}

func SearchFederationCatalog(
	query FederationCatalogQuery,
) ([]FederationCatalogActor, uint32, bool) {
	federationID := strings.TrimSpace(query.FederationID)
	prefix := catalogSearchKey(query.Prefix)
	regionPrefix := strings.ToLower(strings.TrimSpace(query.RegionPrefix))
	afterHandle := catalogSearchKey(query.AfterHandle)
	afterPTID := strings.TrimSpace(query.AfterPTID)
	if federationID == "" || prefix == "" || query.Limit <= 0 {
		return nil, 0, false
	}

	processFederationCatalogIndex.mu.RLock()
	defer processFederationCatalogIndex.mu.RUnlock()
	entries := processFederationCatalogIndex.entries
	first := sort.Search(len(entries), func(i int) bool {
		return entries[i].sortKey >= prefix
	})

	result := make([]FederationCatalogActor, 0, query.Limit)
	var total uint32
	hasMore := false
	for i := first; i < len(entries); i++ {
		entry := entries[i]
		if !strings.HasPrefix(entry.sortKey, prefix) {
			break
		}
		if _, visible := entry.visibleFederations[federationID]; !visible {
			continue
		}
		if regionPrefix != "" &&
			!strings.HasPrefix(strings.ToLower(entry.Region), regionPrefix) {
			continue
		}
		total++
		if entry.sortKey < afterHandle ||
			(entry.sortKey == afterHandle && entry.ActorPTID <= afterPTID) {
			continue
		}
		if len(result) >= query.Limit {
			hasMore = true
			continue
		}
		result = append(result, entry.FederationCatalogActor)
	}
	return result, total, hasMore
}

func loadFederationCatalogIndexEntry(
	ctx context.Context,
	rds *gorm.DB,
	actor *db.Actor,
) (*federationCatalogIndexEntry, error) {
	if actor == nil ||
		actor.PTID == "" ||
		actor.HomeStationPeerID == "" ||
		actor.FederatedHandle == "" {
		return nil, nil
	}

	var meta db.ActorTouchMeta
	if err := rds.WithContext(ctx).
		Select("actor_id", "region").
		Where("actor_id = ?", actor.ID).
		First(&meta).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var rows []db.ActorFederationVisibility
	if err := rds.WithContext(ctx).
		Select("federation_id").
		Where(
			"actor_id = ? AND visibility = ?",
			actor.ID,
			VisibilityIndexed,
		).
		Order("federation_id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	visibleFederations := make(map[string]struct{}, len(rows))
	for i := range rows {
		visibleFederations[rows[i].FederationID] = struct{}{}
	}
	if len(visibleFederations) == 0 {
		return nil, nil
	}

	return &federationCatalogIndexEntry{
		FederationCatalogActor: FederationCatalogActor{
			ActorPTID:         actor.PTID,
			FederatedHandle:   actor.FederatedHandle,
			DisplayName:       actor.Name,
			AvatarURL:         actor.Icon,
			HomeStationPeerID: actor.HomeStationPeerID,
			Region:            meta.Region,
		},
		actorID:            actor.ID,
		sortKey:            catalogSearchKey(actor.FederatedHandle),
		visibleFederations: visibleFederations,
	}, nil
}

func catalogSearchKey(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "@"))
}

func sortFederationCatalogEntries(entries []federationCatalogIndexEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].sortKey != entries[j].sortKey {
			return entries[i].sortKey < entries[j].sortKey
		}
		return entries[i].ActorPTID < entries[j].ActorPTID
	})
}
