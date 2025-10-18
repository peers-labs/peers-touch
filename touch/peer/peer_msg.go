package peer

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/touch/model"
)

func TouchHiTo(c context.Context, param *model.TouchHiToParam) (string, error) {
	sessMux.Lock()
	defer sessMux.Unlock()

	// Get local peer info
	myInfo, err := GetMyPeerInfos(c)
	if err != nil {
		return "", fmt.Errorf("failed to get local peer info: %w", err)
	}

	// Create composite session key: local_peer_id + remote_peer_address
	sessionKey := myInfo.PeerId + "|" + param.PeerAddress

	// Check existing session
	if existing, ok := sessions.Load(sessionKey); ok {
		return existing.(*session).sessionID, nil
	}

	// Generate new session ID
	sessionID := uuid.New().String()

	// Create context with cancellation
	ctx, cancel := context.WithCancel(c)

	// Create and store stream
	strm, err := createStream(ctx, sessionID, param.PeerAddress)
	if err != nil {
		cancel()
		return "", fmt.Errorf("connection failed: %w", err)
	}

	// Create new session
	newSession := &session{
		localPeerID: myInfo.PeerId,
		remoteAddr:  param.PeerAddress,
		sessionID:   sessionID,
		stream:      strm,
		lastActive:  time.Now(),
		messageChan: make(chan *model.StreamMessage, 100),
		ctx:         ctx,
		cancel:      cancel,
	}

	// Store session with composite key
	sessions.Store(sessionKey, newSession)

	// Start session manager goroutine
	go sessionManager(newSession)

	// Start message processor
	go processMessages(newSession)

	newSession.stream = strm
	return sessionID, nil
}

func processMessages(sess *session) {
	for {
		select {
		case msg := <-sess.messageChan:
			select {
			case sess.stream.messageChan <- msg:
				sess.lastActive = time.Now()
			default:
				log.Warnf(sess.ctx, "Message channel full, dropping message")
			}
		case <-sess.ctx.Done():
			sess.stream.Close()
			return
		}
	}
}
