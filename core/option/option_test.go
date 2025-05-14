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
	opt1 := func(o *Options) {
		count++
	}

	{
		o.Apply(opt1)
		o.Apply(opt1)

		assert.Equal(t, 1, count)
	}

	{
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
}
