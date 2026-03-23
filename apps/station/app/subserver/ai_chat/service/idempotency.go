package service

import (
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"google.golang.org/protobuf/proto"
)

type completionInflightCall struct {
	done chan struct{}
	resp *model.ChatCompletionResponse
	err  error
}

type completionCacheItem struct {
	resp      *model.ChatCompletionResponse
	expiresAt time.Time
}

type completionIdempotencyController struct {
	mu       sync.Mutex
	inflight map[string]*completionInflightCall
	cache    map[string]*completionCacheItem
}

var completionIdempotency = &completionIdempotencyController{
	inflight: make(map[string]*completionInflightCall),
	cache:    make(map[string]*completionCacheItem),
}

func withCompletionIdempotency(key string, run func() (*model.ChatCompletionResponse, error)) (*model.ChatCompletionResponse, error) {
	now := time.Now()

	completionIdempotency.mu.Lock()
	for k, v := range completionIdempotency.cache {
		if now.After(v.expiresAt) {
			delete(completionIdempotency.cache, k)
		}
	}
	if cached, ok := completionIdempotency.cache[key]; ok {
		resp := cloneCompletionResponse(cached.resp)
		completionIdempotency.mu.Unlock()
		return resp, nil
	}
	if call, ok := completionIdempotency.inflight[key]; ok {
		completionIdempotency.mu.Unlock()
		<-call.done
		return cloneCompletionResponse(call.resp), call.err
	}
	call := &completionInflightCall{done: make(chan struct{})}
	completionIdempotency.inflight[key] = call
	completionIdempotency.mu.Unlock()

	resp, err := run()
	call.resp = cloneCompletionResponse(resp)
	call.err = err
	close(call.done)

	completionIdempotency.mu.Lock()
	delete(completionIdempotency.inflight, key)
	if err == nil && resp != nil {
		completionIdempotency.cache[key] = &completionCacheItem{
			resp:      cloneCompletionResponse(resp),
			expiresAt: time.Now().Add(10 * time.Second),
		}
	}
	completionIdempotency.mu.Unlock()

	return resp, err
}

func cloneCompletionResponse(in *model.ChatCompletionResponse) *model.ChatCompletionResponse {
	if in == nil {
		return nil
	}
	cloned := proto.Clone(in)
	if out, ok := cloned.(*model.ChatCompletionResponse); ok {
		return out
	}
	return in
}
