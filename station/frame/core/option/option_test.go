package option

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

type keyStruct struct{}

func TestOptions_AppendCtx(t *testing.T) {
	// Create an Options instance
	o := &Options{}
	o.ctx = context.Background()
	// works
	o.AppendCtx(keyStruct{}, "value")
	assert.Equal(t, "value", o.ctx.Value(keyStruct{}))
}

func TestOption_Duplicate(t *testing.T) {
	// Create an Options instance
	o := &Options{}
	o.ctx = context.Background()
	count := 0
	{
		opt1 := func(o *Options) {
			count++
		}
		o.Apply(opt1)
		o.Apply(opt1)

		assert.Equal(t, 1, count)
		o.Apply(opt1, opt1)
		assert.Equal(t, 1, count)
	}

	{
		opt2 := func(o *Options) {
			count++
		}
		o.Apply(opt2)

		assert.Equal(t, 2, count)
	}
	{
		type options = struct {
			options *Options
			count   int
		}

		type keyStruct struct{}
		wrapper := NewWrapper[options](keyStruct{}, func(opts *Options) *options {
			return &options{
				options: opts,
			}
		})

		opt1 := wrapper.Wrap(func(opts *options) {
			opts.count++
		})

		opt2 := wrapper.Wrap(func(opts *options) {
			opts.count++
		})

		allOptions := []Option{opt1, opt1, opt2}
		o.Apply(allOptions...)

		opts := o.Ctx().Value(keyStruct{}).(*options)
		assert.Equal(t, 2, opts.count)
	}
}
