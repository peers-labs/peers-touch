package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	stationAccessKeyTable          = "auth_station_access_keys"
	stationAccessKeySchemaRevision = uint32(1)
	stationAccessKeyAlgorithm      = "HS256"
	stationAccessKeySlotCurrent    = "current"
	stationAccessKeySlotPrevious   = "previous"
)

var (
	ErrStationAccessKeyringMismatch = errors.New("station access keyring mismatch")
	ErrStationAccessKeyNotFound     = errors.New("station access key not found")
)

// StationAccessKeyRow is the shared Station authority for user JWTs and
// keyed Access transaction fingerprints. Key IDs make rotation and replay
// validation independent from the process that handled the original request.
type StationAccessKeyRow struct {
	Slot           string    `gorm:"column:slot;primaryKey;size:16"`
	KeyID          string    `gorm:"column:key_id;size:80;not null;uniqueIndex"`
	Algorithm      string    `gorm:"column:algorithm;size:16;not null"`
	KeyMaterial    []byte    `gorm:"column:key_material;type:bytea;not null"`
	SchemaRevision uint32    `gorm:"column:schema_revision;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

func (StationAccessKeyRow) TableName() string {
	return stationAccessKeyTable
}

type StationAccessKey struct {
	ID       string
	Material []byte
}

type StationAccessKeyring interface {
	Current(context.Context) (StationAccessKey, error)
	Resolve(context.Context, string) (StationAccessKey, error)
	ValidationKeys(context.Context, string) ([]StationAccessKey, error)
}

type gormStationAccessKeyring struct {
	db *gorm.DB
}

var (
	stationAccessKeyringMu sync.RWMutex
	stationAccessKeyring   StationAccessKeyring
)

func init() {
	store.InitTableHooks(func(ctx context.Context, database *gorm.DB) {
		if err := MigrateStationAccessKeyringSchema(ctx, database); err != nil {
			panic(err)
		}
	})
}

func MigrateStationAccessKeyringSchema(
	ctx context.Context,
	database *gorm.DB,
) error {
	if database == nil {
		return errors.New("station access keyring database is required")
	}
	if err := database.WithContext(ctx).AutoMigrate(
		&StationAccessKeyRow{},
	); err != nil {
		return fmt.Errorf("migrate station access keyring: %w", err)
	}
	return nil
}

// OpenStationAccessKeyring installs or verifies the database-backed keyring.
// The configured current secret bootstraps an empty Station database; once a
// row exists, a different configured secret is a readiness failure.
func OpenStationAccessKeyring(
	ctx context.Context,
	database *gorm.DB,
	currentSecret string,
	previousSecret string,
) (StationAccessKeyring, error) {
	if database == nil {
		return nil, errors.New("station access keyring database is required")
	}
	if strings.TrimSpace(currentSecret) == "" {
		return nil, fmt.Errorf(
			"%w: current secret is empty",
			ErrStationAccessKeyringMismatch,
		)
	}
	if strings.TrimSpace(previousSecret) == "" {
		previousSecret = ""
	}
	if err := MigrateStationAccessKeyringSchema(ctx, database); err != nil {
		return nil, err
	}

	keyring := &gormStationAccessKeyring{db: database}
	err := database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		if err := ensureStationAccessKeySlot(
			tx,
			stationAccessKeySlotCurrent,
			[]byte(currentSecret),
			now,
		); err != nil {
			return err
		}
		if previousSecret != "" && previousSecret != currentSecret {
			if err := ensureStationAccessKeySlot(
				tx,
				stationAccessKeySlotPrevious,
				[]byte(previousSecret),
				now,
			); err != nil {
				return err
			}
		}

		var rows []StationAccessKeyRow
		if err := tx.Order("slot ASC").Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 || len(rows) > 2 {
			return fmt.Errorf(
				"%w: expected one current and at most one previous key",
				ErrStationAccessKeyringMismatch,
			)
		}
		for i := range rows {
			if err := validateStationAccessKeyRow(&rows[i]); err != nil {
				return err
			}
			if rows[i].Slot != stationAccessKeySlotCurrent &&
				rows[i].Slot != stationAccessKeySlotPrevious {
				return fmt.Errorf(
					"%w: unsupported slot %q",
					ErrStationAccessKeyringMismatch,
					rows[i].Slot,
				)
			}
			if rows[i].Slot == stationAccessKeySlotPrevious &&
				previousSecret != "" &&
				subtle.ConstantTimeCompare(
					rows[i].KeyMaterial,
					[]byte(previousSecret),
				) != 1 {
				return fmt.Errorf(
					"%w: configured previous key differs from persisted key %s",
					ErrStationAccessKeyringMismatch,
					rows[i].KeyID,
				)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if _, err := keyring.Current(ctx); err != nil {
		return nil, err
	}
	return keyring, nil
}

func InitializeConfiguredStationAccessKeyring(
	ctx context.Context,
	database *gorm.DB,
) error {
	config := Get()
	keyring, err := OpenStationAccessKeyring(
		ctx,
		database,
		config.Secret,
		config.PreviousSecret,
	)
	if err != nil {
		return err
	}
	SetStationAccessKeyring(keyring)
	return nil
}

func SetStationAccessKeyring(keyring StationAccessKeyring) {
	stationAccessKeyringMu.Lock()
	defer stationAccessKeyringMu.Unlock()
	stationAccessKeyring = keyring
}

func getStationAccessKeyring() StationAccessKeyring {
	stationAccessKeyringMu.RLock()
	defer stationAccessKeyringMu.RUnlock()
	return stationAccessKeyring
}

// StationAccessKeyringReady verifies that this process is bound to the shared
// Station keyring and returns the non-secret current key ID for cluster
// admission comparison.
func StationAccessKeyringReady(
	ctx context.Context,
) (string, error) {
	keyring := getStationAccessKeyring()
	if keyring == nil {
		return "", fmt.Errorf(
			"%w: shared keyring is not initialized",
			ErrStationAccessKeyringMismatch,
		)
	}
	current, err := keyring.Current(ctx)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(current.ID) == "" ||
		len(current.Material) == 0 ||
		current.ID != stationAccessKeyID(current.Material) {
		return "", fmt.Errorf(
			"%w: current key is invalid",
			ErrStationAccessKeyringMismatch,
		)
	}
	return current.ID, nil
}

func ensureStationAccessKeySlot(
	tx *gorm.DB,
	slot string,
	material []byte,
	now time.Time,
) error {
	row := StationAccessKeyRow{
		Slot:           slot,
		KeyID:          stationAccessKeyID(material),
		Algorithm:      stationAccessKeyAlgorithm,
		KeyMaterial:    append([]byte(nil), material...),
		SchemaRevision: stationAccessKeySchemaRevision,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&row).Error; err != nil {
		return fmt.Errorf("persist station access %s key: %w", slot, err)
	}

	var persisted StationAccessKeyRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("slot = ?", slot).
		First(&persisted).Error; err != nil {
		return fmt.Errorf("load station access %s key: %w", slot, err)
	}
	if err := validateStationAccessKeyRow(&persisted); err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(persisted.KeyMaterial, material) != 1 {
		return fmt.Errorf(
			"%w: configured %s key differs from persisted key %s",
			ErrStationAccessKeyringMismatch,
			slot,
			persisted.KeyID,
		)
	}
	return nil
}

func (k *gormStationAccessKeyring) Current(
	ctx context.Context,
) (StationAccessKey, error) {
	return k.loadSlot(ctx, stationAccessKeySlotCurrent)
}

func (k *gormStationAccessKeyring) Resolve(
	ctx context.Context,
	keyID string,
) (StationAccessKey, error) {
	keyID = strings.TrimSpace(keyID)
	if keyID == "" {
		return StationAccessKey{}, ErrStationAccessKeyNotFound
	}
	var row StationAccessKeyRow
	if err := k.db.WithContext(ctx).
		Where("key_id = ?", keyID).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return StationAccessKey{}, ErrStationAccessKeyNotFound
		}
		return StationAccessKey{}, err
	}
	return stationAccessKeyFromRow(&row)
}

func (k *gormStationAccessKeyring) ValidationKeys(
	ctx context.Context,
	keyID string,
) ([]StationAccessKey, error) {
	if strings.TrimSpace(keyID) != "" {
		key, err := k.Resolve(ctx, keyID)
		if err != nil {
			return nil, err
		}
		return []StationAccessKey{key}, nil
	}

	current, err := k.Current(ctx)
	if err != nil {
		return nil, err
	}
	keys := []StationAccessKey{current}
	previous, err := k.loadSlot(ctx, stationAccessKeySlotPrevious)
	if err == nil {
		keys = append(keys, previous)
	} else if !errors.Is(err, ErrStationAccessKeyNotFound) {
		return nil, err
	}
	return keys, nil
}

func (k *gormStationAccessKeyring) loadSlot(
	ctx context.Context,
	slot string,
) (StationAccessKey, error) {
	var row StationAccessKeyRow
	if err := k.db.WithContext(ctx).
		Where("slot = ?", slot).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return StationAccessKey{}, ErrStationAccessKeyNotFound
		}
		return StationAccessKey{}, err
	}
	return stationAccessKeyFromRow(&row)
}

func stationAccessKeyFromRow(
	row *StationAccessKeyRow,
) (StationAccessKey, error) {
	if err := validateStationAccessKeyRow(row); err != nil {
		return StationAccessKey{}, err
	}
	return StationAccessKey{
		ID:       row.KeyID,
		Material: append([]byte(nil), row.KeyMaterial...),
	}, nil
}

func validateStationAccessKeyRow(row *StationAccessKeyRow) error {
	if row == nil ||
		row.SchemaRevision != stationAccessKeySchemaRevision ||
		row.Algorithm != stationAccessKeyAlgorithm ||
		len(row.KeyMaterial) == 0 ||
		row.KeyID != stationAccessKeyID(row.KeyMaterial) {
		return fmt.Errorf(
			"%w: invalid persisted key row",
			ErrStationAccessKeyringMismatch,
		)
	}
	return nil
}

func stationAccessKeyID(material []byte) string {
	digest := sha256.Sum256(material)
	return "sak1-" + hex.EncodeToString(digest[:])
}

// StationAccessMAC computes a domain-separated digest with an explicit key ID.
// An empty key ID selects the current shared key.
func StationAccessMAC(
	ctx context.Context,
	keyID string,
	domain string,
	payload []byte,
) (string, string, error) {
	keyring := getStationAccessKeyring()
	if keyring == nil {
		config := Get()
		material := []byte(config.Secret)
		static := staticStationAccessKeyring{
			current: StationAccessKey{
				ID:       stationAccessKeyID(material),
				Material: material,
			},
		}
		if config.PreviousSecret != "" {
			previousMaterial := []byte(config.PreviousSecret)
			static.previous = &StationAccessKey{
				ID:       stationAccessKeyID(previousMaterial),
				Material: previousMaterial,
			}
		}
		keyring = static
	}

	var (
		key StationAccessKey
		err error
	)
	if strings.TrimSpace(keyID) == "" {
		key, err = keyring.Current(ctx)
	} else {
		key, err = keyring.Resolve(ctx, keyID)
	}
	if err != nil {
		return "", "", err
	}
	mac := hmac.New(sha256.New, key.Material)
	_, _ = mac.Write([]byte(domain))
	_, _ = mac.Write(payload)
	return key.ID, hex.EncodeToString(mac.Sum(nil)), nil
}

type staticStationAccessKeyring struct {
	current  StationAccessKey
	previous *StationAccessKey
}

func (k staticStationAccessKeyring) Current(
	context.Context,
) (StationAccessKey, error) {
	if len(k.current.Material) == 0 {
		return StationAccessKey{}, ErrStationAccessKeyNotFound
	}
	return k.current, nil
}

func (k staticStationAccessKeyring) Resolve(
	_ context.Context,
	keyID string,
) (StationAccessKey, error) {
	if keyID == k.current.ID {
		return k.current, nil
	}
	if k.previous != nil && keyID == k.previous.ID {
		return *k.previous, nil
	}
	return StationAccessKey{}, ErrStationAccessKeyNotFound
}

func (k staticStationAccessKeyring) ValidationKeys(
	ctx context.Context,
	keyID string,
) ([]StationAccessKey, error) {
	if keyID != "" {
		key, err := k.Resolve(ctx, keyID)
		if err != nil {
			return nil, err
		}
		return []StationAccessKey{key}, nil
	}
	keys := []StationAccessKey{k.current}
	if k.previous != nil {
		keys = append(keys, *k.previous)
	}
	return keys, nil
}
