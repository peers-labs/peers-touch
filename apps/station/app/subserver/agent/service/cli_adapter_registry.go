package service

// CLIAdapterRegistry maintains the set of registered CLI adapter identifiers
// that Station is authorized to execute. Only adapters present in this registry
// may be invoked during provider execution.
//
// The registry is code-configured (not client-writable).
type CLIAdapterRegistry struct {
	adapters map[string]CLIAdapterSpec
}

// CLIAdapterSpec defines a registered CLI adapter.
type CLIAdapterSpec struct {
	BinaryPath  string
	ArgTemplate string
	TimeoutSecs int
}

func NewCLIAdapterRegistry() *CLIAdapterRegistry {
	return &CLIAdapterRegistry{
		adapters: map[string]CLIAdapterSpec{
			"trae-cli": {
				BinaryPath:  "trae",
				ArgTemplate: "chat --model {{.Model}} --input {{.Input}}",
				TimeoutSecs: 300,
			},
		},
	}
}

// Resolve looks up an adapter by its identifier. Returns the spec and true if
// found, or zero value and false if unregistered.
func (r *CLIAdapterRegistry) Resolve(adapterID string) (CLIAdapterSpec, bool) {
	spec, ok := r.adapters[adapterID]
	return spec, ok
}

// IsRegistered returns whether the given adapter identifier is in the registry.
func (r *CLIAdapterRegistry) IsRegistered(adapterID string) bool {
	_, ok := r.adapters[adapterID]
	return ok
}

// RegisteredIDs returns all registered adapter identifiers.
func (r *CLIAdapterRegistry) RegisteredIDs() []string {
	ids := make([]string, 0, len(r.adapters))
	for id := range r.adapters {
		ids = append(ids, id)
	}
	return ids
}
