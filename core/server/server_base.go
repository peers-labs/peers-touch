package server

import (
	"sync"
)

// BaseServer is the base server for all servers.
// It helps to run the common logic for all servers, including start/stop server,
// key-loading, sub-servers, wrapper loading, etc.
type BaseServer struct {
	subServers map[string]SubServer
	subMutex   sync.RWMutex
}
