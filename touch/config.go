package touch

import (
	cfg "github.com/peers-touch/peers-touch-go/core/config"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/touch/util"
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
			Routers  RouterConfig   `json:"routers" pconf:"routers" yaml:"routers"`
			Security SecurityConfig `json:"security" pconf:"security" yaml:"security"`
		} `json:"touch" pconf:"touch"`
	} `json:"peers" pconf:"peers"`
}

// RouterConfig controls which routers are enabled
type RouterConfig struct {
	Management  bool `json:"management" pconf:"management" yaml:"management"`
	ActivityPub bool `json:"activitypub" pconf:"activitypub" yaml:"activitypub"`
	WellKnown   bool `json:"wellknown" pconf:"wellknown" yaml:"wellknown"`
	User        bool `json:"user" pconf:"user" yaml:"user"`
	Peer        bool `json:"peer" pconf:"peer" yaml:"peer"`
}

// SecurityConfig holds security-related configuration
type SecurityConfig struct {
	Password PasswordConfig `json:"password" pconf:"password" yaml:"password"`
}

// PasswordConfig holds password validation configuration
type PasswordConfig struct {
	// Pattern is the regex pattern for password validation
	Pattern string `json:"pattern" pconf:"pattern" yaml:"pattern"`
	// MinLength is the minimum password length (default: 8)
	MinLength int `json:"min_length" pconf:"min-length" yaml:"min_length"`
	// MaxLength is the maximum password length (default: 20)
	MaxLength int `json:"max_length" pconf:"max-length" yaml:"max_length"`
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

// GetPasswordConfig returns the password configuration with default values
func GetPasswordConfig() *util.PasswordConfig {
	config := &touchConfig.Peers.Touch.Security.Password

	// Set default values if not configured
	if config.Pattern == "" || config.MinLength == 0 || config.MaxLength == 0 {
		return &util.PasswordConfig{
			Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`,
			MinLength: 8,
			MaxLength: 20,
		}
	}

	// Convert to util.PasswordConfig
	return &util.PasswordConfig{
		Pattern:   config.Pattern,
		MinLength: config.MinLength,
		MaxLength: config.MaxLength,
	}
}

// ValidatePassword validates password using configurable pattern
func ValidatePassword(password string) error {
	config := GetPasswordConfig()
	return util.ValidatePassword(password, config)
}
