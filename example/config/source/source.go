package main

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	ns "github.com/dirty-bro-tech/peers-touch-go/core/service/native"
	"net/http"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source/file"
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
	s := ns.NewService(service.WithHandlers(
		server.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("hello world"))
		}))))
	service := peers.NewPeer(
		peers.WithCore(s),
		peers.WithConfig(
			config.NewConfig(
				config.WithSources(
					file.NewSource(
						file.WithPath("./source.yml"))))),
	)
	service.Init()

	log.Infof("demoA: %s", value.Source.DemoA)
	log.Infof("NumberString: %s", value.Source.NumberString)
	log.Infof("RFC3339Time: %s", value.Source.RFC3339Time.String())

	go func() {
		for {
			select {
			case <-time.After(2 * time.Second):
				// try to change DemoA value in source.yml
				// there will log the new value
				log.Infof("demoA: %s", value.Source.DemoA)
			}
		}
	}()
	service.Start()
}
