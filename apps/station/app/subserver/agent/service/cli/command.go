package cli

import (
	"os/exec"
)

// PrepareCommand gives auxiliary CLI commands the executor's process-group
// isolation. CommandContext cancellation kills the whole group, including
// children that still hold a progress pipe open.
func PrepareCommand(command *exec.Cmd) {
	configureProcessGroup(command)
	command.Cancel = func() error { return killProcessGroup(command.Process) }
	command.WaitDelay = defaultTerminationGrace
}

// CleanupCommand releases any children left behind after the parent exits.
func CleanupCommand(command *exec.Cmd) {
	_ = shutdownProcessGroup(command.Process, defaultTerminationGrace)
}
