package agent

import (
	agentsvc "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// channelTurnExecutorTarget is implemented by the channel subserver. The
// interface is declared here to keep the discovery structural (the same
// pattern as federation's SubserverInstances lookups) without importing the
// concrete channel subserver type.
type channelTurnExecutorTarget interface {
	SetTurnExecutor(executor channelsvc.TurnExecutor)
}

type channelRequesterToolTarget interface {
	RequesterTools() channelsvc.RequesterToolExecutor
}

// wireChannelTurnExecutor installs the agent-domain turn executor into the
// channel subserver when both are registered. Channel initializes before
// agent (sorted subserver names), so the instance is available here.
func (s *agentSubServer) wireChannelTurnExecutor(
	turns *agentsvc.TurnService,
	convs *agentsvc.ConversationService,
	admission *agentsvc.TurnAdmissionService,
	agents *agentsvc.AgentService,
	capabilities *agentsvc.CapabilityAuthorityService,
	registry *agentsvc.ToolRegistryService,
	growth *agentsvc.GrowthMetricsService,
) *agentsvc.ChannelTurnExecutor {
	serverOptions := server.GetOptions()
	if serverOptions == nil {
		return nil
	}
	instance := serverOptions.SubserverInstances["channel"]
	if instance == nil {
		return nil
	}
	target, ok := instance.(channelTurnExecutorTarget)
	if !ok {
		return nil
	}
	var requesterTools channelsvc.RequesterToolExecutor
	if source, ok := instance.(channelRequesterToolTarget); ok {
		requesterTools = source.RequesterTools()
	}
	agentsvc.RegisterChannelRequesterTools(registry, requesterTools)
	var attachments agentsvc.ChannelAttachmentStore
	if ossInstance := serverOptions.SubserverInstances["oss"]; ossInstance != nil {
		attachments, _ = ossInstance.(agentsvc.ChannelAttachmentStore)
	}
	executor := agentsvc.NewChannelTurnExecutor(
		turns, convs, admission, attachments, agents, capabilities,
		registry, growth,
	)
	target.SetTurnExecutor(executor)
	return executor
}
