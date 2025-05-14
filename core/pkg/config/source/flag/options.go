package flag

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type includeUnsetKey struct{}

// IncludeUnset toggles the loading of unset flags and their respective default values.
// Default behavior is to ignore any unset flags.
func IncludeUnset(b bool) *option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(includeUnsetKey{}, b)
	})
}
