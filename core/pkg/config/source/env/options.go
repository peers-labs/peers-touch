package env

import (
	"context"
	"strings"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type envSourceKey struct{}
type strippedPrefixKey struct{}
type prefixKey struct{}

// WithStrippedPrefix sets the environment variable prefixes to scope to.
// These prefixes will be removed from the actual config entries.
func WithStrippedPrefix(p ...string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *source.Options) {
			opts.Ctx = context.WithValue(opts.Ctx, strippedPrefixKey{}, appendUnderscore(p))
		})
	}
}

// WithPrefix sets the environment variable prefixes to scope to.
// These prefixes will not be removed. Each prefix will be considered a top level config entry.
func WithPrefix(p ...string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *source.Options) {
			opts.Ctx = context.WithValue(opts.Ctx, prefixKey{}, appendUnderscore(p))
		})
	}
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

func optionWrap(o *option.Options, f func(*source.Options)) {
	if o.Ctx == nil {
		o.Ctx = context.Background()
	}

	var opts *source.Options
	if o.Ctx.Value(envSourceKey{}) == nil {
		opts = &source.Options{}
		o.Ctx = context.WithValue(o.Ctx, envSourceKey{}, opts)
	} else {
		opts = o.Ctx.Value(envSourceKey{}).(*source.Options)
	}

	f(opts)
}
