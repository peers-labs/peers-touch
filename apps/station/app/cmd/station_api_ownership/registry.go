package main

import (
	"fmt"
	"os"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v2"
)

func loadRegistry(root, registryPath string) (ownershipRegistry, string, error) {
	absolutePath := registryPath
	if !filepath.IsAbs(absolutePath) {
		absolutePath = filepath.Join(root, filepath.FromSlash(registryPath))
	}
	content, err := os.ReadFile(absolutePath)
	if err != nil {
		return ownershipRegistry{}, "", fmt.Errorf("read ownership registry %q: %w", registryPath, err)
	}

	var registry ownershipRegistry
	if err := yaml.UnmarshalStrict(content, &registry); err != nil {
		return ownershipRegistry{}, "", fmt.Errorf("parse ownership registry %q: %w", registryPath, err)
	}
	relativePath, err := filepath.Rel(root, absolutePath)
	if err != nil {
		return ownershipRegistry{}, "", fmt.Errorf("resolve ownership registry path %q: %w", registryPath, err)
	}
	return registry, filepath.ToSlash(relativePath), nil
}

func validateAndNormalizeRegistry(registry *ownershipRegistry, registryPath string) []diagnostic {
	var diagnostics []diagnostic
	addInvalid := func(message string) {
		diagnostics = append(diagnostics, diagnostic{
			Code:      "registry_invalid",
			Message:   message,
			Locations: []sourceLocation{{File: registryPath, Line: 1, Column: 1}},
		})
	}

	if registry.SchemaVersion != schemaVersion {
		addInvalid(fmt.Sprintf(
			"schema_version must be %d, got %d",
			schemaVersion,
			registry.SchemaVersion,
		))
	}
	if len(registry.GovernedPrefixes) == 0 {
		addInvalid("governed_prefixes must not be empty")
	}
	for index, prefix := range registry.GovernedPrefixes {
		normalized, err := normalizeRoutePrefix(prefix)
		if err != nil {
			addInvalid(fmt.Sprintf("governed_prefixes[%d]: %v", index, err))
			continue
		}
		registry.GovernedPrefixes[index] = normalized
	}
	sort.Strings(registry.GovernedPrefixes)

	for owner, roots := range registry.OwnerRoots {
		if strings.TrimSpace(owner) == "" {
			addInvalid("owner_roots contains an empty owner")
			continue
		}
		if len(roots) == 0 {
			addInvalid(fmt.Sprintf("owner_roots[%q] must not be empty", owner))
			continue
		}
		normalizedRoots := make([]string, 0, len(roots))
		for index, root := range roots {
			normalized, err := normalizeRepoPath(root)
			if err != nil {
				addInvalid(fmt.Sprintf("owner_roots[%q][%d]: %v", owner, index, err))
				continue
			}
			normalizedRoots = append(normalizedRoots, normalized)
		}
		sort.Strings(normalizedRoots)
		registry.OwnerRoots[owner] = deduplicateStrings(normalizedRoots)
	}

	if len(registry.DDDLayers) == 0 {
		addInvalid("ddd_layers must not be empty")
	}
	layerNames := make(map[string]struct{}, len(registry.DDDLayers))
	for index := range registry.DDDLayers {
		rule := &registry.DDDLayers[index]
		rule.Name = strings.TrimSpace(rule.Name)
		if rule.Name == "" {
			addInvalid(fmt.Sprintf("ddd_layers[%d].name must not be empty", index))
		} else if _, exists := layerNames[rule.Name]; exists {
			addInvalid(fmt.Sprintf("duplicate DDD layer name %q", rule.Name))
		} else {
			layerNames[rule.Name] = struct{}{}
		}

		normalizedRoot, err := normalizeRepoPath(rule.Root)
		if err != nil {
			addInvalid(fmt.Sprintf("DDD layer %q root: %v", rule.Name, err))
		} else {
			rule.Root = normalizedRoot
		}
		rule.ForbiddenImports = normalizeImportPrefixes(rule.ForbiddenImports)
		if len(rule.ForbiddenImports) == 0 {
			addInvalid(fmt.Sprintf("DDD layer %q forbidden_imports must not be empty", rule.Name))
		}
	}
	sort.Slice(registry.DDDLayers, func(i, j int) bool {
		return registry.DDDLayers[i].Name < registry.DDDLayers[j].Name
	})

	capabilityIDs := make(map[string]struct{}, len(registry.Capabilities))
	canonicalRoutes := make(map[string]string, len(registry.Capabilities))
	truthStoreOwners := make(map[string]string)
	for index := range registry.Capabilities {
		item := &registry.Capabilities[index]
		item.ID = strings.TrimSpace(item.ID)
		item.DomainOwner = strings.TrimSpace(item.DomainOwner)
		item.TruthOwner = strings.TrimSpace(item.TruthOwner)
		item.Exposure = strings.TrimSpace(item.Exposure)
		item.RequestProto = strings.TrimSpace(item.RequestProto)
		item.ResponseProto = strings.TrimSpace(item.ResponseProto)

		if item.ID == "" {
			addInvalid(fmt.Sprintf("capabilities[%d].id must not be empty", index))
		} else if _, exists := capabilityIDs[item.ID]; exists {
			addInvalid(fmt.Sprintf("duplicate capability id %q", item.ID))
		} else {
			capabilityIDs[item.ID] = struct{}{}
		}
		if item.DomainOwner == "" {
			addInvalid(fmt.Sprintf("capability %q domain_owner must not be empty", item.ID))
		}
		if item.TruthOwner == "" {
			addInvalid(fmt.Sprintf("capability %q truth_owner must not be empty", item.ID))
		}
		if item.Exposure != "client" && item.Exposure != "peer" && item.Exposure != "internal" {
			addInvalid(fmt.Sprintf(
				"capability %q exposure must be client, peer, or internal",
				item.ID,
			))
		}

		normalizedRoute, err := normalizeRoute(item.CanonicalRoute)
		if err != nil {
			addInvalid(fmt.Sprintf("capability %q canonical_route: %v", item.ID, err))
		} else {
			item.CanonicalRoute = normalizedRoute
			identity := normalizedRoute.identity()
			if existing, exists := canonicalRoutes[identity]; exists {
				addInvalid(fmt.Sprintf(
					"canonical route %q is assigned to both %q and %q",
					identity,
					existing,
					item.ID,
				))
			} else {
				canonicalRoutes[identity] = item.ID
			}
			if !routeIsGoverned(normalizedRoute.Path, registry.GovernedPrefixes) {
				addInvalid(fmt.Sprintf(
					"capability %q canonical route %q is outside governed_prefixes",
					item.ID,
					identity,
				))
			}
		}

		for aliasIndex := range item.ForbiddenAliases {
			normalizedAlias, aliasErr := normalizeRoute(item.ForbiddenAliases[aliasIndex])
			if aliasErr != nil {
				addInvalid(fmt.Sprintf(
					"capability %q forbidden_aliases[%d]: %v",
					item.ID,
					aliasIndex,
					aliasErr,
				))
				continue
			}
			item.ForbiddenAliases[aliasIndex] = normalizedAlias
		}
		sort.Slice(item.ForbiddenAliases, func(i, j int) bool {
			return item.ForbiddenAliases[i].identity() < item.ForbiddenAliases[j].identity()
		})

		item.TruthStores = normalizeIdentifiers(item.TruthStores)
		for _, store := range item.TruthStores {
			if owner, exists := truthStoreOwners[store]; exists && owner != item.TruthOwner {
				addInvalid(fmt.Sprintf(
					"truth store %q has conflicting owners %q and %q",
					store,
					owner,
					item.TruthOwner,
				))
				continue
			}
			truthStoreOwners[store] = item.TruthOwner
		}
		item.SupersededSymbols = normalizeIdentifiers(item.SupersededSymbols)
		item.AllowedDependencies = normalizeIdentifiers(item.AllowedDependencies)
	}
	sort.Slice(registry.Capabilities, func(i, j int) bool {
		return registry.Capabilities[i].ID < registry.Capabilities[j].ID
	})

	for index := range registry.TargetAbsentRoutes {
		normalized, err := normalizeRoute(registry.TargetAbsentRoutes[index])
		if err != nil {
			addInvalid(fmt.Sprintf("target_absent_routes[%d]: %v", index, err))
			continue
		}
		registry.TargetAbsentRoutes[index] = normalized
	}
	sort.Slice(registry.TargetAbsentRoutes, func(i, j int) bool {
		return registry.TargetAbsentRoutes[i].identity() < registry.TargetAbsentRoutes[j].identity()
	})

	for index, prefix := range registry.TargetAbsentPrefixes {
		normalized, err := normalizeRoutePrefix(prefix)
		if err != nil {
			addInvalid(fmt.Sprintf("target_absent_prefixes[%d]: %v", index, err))
			continue
		}
		registry.TargetAbsentPrefixes[index] = normalized
	}
	sort.Strings(registry.TargetAbsentPrefixes)
	registry.TargetAbsentTruthStores = normalizeIdentifiers(registry.TargetAbsentTruthStores)

	return diagnostics
}

func normalizeRoute(route routeKey) (routeKey, error) {
	method := strings.ToUpper(strings.TrimSpace(route.Method))
	if method == "" {
		return routeKey{}, fmt.Errorf("method must not be empty")
	}
	normalizedPath, err := normalizeRoutePath(route.Path)
	if err != nil {
		return routeKey{}, err
	}
	return routeKey{Method: method, Path: normalizedPath}, nil
}

func normalizeRoutePath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("path %q must be absolute", value)
	}
	if strings.ContainsAny(value, "?#") {
		return "", fmt.Errorf("path %q must not contain query or fragment syntax", value)
	}
	normalized := pathpkg.Clean(value)
	if normalized == "." {
		return "", fmt.Errorf("path %q is invalid", value)
	}
	return normalized, nil
}

func normalizeRoutePrefix(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("prefix %q must be absolute", value)
	}
	if strings.ContainsAny(value, "?#") {
		return "", fmt.Errorf("prefix %q must not contain query or fragment syntax", value)
	}
	if value == "/" {
		return value, nil
	}
	return strings.TrimSuffix(pathpkg.Clean(value), "/"), nil
}

func normalizeRepoPath(value string) (string, error) {
	value = filepath.ToSlash(strings.TrimSpace(value))
	if value == "" || filepath.IsAbs(value) {
		return "", fmt.Errorf("path %q must be repository-relative", value)
	}
	normalized := pathpkg.Clean(value)
	if normalized == "." || normalized == ".." || strings.HasPrefix(normalized, "../") {
		return "", fmt.Errorf("path %q escapes the repository", value)
	}
	return strings.TrimSuffix(normalized, "/"), nil
}

func normalizeIdentifiers(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			normalized = append(normalized, value)
		}
	}
	sort.Strings(normalized)
	return deduplicateStrings(normalized)
}

func normalizeImportPrefixes(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.Trim(strings.TrimSpace(value), "/")
		if value != "" {
			normalized = append(normalized, value)
		}
	}
	sort.Strings(normalized)
	return deduplicateStrings(normalized)
}

func deduplicateStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	result := values[:1]
	for _, value := range values[1:] {
		if value != result[len(result)-1] {
			result = append(result, value)
		}
	}
	return result
}

func routeIsGoverned(routePath string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if routeMatchesPrefix(routePath, prefix) {
			return true
		}
	}
	return false
}

func routeMatchesPrefix(routePath, prefix string) bool {
	if prefix == "/" {
		return true
	}
	return routePath == prefix || strings.HasPrefix(routePath, prefix+"/")
}

func pathWithinRoot(file, root string) bool {
	file = strings.TrimSuffix(filepath.ToSlash(filepath.Clean(file)), "/")
	root = strings.TrimSuffix(filepath.ToSlash(filepath.Clean(root)), "/")
	return file == root || strings.HasPrefix(file, root+"/")
}
