package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var (
	defaultRegistrationRoots = []string{
		"apps/station/app",
		"apps/station/frame",
	}
	defaultSourceRoots = []string{
		"apps/station/app",
		"apps/station/frame",
		"apps/desktop/src",
		"apps/desktop/src-tauri/src",
		"apps/mobile/src",
		"apps/mobile/src-tauri/src",
		"model/domain",
		"packages/messaging-core/src",
	}
	defaultProtoRoots = []string{
		"model/domain",
	}
)

func analyze(options analysisOptions) analysisReport {
	report := analysisReport{
		SchemaVersion: schemaVersion,
		Gate:          gateID,
		Status:        "FAIL",
		Routes:        []discoveredRoute{},
		Diagnostics:   []diagnostic{},
	}

	root, err := filepath.Abs(options.Root)
	if err != nil {
		report.Diagnostics = append(report.Diagnostics, diagnostic{
			Code:    "gate_configuration_error",
			Message: fmt.Sprintf("resolve repository root %q: %v", options.Root, err),
		})
		finalizeReport(&report)
		return report
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		report.Diagnostics = append(report.Diagnostics, diagnostic{
			Code:    "gate_configuration_error",
			Message: fmt.Sprintf("repository root %q is not a readable directory", options.Root),
		})
		finalizeReport(&report)
		return report
	}

	registry, registryPath, err := loadRegistry(root, options.RegistryPath)
	if err != nil {
		report.Diagnostics = append(report.Diagnostics, diagnostic{
			Code:    "registry_load_failed",
			Message: err.Error(),
		})
		finalizeReport(&report)
		return report
	}
	report.Diagnostics = append(
		report.Diagnostics,
		validateAndNormalizeRegistry(&registry, registryPath)...,
	)
	report.Summary.CapabilitiesDeclared = len(registry.Capabilities)

	registrationRoots := options.RegistrationRoots
	if len(registrationRoots) == 0 {
		registrationRoots = defaultRegistrationRoots
	}
	sourceRoots := options.SourceRoots
	if len(sourceRoots) == 0 {
		sourceRoots = defaultSourceRoots
	}
	protoRoots := options.ProtoRoots
	if len(protoRoots) == 0 {
		protoRoots = defaultProtoRoots
	}

	routes, routeDiagnostics, parsedCount := discoverRoutes(root, registrationRoots)
	report.Diagnostics = append(report.Diagnostics, routeDiagnostics...)
	report.Summary.GoFilesParsed = parsedCount
	report.Summary.RoutesDiscovered = len(routes)
	for _, route := range routes {
		if routeIsGoverned(route.Path, registry.GovernedPrefixes) {
			report.Routes = append(report.Routes, route)
		}
	}
	report.Summary.GovernedRoutes = len(report.Routes)
	report.Diagnostics = append(
		report.Diagnostics,
		evaluateRoutes(registry, report.Routes)...,
	)

	protoSymbols, protoDiagnostics := discoverProtoSymbols(root, protoRoots)
	report.Diagnostics = append(report.Diagnostics, protoDiagnostics...)
	report.Diagnostics = append(
		report.Diagnostics,
		evaluateCanonicalProtoSymbols(registry, protoSymbols)...,
	)

	supersededSymbols := allSupersededSymbols(registry)
	supersededLocations, supersededDiagnostics := discoverSupersededSymbols(
		root,
		sourceRoots,
		supersededSymbols,
	)
	report.Diagnostics = append(report.Diagnostics, supersededDiagnostics...)
	for _, symbol := range supersededSymbols {
		locations := supersededLocations[symbol]
		if len(locations) == 0 {
			continue
		}
		report.Diagnostics = append(report.Diagnostics, diagnostic{
			Code:        "superseded_proto_symbol",
			Message:     fmt.Sprintf("superseded proto symbol %q remains in source", symbol),
			Identifier:  symbol,
			Occurrences: len(locations),
			Locations:   locations,
		})
	}

	truthStoreLocations, truthStoreDiagnostics := discoverForbiddenTruthStores(
		root,
		[]string{"apps/station/app", "apps/station/frame"},
		registry.TargetAbsentTruthStores,
	)
	report.Diagnostics = append(report.Diagnostics, truthStoreDiagnostics...)
	for _, store := range registry.TargetAbsentTruthStores {
		locations := truthStoreLocations[store]
		if len(locations) == 0 {
			continue
		}
		report.Diagnostics = append(report.Diagnostics, diagnostic{
			Code:        "forbidden_truth_store_identifier",
			Message:     fmt.Sprintf("forbidden truth-store identifier %q remains in Station source", store),
			Identifier:  store,
			Occurrences: len(locations),
			Locations:   locations,
		})
	}

	report.Diagnostics = append(
		report.Diagnostics,
		discoverForbiddenDDDImports(root, registry.DDDLayers)...,
	)

	finalizeReport(&report)
	return report
}

func evaluateRoutes(
	registry ownershipRegistry,
	routes []discoveredRoute,
) []diagnostic {
	canonical := make(map[string]capability, len(registry.Capabilities))
	aliases := make(map[string]string)
	for _, item := range registry.Capabilities {
		canonical[item.CanonicalRoute.identity()] = item
		for _, alias := range item.ForbiddenAliases {
			aliases[alias.identity()] = item.ID
		}
	}
	absentRoutes := make(map[string]struct{}, len(registry.TargetAbsentRoutes))
	for _, route := range registry.TargetAbsentRoutes {
		absentRoutes[route.identity()] = struct{}{}
	}

	byIdentity := make(map[string][]discoveredRoute)
	for _, route := range routes {
		byIdentity[route.key().identity()] = append(byIdentity[route.key().identity()], route)
	}

	var diagnostics []diagnostic
	identities := sortedMapKeys(byIdentity)
	for _, identity := range identities {
		registered := byIdentity[identity]
		key := registered[0].key()
		locations := routeLocations(registered)
		if len(registered) > 1 {
			diagnostics = append(diagnostics, diagnostic{
				Code:        "duplicate_method_path",
				Message:     fmt.Sprintf("route %q is registered %d times", identity, len(registered)),
				Method:      key.Method,
				Path:        key.Path,
				Occurrences: len(registered),
				Locations:   locations,
			})
		}

		if capabilityID, forbidden := aliases[identity]; forbidden {
			diagnostics = append(diagnostics, diagnostic{
				Code:         "forbidden_alias",
				Message:      fmt.Sprintf("forbidden alias %q is registered", identity),
				CapabilityID: capabilityID,
				Method:       key.Method,
				Path:         key.Path,
				Occurrences:  len(registered),
				Locations:    locations,
			})
			continue
		}
		if _, forbidden := absentRoutes[identity]; forbidden {
			diagnostics = append(diagnostics, diagnostic{
				Code:        "forbidden_route",
				Message:     fmt.Sprintf("target-absent route %q is registered", identity),
				Method:      key.Method,
				Path:        key.Path,
				Occurrences: len(registered),
				Locations:   locations,
			})
			continue
		}
		if prefix := matchingForbiddenPrefix(key.Path, registry.TargetAbsentPrefixes); prefix != "" {
			diagnostics = append(diagnostics, diagnostic{
				Code:        "forbidden_prefix",
				Message:     fmt.Sprintf("route %q uses target-absent prefix %q", identity, prefix),
				Method:      key.Method,
				Path:        key.Path,
				Identifier:  prefix,
				Occurrences: len(registered),
				Locations:   locations,
			})
			continue
		}

		item, declared := canonical[identity]
		if !declared {
			diagnostics = append(diagnostics, diagnostic{
				Code:        "undeclared_governed_route",
				Message:     fmt.Sprintf("governed route %q has no capability declaration", identity),
				Method:      key.Method,
				Path:        key.Path,
				Occurrences: len(registered),
				Locations:   locations,
			})
			continue
		}

		allowedRoots := registry.OwnerRoots[item.DomainOwner]
		if len(allowedRoots) == 0 {
			continue
		}
		for _, route := range registered {
			if sourceAllowed(route.Source.File, allowedRoots) {
				continue
			}
			diagnostics = append(diagnostics, diagnostic{
				Code:         "owner_root_mismatch",
				Message:      fmt.Sprintf("capability %q is registered outside owner %q roots", item.ID, item.DomainOwner),
				CapabilityID: item.ID,
				Method:       key.Method,
				Path:         key.Path,
				Owner:        item.DomainOwner,
				Expected:     append([]string(nil), allowedRoots...),
				Occurrences:  1,
				Locations:    []sourceLocation{route.Source},
			})
		}
	}

	for _, item := range registry.Capabilities {
		identity := item.CanonicalRoute.identity()
		if len(byIdentity[identity]) != 0 {
			continue
		}
		diagnostics = append(diagnostics, diagnostic{
			Code:         "missing_canonical_route",
			Message:      fmt.Sprintf("capability %q canonical route %q is not registered", item.ID, identity),
			CapabilityID: item.ID,
			Method:       item.CanonicalRoute.Method,
			Path:         item.CanonicalRoute.Path,
		})
	}
	return diagnostics
}

func evaluateCanonicalProtoSymbols(
	registry ownershipRegistry,
	declarations map[string][]sourceLocation,
) []diagnostic {
	var diagnostics []diagnostic
	for _, item := range registry.Capabilities {
		for _, symbol := range []string{item.RequestProto, item.ResponseProto} {
			if symbol == "" || len(declarations[symbol]) != 0 {
				continue
			}
			diagnostics = append(diagnostics, diagnostic{
				Code:         "missing_canonical_proto_symbol",
				Message:      fmt.Sprintf("capability %q canonical proto symbol %q is not declared", item.ID, symbol),
				CapabilityID: item.ID,
				Identifier:   symbol,
			})
		}
	}
	return diagnostics
}

func allSupersededSymbols(registry ownershipRegistry) []string {
	var symbols []string
	for _, item := range registry.Capabilities {
		symbols = append(symbols, item.SupersededSymbols...)
	}
	sort.Strings(symbols)
	return deduplicateStrings(symbols)
}

func matchingForbiddenPrefix(routePath string, prefixes []string) string {
	for _, prefix := range prefixes {
		if routeMatchesPrefix(routePath, prefix) {
			return prefix
		}
	}
	return ""
}

func sourceAllowed(source string, roots []string) bool {
	for _, root := range roots {
		if pathWithinRoot(source, root) {
			return true
		}
	}
	return false
}

func routeLocations(routes []discoveredRoute) []sourceLocation {
	locations := make([]sourceLocation, 0, len(routes))
	for _, route := range routes {
		locations = append(locations, route.Source)
	}
	sort.Slice(locations, func(i, j int) bool {
		left, right := locations[i], locations[j]
		if left.File != right.File {
			return left.File < right.File
		}
		if left.Line != right.Line {
			return left.Line < right.Line
		}
		return left.Column < right.Column
	})
	return deduplicateLocations(locations)
}

func sortedMapKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func finalizeReport(report *analysisReport) {
	sort.Slice(report.Routes, func(i, j int) bool {
		left, right := report.Routes[i], report.Routes[j]
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		if left.Source.File != right.Source.File {
			return left.Source.File < right.Source.File
		}
		if left.Source.Line != right.Source.Line {
			return left.Source.Line < right.Source.Line
		}
		return left.Source.Column < right.Source.Column
	})
	sort.Slice(report.Diagnostics, func(i, j int) bool {
		left, right := report.Diagnostics[i], report.Diagnostics[j]
		if left.Code != right.Code {
			return left.Code < right.Code
		}
		if left.CapabilityID != right.CapabilityID {
			return left.CapabilityID < right.CapabilityID
		}
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		if left.Identifier != right.Identifier {
			return left.Identifier < right.Identifier
		}
		leftLocation, rightLocation := firstLocation(left), firstLocation(right)
		if leftLocation.File != rightLocation.File {
			return leftLocation.File < rightLocation.File
		}
		if leftLocation.Line != rightLocation.Line {
			return leftLocation.Line < rightLocation.Line
		}
		if leftLocation.Column != rightLocation.Column {
			return leftLocation.Column < rightLocation.Column
		}
		return strings.Compare(left.Message, right.Message) < 0
	})
	report.Summary.Diagnostics = len(report.Diagnostics)
	if len(report.Diagnostics) == 0 {
		report.Status = "PASS"
	} else {
		report.Status = "FAIL"
	}
}

func firstLocation(item diagnostic) sourceLocation {
	if len(item.Locations) == 0 {
		return sourceLocation{}
	}
	return item.Locations[0]
}
