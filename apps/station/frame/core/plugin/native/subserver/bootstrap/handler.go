package bootstrap

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap/model"
	"github.com/peers-labs/peers-touch/station/frame/touch"
	pm "github.com/peers-labs/peers-touch/station/frame/touch/model"
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

	touch.SuccessResponse(c, ctx, "query peers infos success", page)
}

// queryDHTPeer queries DHT for a peer by ID and returns its addresses.
func (s *SubServer) queryDHTPeer(c context.Context, ctx *app.RequestContext) {
	peerIDStr := ctx.Query("peer_id")
	if peerIDStr == "" {
		touch.FailedResponse(c, ctx, fmt.Errorf("peer_id parameter is required"))

		return
	}

	pid, err := peer.Decode(peerIDStr)
	if err != nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("invalid peer ID format: %s", err))

		return
	}

	// Query DHT for peer information
	peerInfo, err := s.dht.FindPeer(c, pid)
	if err != nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("failed to find peer in DHT: %s", err))

		return
	}

	// Convert multiaddresses to strings
	var addrs []string
	for _, addr := range peerInfo.Addrs {
		addrs = append(addrs, addr.String())
	}

	touch.SuccessResponse(c, ctx, "DHT peer query successful", map[string]interface{}{
		"peer_id":   peerInfo.ID.String(),
		"addresses": addrs,
	})
}

// info returns the bootstrap server basic information for testing
// Response:
//
//	{
//	  "peer_id": "12D3Koo...",
//	  "listen_addrs_raw": ["/ip4/127.0.0.1/tcp/4001"],
//	  "dial_addrs": ["/ip4/127.0.0.1/tcp/4001/p2p/12D3Koo..."],
//	  "mdns_enabled": true,
//	  "dht_mode": "server"
//	}
//
// info returns server basic information (peer ID and listen addresses).
func (s *SubServer) info(_ context.Context, ctx *app.RequestContext) {
	// Collect raw listen addresses
	var rawAddrs []string
	for _, a := range s.host.Addrs() {
		rawAddrs = append(rawAddrs, a.String())
	}

	// Use cached dial addrs if available, otherwise derive on the fly
	var dialAddrs []string
	if len(s.addrs) > 0 {
		dialAddrs = s.addrs
	} else {
		p2pAddrs, _ := peer.AddrInfoToP2pAddrs(&peer.AddrInfo{ID: s.host.ID(), Addrs: s.host.Addrs()})
		for _, a := range p2pAddrs {
			dialAddrs = append(dialAddrs, a.String())
		}
	}

	ctx.JSON(http.StatusOK, map[string]interface{}{
		"peer_id":          s.host.ID().String(),
		"listen_addrs_raw": rawAddrs,
		"dial_addrs":       dialAddrs,
		"mdns_enabled":     s.opts.EnableMDNS,
		"dht_mode":         "server",
	})
}
