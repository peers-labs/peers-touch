package publication

import (
	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
)

// Directive value kinds form the closed value type set (XCFG-D04).
type DirectiveValueKind int

const (
	DirectiveValueString DirectiveValueKind = iota + 1
	DirectiveValueBool
	DirectiveValueInt
	DirectiveValueEndpointSeed
)

type DirectiveKeySpec struct {
	Key          string
	ValueKind    DirectiveValueKind
	EndpointKind xconfig.EndpointSeedKind
}

// Registered directive keys. Adding a key is an explicit schema decision;
// unknown keys are rejected at validation time.
var directiveKeyRegistry = map[string]DirectiveKeySpec{
	"network.default_relay": {
		Key:          "network.default_relay",
		ValueKind:    DirectiveValueEndpointSeed,
		EndpointKind: xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_RELAY,
	},
	"network.default_station": {
		Key:          "network.default_station",
		ValueKind:    DirectiveValueEndpointSeed,
		EndpointKind: xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_DIRECT_STATION,
	},
}

func lookupDirectiveKey(key string) (DirectiveKeySpec, bool) {
	spec, ok := directiveKeyRegistry[key]
	return spec, ok
}
