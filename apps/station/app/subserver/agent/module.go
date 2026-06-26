package agent

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ModuleDeps struct {
	DB          interface{}
	EventBus    domain.EventBus
	JWTWrapper  server.Wrapper
	LogIDWrapper server.Wrapper
	Config      *ModuleConfig
}

type ModuleConfig struct {
	OSS struct {
		Bucket     string
		Endpoint   string
		Region     string
	}
}

type AgentModule interface {
	Name() string
	Init(ctx context.Context, deps ModuleDeps) error
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Handlers() []server.Handler
}

type AgentModuleFunc func(deps ModuleDeps) (AgentModule, error)
