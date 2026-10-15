package native

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestPrimeServerOptionsWithoutApplicationSubservers(t *testing.T) {
	root := &option.Options{}
	root.Apply(option.WithRootCtx(context.Background()))

	service := &native{
		opts: &node.Options{Options: root},
	}
	service.primeServerOptions()

	if got := server.GetOptions(); got == nil || got.Options != root {
		t.Fatal("server options were not initialized before plugin construction")
	}
}
