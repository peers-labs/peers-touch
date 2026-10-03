//go:build !windows

package externalruntime

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configureProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProcessGroup(process *os.Process) error {
	if process == nil {
		return nil
	}
	err := syscall.Kill(-process.Pid, syscall.SIGTERM)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func killProcessGroup(process *os.Process) error {
	if process == nil {
		return nil
	}
	err := syscall.Kill(-process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func shutdownProcessGroup(process *os.Process, grace time.Duration) error {
	if process == nil {
		return nil
	}
	if err := terminateProcessGroup(process); err != nil {
		return err
	}
	deadline := time.Now().Add(grace)
	for {
		err := syscall.Kill(-process.Pid, 0)
		switch {
		case errors.Is(err, syscall.ESRCH):
			return nil
		case err != nil && !errors.Is(err, syscall.EPERM):
			return err
		case time.Now().After(deadline):
			return killProcessGroup(process)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}
