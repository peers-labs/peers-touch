package service

import "github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"

// The snake_case name is the cross-runtime D11 audit marker.
func enforce_canvas_single_agent_readiness() error {
	return errcode.NewCanvasSingleAgentNotReady()
}
