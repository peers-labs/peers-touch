package persistence

import (
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LockLinkedActor participates in the caller's transaction. The coordinator
// acquires this actor lock before offer, Access, device and Session locks.
// It cannot establish a new identity from unauthenticated client input.
func (r *Repository) LockLinkedActor(tx *gorm.DB, ptid string) (domain.ActorIdentity, error) {
	if err := requireLinkedTransaction(tx); err != nil {
		return domain.ActorIdentity{}, err
	}
	var model ActorIdentityModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("ptid = ?", ptid).First(&model).Error; err != nil {
		return domain.ActorIdentity{}, mapPersistenceError("actor_identity.link_lock", err)
	}
	return domain.ActorIdentity{
		PTID: model.PTID, PublicKey: append([]byte(nil), model.PublicKey...),
		Fingerprint:    append([]byte(nil), model.Fingerprint...),
		ProfileVersion: uint64(model.ProfileVersion),
	}, nil
}

// LinkedApprover reads the current registered key and revocation state through
// the same transaction. Client-supplied device certificates are not this truth.
func (r *Repository) LinkedApprover(tx *gorm.DB, ptid, deviceID string) (domain.Device, error) {
	if err := requireLinkedTransaction(tx); err != nil {
		return domain.Device{}, err
	}
	var identity ActorIdentityModel
	if err := tx.Where("ptid = ?", ptid).First(&identity).Error; err != nil {
		return domain.Device{}, mapPersistenceError("actor_identity.link_approver", err)
	}
	var device ActorDeviceModel
	if err := tx.Where("ptid = ? AND device_id = ? AND verification_source = ?",
		ptid, deviceID, localVerificationSource).First(&device).Error; err != nil {
		return domain.Device{}, mapPersistenceError("actor_identity.link_approver", err)
	}
	if device.Revoked {
		return domain.Device{}, domain.NewError(domain.ErrorCodeDeviceRevoked,
			"actor_identity.link_approver", "device_id", "has been revoked")
	}
	return deviceFromModel(device, identity.Fingerprint), nil
}

// ValidateLinkedEnrollment verifies a selected claim's certificate without
// activating a device. Its public certificate may be retained with the offer;
// actor_devices is written only by CommitLinkedEnrollment after secure ack.
func (r *Repository) ValidateLinkedEnrollment(
	tx *gorm.DB,
	enrollment domain.Enrollment,
) error {
	if err := requireLinkedTransaction(tx); err != nil {
		return err
	}
	if err := domain.VerifyEnrollment(enrollment.PTID, enrollment.DeviceID, enrollment); err != nil {
		return err
	}
	var model ActorIdentityModel
	if err := tx.Where("ptid = ?", enrollment.PTID).First(&model).Error; err != nil {
		return mapPersistenceError("actor_identity.link_validate", err)
	}
	identity := domain.ActorIdentity{
		PTID: model.PTID, PublicKey: model.PublicKey, Fingerprint: model.Fingerprint,
		ProfileVersion: uint64(model.ProfileVersion),
	}
	if err := identity.ValidateEnrollment(enrollment); err != nil {
		return err
	}
	// A link cannot move the profile fence. A newer profile needs a new
	// certificate from the Mobile; an older certificate cannot activate.
	if enrollment.ProfileVersion != identity.ProfileVersion {
		return domain.NewError(domain.ErrorCodeStaleProfileVersion, "actor_identity.link_validate",
			"observed_profile_version", "must equal the current profile")
	}
	var device ActorDeviceModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("ptid = ? AND device_id = ?", enrollment.PTID, enrollment.DeviceID).
		First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return mapPersistenceError("actor_identity.link_validate", err)
	}
	return deviceFromModel(device, identity.Fingerprint).ValidateEnrollment(enrollment)
}

// CommitLinkedEnrollment is called inside the ack transaction after all
// current authorization fences pass. It uses the canonical enrollment writer,
// without opening a second DB connection or activating a parallel device row.
func (r *Repository) CommitLinkedEnrollment(
	tx *gorm.DB,
	enrollment domain.Enrollment,
	now time.Time,
) (domain.Device, error) {
	if now.IsZero() {
		return domain.Device{}, errors.New("actor identity enrollment time is required")
	}
	if err := r.ValidateLinkedEnrollment(tx, enrollment); err != nil {
		return domain.Device{}, err
	}
	identity, err := establishActorIdentity(tx, enrollment, now.UTC())
	if err != nil {
		return domain.Device{}, err
	}
	return establishActorDevice(tx, identity, enrollment, now.UTC())
}

func requireLinkedTransaction(tx *gorm.DB) error {
	if tx == nil || tx.Statement == nil {
		return errors.New("actor identity transaction is required")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return errors.New("actor identity requires an active transaction")
	}
	return nil
}
