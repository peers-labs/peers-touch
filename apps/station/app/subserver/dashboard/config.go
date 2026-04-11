// Package dashboard provides the Station Dashboard backend SubServer.
// It offers admin authentication and management APIs for the Station node.
// The dashboard admin system is completely separate from the Peers actor system.
//
// Change History:
// - 2026-04-10: Initial implementation — dashboard SubServer with auth,
//   overview, actor management, admin CRUD, audit logging, and embedded SPA.
// - 2026-04-10: Refactored to DDD architecture with application/domain/infrastructure layers.
package dashboard

import (
	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
)

var dashboardConfig = DashboardConfig{}

func init() {
	cfg.RegisterOptions(&dashboardConfig)
}

// SuperUserConfig holds the initial super admin credentials.
// The super user is automatically retired once a real admin is created.
type SuperUserConfig struct {
	Username string `pconf:"username" json:"username" yaml:"username"`
	Password string `pconf:"password" json:"password" yaml:"password"`
}

// DashboardConfig holds all configuration for the dashboard SubServer.
// Nested struct tags follow the pconf convention for YAML auto-binding.
type DashboardConfig struct {
	Peers struct {
		Dashboard struct {
			Enable      bool            `pconf:"enable" json:"enable" yaml:"enable"`
			SuperUser   SuperUserConfig `pconf:"super_user" json:"super_user" yaml:"super_user"`
			AllowedDIDs []string        `pconf:"allowed_dids" json:"allowed_dids" yaml:"allowed_dids"`
			JWTSecret   string          `pconf:"jwt_secret" json:"jwt_secret" yaml:"jwt_secret"`
			SessionTTL  string          `pconf:"session_ttl" json:"session_ttl" yaml:"session_ttl"`
			LocalOnly   bool            `pconf:"local_only" json:"local_only" yaml:"local_only"`
		} `pconf:"dashboard" json:"dashboard" yaml:"dashboard"`
	} `pconf:"peers" json:"peers" yaml:"peers"`
}

// GetConfig returns the singleton dashboard configuration.
func GetConfig() *DashboardConfig {
	return &dashboardConfig
}
