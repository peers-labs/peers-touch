package bootstrap

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin/subserver/bootstrap/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch"
	pm "github.com/dirty-bro-tech/peers-touch-go/touch/model"
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
			Latency: latency.Microseconds(),
		})
	}

	page := pm.PageData[model.ConnectionInfoPO]{
		Total: len(results),
		List:  results,
		Num:   1,
	}

	touch.SuccessResponse(ctx, "query peers infos success", page)
}
