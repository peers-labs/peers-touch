package persistence

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

const retiredExtensionEndpointTable = "ecosystem_custom_plugins"

type retiredExtensionEndpointRow struct {
	ID             string    `gorm:"column:id"`
	Name           string    `gorm:"column:name"`
	Description    string    `gorm:"column:description"`
	Endpoint       string    `gorm:"column:endpoint"`
	Method         string    `gorm:"column:method"`
	AuthType       string    `gorm:"column:auth_type"`
	InputSchema    string    `gorm:"column:input_schema"`
	OutputSchema   string    `gorm:"column:output_schema"`
	Enabled        bool      `gorm:"column:enabled"`
	OwnerActorPTID string    `gorm:"column:owner_actor_ptid"`
	OwnerActorID   string    `gorm:"column:owner_actor_id"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
}

func (retiredExtensionEndpointRow) TableName() string {
	return retiredExtensionEndpointTable
}

type RetiredExtensionEndpointAudit struct {
	ActorScopeHash string
	MetadataHash   string
}

func ReadRetiredExtensionEndpointAudits(
	db *gorm.DB,
) ([]RetiredExtensionEndpointAudit, error) {
	if db == nil {
		return nil, fmt.Errorf("retired extension audit requires database")
	}
	if !db.Migrator().HasTable(retiredExtensionEndpointTable) {
		return nil, nil
	}

	var rows []retiredExtensionEndpointRow
	if err := db.Table(retiredExtensionEndpointTable).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("read retired extension endpoints: %w", err)
	}

	audits := make([]RetiredExtensionEndpointAudit, 0, len(rows))
	for _, row := range rows {
		actorScope := strings.TrimSpace(row.OwnerActorPTID)
		if actorScope == "" {
			actorScope = strings.TrimSpace(row.OwnerActorID)
		}
		if actorScope == "" {
			return nil, fmt.Errorf(
				"retired extension endpoint %q has no actor scope",
				row.ID,
			)
		}
		audits = append(audits, RetiredExtensionEndpointAudit{
			ActorScopeHash: retiredExtensionEndpointHash(actorScope),
			MetadataHash: retiredExtensionEndpointHash(
				row.ID,
				row.Name,
				row.Description,
				row.Endpoint,
				row.Method,
				row.AuthType,
				row.InputSchema,
				row.OutputSchema,
				strconv.FormatBool(row.Enabled),
				row.CreatedAt.UTC().Format(time.RFC3339Nano),
				row.UpdatedAt.UTC().Format(time.RFC3339Nano),
			),
		})
	}
	return audits, nil
}

func PurgeRetiredExtensionEndpointTable(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("retired extension purge requires database")
	}
	if !db.Migrator().HasTable(retiredExtensionEndpointTable) {
		return nil
	}
	if err := db.Migrator().DropTable(retiredExtensionEndpointTable); err != nil {
		return fmt.Errorf("purge retired extension endpoint table: %w", err)
	}
	return nil
}

func retiredExtensionEndpointHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}
