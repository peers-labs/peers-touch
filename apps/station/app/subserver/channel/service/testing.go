package service

import "github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginruntime"

// RunningStateForTest returns the supervised process for a plugin id, or nil.
// Tests use it to force a crash and observe recovery/failed state.
func (c *Catalog) RunningStateForTest(id string) *pluginruntime.State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.running[id]
}
