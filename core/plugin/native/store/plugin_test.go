package native

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source/file"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/stretchr/testify/assert"
)

var (
	testConfigPathP = "../../../config/testfile/peers.yml"
	testConfigPathS = "../../../config/testfile/store.yml"
)

func getTestFilePath() string {
	_, filename, _, _ := runtime.Caller(1) // 1 skips this function's frame
	return filepath.Dir(filename)
}

func TestNativeStorePlugin_Options(t *testing.T) {
	ctx := context.Background()
	ctxOption := option.WithRootCtx(ctx)
	c := cfg.NewConfig(
		cfg.WithSources(
			file.NewSource(ctxOption, file.WithPath(filepath.Join(getTestFilePath(), testConfigPathS))),
			file.NewSource(file.WithPath(filepath.Join(getTestFilePath(), testConfigPathP))),
		))
	// store.WithRDS tries to help init store context
	err := c.Init(store.WithRDS(&store.RDSInit{
		Name: "test",
	}))
	assert.NoError(t, err)

	err = c.Scan(&options)
	assert.NoError(t, err)

	p := &nativeStorePlugin{}
	opts := p.Options()

	storeOpts := store.GetOptions()
	storeOpts.Apply(opts...)

	{
		// 3 = test + the two in config-files
		assert.Lenf(t, storeOpts.RDSMap, 3, "RDS Map length should be 2")
	}

	{
		hasDefault := false
		for _, rm := range storeOpts.RDSMap {
			if rm.Default == true && hasDefault == false {
				hasDefault = true
			}
		}
		assert.True(t, hasDefault, "Default option should be set")
	}
}
