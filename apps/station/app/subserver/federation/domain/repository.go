package domain

import (
	"context"
	"crypto/ed25519"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

type FederationRecord struct {
	FederationID           string
	Name                   string
	Description            string
	Status                 string
	PolicyType             string
	SequencerStationPeerID string
	GenesisHash            []byte
	HeadHash               []byte
	HeadSeq                uint64
	CreatedByActorPTID     string
	CreatedByStationPeerID string
}

type MembershipRecord struct {
	FederationID      string
	StationPeerID     string
	StationName       string
	StationURL        string
	Role              string
	Status            string
	JoinedAt          string
	ApprovedByEventID string
}

type ActorRoleRecord struct {
	FederationID         string
	ActorPTID            string
	ActorFederatedHandle string
	StationPeerID        string
	Role                 string
	GrantedByEventID     string
}

const (
	StationRoleOwner           = "station_owner"
	StationRoleFederationAdmin = "federation_admin"
)

type SyncCursorRecord struct {
	FederationID        string
	RemoteStationPeerID string
	LastSeenHeadHash    []byte
	LastSeenHeadSeq     uint64
	LastAppliedSeq      uint64
	Status              string
}

type FederationRepository interface {
	Create(ctx context.Context, record *FederationRecord) error
	GetByID(ctx context.Context, federationID string) (*FederationRecord, error)
	ListByStation(ctx context.Context, stationPeerID string) ([]*FederationRecord, error)
	UpdateHead(ctx context.Context, federationID string, headHash []byte, headSeq uint64) error
	UpdateStatus(ctx context.Context, federationID string, status string) error
}

type LedgerEventRepository interface {
	Append(ctx context.Context, event *pb.LedgerEvent) error
	GetBySeq(ctx context.Context, federationID string, seq uint64) (*pb.LedgerEvent, error)
	ListRange(ctx context.Context, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error)
	ListAll(ctx context.Context, federationID string) ([]*pb.LedgerEvent, error)
	GetHead(ctx context.Context, federationID string) (*pb.LedgerEvent, error)
}

type LedgerProjectionMutation struct {
	Membership              *MembershipRecord
	MembershipStationPeerID string
	MembershipStatus        string
	FederationStatus        string
}

type LedgerEventCommitter interface {
	Commit(
		ctx context.Context,
		event *pb.LedgerEvent,
		mutation LedgerProjectionMutation,
	) error
}

type StationSigningKey struct {
	PublicKey  ed25519.PublicKey
	PrivateKey ed25519.PrivateKey
}

type StationSigningKeyProvider interface {
	Current(ctx context.Context) (*StationSigningKey, error)
}

type MembershipRepository interface {
	Upsert(ctx context.Context, record *MembershipRecord) error
	GetByStation(ctx context.Context, federationID, stationPeerID string) (*MembershipRecord, error)
	ListByFederation(ctx context.Context, federationID string) ([]*MembershipRecord, error)
	ListByStation(ctx context.Context, stationPeerID string) ([]*MembershipRecord, error)
	UpdateStatus(ctx context.Context, federationID, stationPeerID, status string) error
}

type ActorRoleRepository interface {
	Upsert(ctx context.Context, record *ActorRoleRecord) error
	GetByActor(ctx context.Context, federationID, actorPTID string) (*ActorRoleRecord, error)
	ListByFederation(ctx context.Context, federationID string) ([]*ActorRoleRecord, error)
	Revoke(ctx context.Context, federationID, actorPTID string) error
}

type StationRoleRepository interface {
	EnsureInitialOwner(ctx context.Context) error
	HasAnyRole(
		ctx context.Context,
		actorPTID string,
		roles ...string,
	) (bool, error)
}

type SyncCursorRepository interface {
	Upsert(ctx context.Context, record *SyncCursorRecord) error
	Get(ctx context.Context, federationID, remoteStationPeerID string) (*SyncCursorRecord, error)
	ListByFederation(ctx context.Context, federationID string) ([]*SyncCursorRecord, error)
}
