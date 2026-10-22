//go:build windows

package pluginruntime

import (
	"os/exec"
)

func configureProcessGroup(cmd *exec.Cmd) {
	// Process-group isolation on Windows uses CREATE_NEW_PROCESS_GROUP; left
	// minimal here because the supported Station host is linux/darwin.
}

func (s *State) kill() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	return s.cmd.Process.Kill()
}

// KillProcessGroupForTest forcibly kills the supervised process, simulating
// an external crash. Test-only.
func (s *State) KillProcessGroupForTest() error { return s.kill() }
