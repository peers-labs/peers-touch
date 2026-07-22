package infrastructure

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"gorm.io/gorm"
)

type Repos struct {
	Federation      domain.FederationRepository
	LedgerEvent     domain.LedgerEventRepository
	Membership      domain.MembershipRepository
	ActorRole       domain.ActorRoleRepository
	SyncCursor      domain.SyncCursorRepository
	ActorSigningKey domain.ActorSigningKeyRepository
}

func NewRepos(_ *gorm.DB) *Repos {
	return &Repos{
		Federation:      newInMemoryFederationRepo(),
		LedgerEvent:     newInMemoryLedgerEventRepo(),
		Membership:      newInMemoryMembershipRepo(),
		ActorRole:       newInMemoryActorRoleRepo(),
		SyncCursor:      newInMemorySyncCursorRepo(),
		ActorSigningKey: newInMemoryActorSigningKeyRepo(),
	}
}

// In-memory implementations for Phase 1 bootstrap.
// PostgreSQL implementations will replace these once migrations are in place.

type inMemoryFederationRepo struct {
	mu   sync.RWMutex
	data map[string]*domain.FederationRecord
}

func newInMemoryFederationRepo() *inMemoryFederationRepo {
	return &inMemoryFederationRepo{data: make(map[string]*domain.FederationRecord)}
}

func (r *inMemoryFederationRepo) Create(_ context.Context, record *domain.FederationRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data[record.FederationID] = record
	return nil
}

func (r *inMemoryFederationRepo) GetByID(_ context.Context, id string) (*domain.FederationRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.data[id]
	if !ok {
		return nil, nil
	}
	return rec, nil
}

func (r *inMemoryFederationRepo) ListByStation(_ context.Context, stationPeerID string) ([]*domain.FederationRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []*domain.FederationRecord
	for _, rec := range r.data {
		result = append(result, rec)
	}
	return result, nil
}

func (r *inMemoryFederationRepo) UpdateHead(_ context.Context, id string, headHash []byte, headSeq uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if rec, ok := r.data[id]; ok {
		rec.HeadHash = headHash
		rec.HeadSeq = headSeq
	}
	return nil
}

func (r *inMemoryFederationRepo) UpdateStatus(_ context.Context, id, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if rec, ok := r.data[id]; ok {
		rec.Status = status
	}
	return nil
}

type inMemoryLedgerEventRepo struct {
	mu   sync.RWMutex
	data map[string][]*pb.LedgerEvent
}

func newInMemoryLedgerEventRepo() *inMemoryLedgerEventRepo {
	return &inMemoryLedgerEventRepo{data: make(map[string][]*pb.LedgerEvent)}
}

func (r *inMemoryLedgerEventRepo) Append(_ context.Context, event *pb.LedgerEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data[event.FederationId] = append(r.data[event.FederationId], event)
	return nil
}

func (r *inMemoryLedgerEventRepo) GetBySeq(_ context.Context, federationID string, seq uint64) (*pb.LedgerEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events := r.data[federationID]
	for _, e := range events {
		if e.Seq == seq {
			return e, nil
		}
	}
	return nil, nil
}

func (r *inMemoryLedgerEventRepo) ListRange(_ context.Context, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events := r.data[federationID]
	var result []*pb.LedgerEvent
	for _, e := range events {
		if e.Seq >= fromSeq && uint32(len(result)) < limit {
			result = append(result, e)
		}
	}
	return result, nil
}

func (r *inMemoryLedgerEventRepo) ListAll(_ context.Context, federationID string) ([]*pb.LedgerEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.data[federationID], nil
}

func (r *inMemoryLedgerEventRepo) GetHead(_ context.Context, federationID string) (*pb.LedgerEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events := r.data[federationID]
	if len(events) == 0 {
		return nil, nil
	}
	return events[len(events)-1], nil
}

type inMemoryMembershipRepo struct {
	mu   sync.RWMutex
	data map[string][]*domain.MembershipRecord
}

func newInMemoryMembershipRepo() *inMemoryMembershipRepo {
	return &inMemoryMembershipRepo{data: make(map[string][]*domain.MembershipRecord)}
}

func (r *inMemoryMembershipRepo) Upsert(_ context.Context, record *domain.MembershipRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := record.FederationID
	for i, existing := range r.data[key] {
		if existing.StationPeerID == record.StationPeerID {
			r.data[key][i] = record
			return nil
		}
	}
	r.data[key] = append(r.data[key], record)
	return nil
}

func (r *inMemoryMembershipRepo) GetByStation(_ context.Context, federationID, stationPeerID string) (*domain.MembershipRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, rec := range r.data[federationID] {
		if rec.StationPeerID == stationPeerID {
			return rec, nil
		}
	}
	return nil, nil
}

func (r *inMemoryMembershipRepo) ListByFederation(_ context.Context, federationID string) ([]*domain.MembershipRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.data[federationID], nil
}

func (r *inMemoryMembershipRepo) UpdateStatus(_ context.Context, federationID, stationPeerID, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rec := range r.data[federationID] {
		if rec.StationPeerID == stationPeerID {
			rec.Status = status
			return nil
		}
	}
	return nil
}

type inMemoryActorRoleRepo struct {
	mu   sync.RWMutex
	data map[string][]*domain.ActorRoleRecord
}

func newInMemoryActorRoleRepo() *inMemoryActorRoleRepo {
	return &inMemoryActorRoleRepo{data: make(map[string][]*domain.ActorRoleRecord)}
}

func (r *inMemoryActorRoleRepo) Upsert(_ context.Context, record *domain.ActorRoleRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := record.FederationID
	for i, existing := range r.data[key] {
		if existing.ActorID == record.ActorID {
			r.data[key][i] = record
			return nil
		}
	}
	r.data[key] = append(r.data[key], record)
	return nil
}

func (r *inMemoryActorRoleRepo) GetByActor(_ context.Context, federationID, actorID string) (*domain.ActorRoleRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, rec := range r.data[federationID] {
		if rec.ActorID == actorID {
			return rec, nil
		}
	}
	return nil, nil
}

func (r *inMemoryActorRoleRepo) ListByFederation(_ context.Context, federationID string) ([]*domain.ActorRoleRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.data[federationID], nil
}

func (r *inMemoryActorRoleRepo) Revoke(_ context.Context, federationID, actorID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	records := r.data[federationID]
	for i, rec := range records {
		if rec.ActorID == actorID {
			r.data[federationID] = append(records[:i], records[i+1:]...)
			return nil
		}
	}
	return nil
}

type inMemorySyncCursorRepo struct {
	mu   sync.RWMutex
	data map[string][]*domain.SyncCursorRecord
}

func newInMemorySyncCursorRepo() *inMemorySyncCursorRepo {
	return &inMemorySyncCursorRepo{data: make(map[string][]*domain.SyncCursorRecord)}
}

func (r *inMemorySyncCursorRepo) Upsert(_ context.Context, record *domain.SyncCursorRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := record.FederationID
	for i, existing := range r.data[key] {
		if existing.RemoteStationPeerID == record.RemoteStationPeerID {
			r.data[key][i] = record
			return nil
		}
	}
	r.data[key] = append(r.data[key], record)
	return nil
}

func (r *inMemorySyncCursorRepo) Get(_ context.Context, federationID, remotePeerID string) (*domain.SyncCursorRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, rec := range r.data[federationID] {
		if rec.RemoteStationPeerID == remotePeerID {
			return rec, nil
		}
	}
	return nil, nil
}

func (r *inMemorySyncCursorRepo) ListByFederation(_ context.Context, federationID string) ([]*domain.SyncCursorRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.data[federationID], nil
}

type inMemoryActorSigningKeyRepo struct {
	mu   sync.RWMutex
	data map[string]*domain.ActorSigningKeyRecord
}

func newInMemoryActorSigningKeyRepo() *inMemoryActorSigningKeyRepo {
	return &inMemoryActorSigningKeyRepo{data: make(map[string]*domain.ActorSigningKeyRecord)}
}

func (r *inMemoryActorSigningKeyRepo) Get(_ context.Context, actorID string) (*domain.ActorSigningKeyRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.data[actorID]
	if !ok {
		return nil, nil
	}
	return rec, nil
}

func (r *inMemoryActorSigningKeyRepo) Store(_ context.Context, record *domain.ActorSigningKeyRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data[record.ActorID] = record
	return nil
}
