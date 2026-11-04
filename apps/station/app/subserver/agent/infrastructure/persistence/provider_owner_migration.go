package persistence

import "gorm.io/gorm"

// MigrateProviderOwnerIndexes runs after AutoMigrate has created the explicit
// owner indexes. Existing actor rows, including inaccessible unowned legacy
// rows, retain actor scope; no data is reclassified as Station-owned.
func MigrateProviderOwnerIndexes(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		for _, entry := range []struct {
			model any
			old   string
		}{
			{&AgentProvider{}, "idx_agent_providers_actor_ptid_provider"},
			{&AgentModel{}, "idx_agent_models_actor_ptid_provider_model"},
			{&Credential{}, "idx_credentials_actor_ptid_provider"},
		} {
			if tx.Migrator().HasIndex(entry.model, entry.old) {
				if err := tx.Migrator().DropIndex(entry.model, entry.old); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
