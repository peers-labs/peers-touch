// Package xcontrol evaluates signed X Config directives for Station.
//
// Evaluation semantics MUST stay identical to the Rust x-config-core
// evaluator; both are locked by model/domain/x_config/evaluation-vectors.
package xcontrol

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"strconv"
	"strings"

	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
)

const regionUnknown = "unknown"

// TargetingContext is the Station-side evaluation input. Product is always
// "station" for this client.
type TargetingContext struct {
	Product      string
	Platform     xconfig.ClientPlatform
	Architecture xconfig.ClientArchitecture
	Flavor       string
	Channel      string
	Environment  string
	Region       string
	Version      SemanticVersion
	Labels       map[string]string
	DeviceID     string
}

// SemanticVersion is a minimal X.Y.Z version with optional prerelease.
type SemanticVersion struct {
	Major      uint64
	Minor      uint64
	Patch      uint64
	Prerelease string
}

func ParseSemanticVersion(raw string) (SemanticVersion, bool) {
	parsed := SemanticVersion{}
	core := raw
	if dash := strings.IndexByte(raw, '-'); dash >= 0 {
		core, parsed.Prerelease = raw[:dash], raw[dash+1:]
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return parsed, false
	}
	var err error
	if parsed.Major, err = strconv.ParseUint(parts[0], 10, 64); err != nil {
		return parsed, false
	}
	if parsed.Minor, err = strconv.ParseUint(parts[1], 10, 64); err != nil {
		return parsed, false
	}
	if parsed.Patch, err = strconv.ParseUint(parts[2], 10, 64); err != nil {
		return parsed, false
	}
	return parsed, true
}

// Compare returns -1/0/1. A version without prerelease outranks one with.
func (v SemanticVersion) Compare(other SemanticVersion) int {
	for _, pair := range [][2]uint64{
		{v.Major, other.Major},
		{v.Minor, other.Minor},
		{v.Patch, other.Patch},
	} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	switch {
	case v.Prerelease == other.Prerelease:
		return 0
	case v.Prerelease == "":
		return 1
	case other.Prerelease == "":
		return -1
	case v.Prerelease < other.Prerelease:
		return -1
	default:
		return 1
	}
}

// EvaluatedValue is the closed oneof projection of a directive value.
type EvaluatedValue struct {
	StringValue    *string
	BoolValue      *bool
	IntValue       *int64
	EndpointSeedID *string
}

type ResolvedDirective struct {
	Key           string
	Value         EvaluatedValue
	MatchedRuleID string
	Matched       bool
}

// EvaluateDirectives returns one resolution per directive, in snapshot order.
func EvaluateDirectives(
	directives []*xconfig.Directive,
	context TargetingContext,
) []ResolvedDirective {
	resolved := make([]ResolvedDirective, 0, len(directives))
	for _, directive := range directives {
		var value *xconfig.DirectiveValue
		matchedRule := ""
		matched := false
		for _, rule := range directive.GetRules() {
			if ruleMatches(rule, context) {
				value = rule.GetValue()
				matchedRule = rule.GetId()
				matched = true
				break
			}
		}
		if value == nil {
			value = directive.GetFallback()
		}
		if projected, ok := projectValue(value); ok {
			resolved = append(resolved, ResolvedDirective{
				Key:           directive.GetKey(),
				Value:         projected,
				MatchedRuleID: matchedRule,
				Matched:       matched,
			})
		}
	}
	return resolved
}

func projectValue(value *xconfig.DirectiveValue) (EvaluatedValue, bool) {
	switch typed := value.GetValue().(type) {
	case *xconfig.DirectiveValue_StringValue:
		return EvaluatedValue{StringValue: &typed.StringValue}, true
	case *xconfig.DirectiveValue_BoolValue:
		return EvaluatedValue{BoolValue: &typed.BoolValue}, true
	case *xconfig.DirectiveValue_IntValue:
		return EvaluatedValue{IntValue: &typed.IntValue}, true
	case *xconfig.DirectiveValue_EndpointSeedId:
		return EvaluatedValue{EndpointSeedID: &typed.EndpointSeedId}, true
	default:
		return EvaluatedValue{}, false
	}
}

func ruleMatches(rule *xconfig.DirectiveRule, context TargetingContext) bool {
	clause := rule.GetMatch()
	if clause == nil {
		return false
	}
	if !clauseMatches(clause, context) {
		return false
	}
	permille := rule.GetRolloutPermille()
	if permille == 0 {
		permille = 1000
	}
	if permille >= 1000 {
		return true
	}
	if context.DeviceID == "" {
		return false
	}
	return RolloutBucket(rule.GetId(), context.DeviceID) < permille
}

// RolloutBucket mirrors the Rust HMAC permille bucketing.
func RolloutBucket(ruleID, deviceID string) uint32 {
	mac := hmac.New(sha256.New, []byte(ruleID))
	mac.Write([]byte(deviceID))
	return uint32(binary.BigEndian.Uint64(mac.Sum(nil)[:8]) % 1000)
}

func clauseMatches(clause *xconfig.TargetClause, context TargetingContext) bool {
	return anyOrWildcard(clause.GetProducts(), func(value string) bool { return value == context.Product }) &&
		anyEnumOrWildcard(clause.GetPlatforms(), context.Platform) &&
		anyEnumOrWildcard(clause.GetArchitectures(), context.Architecture) &&
		anyOrWildcard(clause.GetFlavors(), func(value string) bool { return value == context.Flavor }) &&
		anyOrWildcard(clause.GetChannels(), func(value string) bool { return value == context.Channel }) &&
		anyOrWildcard(clause.GetEnvironments(), func(value string) bool { return value == context.Environment }) &&
		regionMatches(clause.GetRegions(), context.Region) &&
		allVersionsSatisfy(clause.GetVersions(), context.Version) &&
		allLabelsMatch(clause.GetLabels(), context.Labels)
}

func anyOrWildcard(values []string, predicate func(string) bool) bool {
	if len(values) == 0 {
		return true
	}
	for _, value := range values {
		if predicate(value) {
			return true
		}
	}
	return false
}

func anyEnumOrWildcard[T comparable](values []T, actual T) bool {
	if len(values) == 0 {
		return true
	}
	for _, value := range values {
		if value == actual {
			return true
		}
	}
	return false
}

func regionMatches(values []string, region string) bool {
	if len(values) == 0 {
		return true
	}
	return region != "" && region != regionUnknown && anyOrWildcard(values, func(value string) bool {
		return value == region
	})
}

func allLabelsMatch(matchers []*xconfig.LabelMatcher, labels map[string]string) bool {
	for _, matcher := range matchers {
		if labels[matcher.GetKey()] != matcher.GetValue() {
			return false
		}
	}
	return true
}

func allVersionsSatisfy(constraints []*xconfig.VersionConstraint, version SemanticVersion) bool {
	for _, constraint := range constraints {
		base, ok := ParseSemanticVersion(constraint.GetVersion())
		if !ok {
			return false
		}
		switch constraint.GetComparator() {
		case ">=":
			if version.Compare(base) < 0 {
				return false
			}
		case "<":
			if version.Compare(base) >= 0 {
				return false
			}
		case "^":
			if version.Compare(base) < 0 {
				return false
			}
			ceiling := base
			switch {
			case base.Major > 0:
				ceiling = SemanticVersion{Major: base.Major + 1}
			case base.Minor > 0:
				ceiling = SemanticVersion{Minor: base.Minor + 1}
			default:
				ceiling = SemanticVersion{Patch: base.Patch + 1}
			}
			if version.Compare(ceiling) >= 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}
