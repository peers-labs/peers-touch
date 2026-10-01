package externalruntime

import (
	"context"
	"os"
	"time"
)

func superviseProcess(
	ctx context.Context,
	process *os.Process,
	processDone <-chan struct{},
	grace time.Duration,
) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-processDone:
			return
		case <-ctx.Done():
		}

		_ = terminateProcessGroup(process)
		if grace <= 0 {
			grace = defaultTerminationGrace
		}
		timer := time.NewTimer(grace)
		defer timer.Stop()
		select {
		case <-processDone:
		case <-timer.C:
			_ = killProcessGroup(process)
		}
	}()
	return done
}
