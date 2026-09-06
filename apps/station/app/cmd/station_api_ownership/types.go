package main

const (
	gateID        = "station-api-ownership"
	schemaVersion = 1
)

type analysisOptions struct {
	Root              string
	RegistryPath      string
	RegistrationRoots []string
	SourceRoots       []string
	ProtoRoots        []string
}

type ownershipRegistry struct {
	SchemaVersion           int                 `yaml:"schema_version"`
	Status                  string              `yaml:"status"`
	Scope                   string              `yaml:"scope"`
	Activation              registryActivation  `yaml:"activation"`
	GovernedPrefixes        []string            `yaml:"governed_prefixes"`
	OwnerRoots              map[string][]string `yaml:"owner_roots"`
	Capabilities            []capability        `yaml:"capabilities"`
	TargetAbsentRoutes      []routeKey          `yaml:"target_absent_routes"`
	TargetAbsentPrefixes    []string            `yaml:"target_absent_prefixes"`
	TargetAbsentTruthStores []string            `yaml:"target_absent_truth_stores"`
}

type registryActivation struct {
	State        string   `yaml:"state"`
	GateEnabled  bool     `yaml:"gate_enabled"`
	Requirements []string `yaml:"requirements"`
}

type capability struct {
	ID                  string     `yaml:"id"`
	DomainOwner         string     `yaml:"domain_owner"`
	TruthOwner          string     `yaml:"truth_owner"`
	Exposure            string     `yaml:"exposure"`
	CanonicalRoute      routeKey   `yaml:"canonical_route"`
	RequestProto        string     `yaml:"request_proto"`
	ResponseProto       string     `yaml:"response_proto"`
	TruthStores         []string   `yaml:"truth_stores"`
	AllowedDependencies []string   `yaml:"allowed_dependencies"`
	ForbiddenAliases    []routeKey `yaml:"forbidden_aliases"`
	SupersededSymbols   []string   `yaml:"superseded_symbols"`
}

type routeKey struct {
	Method string `json:"method" yaml:"method"`
	Path   string `json:"path" yaml:"path"`
}

func (r routeKey) identity() string {
	return r.Method + " " + r.Path
}

type sourceLocation struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type discoveredRoute struct {
	Method   string         `json:"method"`
	Path     string         `json:"path"`
	Name     string         `json:"name,omitempty"`
	Source   sourceLocation `json:"source"`
	Function string         `json:"registrationFunction"`
}

func (r discoveredRoute) key() routeKey {
	return routeKey{Method: r.Method, Path: r.Path}
}

type diagnostic struct {
	Code         string           `json:"code"`
	Message      string           `json:"message"`
	CapabilityID string           `json:"capabilityId,omitempty"`
	Method       string           `json:"method,omitempty"`
	Path         string           `json:"path,omitempty"`
	Identifier   string           `json:"identifier,omitempty"`
	Owner        string           `json:"owner,omitempty"`
	Expected     []string         `json:"expected,omitempty"`
	Occurrences  int              `json:"occurrences,omitempty"`
	Locations    []sourceLocation `json:"locations,omitempty"`
}

type reportSummary struct {
	CapabilitiesDeclared int `json:"capabilitiesDeclared"`
	Diagnostics          int `json:"diagnostics"`
	GoFilesParsed        int `json:"goFilesParsed"`
	GovernedRoutes       int `json:"governedRoutes"`
	RoutesDiscovered     int `json:"routesDiscovered"`
}

type analysisReport struct {
	SchemaVersion int               `json:"schemaVersion"`
	Gate          string            `json:"gate"`
	Status        string            `json:"status"`
	Summary       reportSummary     `json:"summary"`
	Routes        []discoveredRoute `json:"routes"`
	Diagnostics   []diagnostic      `json:"diagnostics"`
}
