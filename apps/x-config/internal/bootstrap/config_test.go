package bootstrap

import (
	"strings"
	"testing"
)

func TestLoadConfigRequiresIndependentProductionStorageDrivers(t *testing.T) {
	t.Setenv("X_CONFIG_STORAGE_DRIVER", "github")
	if _, err := LoadConfig(); err == nil ||
		!strings.Contains(
			err.Error(),
			"unsupported_x_config_catalog_storage_driver",
		) {
		t.Fatalf("legacy storage driver remained active: %v", err)
	}

	t.Setenv("X_CONFIG_CATALOG_STORAGE_DRIVER", "github")
	if _, err := LoadConfig(); err == nil ||
		!strings.Contains(
			err.Error(),
			"unsupported_x_config_operator_storage_driver",
		) {
		t.Fatalf("missing operator driver did not fail closed: %v", err)
	}

	t.Setenv("X_CONFIG_OPERATOR_STORAGE_DRIVER", "sqlite")
	if _, err := LoadConfig(); err == nil ||
		!strings.Contains(
			err.Error(),
			"x_config_operator_sqlite_path_required",
		) {
		t.Fatalf("missing sqlite path did not fail closed: %v", err)
	}
}
