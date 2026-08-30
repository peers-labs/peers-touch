package infrastructure

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repos struct {
	Federation      domain.FederationRepository
	LedgerEvent     domain.LedgerEventRepository
	Membership      domain.MembershipRepository
	ActorRole       domain.ActorRoleRepository
	SyncCursor      domain.SyncCursorRepository
	ActorSigningKey domain.ActorSigningKeyRepository
}

func NewRepos(db *gorm.DB) *Repos {
	return &Repos{
		Federation:      &federationRepo{db: db},
		LedgerEvent:     &ledgerEventRepo{db: db},
		Membership:      &membershipRepo{db: db},
		ActorRole:       &actorRoleRepo{db: db},
		SyncCursor:      &syncCursorRepo{db: db},
		ActorSigningKey: &actorSigningKeyRepo{db: db},
	}
}

func MigrateIdentityColumns(db *gorm.DB) error {
	for _, rename := range []struct {
		table string
		from  string
		to    string
	}{
		{table: "federation", from: "created_by_actor_id", to: "created_by_actor_ptid"},
		{table: "federation_ledger_event", from: "actor_id", to: "actor_ptid"},
		{table: "federation_actor_role", from: "actor_id", to: "actor_ptid"},
		{table: "actor_signing_key", from: "actor_id", to: "actor_ptid"},
	} {
		if err := modeldb.MigrateStringIdentityColumn(db, rename.table, rename.from, rename.to); err != nil {
			return err
		}
	}
	return nil
}

// ═══ GORM Models ═══════════════════════════════════════════════════════════

type federationModel struct {
	ID                     int64     `gorm:"primaryKey;autoIncrement"`
	FederationID           string    `gorm:"uniqueIndex;type:varchar(30);not null"`
	Name                   string    `gorm:"type:varchar(255);not null"`
	Description            string    `gorm:"type:text;not null;default:''"`
	Status                 string    `gorm:"type:varchar(20);not null;default:'active';index"`
	PolicyType             string    `gorm:"type:varchar(30);not null;default:'single_admin'"`
	SequencerStationPeerID string    `gorm:"type:varchar(128);not null"`
	GenesisHash            []byte    `gorm:"type:bytea;not null"`
	HeadHash               []byte    `gorm:"type:bytea;not null"`
	HeadSeq                int64     `gorm:"not null;default:0"`
	CreatedByActorPTID     string    `gorm:"column:created_by_actor_ptid;type:varchar(255);not null"`
	CreatedByStationPeerID string    `gorm:"type:varchar(128);not null"`
	CreatedAt              time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt              time.Time `gorm:"not null;autoUpdateTime"`
}

func (federationModel) TableName() string { return "federation" }

type ledgerEventModel struct {
	ID                     int64  `gorm:"primaryKey;autoIncrement"`
	EventID                string `gorm:"uniqueIndex;type:varchar(30);not null"`
	FederationID           string `gorm:"type:varchar(30);not null;index:idx_ledger_event_federation_seq"`
	Seq                    int64  `gorm:"not null;index:idx_ledger_event_federation_seq"`
	PrevHash               []byte `gorm:"type:bytea;not null"`
	EventHash              []byte `gorm:"type:bytea;not null"`
	EventType              int32  `gorm:"type:smallint;not null"`
	PayloadBytes           []byte `gorm:"type:bytea;not null"`
	PayloadHash            []byte `gorm:"type:bytea;not null"`
	ActorPTID              string `gorm:"column:actor_ptid;type:varchar(255);not null"`
	ActorFederatedHandle   string `gorm:"type:varchar(255);not null;default:''"`
	StationPeerID          string `gorm:"type:varchar(128);not null"`
	SequencerStationPeerID string `gorm:"type:varchar(128);not null"`
	ActorSignature         []byte `gorm:"type:bytea;not null"`
	StationSignature       []byte `gorm:"type:bytea;not null"`
	SequencerSignature     []byte `gorm:"type:bytea;not null"`
	CreatedAtUnixMs        int64  `gorm:"not null"`
}

func (ledgerEventModel) TableName() string { return "federation_ledger_event" }

type membershipModel struct {
	ID                int64     `gorm:"primaryKey;autoIncrement"`
	FederationID      string    `gorm:"type:varchar(30);not null;uniqueIndex:idx_membership_fed_station"`
	StationPeerID     string    `gorm:"type:varchar(128);not null;uniqueIndex:idx_membership_fed_station;index"`
	StationName       string    `gorm:"type:varchar(255);not null;default:''"`
	StationURL        string    `gorm:"type:varchar(512);not null;default:''"`
	Role              string    `gorm:"type:varchar(30);not null;default:'member_station'"`
	Status            string    `gorm:"type:varchar(20);not null;default:'active'"`
	JoinedAt          time.Time `gorm:"not null;autoCreateTime"`
	ApprovedByEventID string    `gorm:"type:varchar(30);not null;default:''"`
}

func (membershipModel) TableName() string { return "federation_station_membership" }

type actorRoleModel struct {
	ID                   int64      `gorm:"primaryKey;autoIncrement"`
	FederationID         string     `gorm:"type:varchar(30);not null;uniqueIndex:idx_actor_role_fed_actor;index"`
	ActorPTID            string     `gorm:"column:actor_ptid;type:varchar(255);not null;uniqueIndex:idx_actor_role_fed_actor"`
	ActorFederatedHandle string     `gorm:"type:varchar(255);not null;default:''"`
	StationPeerID        string     `gorm:"type:varchar(128);not null"`
	Role                 string     `gorm:"type:varchar(30);not null"`
	GrantedByEventID     string     `gorm:"type:varchar(30);not null;default:''"`
	CreatedAt            time.Time  `gorm:"not null;autoCreateTime"`
	RevokedAt            *time.Time `gorm:""`
}

func (actorRoleModel) TableName() string { return "federation_actor_role" }

type actorSigningKeyModel struct {
	ID        int64      `gorm:"primaryKey;autoIncrement"`
	ActorPTID string     `gorm:"column:actor_ptid;uniqueIndex;type:varchar(255);not null"`
	PublicKey []byte     `gorm:"type:bytea;not null"`
	Seed      []byte     `gorm:"column:encrypted_private_key;type:bytea;not null"`
	CreatedAt time.Time  `gorm:"not null;autoCreateTime"`
	RotatedAt *time.Time `gorm:""`
}

func (actorSigningKeyModel) TableName() string { return "actor_signing_key" }

type syncCursorModel struct {
	ID                  int64      `gorm:"primaryKey;autoIncrement"`
	FederationID        string     `gorm:"type:varchar(30);not null;uniqueIndex:idx_sync_cursor_fed_station"`
	RemoteStationPeerID string     `gorm:"type:varchar(128);not null;uniqueIndex:idx_sync_cursor_fed_station"`
	LastSeenHeadHash    []byte     `gorm:"type:bytea"`
	LastSeenHeadSeq     int64      `gorm:"not null;default:0"`
	LastAppliedSeq      int64      `gorm:"not null;default:0"`
	LastSyncAt          *time.Time `gorm:""`
	Status              string     `gorm:"type:varchar(30);not null;default:'healthy'"`
	ErrorCode           int32      `gorm:"not null;default:0"`
	ErrorMessage        string     `gorm:"type:text;not null;default:''"`
}

func (syncCursorModel) TableName() string { return "federation_sync_cursor" }

// ═══ FederationRepository ═════════════════════════════════════════════════

type federationRepo struct{ db *gorm.DB }

func (r *federationRepo) Create(ctx context.Context, record *domain.FederationRecord) error {
	m := &federationModel{
		FederationID:           record.FederationID,
		Name:                   record.Name,
		Description:            record.Description,
		Status:                 record.Status,
		PolicyType:             record.PolicyType,
		SequencerStationPeerID: record.SequencerStationPeerID,
		GenesisHash:            record.GenesisHash,
		HeadHash:               record.HeadHash,
		HeadSeq:                int64(record.HeadSeq),
		CreatedByActorPTID:     record.CreatedByActorPTID,
		CreatedByStationPeerID: record.CreatedByStationPeerID,
	}
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *federationRepo) GetByID(ctx context.Context, federationID string) (*domain.FederationRecord, error) {
	var m federationModel
	err := r.db.WithContext(ctx).Where("federation_id = ?", federationID).First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return toFederationRecord(&m), nil
}

func (r *federationRepo) ListByStation(ctx context.Context, stationPeerID string) ([]*domain.FederationRecord, error) {
	var models []federationModel
	query := r.db.WithContext(ctx)
	if stationPeerID != "" {
		query = query.Where("federation_id IN (SELECT federation_id FROM federation_station_membership WHERE station_peer_id = ? AND status = 'active')", stationPeerID)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*domain.FederationRecord, len(models))
	for i := range models {
		result[i] = toFederationRecord(&models[i])
	}
	return result, nil
}

func (r *federationRepo) UpdateHead(ctx context.Context, federationID string, headHash []byte, headSeq uint64) error {
	res := r.db.WithContext(ctx).Model(&federationModel{}).
		Where("federation_id = ?", federationID).
		Updates(map[string]interface{}{
			"head_hash": headHash,
			"head_seq":  int64(headSeq),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *federationRepo) UpdateStatus(ctx context.Context, federationID string, status string) error {
	res := r.db.WithContext(ctx).Model(&federationModel{}).
		Where("federation_id = ?", federationID).
		Update("status", status)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func toFederationRecord(m *federationModel) *domain.FederationRecord {
	return &domain.FederationRecord{
		FederationID:           m.FederationID,
		Name:                   m.Name,
		Description:            m.Description,
		Status:                 m.Status,
		PolicyType:             m.PolicyType,
		SequencerStationPeerID: m.SequencerStationPeerID,
		GenesisHash:            m.GenesisHash,
		HeadHash:               m.HeadHash,
		HeadSeq:                uint64(m.HeadSeq),
		CreatedByActorPTID:     m.CreatedByActorPTID,
		CreatedByStationPeerID: m.CreatedByStationPeerID,
	}
}

// ═══ LedgerEventRepository ═══════════════════════════════════════════════

type ledgerEventRepo struct{ db *gorm.DB }

func (r *ledgerEventRepo) Append(ctx context.Context, event *pb.LedgerEvent) error {
	m := &ledgerEventModel{
		EventID:                event.EventId,
		FederationID:           event.FederationId,
		Seq:                    int64(event.Seq),
		PrevHash:               event.PrevHash,
		EventHash:              event.EventHash,
		EventType:              int32(event.EventType),
		PayloadBytes:           event.PayloadBytes,
		PayloadHash:            event.PayloadHash,
		ActorPTID:              event.ActorPtid,
		ActorFederatedHandle:   event.ActorFederatedHandle,
		StationPeerID:          event.StationPeerId,
		SequencerStationPeerID: event.SequencerStationPeerId,
		ActorSignature:         event.ActorSignature,
		StationSignature:       event.StationSignature,
		SequencerSignature:     event.SequencerSignature,
		CreatedAtUnixMs:        event.CreatedAtUnixMs,
	}
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *ledgerEventRepo) GetBySeq(ctx context.Context, federationID string, seq uint64) (*pb.LedgerEvent, error) {
	var m ledgerEventModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND seq = ?", federationID, int64(seq)).
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return toLedgerEventPb(&m), nil
}

func (r *ledgerEventRepo) ListRange(ctx context.Context, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	var models []ledgerEventModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND seq >= ?", federationID, int64(fromSeq)).
		Order("seq ASC").
		Limit(int(limit)).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	result := make([]*pb.LedgerEvent, len(models))
	for i := range models {
		result[i] = toLedgerEventPb(&models[i])
	}
	return result, nil
}

func (r *ledgerEventRepo) ListAll(ctx context.Context, federationID string) ([]*pb.LedgerEvent, error) {
	var models []ledgerEventModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ?", federationID).
		Order("seq ASC").
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	result := make([]*pb.LedgerEvent, len(models))
	for i := range models {
		result[i] = toLedgerEventPb(&models[i])
	}
	return result, nil
}

func (r *ledgerEventRepo) GetHead(ctx context.Context, federationID string) (*pb.LedgerEvent, error) {
	var m ledgerEventModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ?", federationID).
		Order("seq DESC").
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return toLedgerEventPb(&m), nil
}

func toLedgerEventPb(m *ledgerEventModel) *pb.LedgerEvent {
	return &pb.LedgerEvent{
		EventId:                m.EventID,
		FederationId:           m.FederationID,
		Seq:                    uint64(m.Seq),
		PrevHash:               m.PrevHash,
		EventHash:              m.EventHash,
		EventType:              pb.EventType(m.EventType),
		PayloadBytes:           m.PayloadBytes,
		PayloadHash:            m.PayloadHash,
		ActorPtid:              m.ActorPTID,
		ActorFederatedHandle:   m.ActorFederatedHandle,
		StationPeerId:          m.StationPeerID,
		SequencerStationPeerId: m.SequencerStationPeerID,
		ActorSignature:         m.ActorSignature,
		StationSignature:       m.StationSignature,
		SequencerSignature:     m.SequencerSignature,
		CreatedAtUnixMs:        m.CreatedAtUnixMs,
	}
}

// ═══ MembershipRepository ════════════════════════════════════════════════

type membershipRepo struct{ db *gorm.DB }

func (r *membershipRepo) Upsert(ctx context.Context, record *domain.MembershipRecord) error {
	m := &membershipModel{
		FederationID:      record.FederationID,
		StationPeerID:     record.StationPeerID,
		StationName:       record.StationName,
		StationURL:        record.StationURL,
		Role:              record.Role,
		Status:            record.Status,
		ApprovedByEventID: record.ApprovedByEventID,
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "federation_id"}, {Name: "station_peer_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"station_name", "station_url", "role", "status", "approved_by_event_id"}),
	}).Create(m).Error
}

func (r *membershipRepo) GetByStation(ctx context.Context, federationID, stationPeerID string) (*domain.MembershipRecord, error) {
	var m membershipModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND station_peer_id = ?", federationID, stationPeerID).
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return toMembershipRecord(&m), nil
}

func (r *membershipRepo) ListByFederation(ctx context.Context, federationID string) ([]*domain.MembershipRecord, error) {
	var models []membershipModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ?", federationID).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	result := make([]*domain.MembershipRecord, len(models))
	for i := range models {
		result[i] = toMembershipRecord(&models[i])
	}
	return result, nil
}

func (r *membershipRepo) UpdateStatus(ctx context.Context, federationID, stationPeerID, status string) error {
	return r.db.WithContext(ctx).Model(&membershipModel{}).
		Where("federation_id = ? AND station_peer_id = ?", federationID, stationPeerID).
		Update("status", status).Error
}

func toMembershipRecord(m *membershipModel) *domain.MembershipRecord {
	return &domain.MembershipRecord{
		FederationID:      m.FederationID,
		StationPeerID:     m.StationPeerID,
		StationName:       m.StationName,
		StationURL:        m.StationURL,
		Role:              m.Role,
		Status:            m.Status,
		JoinedAt:          m.JoinedAt.Format(time.RFC3339),
		ApprovedByEventID: m.ApprovedByEventID,
	}
}

// ═══ ActorRoleRepository ═════════════════════════════════════════════════

type actorRoleRepo struct{ db *gorm.DB }

func (r *actorRoleRepo) Upsert(ctx context.Context, record *domain.ActorRoleRecord) error {
	m := &actorRoleModel{
		FederationID:         record.FederationID,
		ActorPTID:            record.ActorPTID,
		ActorFederatedHandle: record.ActorFederatedHandle,
		StationPeerID:        record.StationPeerID,
		Role:                 record.Role,
		GrantedByEventID:     record.GrantedByEventID,
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "federation_id"}, {Name: "actor_ptid"}},
		DoUpdates: clause.AssignmentColumns([]string{"role", "actor_federated_handle", "station_peer_id", "granted_by_event_id"}),
	}).Create(m).Error
}

func (r *actorRoleRepo) GetByActor(ctx context.Context, federationID, actorPTID string) (*domain.ActorRoleRecord, error) {
	var m actorRoleModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND actor_ptid = ? AND revoked_at IS NULL", federationID, actorPTID).
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &domain.ActorRoleRecord{
		FederationID:         m.FederationID,
		ActorPTID:            m.ActorPTID,
		ActorFederatedHandle: m.ActorFederatedHandle,
		StationPeerID:        m.StationPeerID,
		Role:                 m.Role,
		GrantedByEventID:     m.GrantedByEventID,
	}, nil
}

func (r *actorRoleRepo) ListByFederation(ctx context.Context, federationID string) ([]*domain.ActorRoleRecord, error) {
	var models []actorRoleModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND revoked_at IS NULL", federationID).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	result := make([]*domain.ActorRoleRecord, len(models))
	for i := range models {
		result[i] = &domain.ActorRoleRecord{
			FederationID:         models[i].FederationID,
			ActorPTID:            models[i].ActorPTID,
			ActorFederatedHandle: models[i].ActorFederatedHandle,
			StationPeerID:        models[i].StationPeerID,
			Role:                 models[i].Role,
			GrantedByEventID:     models[i].GrantedByEventID,
		}
	}
	return result, nil
}

func (r *actorRoleRepo) Revoke(ctx context.Context, federationID, actorPTID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&actorRoleModel{}).
		Where("federation_id = ? AND actor_ptid = ? AND revoked_at IS NULL", federationID, actorPTID).
		Update("revoked_at", &now).Error
}

// ═══ ActorSigningKeyRepository ═══════════════════════════════════════════

type actorSigningKeyRepo struct{ db *gorm.DB }

func (r *actorSigningKeyRepo) Store(ctx context.Context, record *domain.ActorSigningKeyRecord) error {
	m := &actorSigningKeyModel{
		ActorPTID: record.ActorPTID,
		PublicKey: record.PublicKey,
		Seed:      record.EncryptedPrivateKey,
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "actor_ptid"}},
		DoUpdates: clause.AssignmentColumns([]string{"public_key", "encrypted_private_key"}),
	}).Create(m).Error
}

func (r *actorSigningKeyRepo) Get(ctx context.Context, actorPTID string) (*domain.ActorSigningKeyRecord, error) {
	var m actorSigningKeyModel
	err := r.db.WithContext(ctx).Where("actor_ptid = ?", actorPTID).First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &domain.ActorSigningKeyRecord{
		ActorPTID:           m.ActorPTID,
		PublicKey:           m.PublicKey,
		EncryptedPrivateKey: m.Seed,
	}, nil
}

// ═══ SyncCursorRepository ════════════════════════════════════════════════

type syncCursorRepo struct{ db *gorm.DB }

func (r *syncCursorRepo) Upsert(ctx context.Context, record *domain.SyncCursorRecord) error {
	now := time.Now()
	m := &syncCursorModel{
		FederationID:        record.FederationID,
		RemoteStationPeerID: record.RemoteStationPeerID,
		LastSeenHeadHash:    record.LastSeenHeadHash,
		LastSeenHeadSeq:     int64(record.LastSeenHeadSeq),
		LastAppliedSeq:      int64(record.LastAppliedSeq),
		LastSyncAt:          &now,
		Status:              record.Status,
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "federation_id"}, {Name: "remote_station_peer_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"last_seen_head_hash", "last_seen_head_seq", "last_applied_seq", "last_sync_at", "status"}),
	}).Create(m).Error
}

func (r *syncCursorRepo) Get(ctx context.Context, federationID, remoteStationPeerID string) (*domain.SyncCursorRecord, error) {
	var m syncCursorModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ? AND remote_station_peer_id = ?", federationID, remoteStationPeerID).
		First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &domain.SyncCursorRecord{
		FederationID:        m.FederationID,
		RemoteStationPeerID: m.RemoteStationPeerID,
		LastSeenHeadHash:    m.LastSeenHeadHash,
		LastSeenHeadSeq:     uint64(m.LastSeenHeadSeq),
		LastAppliedSeq:      uint64(m.LastAppliedSeq),
		Status:              m.Status,
	}, nil
}

func (r *syncCursorRepo) ListByFederation(ctx context.Context, federationID string) ([]*domain.SyncCursorRecord, error) {
	var models []syncCursorModel
	err := r.db.WithContext(ctx).
		Where("federation_id = ?", federationID).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	result := make([]*domain.SyncCursorRecord, len(models))
	for i := range models {
		result[i] = &domain.SyncCursorRecord{
			FederationID:        models[i].FederationID,
			RemoteStationPeerID: models[i].RemoteStationPeerID,
			LastSeenHeadHash:    models[i].LastSeenHeadHash,
			LastSeenHeadSeq:     uint64(models[i].LastSeenHeadSeq),
			LastAppliedSeq:      uint64(models[i].LastAppliedSeq),
			Status:              models[i].Status,
		}
	}
	return result, nil
}
