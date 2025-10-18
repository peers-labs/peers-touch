package handler

import (
	"log"
	"net/http"
	"time"
)

// Wrapper 中间件包装器类型
type Wrapper func(http.Handler) http.Handler

// GetAuthWrapper 获取认证wrapper
func GetAuthWrapper() Wrapper {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := r.Header.Get("Authorization")
			
			if token == "" {
				http.Error(w, "authorization token required", http.StatusUnauthorized)
				return
			}
			
			// 简单的token验证逻辑
			if !isValidToken(token) {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			
			next.ServeHTTP(w, r)
		})
	}
}

// isValidToken 验证token的辅助函数
func isValidToken(token string) bool {
	// 简单的token验证逻辑
	return len(token) > 10 && token[:7] == "Bearer "
}

// GetLogWrapper 获取日志wrapper
func GetLogWrapper() Wrapper {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			path := r.URL.Path
			method := r.Method
			
			log.Printf("Request started: %s %s", method, path)
			
			// 创建一个ResponseWriter包装器来捕获状态码
			rw := &responseWriter{ResponseWriter: w, statusCode: 200}
			
			next.ServeHTTP(rw, r)
			
			duration := time.Since(start)
			
			log.Printf("Request completed: %s %s %d %v", method, path, rw.statusCode, duration)
		})
	}
}

// responseWriter 包装器用于捕获状态码
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// GetRateLimitWrapper 获取限流wrapper
func GetRateLimitWrapper(limit int, window time.Duration) Wrapper {
	requests := make(map[string][]time.Time)
	
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clientIP := r.RemoteAddr
			now := time.Now()
			
			// 清理过期请求
			if _, exists := requests[clientIP]; exists {
				validRequests := []time.Time{}
				for _, reqTime := range requests[clientIP] {
					if now.Sub(reqTime) <= window {
						validRequests = append(validRequests, reqTime)
					}
				}
				requests[clientIP] = validRequests
			}
			
			// 检查是否超过限制
			if len(requests[clientIP]) >= limit {
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
			
			// 记录当前请求
			requests[clientIP] = append(requests[clientIP], now)
			
			next.ServeHTTP(w, r)
		})
	}
}

// GetCorsWrapper 获取CORS wrapper
func GetCorsWrapper() Wrapper {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			
			next.ServeHTTP(w, r)
		})
	}
}

// GetRecoveryWrapper 获取恢复wrapper
func GetRecoveryWrapper() Wrapper {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					log.Printf("Panic recovered: %v", err)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			
			next.ServeHTTP(w, r)
		})
	}
}

// CombineWrappers 组合多个wrapper
func CombineWrappers(wrappers ...Wrapper) Wrapper {
	return func(next http.Handler) http.Handler {
		for i := len(wrappers) - 1; i >= 0; i-- {
			next = wrappers[i](next)
		}
		return next
	}
}

// GetDefaultWrappers 获取默认wrapper组合
func GetDefaultWrappers() []Wrapper {
	return []Wrapper{
		GetCorsWrapper(),
		GetRecoveryWrapper(),
		GetLogWrapper(),
		GetRateLimitWrapper(100, time.Minute), // 每分钟100次请求限制
	}
}

// GetAuthenticatedWrappers 获取需要认证的wrapper组合
func GetAuthenticatedWrappers() []Wrapper {
	return append(GetDefaultWrappers(), GetAuthWrapper())
}