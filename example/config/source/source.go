package main

import (
	"context"
	"time"

	"github.com/peers-touch/peers-touch-go/core/config"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/pkg/config/source/file"
)

type source struct {
	DemoA        string    `pconf:"demoA"`
	NumberString string    `pconf:"number-string"`
	RFC3339Time  time.Time `pconf:"rfc3339-time"`
}

type Value struct {
	Source source `pconf:"source"`
}

var (
	value Value
)

func init() {
	config.RegisterOptions(&value)
}

func main() {
	ctx := context.Background()
	config.NewConfig(
		config.WithSources(
			file.NewSource(
				option.WithRootCtx(ctx),
				file.WithPath("./source.yml")))).Init()
	log.Infof(ctx, "demoA: %s", value.Source.DemoA)
	log.Infof(ctx, "NumberString: %s", value.Source.NumberString)
	log.Infof(ctx, "RFC3339Time: %s", value.Source.RFC3339Time.String())

	go func() {
		for {
			select {
			case <-time.After(2 * time.Second):
				// try to change DemoA value in source.yml
				// there will log the new value
				log.Infof(ctx, "demoA: %s", value.Source.DemoA)
			}
		}
	}()
}
