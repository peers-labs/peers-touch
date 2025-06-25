package bootstrap

import (
	"encoding/json"
	"net/http"
)

// listPeerInfos processes the HTTP request and returns peer info
func (s *SubServer) listPeerInfos(w http.ResponseWriter, r *http.Request) {
	peers := s.host.Network().Peers()
	results := make([]ConnectionInfo, 0, len(peers))

	for _, p := range peers {
		// Get peer addresses from peerStore
		addrs := s.host.Peerstore().Addrs(p)
		addrStrs := make([]string, len(addrs))
		for i, addr := range addrs {
			addrStrs[i] = addr.String()
		}

		// Get connection details
		conns := s.host.Network().ConnsToPeer(p)
		if len(conns) == 0 {
			continue
		}
		conn := conns[0]
		latency := s.host.Peerstore().LatencyEWMA(p)

		results = append(results, ConnectionInfo{
			PeerID:       p.String(),
			ConnectionID: conn.ID(),
			Stats:        conn.Stat(),
			Latency:      latency,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"count": len(results),
		"peers": results,
	})
}
