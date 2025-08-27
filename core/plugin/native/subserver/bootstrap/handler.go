package bootstrap

import (
	"context"
	"fmt"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/subserver/bootstrap/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch"
	pm "github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/libp2p/go-libp2p/core/peer"
)

// listPeerInfos processes the HTTP request and returns peer info
func (s *SubServer) listPeerInfos(c context.Context, ctx *app.RequestContext) {
	peers := s.host.Network().Peers()
	var results []model.ConnectionInfoPO

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

		results = append(results, model.ConnectionInfoPO{
			PeerID:       p.String(),
			ConnectionID: conn.ID(),
			Stats: model.ConnectionStats{
				Direction:  conn.Stat().Direction.String(),
				Opened:     conn.Stat().Opened,
				NumStreams: conn.Stat().NumStreams,
			},
			Addrs:   addrStrs,
			Latency: latency.Microseconds(),
		})
	}

	page := pm.PageData[model.ConnectionInfoPO]{
		Total: len(results),
		List:  results,
		No:    1,
	}

	touch.SuccessResponse(ctx, "query peers infos success", page)
}

func (s *SubServer) queryDHTPeer(c context.Context, ctx *app.RequestContext) {
	peerIDStr := ctx.Query("peer_id")
	if peerIDStr == "" {
		touch.FailedResponse(ctx, fmt.Errorf("peer_id parameter is required"))
		return
	}

	pid, err := peer.Decode(peerIDStr)
	if err != nil {
		touch.FailedResponse(ctx, fmt.Errorf("invalid peer ID format: %s", err))
		return
	}

	// Query DHT for peer information
	peerInfo, err := s.dht.FindPeer(c, pid)
	if err != nil {
		touch.FailedResponse(ctx, fmt.Errorf("failed to find peer in DHT: %s", err))
		return
	}

	// Convert multiaddresses to strings
	var addrs []string
	for _, addr := range peerInfo.Addrs {
		addrs = append(addrs, addr.String())
	}

	touch.SuccessResponse(ctx, "DHT peer query successful", map[string]interface{}{
		"peer_id":   peerInfo.ID.String(),
		"addresses": addrs,
	})
}
