package publication

import (
	"testing"

	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
)

func seedKindsForDirectives() map[string]xconfig.EndpointSeedKind {
	return map[string]xconfig.EndpointSeedKind{
		"relay-global": xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_RELAY,
		"relay-cn-1":   xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_RELAY,
		"station-cn-1": xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_DIRECT_STATION,
	}
}

func validRelayDirective() catalog.CatalogDirective {
	return catalog.CatalogDirective{
		Key: "network.default_relay",
		Rules: []catalog.CatalogDirectiveRule{
			{
				ID: "cn-geek",
				Match: catalog.CatalogTargetClause{
					Products: []string{"desktop"},
					Flavors:  []string{"geek", "xx"},
					Regions:  []string{"cn"},
					Versions: []catalog.CatalogVersionConstraint{
						{Comparator: ">=", Version: "0.2.0"},
					},
				},
				Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1"},
			},
		},
		Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
	}
}

func TestBuildDirectivesAcceptsValidShape(t *testing.T) {
	directives, err := buildDirectives(
		[]catalog.CatalogDirective{validRelayDirective()},
		seedKindsForDirectives(),
	)
	if err != nil {
		t.Fatalf("expected valid directive, got %v", err)
	}
	if len(directives) != 1 {
		t.Fatalf("expected one directive, got %d", len(directives))
	}
	rule := directives[0].Rules[0]
	if rule.Id != "cn-geek" ||
		len(rule.Match.Products) != 1 || rule.Match.Products[0] != "desktop" ||
		len(rule.Match.Platforms) != 0 ||
		rule.GetValue().GetEndpointSeedId() != "relay-cn-1" ||
		directives[0].GetFallback().GetEndpointSeedId() != "relay-global" {
		t.Fatalf("unexpected directive projection: %+v", directives[0])
	}
	if rule.Match.Versions[0].Comparator != ">=" {
		t.Fatalf("version constraint not preserved")
	}
}

func TestBuildDirectivesRejectsInvalidShapes(t *testing.T) {
	kinds := seedKindsForDirectives()
	cases := map[string]catalog.CatalogDirective{
		"unknown key": {
			Key:      "network.custom",
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
		"missing fallback value": {
			Key: "network.default_relay",
		},
		"fallback references unknown seed": {
			Key:      "network.default_relay",
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "missing"},
		},
		"relay key references station seed": {
			Key:      "network.default_relay",
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "station-cn-1"},
		},
		"rule missing value": {
			Key: "network.default_relay",
			Rules: []catalog.CatalogDirectiveRule{
				{ID: "r1", Match: catalog.CatalogTargetClause{Regions: []string{"cn"}}},
			},
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
		"multiple values in one directive value": {
			Key: "network.default_relay",
			Rules: []catalog.CatalogDirectiveRule{{
				ID:    "r1",
				Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1", StringValue: "x"},
			}},
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
		"unknown comparator": {
			Key: "network.default_relay",
			Rules: []catalog.CatalogDirectiveRule{{
				ID:    "r1",
				Match: catalog.CatalogTargetClause{Versions: []catalog.CatalogVersionConstraint{{Comparator: "==", Version: "1.0.0"}}},
				Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1"},
			}},
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
		"unknown platform": {
			Key: "network.default_relay",
			Rules: []catalog.CatalogDirectiveRule{{
				ID:    "r1",
				Match: catalog.CatalogTargetClause{Platforms: []string{"plan9"}},
				Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1"},
			}},
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
		"rollout above permille": {
			Key: "network.default_relay",
			Rules: []catalog.CatalogDirectiveRule{{
				ID:              "r1",
				Value:           catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1"},
				RolloutPermille: 1001,
			}},
			Fallback: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-global"},
		},
	}
	for name, directive := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := buildDirectives([]catalog.CatalogDirective{directive}, kinds); err == nil {
				t.Fatalf("expected rejection for %s", name)
			}
		})
	}
}

func TestBuildDirectivesRejectsDuplicateKeysAndRules(t *testing.T) {
	first := validRelayDirective()
	second := validRelayDirective()
	if _, err := buildDirectives(
		[]catalog.CatalogDirective{first, second},
		seedKindsForDirectives(),
	); err == nil {
		t.Fatal("expected duplicate directive key rejection")
	}

	duplicateRule := validRelayDirective()
	duplicateRule.Rules = append(
		duplicateRule.Rules,
		catalog.CatalogDirectiveRule{
			ID:    "cn-geek",
			Value: catalog.CatalogDirectiveValue{EndpointSeedID: "relay-cn-1"},
		},
	)
	if _, err := buildDirectives(
		[]catalog.CatalogDirective{duplicateRule},
		seedKindsForDirectives(),
	); err == nil {
		t.Fatal("expected duplicate rule id rejection")
	}
}
