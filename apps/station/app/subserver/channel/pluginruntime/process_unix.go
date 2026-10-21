//go:build !windows

package pluginruntime

import (
	"errors"
	"os/exec"
	"syscall"
)

func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func (s *State) kill() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

// KillProcessGroupForTest forcibly kills the supervised process group,
// simulating an external crash. Test-only.
func (s *State) KillProcessGroupForTest() error { return s.kill() }
