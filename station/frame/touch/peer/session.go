package peer

import (
	"sync"
	"time"
)

var (
	sessions sync.Map // Concurrent session storage
	sessMux  sync.Mutex
)

func sessionManager(sess *session) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if time.Since(sess.lastActive) > time.Minute {
				sess.ctx.Done()
				sessions.Delete(sess.sessionID)
				return
			}
		case <-sess.ctx.Done():
			sessions.Delete(sess.sessionID)
			return
		}
	}
}
