package relay

import "sync"

type tunnelAdmission struct {
	mu sync.Mutex

	maxGlobal int
	maxSource int
	maxRoute  int

	global  int
	sources map[string]int
	routes  map[string]int
}

func newTunnelAdmission(
	maxGlobal int,
	maxSource int,
	maxRoute int,
) *tunnelAdmission {
	return &tunnelAdmission{
		maxGlobal: maxGlobal,
		maxSource: maxSource,
		maxRoute:  maxRoute,
		sources:   make(map[string]int),
		routes:    make(map[string]int),
	}
}

func (a *tunnelAdmission) acquire(
	source string,
	routeID string,
) (func(), bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.global >= a.maxGlobal ||
		a.sources[source] >= a.maxSource ||
		a.routes[routeID] >= a.maxRoute {
		return nil, false
	}
	a.global++
	a.sources[source]++
	a.routes[routeID]++

	var once sync.Once
	return func() {
		once.Do(func() {
			a.mu.Lock()
			defer a.mu.Unlock()
			a.global--
			a.sources[source]--
			a.routes[routeID]--
			if a.sources[source] == 0 {
				delete(a.sources, source)
			}
			if a.routes[routeID] == 0 {
				delete(a.routes, routeID)
			}
		})
	}, true
}

type tunnelRateLimiter struct {
	mu       sync.Mutex
	limit    int64
	window   int64
	consumed int64
}

func newTunnelRateLimiter(limit int64) *tunnelRateLimiter {
	return &tunnelRateLimiter{limit: limit}
}

func (l *tunnelRateLimiter) allow(nowUnix int64, size int64) bool {
	if size < 0 || l.limit <= 0 {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.window != nowUnix {
		l.window = nowUnix
		l.consumed = 0
	}
	if l.consumed+size > l.limit {
		return false
	}
	l.consumed += size
	return true
}
