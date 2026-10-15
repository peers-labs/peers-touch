package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ---- Persistent Object models (GORM) ----

type enrollmentPO struct {
	ID                     uint64 `gorm:"primaryKey;autoIncrement:false"`
	StationPeerID          string `gorm:"size:255;uniqueIndex:idx_relay_enrollment_station_node,priority:1;uniqueIndex:idx_relay_enrollment_station_node_generation,priority:1"`
	NodePeerID             string `gorm:"size:255;uniqueIndex;uniqueIndex:idx_relay_enrollment_station_node,priority:2;uniqueIndex:idx_relay_enrollment_station_node_generation,priority:2"`
	StationRootPublicKey   []byte
	NodeAuthorizationEpoch uint64
	NodeAuthorizationUntil time.Time               `gorm:"index"`
	Label                  string                  `gorm:"size:255"`
	Status                 domain.EnrollmentStatus `gorm:"index"`
	Generation             uint64                  `gorm:"not null;default:1;uniqueIndex:idx_relay_enrollment_station_node_generation,priority:3"`
	CredentialJTI          string                  `gorm:"size:128;index"`
	MaxClients             int32
	BandwidthLimit         int64
	InviteID               uint64 `gorm:"index"`
	EnrolledAt             time.Time
	RevokedAt              *time.Time `gorm:"index"`
	CreatedAt              time.Time  `gorm:"autoCreateTime"`
	UpdatedAt              time.Time  `gorm:"autoUpdateTime"`
}

func (*enrollmentPO) TableName() string { return "relay_enrollment" }

func (m *enrollmentPO) BeforeCreate(_ *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

type invitePO struct {
	ID                    uint64 `gorm:"primaryKey;autoIncrement:false"`
	SecretDigest          string `gorm:"column:secret_digest;size:64;uniqueIndex"`
	IntendedStationPeerID string `gorm:"column:intended_station_peer_id;size:255;index"`
	Label                 string `gorm:"size:255"`
	MaxClients            int32
	BandwidthLimit        int64
	Status                domain.InviteStatus `gorm:"index"`
	ConsumedBy            string              `gorm:"size:255"`
	ConsumedAt            *time.Time
	CreatedAt             time.Time `gorm:"autoCreateTime"`
	UpdatedAt             time.Time `gorm:"autoUpdateTime"`
}

func (*invitePO) TableName() string { return "relay_invite" }

func (i *invitePO) BeforeCreate(_ *gorm.DB) error {
	if i.ID == 0 {
		i.ID = id.NextID()
	}
	return nil
}

// ---- domain ↔ PO converters ----

func toDomainEnrollment(po enrollmentPO) domain.Enrollment {
	return domain.Enrollment{
		ID:                     po.ID,
		StationPeerID:          po.StationPeerID,
		NodePeerID:             po.NodePeerID,
		StationRootPublicKey:   append([]byte(nil), po.StationRootPublicKey...),
		NodeAuthorizationEpoch: po.NodeAuthorizationEpoch,
		NodeAuthorizationUntil: po.NodeAuthorizationUntil,
		Label:                  po.Label,
		Status:                 po.Status,
		Generation:             po.Generation,
		CredentialJTI:          po.CredentialJTI,
		MaxClients:             po.MaxClients,
		BandwidthLimit:         po.BandwidthLimit,
		InviteID:               po.InviteID,
		EnrolledAt:             po.EnrolledAt,
		RevokedAt:              po.RevokedAt,
		CreatedAt:              po.CreatedAt,
		UpdatedAt:              po.UpdatedAt,
	}
}

func toEnrollmentPO(m *domain.Enrollment) enrollmentPO {
	return enrollmentPO{
		ID:                     m.ID,
		StationPeerID:          m.StationPeerID,
		NodePeerID:             m.NodePeerID,
		StationRootPublicKey:   append([]byte(nil), m.StationRootPublicKey...),
		NodeAuthorizationEpoch: m.NodeAuthorizationEpoch,
		NodeAuthorizationUntil: m.NodeAuthorizationUntil,
		Label:                  m.Label,
		Status:                 m.Status,
		Generation:             m.Generation,
		CredentialJTI:          m.CredentialJTI,
		MaxClients:             m.MaxClients,
		BandwidthLimit:         m.BandwidthLimit,
		InviteID:               m.InviteID,
		EnrolledAt:             m.EnrolledAt,
		RevokedAt:              m.RevokedAt,
		CreatedAt:              m.CreatedAt,
		UpdatedAt:              m.UpdatedAt,
	}
}

func toDomainInvite(po invitePO) domain.Invite {
	return domain.Invite{
		ID:                    po.ID,
		SecretDigest:          po.SecretDigest,
		IntendedStationPeerID: po.IntendedStationPeerID,
		Label:                 po.Label,
		MaxClients:            po.MaxClients,
		BandwidthLimit:        po.BandwidthLimit,
		Status:                po.Status,
		ConsumedBy:            po.ConsumedBy,
		ConsumedAt:            po.ConsumedAt,
		CreatedAt:             po.CreatedAt,
		UpdatedAt:             po.UpdatedAt,
	}
}

func toInvitePO(i *domain.Invite) invitePO {
	return invitePO{
		ID:                    i.ID,
		SecretDigest:          i.SecretDigest,
		IntendedStationPeerID: i.IntendedStationPeerID,
		Label:                 i.Label,
		MaxClients:            i.MaxClients,
		BandwidthLimit:        i.BandwidthLimit,
		Status:                i.Status,
		ConsumedBy:            i.ConsumedBy,
		ConsumedAt:            i.ConsumedAt,
		CreatedAt:             i.CreatedAt,
		UpdatedAt:             i.UpdatedAt,
	}
}

// ---- GormRepo implements domain.Repository ----

var _ domain.Repository = (*GormRepo)(nil)

type GormRepo struct {
	db           *gorm.DB
	enrollmentMu sync.Mutex
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		legacyInviteTable := tx.Migrator().HasTable(&invitePO{}) &&
			tx.Migrator().HasColumn(&invitePO{}, "token")
		if legacyInviteTable {
			// Legacy invite rows contain plaintext bearer secrets. They cannot
			// be migrated into the PoP flow, so invalidate and remove them.
			if err := tx.Exec("DELETE FROM relay_invite").Error; err != nil {
				return fmt.Errorf("purge legacy relay invites: %w", err)
			}
			for _, indexName := range []string{
				"idx_relay_invite_token",
				"idx_relay_invite_station_peer_id",
			} {
				if err := dropLegacyIndex(tx, indexName); err != nil {
					return err
				}
			}
			if err := tx.Exec(
				"ALTER TABLE relay_invite DROP COLUMN token",
			).Error; err != nil {
				return fmt.Errorf("drop legacy relay invite token: %w", err)
			}
			if tx.Migrator().HasColumn(&invitePO{}, "station_peer_id") {
				if err := tx.Exec(
					"ALTER TABLE relay_invite DROP COLUMN station_peer_id",
				).Error; err != nil {
					return fmt.Errorf("drop legacy Relay invite identity: %w", err)
				}
			}
		}
		if tx.Migrator().HasTable("relay_invite") &&
			tx.Migrator().HasColumn("relay_invite", "expires_at") {
			if err := tx.
				Where("status IN ?", []domain.InviteStatus{3, 4}).
				Delete(&invitePO{}).Error; err != nil {
				return fmt.Errorf(
					"remove terminal expiring Relay invites: %w",
					err,
				)
			}
			if err := dropLegacyIndex(
				tx,
				"idx_relay_invite_expires_at",
			); err != nil {
				return err
			}
			if err := tx.Exec(
				"ALTER TABLE relay_invite DROP COLUMN expires_at",
			).Error; err != nil {
				return fmt.Errorf(
					"drop Relay invite expiry column: %w",
					err,
				)
			}
		}
		if tx.Migrator().HasTable(&enrollmentPO{}) {
			for _, indexName := range []string{
				"idx_relay_enrollment_station_peer_id",
				"idx_relay_enrollment_station_generation",
			} {
				if err := dropLegacyEnrollmentIndex(tx, indexName); err != nil {
					return err
				}
			}
		}
		if err := tx.AutoMigrate(&enrollmentPO{}, &invitePO{}); err != nil {
			return err
		}

		now := time.Now().UTC()
		result := tx.Model(&enrollmentPO{}).
			Where(
				"status <> ? AND (generation = 0 OR credential_jti = ? OR node_peer_id = ? OR station_root_public_key IS NULL OR length(station_root_public_key) = 0 OR node_authorization_epoch = 0)",
				domain.EnrollmentStatusRevoked,
				"",
				"",
			).
			Updates(map[string]interface{}{
				"generation":     gorm.Expr("CASE WHEN generation = 0 THEN 1 ELSE generation + 1 END"),
				"credential_jti": "",
				"status":         domain.EnrollmentStatusRevoked,
				"revoked_at":     &now,
			})
		if result.Error != nil {
			return fmt.Errorf("invalidate legacy relay enrollments: %w", result.Error)
		}
		return nil
	})
}

// ---- Invite ----

func (r *GormRepo) CreateInvite(ctx context.Context, invite *domain.Invite) error {
	po := toInvitePO(invite)
	if err := r.db.WithContext(ctx).Create(&po).Error; err != nil {
		return err
	}
	invite.ID = po.ID
	invite.CreatedAt = po.CreatedAt
	invite.UpdatedAt = po.UpdatedAt
	return nil
}

func (r *GormRepo) GetInviteBySecretDigest(ctx context.Context, secretDigest string) (*domain.Invite, error) {
	var po invitePO
	if err := r.db.WithContext(ctx).
		Where("secret_digest = ?", secretDigest).
		First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainInvite(po)
	return &out, nil
}

func (r *GormRepo) ConsumeInviteAndCreateEnrollment(
	ctx context.Context,
	inviteID uint64,
	enrollment *domain.Enrollment,
	maxStations int,
) (*domain.Enrollment, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	now := time.Now().UTC()
	var activated domain.Enrollment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&invitePO{}).
			Where(
				"id = ? AND status = ?",
				inviteID,
				domain.InviteStatusActive,
			).
			Updates(map[string]interface{}{
				"status":      domain.InviteStatusConsumed,
				"consumed_by": enrollment.StationPeerID,
				"consumed_at": &now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return fmt.Errorf("%w: invite_id=%d", domain.ErrInviteAlreadyConsumed, inviteID)
		}

		var current enrollmentPO
		getErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"station_peer_id = ? AND node_peer_id = ?",
				enrollment.StationPeerID,
				enrollment.NodePeerID,
			).
			First(&current).Error
		if getErr != nil && !errorsIsRecordNotFound(getErr) {
			return getErr
		}

		if errorsIsRecordNotFound(getErr) && maxStations > 0 {
			var count int64
			if err := tx.Model(&enrollmentPO{}).
				Distinct("station_peer_id").
				Where(
					"status <> ? AND station_peer_id <> ?",
					domain.EnrollmentStatusRevoked,
					enrollment.StationPeerID,
				).
				Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(maxStations) {
				return domain.ErrRelayCapacityFull
			}
		}

		next := toEnrollmentPO(enrollment)
		next.Status = domain.EnrollmentStatusOffline
		next.EnrolledAt = now
		next.RevokedAt = nil
		if errorsIsRecordNotFound(getErr) {
			next.Generation = 1
			if err := tx.Create(&next).Error; err != nil {
				return err
			}
		} else {
			next.ID = current.ID
			next.Generation = current.Generation + 1
			next.CreatedAt = current.CreatedAt
			if err := tx.Save(&next).Error; err != nil {
				return err
			}
		}
		activated = toDomainEnrollment(next)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &activated, nil
}

func (r *GormRepo) ListInvites(ctx context.Context) ([]domain.Invite, error) {
	var pos []invitePO
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&pos).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Invite, 0, len(pos))
	for _, po := range pos {
		out = append(out, toDomainInvite(po))
	}
	return out, nil
}

func (r *GormRepo) DeleteInvite(ctx context.Context, inviteID uint64) error {
	result := r.db.WithContext(ctx).
		Where("id = ? AND status = ?", inviteID, domain.InviteStatusActive).
		Delete(&invitePO{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf(
			"%w: invite_id=%d",
			domain.ErrInviteAlreadyConsumed,
			inviteID,
		)
	}
	return nil
}

// ---- Enrollment ----

func (r *GormRepo) GetEnrollment(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
) (*domain.Enrollment, error) {
	var po enrollmentPO
	if err := r.db.WithContext(ctx).
		Where(
			"station_peer_id = ? AND node_peer_id = ?",
			stationPeerID,
			nodePeerID,
		).
		First(&po).Error; err != nil {
		return nil, err
	}
	out := toDomainEnrollment(po)
	return &out, nil
}

func (r *GormRepo) UpdateEnrollmentStatus(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
	generation uint64,
	status domain.EnrollmentStatus,
) error {
	result := r.db.WithContext(ctx).Model(&enrollmentPO{}).
		Where(
			"station_peer_id = ? AND node_peer_id = ? AND generation = ? AND status <> ?",
			stationPeerID,
			nodePeerID,
			generation,
			domain.EnrollmentStatusRevoked,
		).
		Update("status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrNodeCredentialStale
	}
	return nil
}

func (r *GormRepo) RotateNodeCredential(
	ctx context.Context,
	current domain.NodeIdentity,
	nextCredentialJTI string,
	nodeAuthorizationEpoch uint64,
	nodeAuthorizationUntil time.Time,
) (*domain.Enrollment, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	if nextCredentialJTI == "" || nodeAuthorizationEpoch == 0 ||
		!nodeAuthorizationUntil.After(time.Now().UTC()) {
		return nil, domain.ErrNodeCredentialStale
	}

	var rotated domain.Enrollment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&enrollmentPO{}).
			Where(
				"id = ? AND station_peer_id = ? AND node_peer_id = ? AND generation = ? AND credential_jti = ? AND status <> ? AND node_authorization_epoch <= ?",
				current.EnrollmentID,
				current.StationPeerID,
				current.NodePeerID,
				current.Generation,
				current.JTI,
				domain.EnrollmentStatusRevoked,
				nodeAuthorizationEpoch,
			).
			Updates(map[string]interface{}{
				"credential_jti":           nextCredentialJTI,
				"node_authorization_epoch": nodeAuthorizationEpoch,
				"node_authorization_until": nodeAuthorizationUntil.UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return domain.ErrNodeCredentialStale
		}

		var committed enrollmentPO
		if err := tx.First(&committed, "id = ?", current.EnrollmentID).Error; err != nil {
			return fmt.Errorf(
				"load committed Relay enrollment %d: %w",
				current.EnrollmentID,
				err,
			)
		}
		rotated = toDomainEnrollment(committed)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &rotated, nil
}

func (r *GormRepo) RetireEnrollment(
	ctx context.Context,
	current domain.NodeIdentity,
) (*domain.Enrollment, error) {
	return r.revokeEnrollment(ctx, current.StationPeerID, current.NodePeerID, &current)
}

func (r *GormRepo) RevokeEnrollment(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
) (*domain.Enrollment, error) {
	return r.revokeEnrollment(ctx, stationPeerID, nodePeerID, nil)
}

func (r *GormRepo) revokeEnrollment(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
	identity *domain.NodeIdentity,
) (*domain.Enrollment, error) {
	r.enrollmentMu.Lock()
	defer r.enrollmentMu.Unlock()

	var revoked domain.Enrollment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current enrollmentPO
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"station_peer_id = ? AND node_peer_id = ?",
				stationPeerID,
				nodePeerID,
			).
			First(&current).Error; err != nil {
			if errorsIsRecordNotFound(err) {
				return domain.ErrEnrollmentNotFound
			}
			return err
		}
		now := time.Now().UTC()
		if identity != nil {
			if current.ID != identity.EnrollmentID || current.CredentialJTI != identity.JTI {
				return domain.ErrNodeCredentialStale
			}
			if current.Status == domain.EnrollmentStatusRevoked {
				if current.Generation != identity.Generation+1 {
					return domain.ErrNodeCredentialStale
				}
			} else if current.Generation != identity.Generation ||
				!identity.ExpiresAt.After(now) || !current.NodeAuthorizationUntil.After(now) {
				return domain.ErrNodeCredentialStale
			}
		}
		if current.Status == domain.EnrollmentStatusRevoked {
			revoked = toDomainEnrollment(current)
			return nil
		}
		result := tx.Model(&enrollmentPO{}).
			Where("id = ? AND generation = ? AND credential_jti = ? AND status <> ?",
				current.ID, current.Generation, current.CredentialJTI, domain.EnrollmentStatusRevoked).
			Updates(map[string]interface{}{
				"generation": current.Generation + 1,
				"status":     domain.EnrollmentStatusRevoked,
				"revoked_at": &now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return domain.ErrNodeCredentialStale
		}
		current.Generation++
		current.Status = domain.EnrollmentStatusRevoked
		current.RevokedAt = &now
		revoked = toDomainEnrollment(current)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &revoked, nil
}

func (r *GormRepo) ListOnlineEnrollments(ctx context.Context) ([]domain.Enrollment, error) {
	var pos []enrollmentPO
	if err := r.db.WithContext(ctx).Where("status = ?", domain.EnrollmentStatusOnline).Find(&pos).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Enrollment, 0, len(pos))
	for _, po := range pos {
		out = append(out, toDomainEnrollment(po))
	}
	return out, nil
}

func (r *GormRepo) ListAdmittedEnrollments(ctx context.Context) ([]domain.Enrollment, error) {
	var pos []enrollmentPO
	if err := r.db.WithContext(ctx).
		Where(
			"status <> ? AND node_authorization_until > ?",
			domain.EnrollmentStatusRevoked,
			time.Now().UTC(),
		).
		Find(&pos).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Enrollment, 0, len(pos))
	for _, po := range pos {
		out = append(out, toDomainEnrollment(po))
	}
	return out, nil
}

func (r *GormRepo) CountOnlineEnrollments(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&enrollmentPO{}).
		Where("status = ?", domain.EnrollmentStatusOnline).
		Count(&count).Error
	return count, err
}

func errorsIsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

func dropLegacyIndex(tx *gorm.DB, indexName string) error {
	if !tx.Migrator().HasIndex(&invitePO{}, indexName) {
		return nil
	}
	statement := "DROP INDEX IF EXISTS " + indexName
	if tx.Dialector.Name() == "mysql" {
		statement = "DROP INDEX " + indexName + " ON relay_invite"
	}
	if err := tx.Exec(statement).Error; err != nil &&
		tx.Dialector.Name() == "mysql" {
		return fmt.Errorf("drop legacy Relay invite index %s: %w", indexName, err)
	}
	return nil
}

func dropLegacyEnrollmentIndex(tx *gorm.DB, indexName string) error {
	if !tx.Migrator().HasIndex(&enrollmentPO{}, indexName) {
		return nil
	}
	statement := "DROP INDEX IF EXISTS " + indexName
	if tx.Dialector.Name() == "mysql" {
		statement = "DROP INDEX " + indexName + " ON relay_enrollment"
	}
	if err := tx.Exec(statement).Error; err != nil &&
		tx.Dialector.Name() == "mysql" {
		return fmt.Errorf(
			"drop legacy Relay enrollment index %s: %w",
			indexName,
			err,
		)
	}
	return nil
}
