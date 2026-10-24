export type CatalogEndpoint = {
  seed_id: string;
  kind: "relay" | "direct_station";
  display_name: string;
  connection_material_base64: string;
  station_advertisement_base64?: string;
  regions: string[];
  available_from?: string;
  available_until?: string;
};

export type CatalogRelease = {
  release_id: string;
  platform: "macos" | "windows" | "linux" | "ios" | "android";
  architecture: "arm64" | "x86_64" | "universal";
  version: string;
  minimum_supported_version: string;
  manifest_url: string;
  manifest_sha256: string;
  release_signing_key_id: string;
  release_notes_url: string;
  published_at: string;
};

export type DirectiveValue = {
  string_value?: string;
  bool_value?: boolean;
  int_value?: number;
  endpoint_seed_id?: string;
};

export type VersionConstraint = {
  comparator: ">=" | "<" | "^";
  version: string;
};

export type LabelMatcher = {
  key: string;
  value: string;
};

export type TargetClause = {
  products?: string[];
  platforms?: CatalogRelease["platform"][];
  architectures?: CatalogRelease["architecture"][];
  flavors?: string[];
  channels?: string[];
  environments?: string[];
  regions?: string[];
  versions?: VersionConstraint[];
  labels?: LabelMatcher[];
};

export type CatalogDirectiveRule = {
  id: string;
  match: TargetClause;
  value: DirectiveValue;
  rollout_permille?: number;
};

export type CatalogDirective = {
  key: string;
  rules: CatalogDirectiveRule[];
  fallback: DirectiveValue;
};

export type Catalog = {
  schema_version: 1;
  channel: string;
  endpoints: CatalogEndpoint[];
  releases: CatalogRelease[];
  // Passed through unchanged in P1; directive editing arrives in P3.
  directives?: CatalogDirective[];
};

export type Draft = {
  revision: string;
  content_sha256: string;
  catalog: Catalog;
  loaded_at: string;
};

export type Finding = {
  field: string;
  code: string;
  message: string;
  owner: string;
};

export type Validation = {
  valid: boolean;
  content_sha256: string;
  findings: Finding[];
};

export type Publication = {
  publication_id: string;
  channel: string;
  sequence: number;
  source_revision: string;
  content_sha256: string;
  signing_key_id: string;
  statement_sha256: string;
  envelope_sha256: string;
  published_by: string;
  published_at: string;
  expires_at: string;
  repository_revision?: string;
  catalog: Catalog;
};

export type Session = {
  authenticated: boolean;
  provider: string;
  provider_subject: string;
  expires_at: string;
};

export type EditableItem =
  | { type: "endpoint"; index: number; value: CatalogEndpoint }
  | { type: "release"; index: number; value: CatalogRelease };

export const emptyCatalog = (): Catalog => ({
  schema_version: 1,
  channel: "stable",
  endpoints: [],
  releases: [],
});
