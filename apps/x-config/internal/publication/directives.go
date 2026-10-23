package publication

import (
	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	catalogdomain "github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
)

var directiveProducts = map[string]struct{}{
	"desktop": {},
	"mobile":  {},
	"station": {},
}

var versionComparators = map[string]struct{}{
	">=": {},
	"<":  {},
	"^":  {},
}

func buildDirectives(
	input []catalogdomain.CatalogDirective,
	seedKinds map[string]xconfig.EndpointSeedKind,
) ([]*xconfig.Directive, error) {
	seenKeys := make(map[string]struct{}, len(input))
	directives := make([]*xconfig.Directive, 0, len(input))
	for _, entry := range input {
		spec, ok := lookupDirectiveKey(entry.Key)
		if !ok || !validIdentifier(entry.Key, 64) {
			return nil, ErrCatalogInvalid
		}
		if _, exists := seenKeys[entry.Key]; exists {
			return nil, ErrCatalogInvalid
		}
		seenKeys[entry.Key] = struct{}{}
		if len(entry.Rules) > MaxDirectiveRules {
			return nil, ErrCatalogInvalid
		}
		fallback, err := buildDirectiveValue(entry.Fallback, spec, seedKinds)
		if err != nil {
			return nil, err
		}
		rules := make([]*xconfig.DirectiveRule, 0, len(entry.Rules))
		seenRules := make(map[string]struct{}, len(entry.Rules))
		for _, rule := range entry.Rules {
			if !validIdentifier(rule.ID, 48) {
				return nil, ErrCatalogInvalid
			}
			if _, exists := seenRules[rule.ID]; exists {
				return nil, ErrCatalogInvalid
			}
			seenRules[rule.ID] = struct{}{}
			if rule.RolloutPermille > MaxRolloutPermille {
				return nil, ErrCatalogInvalid
			}
			clause, err := buildTargetClause(rule.Match)
			if err != nil {
				return nil, err
			}
			value, err := buildDirectiveValue(rule.Value, spec, seedKinds)
			if err != nil {
				return nil, err
			}
			rules = append(rules, &xconfig.DirectiveRule{
				Id:              rule.ID,
				Match:           clause,
				Value:           value,
				RolloutPermille: rule.RolloutPermille,
			})
		}
		directives = append(directives, &xconfig.Directive{
			Key:      entry.Key,
			Rules:    rules,
			Fallback: fallback,
		})
	}
	return directives, nil
}

func buildDirectiveValue(
	input catalogdomain.CatalogDirectiveValue,
	spec DirectiveKeySpec,
	seedKinds map[string]xconfig.EndpointSeedKind,
) (*xconfig.DirectiveValue, error) {
	set := 0
	if input.StringValue != "" {
		set++
	}
	if input.BoolValue != nil {
		set++
	}
	if input.IntValue != nil {
		set++
	}
	if input.EndpointSeedID != "" {
		set++
	}
	if set != 1 {
		return nil, ErrCatalogInvalid
	}
	switch spec.ValueKind {
	case DirectiveValueString:
		if input.StringValue == "" || !validText(input.StringValue, 512) {
			return nil, ErrCatalogInvalid
		}
		return &xconfig.DirectiveValue{
			Value: &xconfig.DirectiveValue_StringValue{StringValue: input.StringValue},
		}, nil
	case DirectiveValueBool:
		if input.BoolValue == nil {
			return nil, ErrCatalogInvalid
		}
		return &xconfig.DirectiveValue{
			Value: &xconfig.DirectiveValue_BoolValue{BoolValue: *input.BoolValue},
		}, nil
	case DirectiveValueInt:
		if input.IntValue == nil {
			return nil, ErrCatalogInvalid
		}
		return &xconfig.DirectiveValue{
			Value: &xconfig.DirectiveValue_IntValue{IntValue: *input.IntValue},
		}, nil
	case DirectiveValueEndpointSeed:
		if !validIdentifier(input.EndpointSeedID, 128) {
			return nil, ErrCatalogInvalid
		}
		kind, exists := seedKinds[input.EndpointSeedID]
		if !exists || kind != spec.EndpointKind {
			return nil, ErrCatalogInvalid
		}
		return &xconfig.DirectiveValue{
			Value: &xconfig.DirectiveValue_EndpointSeedId{EndpointSeedId: input.EndpointSeedID},
		}, nil
	default:
		return nil, ErrCatalogInvalid
	}
}

func buildTargetClause(input catalogdomain.CatalogTargetClause) (*xconfig.TargetClause, error) {
	if len(input.Products) > MaxTargetValues ||
		len(input.Platforms) > MaxTargetValues ||
		len(input.Architectures) > MaxTargetValues ||
		len(input.Flavors) > MaxTargetValues ||
		len(input.Channels) > MaxTargetValues ||
		len(input.Environments) > MaxTargetValues ||
		len(input.Regions) > MaxTargetValues ||
		len(input.Versions) > MaxTargetValues ||
		len(input.Labels) > MaxTargetValues {
		return nil, ErrCatalogInvalid
	}
	for _, product := range input.Products {
		if _, ok := directiveProducts[product]; !ok || !validIdentifier(product, 24) {
			return nil, ErrCatalogInvalid
		}
	}
	platforms := make([]xconfig.ClientPlatform, 0, len(input.Platforms))
	for _, value := range input.Platforms {
		platform, ok := mapPlatform(value)
		if !ok {
			return nil, ErrCatalogInvalid
		}
		platforms = append(platforms, platform)
	}
	architectures := make([]xconfig.ClientArchitecture, 0, len(input.Architectures))
	for _, value := range input.Architectures {
		architecture, ok := mapArchitecture(value)
		if !ok {
			return nil, ErrCatalogInvalid
		}
		architectures = append(architectures, architecture)
	}
	for _, values := range [][]string{
		input.Flavors,
		input.Channels,
		input.Environments,
		input.Regions,
	} {
		for _, value := range values {
			if !validIdentifier(value, 32) {
				return nil, ErrCatalogInvalid
			}
		}
	}
	versions := make([]*xconfig.VersionConstraint, 0, len(input.Versions))
	for _, constraint := range input.Versions {
		if _, ok := versionComparators[constraint.Comparator]; !ok ||
			!semanticVersion.MatchString(constraint.Version) {
			return nil, ErrCatalogInvalid
		}
		versions = append(versions, &xconfig.VersionConstraint{
			Comparator: constraint.Comparator,
			Version:    constraint.Version,
		})
	}
	labels := make([]*xconfig.LabelMatcher, 0, len(input.Labels))
	for _, matcher := range input.Labels {
		if !validIdentifier(matcher.Key, 64) || !validText(matcher.Value, 32) {
			return nil, ErrCatalogInvalid
		}
		labels = append(labels, &xconfig.LabelMatcher{
			Key:   matcher.Key,
			Value: matcher.Value,
		})
	}
	return &xconfig.TargetClause{
		Products:      input.Products,
		Platforms:     platforms,
		Architectures: architectures,
		Flavors:       input.Flavors,
		Channels:      input.Channels,
		Environments:  input.Environments,
		Regions:       input.Regions,
		Versions:      versions,
		Labels:        labels,
	}, nil
}
