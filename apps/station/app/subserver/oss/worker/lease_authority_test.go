package worker

import (
	"context"
	"time"
)

func testWorkerContext(
	parent context.Context,
	workerName string,
) context.Context {
	return withLeaseAuthority(parent, LeaseAuthority{
		WorkerName:       workerName,
		OwnerNodePeerID:  "test-node",
		OwnerIncarnation: "test-incarnation",
		FencingToken:     1,
		ExpiresAt:        time.Now().Add(time.Hour),
	})
}
