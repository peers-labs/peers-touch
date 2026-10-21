package pluginruntime

// KillForTest force-terminates the plugin process group. Tests use it to
// simulate an external crash; production callers go through Stop.
func (s *State) KillForTest() error {
	return s.kill()
}
