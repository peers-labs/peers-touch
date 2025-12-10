package broker

import (
	"context"
)

type Message struct {
	ID        string
	Topic     string
	Key       string
	Headers   map[string]string
	Payload   []byte
	Timestamp int64
}

type PublishOptions struct {
	TTLMillis int64
	Priority  int
}

type PullOptions struct {
	Filter []string
}

type SubscribeOptions struct {
	ManualAck bool
	Filter    []string
}

type Subscription interface {
	Stop() error
}

type Broker interface {
	Publish(ctx context.Context, topic string, key string, headers map[string]string, payload []byte, opts PublishOptions) error
	Pull(ctx context.Context, topic string, sinceID string, limit int, opts PullOptions) ([]Message, error)
	Subscribe(ctx context.Context, topicPattern string, group string, handler func(ctx context.Context, msg Message) error, opts SubscribeOptions) (Subscription, error)
	Close() error
}
