//go:build !windows

package cli

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
	return signalProcessGroup(process, syscall.SIGTERM)
}

func killProcessGroup(process *os.Process) error {
	return signalProcessGroup(process, syscall.SIGKILL)
}

func shutdownProcessGroup(process *os.Process, grace time.Duration) error {
	if process == nil {
		return nil
	}
	if err := terminateProcessGroup(process); err != nil {
		return err
	}
	if grace <= 0 {
		grace = defaultTerminationGrace
	}

	deadline := time.Now().Add(grace)
	for {
		running, err := processGroupRunning(process)
		if err != nil || !running {
			return err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return killProcessGroup(process)
		}
		if remaining > 10*time.Millisecond {
			remaining = 10 * time.Millisecond
		}
		time.Sleep(remaining)
	}
}

func processGroupRunning(process *os.Process) (bool, error) {
	err := syscall.Kill(-process.Pid, 0)
	switch {
	case err == nil, errors.Is(err, syscall.EPERM):
		return true, nil
	case errors.Is(err, syscall.ESRCH):
		return false, nil
	default:
		return false, err
	}
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
