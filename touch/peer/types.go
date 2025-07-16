package peer

import (
	"context"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
)

// Add session structure
type session struct {
	localPeerID string
	remoteAddr  string
	sessionID   string
	lastActive  time.Time
	messageChan chan *model.StreamMessage
	ctx         context.Context
	cancel      context.CancelFunc
	stream      *stream
}
