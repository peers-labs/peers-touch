package catalog

type Catalog struct {
	SchemaVersion int                  `json:"schema_version" yaml:"schema_version"`
	Channel       string               `json:"channel" yaml:"channel"`
	Endpoints     []CatalogEndpoint    `json:"endpoints" yaml:"endpoints"`
	Releases      []CatalogRelease     `json:"releases" yaml:"releases"`
	Directives    []CatalogDirective   `json:"directives,omitempty" yaml:"directives,omitempty"`
	Distribution  *CatalogDistribution `json:"distribution,omitempty" yaml:"distribution,omitempty"`
}

// CatalogDistribution is the signed transport steering section: ordered
// future-fetch origins. It never carries trust material.
type CatalogDistribution struct {
	Origins []string `json:"origins,omitempty" yaml:"origins,omitempty"`
}

// CatalogDirectiveValue is a closed oneof. Exactly one value field must be
// set; pointer scalars distinguish "unset" from a false/zero value.
type CatalogDirectiveValue struct {
	StringValue    string `json:"string_value,omitempty" yaml:"string_value,omitempty"`
	BoolValue      *bool  `json:"bool_value,omitempty" yaml:"bool_value,omitempty"`
	IntValue       *int64 `json:"int_value,omitempty" yaml:"int_value,omitempty"`
	EndpointSeedID string `json:"endpoint_seed_id,omitempty" yaml:"endpoint_seed_id,omitempty"`
}

type CatalogVersionConstraint struct {
	Comparator string `json:"comparator" yaml:"comparator"`
	Version    string `json:"version" yaml:"version"`
}

type CatalogLabelMatcher struct {
	Key   string `json:"key" yaml:"key"`
	Value string `json:"value" yaml:"value"`
}

type CatalogTargetClause struct {
	Products      []string                   `json:"products,omitempty" yaml:"products,omitempty"`
	Platforms     []string                   `json:"platforms,omitempty" yaml:"platforms,omitempty"`
	Architectures []string                   `json:"architectures,omitempty" yaml:"architectures,omitempty"`
	Flavors       []string                   `json:"flavors,omitempty" yaml:"flavors,omitempty"`
	Channels      []string                   `json:"channels,omitempty" yaml:"channels,omitempty"`
	Environments  []string                   `json:"environments,omitempty" yaml:"environments,omitempty"`
	Regions       []string                   `json:"regions,omitempty" yaml:"regions,omitempty"`
	Versions      []CatalogVersionConstraint `json:"versions,omitempty" yaml:"versions,omitempty"`
	Labels        []CatalogLabelMatcher      `json:"labels,omitempty" yaml:"labels,omitempty"`
}

type CatalogDirectiveRule struct {
	ID              string                `json:"id" yaml:"id"`
	Match           CatalogTargetClause   `json:"match" yaml:"match"`
	Value           CatalogDirectiveValue `json:"value" yaml:"value"`
	RolloutPermille uint32                `json:"rollout_permille,omitempty" yaml:"rollout_permille,omitempty"`
}

type CatalogDirective struct {
	Key      string                 `json:"key" yaml:"key"`
	Rules    []CatalogDirectiveRule `json:"rules" yaml:"rules"`
	Fallback CatalogDirectiveValue  `json:"fallback" yaml:"fallback"`
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
