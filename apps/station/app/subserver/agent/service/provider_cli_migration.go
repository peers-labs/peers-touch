package service

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

// MigrateCLIAdapterIdentities preserves resource IDs, versions and grants.
// Unknown legacy CLI rows remain unavailable instead of executing guessed argv.
func MigrateCLIAdapterIdentities(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		for _, cp := range catalog.List() {
			if cp.RuntimeKind != providerRuntimeCLI {
				continue
			}
			if err := tx.Model(&persistence.AgentProvider{}).
				Where("runtime_kind = ? AND name = ? AND cli_adapter_id = ?", providerRuntimeCLI, cp.ID, "").
				UpdateColumn("cli_adapter_id", cp.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
