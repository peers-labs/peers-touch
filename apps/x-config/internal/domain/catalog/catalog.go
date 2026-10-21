package catalog

type Catalog struct {
	SchemaVersion int               `json:"schema_version" yaml:"schema_version"`
	Channel       string            `json:"channel" yaml:"channel"`
	Endpoints     []CatalogEndpoint `json:"endpoints" yaml:"endpoints"`
	Releases      []CatalogRelease  `json:"releases" yaml:"releases"`
}

type CatalogEndpoint struct {
	SeedID                     string   `json:"seed_id" yaml:"seed_id"`
	Kind                       string   `json:"kind" yaml:"kind"`
	DisplayName                string   `json:"display_name" yaml:"display_name"`
	ConnectionMaterialBase64   string   `json:"connection_material_base64" yaml:"connection_material_base64"`
	StationAdvertisementBase64 string   `json:"station_advertisement_base64,omitempty" yaml:"station_advertisement_base64,omitempty"`
	Regions                    []string `json:"regions" yaml:"regions"`
	AvailableFrom              string   `json:"available_from,omitempty" yaml:"available_from,omitempty"`
	AvailableUntil             string   `json:"available_until,omitempty" yaml:"available_until,omitempty"`
}

type CatalogRelease struct {
	ReleaseID               string `json:"release_id" yaml:"release_id"`
	Platform                string `json:"platform" yaml:"platform"`
	Architecture            string `json:"architecture" yaml:"architecture"`
	Version                 string `json:"version" yaml:"version"`
	MinimumSupportedVersion string `json:"minimum_supported_version" yaml:"minimum_supported_version"`
	ManifestURL             string `json:"manifest_url" yaml:"manifest_url"`
	ManifestSHA256          string `json:"manifest_sha256" yaml:"manifest_sha256"`
	ReleaseSigningKeyID     string `json:"release_signing_key_id" yaml:"release_signing_key_id"`
	ReleaseNotesURL         string `json:"release_notes_url" yaml:"release_notes_url"`
	PublishedAt             string `json:"published_at" yaml:"published_at"`
}
