//go:build !windows

package cli

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func configureProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProcessGroup(process *os.Process) error {
	return signalProcessGroup(process, syscall.SIGTERM)
}

func killProcessGroup(process *os.Process) error {
	return signalProcessGroup(process, syscall.SIGKILL)
}

func signalProcessGroup(process *os.Process, signal syscall.Signal) error {
	if process == nil {
		return nil
	}
	err := syscall.Kill(-process.Pid, signal)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
