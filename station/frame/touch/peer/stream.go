package peer

import (
	"context"
	"net"
	"sync"
	"time"

	log "github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/touch/model"
)

type stream struct {
	conn         net.Conn
	sessionID    string
	localAddr    string
	remoteAddr   string
	messageChan  chan *model.StreamMessage
	closeChan    chan struct{}
	mu           sync.Mutex
	lastActivity time.Time
}

func createStream(ctx context.Context, sessionID string, peerAddr string) (*stream, error) {
	conn, err := net.DialTimeout("tcp", peerAddr, 5*time.Second)
	if err != nil {
		return nil, err
	}

	s := &stream{
		conn:         conn,
		sessionID:    sessionID,
		localAddr:    conn.LocalAddr().String(),
		remoteAddr:   peerAddr,
		messageChan:  make(chan *model.StreamMessage, 100),
		closeChan:    make(chan struct{}),
		lastActivity: time.Now(),
	}

	go s.readLoop(ctx)
	go s.writeLoop(ctx)

	return s, nil
}

func (s *stream) readLoop(ctx context.Context) {
	defer s.Close()
	buf := make([]byte, 4096)

	for {
		select {
		case <-s.closeChan:
			return
		default:
			s.conn.SetReadDeadline(time.Now().Add(30 * time.Second))

			n, err := s.conn.Read(buf)
			if err != nil {
				log.Warnf(ctx, "Stream read error: %v", err)
				return
			}

			s.mu.Lock()
			s.lastActivity = time.Now()
			s.mu.Unlock()

			// Handle incoming data
			log.Infof(ctx, "Received %d bytes from %s", n, s.remoteAddr)
		}
	}
}

func (s *stream) writeLoop(ctx context.Context) {
	defer s.Close()

	for {
		select {
		case <-s.closeChan:
			return
		case msg := <-s.messageChan:
			s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			_, err := s.conn.Write([]byte(msg.Content))
			if err != nil {
				log.Warnf(ctx, "Stream write error: %v", err)
				return
			}

			s.mu.Lock()
			s.lastActivity = time.Now()
			s.mu.Unlock()

			log.Infof(ctx, "Sent message to %s: %s", s.remoteAddr, msg.Content)
		}
	}
}

func (s *stream) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	select {
	case <-s.closeChan:
		return
	default:
		close(s.closeChan)
		s.conn.Close()
	}
}
