// Package role owns process role selection and composition allowlists.
package role

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

const EnvironmentVariable = "PEERS_NODE_ROLE"

type Role string

const (
	Station Role = "station"
	Relay   Role = "relay"
)

var (
	ErrMissing = errors.New("runtime role is required")
	ErrInvalid = errors.New("runtime role is invalid")
)

type contextKey struct{}

var pluginSubserverAllowlists = map[Role]map[string]struct{}{
	Station: {
		"agent":        {},
		"bootstrap":    {},
		"launcher":     {},
		"oauth":        {},
		"oss":          {},
		"relay-client": {},
		"turn":         {},
	},
	Relay: {
		"relay": {},
	},
}

func Parse(value string) (Role, error) {
	candidate := Role(strings.ToLower(strings.TrimSpace(value)))
	switch candidate {
	case Station, Relay:
		return candidate, nil
	case "":
		return "", fmt.Errorf("%w: set %s to station or relay", ErrMissing, EnvironmentVariable)
	default:
		return "", fmt.Errorf("%w: %q; set %s to station or relay", ErrInvalid, value, EnvironmentVariable)
	}
}

func FromEnvironment() (Role, error) {
	return Parse(os.Getenv(EnvironmentVariable))
}

func WithContext(ctx context.Context, runtimeRole Role) context.Context {
	return context.WithValue(ctx, contextKey{}, runtimeRole)
}

func FromContext(ctx context.Context) (Role, error) {
	if ctx == nil {
		return "", fmt.Errorf("%w: role context is nil", ErrMissing)
	}
	runtimeRole, ok := ctx.Value(contextKey{}).(Role)
	if !ok {
		return "", fmt.Errorf("%w: role is not bound to process context", ErrMissing)
	}
	return Parse(string(runtimeRole))
}

func (r Role) NodeName() string {
	return "peers-touch-" + string(r)
}

func (r Role) IncludesApplicationSubservers() bool {
	return r == Station
}

func (r Role) IncludesTouch() bool {
	return r == Station
}

func (r Role) AllowsPluginSubserver(name string) bool {
	_, allowed := pluginSubserverAllowlists[r][name]
	return allowed
}

func (r Role) PluginSubservers() []string {
	allowlist := pluginSubserverAllowlists[r]
	names := make([]string, 0, len(allowlist))
	for name := range allowlist {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
