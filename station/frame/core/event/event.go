// Package event provides real-time event push infrastructure for the peers-touch system.
//
// Architecture (from message-storage-system.zh.md design doc):
//
//	┌─────────────────────────────────────────┐
//	│  领域服务（各域）                         │
//	│  发出领域事件对象                        │
//	└──────────────┬──────────────────────────┘
//	               │
//	┌──────────────▼──────────────────────────┐
//	│  事件调度器（Dispatcher）                │
//	│  异步扫描 Outbox，发布到事件总线         │
//	└──────────────┬──────────────────────────┘
//	               │
//	┌──────────────▼──────────────────────────┐
//	│  事件总线（Broker - 可插拔）              │
//	│  memory → Postgres LISTEN/NOTIFY       │
//	│  → Redis Streams → NATS                │
//	└──────────────┬──────────────────────────┘
//	               │
//	┌──────────────▼──────────────────────────┐
//	│  订阅注册表（SubscriptionRegistry）      │
//	│  维护在线订阅到连接集合的映射            │
//	└──────────────┬──────────────────────────┘
//	               │
//	┌──────────────▼──────────────────────────┐
//	│  投递路由（DeliveryRouter）              │
//	│  按 scope 路由到目标订阅连接             │
//	└──────────────┬──────────────────────────┘
//	               │
//	┌──────────────▼──────────────────────────┐
//	│  连接枢纽（ConnectionHub）                │
//	│  SSE/WS 管理、背压、断线重连             │
//	└──────────────────────────────────────────┘
//
// Usage:
//
//	// Initialize event system
//	hub := event.NewConnectionHub(logger)
//	router := event.NewDeliveryRouter(hub, broker, logger)
//	handler := event.NewEventHandler(hub, router, broker, logger)
//
//	// Register routes
//	handler.RegisterRoutes(ginRouter.Group("/api/v1"))
//
//	// Publish events from domain services
//	router.PublishChatMessage(ctx, senderID, recipientID, convID, msgID, content, msgType)
package event

import (
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// EventSystem encapsulates the entire event push infrastructure
type EventSystem struct {
	Hub    *ConnectionHub
	Router *DeliveryRouter
	Broker broker.Broker
	Logger logger.Logger
}

// NewEventSystem creates a complete event system
func NewEventSystem(brk broker.Broker, log logger.Logger) *EventSystem {
	hub := NewConnectionHub(log)
	router := NewDeliveryRouter(hub, brk, log)

	return &EventSystem{
		Hub:    hub,
		Router: router,
		Broker: brk,
		Logger: log,
	}
}

// Global event system instance (set during initialization)
var globalEventSystem *EventSystem

// SetGlobalEventSystem sets the global event system instance
func SetGlobalEventSystem(es *EventSystem) {
	globalEventSystem = es
}

// GetGlobalEventSystem returns the global event system instance
func GetGlobalEventSystem() *EventSystem {
	return globalEventSystem
}

// PublishChatMessage is a convenience function to publish a chat message event
func PublishChatMessage(senderID, recipientID, convID, messageID, content, msgType string) error {
	if globalEventSystem == nil {
		return nil // Event system not initialized, silently ignore
	}
	return globalEventSystem.Router.PublishChatMessage(nil, senderID, recipientID, convID, messageID, content, msgType)
}

// PublishMessageRead is a convenience function to publish a message read event
func PublishMessageRead(readerID, senderID, messageID string) error {
	if globalEventSystem == nil {
		return nil
	}
	return globalEventSystem.Router.PublishMessageRead(nil, readerID, senderID, messageID)
}
