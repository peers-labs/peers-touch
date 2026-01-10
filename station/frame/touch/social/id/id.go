package id

import (
	"sync"
	"time"
)

var (
	generator *Generator
	once      sync.Once
)

type Generator struct {
	mu       sync.Mutex
	lastTime int64
	sequence uint64
}

func Init() {
	once.Do(func() {
		generator = &Generator{}
	})
}

func Next() uint64 {
	if generator == nil {
		Init()
	}
	return generator.Next()
}

func (g *Generator) Next() uint64 {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now().UnixMilli()
	if now == g.lastTime {
		g.sequence++
	} else {
		g.sequence = 0
		g.lastTime = now
	}

	return uint64(now<<12) | (g.sequence & 0xFFF)
}
