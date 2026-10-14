package actor

import "testing"

func TestSearchFederationCatalogUsesSortedHandlePrefixAndScopedOptIn(t *testing.T) {
	processFederationCatalogIndex.mu.Lock()
	previous := processFederationCatalogIndex.entries
	processFederationCatalogIndex.entries = []federationCatalogIndexEntry{
		{
			FederationCatalogActor: FederationCatalogActor{
				ActorPTID:       "ptid:alice-a",
				FederatedHandle: "@alice@a.test",
				DisplayName:     "Alice A",
				Region:          "CN-SH",
			},
			sortKey: "alice@a.test",
			visibleFederations: map[string]struct{}{
				"fed-a": {},
			},
		},
		{
			FederationCatalogActor: FederationCatalogActor{
				ActorPTID:       "ptid:alice-b",
				FederatedHandle: "@alice@b.test",
				DisplayName:     "Alice B",
				Region:          "US-CA",
			},
			sortKey: "alice@b.test",
			visibleFederations: map[string]struct{}{
				"fed-b": {},
			},
		},
		{
			FederationCatalogActor: FederationCatalogActor{
				ActorPTID:       "ptid:bob",
				FederatedHandle: "@bob@a.test",
				DisplayName:     "Bob",
				Region:          "CN-BJ",
			},
			sortKey: "bob@a.test",
			visibleFederations: map[string]struct{}{
				"fed-a": {},
			},
		},
	}
	processFederationCatalogIndex.mu.Unlock()
	t.Cleanup(func() {
		processFederationCatalogIndex.mu.Lock()
		processFederationCatalogIndex.entries = previous
		processFederationCatalogIndex.mu.Unlock()
	})

	results, total, hasMore := SearchFederationCatalog(FederationCatalogQuery{
		FederationID: "fed-a",
		Prefix:       "@ali",
		RegionPrefix: "cn",
		Limit:        20,
	})
	if total != 1 || hasMore || len(results) != 1 ||
		results[0].ActorPTID != "ptid:alice-a" {
		t.Fatalf(
			"scoped catalog result total=%d has_more=%t entries=%+v",
			total,
			hasMore,
			results,
		)
	}

	results, total, hasMore = SearchFederationCatalog(FederationCatalogQuery{
		FederationID: "fed-a",
		Prefix:       "a",
		AfterHandle:  "@alice@a.test",
		AfterPTID:    "ptid:alice-a",
		Limit:        20,
	})
	if total != 1 || hasMore || len(results) != 0 {
		t.Fatalf(
			"cursor result total=%d has_more=%t entries=%+v",
			total,
			hasMore,
			results,
		)
	}
}

func TestRemoveFederationCatalogActorFailsClosed(t *testing.T) {
	processFederationCatalogIndex.mu.Lock()
	previous := processFederationCatalogIndex.entries
	processFederationCatalogIndex.entries = []federationCatalogIndexEntry{
		{
			FederationCatalogActor: FederationCatalogActor{
				ActorPTID:       "ptid:alice",
				FederatedHandle: "@alice@station.test",
			},
			actorID: 41,
			sortKey: "alice@station.test",
		},
		{
			FederationCatalogActor: FederationCatalogActor{
				ActorPTID:       "ptid:bob",
				FederatedHandle: "@bob@station.test",
			},
			actorID: 42,
			sortKey: "bob@station.test",
		},
	}
	processFederationCatalogIndex.mu.Unlock()
	t.Cleanup(func() {
		processFederationCatalogIndex.mu.Lock()
		processFederationCatalogIndex.entries = previous
		processFederationCatalogIndex.mu.Unlock()
	})

	RemoveFederationCatalogActor(41)

	processFederationCatalogIndex.mu.RLock()
	defer processFederationCatalogIndex.mu.RUnlock()
	if len(processFederationCatalogIndex.entries) != 1 ||
		processFederationCatalogIndex.entries[0].actorID != 42 {
		t.Fatalf(
			"catalog entries after removal = %+v",
			processFederationCatalogIndex.entries,
		)
	}
}
