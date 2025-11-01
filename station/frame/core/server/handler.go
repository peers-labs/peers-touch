package server

import (
	"context"
	"net/http"
)

// HandlerFunc defines a standard http.HandlerFunc type
type HandlerFunc func(w http.ResponseWriter, r *http.Request)

// ContextHandlerFunc defines a context-aware handler function
type ContextHandlerFunc func(ctx context.Context, w http.ResponseWriter, r *http.Request)
