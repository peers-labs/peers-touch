package a

import (
	"context"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/broker"
)

type memoryBroker struct {
	mu     sync.RWMutex
	topics map[string][]broker.Message
}

func New(opts ...interface{}) broker.Broker {
	return &memoryBroker{topics: make(map[string][]broker.Message)}
}

func (m *memoryBroker) Publish(ctx context.Context, topic string, key string, headers map[string]string, payload []byte, opts broker.PublishOptions) error {
	msg := broker.Message{ID: time.Now().UTC().Format("20060102T150405.000000000"), Topic: topic, Key: key, Headers: headers, Payload: payload, Timestamp: time.Now().UTC().UnixMilli()}
	m.mu.Lock()
	m.topics[topic] = append(m.topics[topic], msg)
	m.mu.Unlock()
	return nil
}

func (m *memoryBroker) Pull(ctx context.Context, topic string, sinceID string, limit int, opts broker.PullOptions) ([]broker.Message, error) {
	m.mu.RLock()
	list := m.topics[topic]
	m.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	start := 0
	if sinceID != "" {
		for i := range list {
			if list[i].ID == sinceID {
				start = i + 1
				break
			}
		}
	}
	end := start + limit
	if end > len(list) {
		end = len(list)
	}
	res := make([]broker.Message, end-start)
	copy(res, list[start:end])
	return res, nil
}

func (m *memoryBroker) Subscribe(ctx context.Context, topicPattern string, group string, handler func(ctx context.Context, msg broker.Message) error, opts broker.SubscribeOptions) (broker.Subscription, error) {
	// Minimal implementation: not used in first version; rely on Pull
	return &noopSub{}, nil
}

func (m *memoryBroker) Close() error { return nil }

type noopSub struct{}

func (n *noopSub) Stop() error { return nil }
