//go:build windows

package externalruntime

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
	if err := process.Kill(); err != nil && !os.IsProcessDone(err) {
		return err
	}
	return nil
}

func killProcessGroup(process *os.Process) error {
	return terminateProcessGroup(process)
}

func shutdownProcessGroup(process *os.Process, _ time.Duration) error {
	return terminateProcessGroup(process)
}
