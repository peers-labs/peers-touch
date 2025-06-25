package model

import "time"

type ListPeersResult struct {
	Peers []ConnectionInfo
}

type ConnectionStats struct {
	Direction  string
	Opened     time.Time
	Transient  bool
	Extra      map[string]interface{}
	NumStreams int
	ConnMuxer  string
	Security   string
}

type ConnectionInfoPO struct {
	PeerID       string
	ConnectionID string
	Stats        ConnectionStats
	Latency      int64
}
