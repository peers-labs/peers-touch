package env

import (
	"strings"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type strippedPrefixKey struct{}
type prefixKey struct{}

// WithStrippedPrefix sets the environment variable prefixes to scope to.
// These prefixes will be removed from the actual config entries.
func WithStrippedPrefix(p ...string) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(strippedPrefixKey{}, appendUnderscore(p))
	})
}

// WithPrefix sets the environment variable prefixes to scope to.
// These prefixes will not be removed. Each prefix will be considered a top level config entry.
func WithPrefix(p ...string) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(prefixKey{}, appendUnderscore(p))
	})
}

func appendUnderscore(prefixes []string) []string {
	//nolint:prealloc
	var result []string
	for _, p := range prefixes {
		if !strings.HasSuffix(p, "_") {
			result = append(result, p+"_")
			continue
		}

		result = append(result, p)
	}

	return result
}
