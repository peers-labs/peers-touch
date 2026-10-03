//go:build windows

package cli

import (
	"os"
	"os/exec"
	"time"
)

func configureProcessGroup(_ *exec.Cmd) {}

func terminateProcessGroup(process *os.Process) error {
	if process == nil {
		return nil
	}
	return process.Kill()
}

func killProcessGroup(process *os.Process) error {
	if process == nil {
		return nil
	}
	return process.Kill()
}

func shutdownProcessGroup(_ *os.Process, _ time.Duration) error {
	return nil
}
