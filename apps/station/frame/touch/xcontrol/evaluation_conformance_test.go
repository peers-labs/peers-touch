package xcontrol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
)

type vectorDocument struct {
	Schema  string       `json:"schema"`
	Vectors []vectorCase `json:"vectors"`
}

type vectorCase struct {
	Name       string            `json:"name"`
	Directives []directiveShape  `json:"directives"`
	Cases      []expectationCase `json:"cases"`
}

type directiveShape struct {
	Key      string         `json:"key"`
	Fallback valueShape     `json:"fallback"`
	Rules    []ruleShape    `json:"rules"`
}

type ruleShape struct {
	ID              string         `json:"id"`
	Match           clauseShape    `json:"match"`
	Value           valueShape     `json:"value"`
	RolloutPermille uint32         `json:"rollout_permille"`
}

type clauseShape struct {
	Products      []string            `json:"products"`
	Platforms     []string            `json:"platforms"`
	Architectures []string            `json:"architectures"`
	Flavors       []string            `json:"flavors"`
	Channels      []string            `json:"channels"`
	Environments  []string            `json:"environments"`
	Regions       []string            `json:"regions"`
	Versions      []constraintShape   `json:"versions"`
	Labels        []labelMatcherShape `json:"labels"`
}

type constraintShape struct {
	Comparator string `json:"comparator"`
	Version    string `json:"version"`
}

type labelMatcherShape struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// valueShape keeps the closed oneof; exactly one pointer is set.
type valueShape struct {
	StringValue    *string `json:"string_value"`
	BoolValue      *bool   `json:"bool_value"`
	IntValue       *int64  `json:"int_value"`
	EndpointSeedID *string `json:"endpoint_seed_id"`
}

type contextShape struct {
	Product      string            `json:"product"`
	Platform     string            `json:"platform"`
	Architecture string            `json:"architecture"`
	Flavor       string            `json:"flavor"`
	Channel      string            `json:"channel"`
	Environment  string            `json:"environment"`
	Region       string            `json:"region"`
	Version       string            `json:"version"`
	Labels        map[string]string `json:"labels"`
	DeviceID      string            `json:"device_id"`
}

type expectationCase struct {
	Context   contextShape      `json:"context"`
	Expect    *expectationShape `json:"expect"`
	ExpectKV  map[string]valueShape `json:"expect_kv"`
}

type expectationShape struct {
	Key           string     `json:"key"`
	Value         valueShape `json:"value"`
	MatchedRuleID *string    `json:"matched_rule_id"`
}

func TestConformanceVectors(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..",
		"model", "domain", "x_config", "evaluation-vectors", "directives.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var document vectorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if document.Schema != "x-config-directive-vectors/v1" {
		t.Fatalf("unexpected vector schema %s", document.Schema)
	}
	for _, group := range document.Vectors {
		directives := buildDirectives(t, group.Directives)
		for _, tc := range group.Cases {
			context := buildContext(t, tc.Context)
			resolved := EvaluateDirectives(directives, context)
			byKey := map[string]ResolvedDirective{}
			for _, entry := range resolved {
				byKey[entry.Key] = entry
			}
			if tc.Expect != nil {
				actual, ok := byKey[tc.Expect.Key]
				if !ok {
					t.Fatalf("%s: missing resolution for %s", group.Name, tc.Expect.Key)
				}
				assertValue(t, group.Name, actual.Value, tc.Expect.Value)
				var expectedRule string
				if tc.Expect.MatchedRuleID != nil {
					expectedRule = *tc.Expect.MatchedRuleID
				}
				if actual.MatchedRuleID != expectedRule {
					t.Fatalf("%s: matched rule = %q want %q", group.Name, actual.MatchedRuleID, expectedRule)
				}
			}
			for key, expected := range tc.ExpectKV {
				actual, ok := byKey[key]
				if !ok {
					t.Fatalf("%s: missing resolution for %s", group.Name, key)
				}
				assertValue(t, group.Name, actual.Value, expected)
			}
		}
	}
}

func buildContext(t *testing.T, shape contextShape) TargetingContext {
	version, ok := ParseSemanticVersion(shape.Version)
	if !ok {
		t.Fatalf("invalid context version %s", shape.Version)
	}
	return TargetingContext{
		Product:      shape.Product,
		Platform:     platform(shape.Platform),
		Architecture: architecture(shape.Architecture),
		Flavor:       shape.Flavor,
		Channel:      shape.Channel,
		Environment:  shape.Environment,
		Region:       shape.Region,
		Version:      version,
		Labels:       shape.Labels,
		DeviceID:     shape.DeviceID,
	}
}

func platform(value string) xconfig.ClientPlatform {
	switch value {
	case "macos":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_MACOS
	case "windows":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_WINDOWS
	case "linux":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_LINUX
	case "ios":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_IOS
	case "android":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_ANDROID
	default:
		return xconfig.ClientPlatform_CLIENT_PLATFORM_UNSPECIFIED
	}
}

func architecture(value string) xconfig.ClientArchitecture {
	switch value {
	case "arm64":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_ARM64
	case "x86_64":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_X86_64
	case "universal":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_UNIVERSAL
	default:
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_UNSPECIFIED
	}
}

func buildDirectives(t *testing.T, shapes []directiveShape) []*xconfig.Directive {
	directives := make([]*xconfig.Directive, 0, len(shapes))
	for _, shape := range shapes {
		rules := make([]*xconfig.DirectiveRule, 0, len(shape.Rules))
		for _, rule := range shape.Rules {
			rules = append(rules, &xconfig.DirectiveRule{
				Id: rule.ID,
				Match: &xconfig.TargetClause{
					Products:      rule.Match.Products,
					Platforms:     platforms(rule.Match.Platforms),
					Architectures: architectures(rule.Match.Architectures),
					Flavors:       rule.Match.Flavors,
					Channels:      rule.Match.Channels,
					Environments:  rule.Match.Environments,
					Regions:       rule.Match.Regions,
					Versions:      constraints(rule.Match.Versions),
					Labels:        labels(rule.Match.Labels),
				},
				Value:           protoValue(rule.Value),
				RolloutPermille: rule.RolloutPermille,
			})
		}
		directives = append(directives, &xconfig.Directive{
			Key:      shape.Key,
			Rules:    rules,
			Fallback: protoValue(shape.Fallback),
		})
	}
	return directives
}

func platforms(values []string) []xconfig.ClientPlatform {
	out := make([]xconfig.ClientPlatform, 0, len(values))
	for _, value := range values {
		out = append(out, platform(value))
	}
	return out
}

func architectures(values []string) []xconfig.ClientArchitecture {
	out := make([]xconfig.ClientArchitecture, 0, len(values))
	for _, value := range values {
		out = append(out, architecture(value))
	}
	return out
}

func constraints(values []constraintShape) []*xconfig.VersionConstraint {
	out := make([]*xconfig.VersionConstraint, 0, len(values))
	for _, value := range values {
		out = append(out, &xconfig.VersionConstraint{
			Comparator: value.Comparator,
			Version:    value.Version,
		})
	}
	return out
}

func labels(values []labelMatcherShape) []*xconfig.LabelMatcher {
	out := make([]*xconfig.LabelMatcher, 0, len(values))
	for _, value := range values {
		out = append(out, &xconfig.LabelMatcher{Key: value.Key, Value: value.Value})
	}
	return out
}

func protoValue(shape valueShape) *xconfig.DirectiveValue {
	switch {
	case shape.StringValue != nil:
		return &xconfig.DirectiveValue{Value: &xconfig.DirectiveValue_StringValue{StringValue: *shape.StringValue}}
	case shape.BoolValue != nil:
		return &xconfig.DirectiveValue{Value: &xconfig.DirectiveValue_BoolValue{BoolValue: *shape.BoolValue}}
	case shape.IntValue != nil:
		return &xconfig.DirectiveValue{Value: &xconfig.DirectiveValue_IntValue{IntValue: *shape.IntValue}}
	case shape.EndpointSeedID != nil:
		return &xconfig.DirectiveValue{Value: &xconfig.DirectiveValue_EndpointSeedId{EndpointSeedId: *shape.EndpointSeedID}}
	default:
		return nil
	}
}

func assertValue(t *testing.T, group string, actual EvaluatedValue, expected valueShape) {
	t.Helper()
	switch {
	case expected.StringValue != nil:
		if actual.StringValue == nil || *actual.StringValue != *expected.StringValue {
			t.Fatalf("%s: string value mismatch", group)
		}
	case expected.BoolValue != nil:
		if actual.BoolValue == nil || *actual.BoolValue != *expected.BoolValue {
			t.Fatalf("%s: bool value mismatch", group)
		}
	case expected.IntValue != nil:
		if actual.IntValue == nil || *actual.IntValue != *expected.IntValue {
			t.Fatalf("%s: int value mismatch", group)
		}
	case expected.EndpointSeedID != nil:
		if actual.EndpointSeedID == nil || *actual.EndpointSeedID != *expected.EndpointSeedID {
			t.Fatalf("%s: endpoint seed value mismatch", group)
		}
	}
}
