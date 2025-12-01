package actor

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
)

func init() {
	config.RegisterOptions(&ymlOptions)
}

// see github.com/peers-labs/peers-touch/station/frame/example/helloworld/conf/actor_*.yml
var ymlOptions struct {
	Peers struct {
		Actor struct {
			Person []struct {
				Name  string `pconf:"name"`
				Email string `pconf:"email"`
			} `pconf:"person"`
		} `pconf:"actor"`
	} `pconf:"peers"`
}
