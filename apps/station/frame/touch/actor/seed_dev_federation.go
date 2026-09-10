package actor

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type seedFederationRecord struct {
	ID                     int64     `gorm:"primaryKey;autoIncrement"`
	FederationID           string    `gorm:"uniqueIndex;type:varchar(30);not null"`
	Name                   string    `gorm:"type:varchar(255);not null"`
	Description            string    `gorm:"type:text;not null;default:''"`
	Status                 string    `gorm:"type:varchar(20);not null;default:'active'"`
	PolicyType             string    `gorm:"type:varchar(30);not null;default:'single_admin'"`
	SequencerStationPeerID string    `gorm:"type:varchar(128);not null"`
	GenesisHash            []byte    `gorm:"type:bytea;not null"`
	HeadHash               []byte    `gorm:"type:bytea;not null"`
	HeadSeq                int64     `gorm:"not null;default:0"`
	CreatedByActorPTID     string    `gorm:"type:varchar(255);not null"`
	CreatedByStationPeerID string    `gorm:"type:varchar(128);not null"`
	CreatedAt              time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt              time.Time `gorm:"not null;autoUpdateTime"`
}

func (seedFederationRecord) TableName() string { return "federation" }

type seedMembershipRecord struct {
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

func (seedMembershipRecord) TableName() string { return "federation_station_membership" }

type seedActorRoleRecord struct {
	ID                   int64     `gorm:"primaryKey;autoIncrement"`
	FederationID         string    `gorm:"type:varchar(30);not null;uniqueIndex:idx_actor_role_fed_actor;index"`
	ActorPTID            string    `gorm:"column:actor_ptid;type:varchar(255);not null;uniqueIndex:idx_actor_role_fed_actor"`
	ActorFederatedHandle string    `gorm:"type:varchar(255);not null;default:''"`
	StationPeerID        string    `gorm:"type:varchar(128);not null"`
	Role                 string    `gorm:"type:varchar(30);not null"`
	GrantedByEventID     string    `gorm:"type:varchar(30);not null;default:''"`
	CreatedAt            time.Time `gorm:"not null;autoCreateTime"`
}

func (seedActorRoleRecord) TableName() string { return "federation_actor_role" }

// SeedDevFederation ensures at least one federation exists on the Station.
// When the federation table is empty (fresh DB or after a wipe), it creates
// a self-federation with the first preset actor as owner. This unblocks all
// federation-dependent flows: friend requests, conversations, and chat.
func SeedDevFederation(ctx context.Context, ownerUsername string) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	if !rds.Migrator().HasTable(&seedFederationRecord{}) {
		log.Infof(ctx, "[seed] federation table not yet created, skipping federation seed")
		return nil
	}

	var count int64
	if err := rds.Model(&seedFederationRecord{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	stationPeerID := nativefed.LocalIdentitySnapshot().StationPeerID.String()
	if stationPeerID == "" {
		log.Warnf(ctx, "[seed] Station peer identity unavailable, skipping federation seed")
		return nil
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", ownerUsername).First(&actor).Error; err != nil {
		log.Warnf(ctx, "[seed] actor %q not found, skipping federation seed", ownerUsername)
		return nil
	}

	federationID := "fed_" + ulid.Make().String()
	now := time.Now()

	fed := seedFederationRecord{
		FederationID:           federationID,
		Name:                   "local",
		Description:            "Auto-bootstrapped local federation",
		Status:                 "active",
		PolicyType:             "single_admin",
		SequencerStationPeerID: stationPeerID,
		GenesisHash:            make([]byte, 32),
		HeadHash:               make([]byte, 32),
		HeadSeq:                0,
		CreatedByActorPTID:     actor.PTID,
		CreatedByStationPeerID: stationPeerID,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	membership := seedMembershipRecord{
		FederationID:  federationID,
		StationPeerID: stationPeerID,
		StationName:   "local",
		StationURL:    "",
		Role:          "founder",
		Status:        "active",
		JoinedAt:      now,
	}

	actorRole := seedActorRoleRecord{
		FederationID:         federationID,
		ActorPTID:            actor.PTID,
		ActorFederatedHandle: actor.PTID,
		StationPeerID:        stationPeerID,
		Role:                 "federation_owner",
		CreatedAt:            now,
	}

	return rds.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&fed).Error; err != nil {
			return err
		}
		if err := tx.Create(&membership).Error; err != nil {
			return err
		}
		if err := tx.Create(&actorRole).Error; err != nil {
			return err
		}
		log.Infof(ctx, "[seed] dev federation bootstrapped: id=%s owner=%s station=%s",
			federationID, ownerUsername, stationPeerID)
		return nil
	})
}
