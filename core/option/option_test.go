package option

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

type optionKey struct{}

var skey = optionKey{}
var skeyPtr = &optionKey{}

func TestOptions_AppendCtx(t *testing.T) {
	// Create an Options instance
	o := &options{}
	o.ctx = context.Background()

	// works
	o.AppendCtxInf(skeyPtr, "value")
	assert.Equal(t, "value", o.ctx.Value(skeyPtr))

	// works
	o.ctx = context.WithValue(o.ctx, skey, "value2")
	assert.Equal(t, "value2", o.ctx.Value(skey))

	// works
	assert.Equal(t, "value2", o.ctx.Value(optionKey{}))

	// works
	o.ctx = context.WithValue(o.ctx, optionKey{}, "value3")
	assert.Equal(t, "value3", o.ctx.Value(skey))

	fmt.Printf("skeyPtr is at: %p\n", skeyPtr) // 0x123450 (zerobase地址)
	fmt.Printf("skey is at %p\n", &skey)
	fmt.Printf("optionKey{} is at %p\n", &optionKey{})

	// doesn't work
	o.AppendCtxStruct(skey, "value4")
	assert.Equal(t, "value4", o.ctx.Value(skey))
}

type options struct {
	ctx context.Context
}

func (o *options) AppendCtxStruct(key struct{}, value interface{}) {
	if o.ctx == nil {
		panic("option ctx is nil")
	}
	fmt.Printf("inner key is at %p\n", &key)
	o.ctx = context.WithValue(o.ctx, key, value)
	return
}

func (o *options) AppendCtxInf(key interface{}, value interface{}) {
	if o.ctx == nil {
		panic("option ctx is nil")
	}

	o.ctx = context.WithValue(o.ctx, key, value)
	return
}
