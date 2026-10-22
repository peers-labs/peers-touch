package catalogrepo

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
)

type MemoryRepository struct {
	mu           sync.Mutex
	counter      uint64
	current      map[string]catalog.Draft
	history      map[string]catalog.Draft
	publications map[string][]catalog.Publication
	snapshots    map[string]catalog.Publication
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		current:      make(map[string]catalog.Draft),
		history:      make(map[string]catalog.Draft),
		publications: make(map[string][]catalog.Publication),
		snapshots:    make(map[string]catalog.Publication),
	}
}

func (r *MemoryRepository) LoadDraft(
	_ context.Context,
	channel string,
) (*catalog.Draft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	draft, ok := r.current[channel]
	if !ok {
		return nil, catalog.ErrDraftNotFound
	}
	out := cloneDraft(draft)
	return &out, nil
}

func (r *MemoryRepository) LoadDraftAtRevision(
	_ context.Context,
	channel string,
	revision string,
) (*catalog.Draft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	draft, ok := r.history[revision]
	if !ok || draft.Catalog.Channel != channel {
		return nil, catalog.ErrDraftNotFound
	}
	out := cloneDraft(draft)
	return &out, nil
}

func (r *MemoryRepository) SaveDraft(
	_ context.Context,
	baseRevision string,
	draft catalog.Draft,
) (*catalog.Draft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, found := r.current[draft.Catalog.Channel]
	if (found && current.Revision != baseRevision) ||
		(!found && baseRevision != "") {
		return nil, catalog.ErrDraftConflict
	}
	r.counter++
	draft.Revision = fmt.Sprintf("memory-%020d", r.counter)
	draft.LoadedAt = time.Now().UTC()
	stored := cloneDraft(draft)
	r.current[draft.Catalog.Channel] = stored
	r.history[draft.Revision] = stored
	out := cloneDraft(stored)
	return &out, nil
}

func (r *MemoryRepository) Publish(
	_ context.Context,
	baseRevision string,
	channel string,
	build catalog.PublicationBuilder,
) (*catalog.Publication, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, found := r.current[channel]
	if !found || current.Revision != baseRevision {
		return nil, catalog.ErrDraftConflict
	}
	sequence := uint64(1)
	values := r.publications[channel]
	if len(values) > 0 {
		sequence = values[0].Sequence + 1
	}
	publication, err := build(sequence)
	if err != nil {
		return nil, err
	}
	if !validPublication(publication, baseRevision, channel, sequence) ||
		len(publication.EnvelopeBytes) == 0 {
		return nil, catalog.ErrValidationFailed
	}
	r.counter++
	revision := fmt.Sprintf("memory-%020d", r.counter)
	current.Revision = revision
	current.LoadedAt = time.Now().UTC()
	r.current[channel] = cloneDraft(current)
	r.history[revision] = cloneDraft(current)
	publication.RepositoryRevision = revision
	out := clonePublication(publication)
	stored := clonePublication(publication)
	stored.RepositoryRevision = ""
	r.publications[channel] = append(
		[]catalog.Publication{stored},
		values...,
	)
	r.snapshots[snapshotKey(channel, sequence)] = stored
	return &out, nil
}

func (r *MemoryRepository) ListPublications(
	_ context.Context,
	channel string,
	limit int,
) ([]catalog.Publication, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	values := append([]catalog.Publication(nil), r.publications[channel]...)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if len(values) > limit {
		values = values[:limit]
	}
	for index := range values {
		values[index] = clonePublication(values[index])
	}
	return values, nil
}

func (r *MemoryRepository) LoadPublishedSnapshot(
	_ context.Context,
	channel string,
	sequence uint64,
) (*catalog.Publication, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if sequence == 0 {
		values := r.publications[channel]
		if len(values) == 0 {
			return nil, catalog.ErrPublicationNotFound
		}
		out := clonePublication(values[0])
		return &out, nil
	}
	value, found := r.snapshots[snapshotKey(channel, sequence)]
	if !found {
		return nil, catalog.ErrPublicationNotFound
	}
	out := clonePublication(value)
	return &out, nil
}

func cloneDraft(value catalog.Draft) catalog.Draft {
	out := value
	out.Catalog.Endpoints = append(
		[]catalog.CatalogEndpoint(nil),
		value.Catalog.Endpoints...,
	)
	out.Catalog.Releases = append(
		[]catalog.CatalogRelease(nil),
		value.Catalog.Releases...,
	)
	return out
}

func clonePublication(value catalog.Publication) catalog.Publication {
	out := value
	out.Catalog = cloneDraft(catalog.Draft{Catalog: value.Catalog}).Catalog
	out.EnvelopeBytes = append([]byte(nil), value.EnvelopeBytes...)
	return out
}

func snapshotKey(channel string, sequence uint64) string {
	return fmt.Sprintf("%s/%020d", channel, sequence)
}
