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
