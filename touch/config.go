package touch

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
)

var (
	touchConfig = TouchConfig{}
)

func init() {
	cfg.RegisterOptions(&touchConfig)
}

// TouchConfig holds configuration for the touch layer
type TouchConfig struct {
	Peers struct {
		Touch struct {
			Routers RouterConfig `json:"routers" pconf:"routers" yaml:"routers"`
		} `json:"touch" pconf:"touch"`
	} `json:"peers" pconf:"peers"`
}

// RouterConfig controls which routers are enabled
type RouterConfig struct {
	Management      bool `json:"management" pconf:"management" yaml:"management"`
	ActivityPub     bool `json:"activitypub" pconf:"activitypub" yaml:"activitypub"`
	UserActivityPub bool `json:"user_activitypub" pconf:"user_activitypub" yaml:"user_activitypub"`
	WellKnown       bool `json:"wellknown" pconf:"wellknown" yaml:"wellknown"`
	User            bool `json:"user" pconf:"user" yaml:"user"`
	Peer            bool `json:"peer" pconf:"peer" yaml:"peer"`
}

func (r *RouterConfig) Options() []option.Option {
	// Router config doesn't need to return options as it's used directly
	return nil
}

// GetRouterConfig returns the router configuration with default values
func GetRouterConfig() *RouterConfig {
	// Always return the loaded configuration
	// If no configuration is loaded, the zero values (false) will be used
	return &touchConfig.Peers.Touch.Routers
}