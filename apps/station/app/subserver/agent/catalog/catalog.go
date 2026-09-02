package catalog

import (
	_ "embed"
	"sync"

	"gopkg.in/yaml.v2"
)

//go:embed providers.default.yaml
var defaultCatalogYAML []byte

type CatalogModel struct {
	ID              string   `yaml:"id"`
	DisplayName     string   `yaml:"display_name"`
	Type            string   `yaml:"type"`
	Enabled         bool     `yaml:"enabled"`
	ContextWindow   int      `yaml:"context_window"`
	ThinkingControl string   `yaml:"thinking_control"`
	Capabilities    []string `yaml:"capabilities"`
}

type CatalogProvider struct {
	ID               string         `yaml:"id"`
	Name             string         `yaml:"name"`
	Description      string         `yaml:"description"`
	Enabled          bool           `yaml:"enabled"`
	Builtin          bool           `yaml:"builtin"`
	ShowChecker      bool           `yaml:"show_checker"`
	ShowAPIKey       *bool          `yaml:"show_api_key"`
	Protocol         string         `yaml:"protocol"`
	Discovery        string         `yaml:"discovery"`
	HomeURL          string         `yaml:"home_url"`
	APIKeyURL        string         `yaml:"api_key_url"`
	DefaultBaseURL   string         `yaml:"default_base_url"`
	RuntimeKind      string         `yaml:"runtime_kind"`
	CredentialEnvKey string         `yaml:"credential_env_key"`
	CliCommand       string         `yaml:"cli_command"`
	ModelsCommand    string         `yaml:"models_command"`
	Models           []CatalogModel `yaml:"models"`
}

type catalogFile struct {
	Providers []CatalogProvider `yaml:"providers"`
}

var (
	catalogOnce     sync.Once
	catalogRegistry []CatalogProvider
)

func loadCatalog() {
	var f catalogFile
	if err := yaml.Unmarshal(defaultCatalogYAML, &f); err != nil {
		catalogRegistry = []CatalogProvider{}
		return
	}
	catalogRegistry = f.Providers
}

func List() []CatalogProvider {
	catalogOnce.Do(loadCatalog)
	return catalogRegistry
}

func Find(id string) *CatalogProvider {
	for i := range List() {
		if catalogRegistry[i].ID == id {
			return &catalogRegistry[i]
		}
	}
	return nil
}

// SetForTesting replaces the catalog registry with the given providers.
// It must only be called from tests. Callers should defer RestoreForTesting
// to avoid polluting other tests.
func SetForTesting(providers []CatalogProvider) {
	catalogOnce.Do(func() {}) // ensure sync.Once is spent
	catalogRegistry = providers
}

// RestoreForTesting reloads the catalog from the embedded default YAML.
func RestoreForTesting() {
	loadCatalog()
}
