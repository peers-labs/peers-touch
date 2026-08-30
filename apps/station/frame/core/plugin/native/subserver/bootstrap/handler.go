package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	multiaddr "github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap/model"
	"github.com/peers-labs/peers-touch/station/frame/touch"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	resolverpkg "github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
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

// connectPeer establishes a libp2p connection to a peer for operational
// testing of the federation-direct gater. The endpoint accepts the address
// in either of two forms:
//
//   - ?multiaddr=/ip4/.../tcp/.../p2p/<peer-id>
//     The dial uses the supplied multiaddr verbatim. Useful in test rigs
//     where peers are known a priori and DHT publishing isn't wired up.
//   - ?peer_id=<base58 peer id>
//     The local DHT is queried for the peer's address record. This path
//     only works when the target has actively announced itself into the
//     DHT (Provide / PutValue) — which is currently a future-work item.
//
// In both modes the host.Connect failure path is the test signal: with the
// gater installed, dialing a non-seed peer surfaces as a "blocked or failed"
// error, while permissive stations succeed and open a direct libp2p session.
//
// Query: (peer_id | multiaddr)[&timeout=10s]
func (s *SubServer) connectPeer(c context.Context, ctx *app.RequestContext) {
	timeout := 10 * time.Second
	if t := ctx.Query("timeout"); t != "" {
		if d, perr := time.ParseDuration(t); perr == nil && d > 0 {
			timeout = d
		}
	}

	addrStr := ctx.Query("multiaddr")
	peerIDStr := ctx.Query("peer_id")
	if addrStr == "" && peerIDStr == "" {
		touch.FailedResponse(c, ctx, fmt.Errorf("either multiaddr or peer_id parameter is required"))
		return
	}

	var info peer.AddrInfo
	if addrStr != "" {
		m, err := multiaddr.NewMultiaddr(addrStr)
		if err != nil {
			touch.FailedResponse(c, ctx, fmt.Errorf("invalid multiaddr: %s", err))
			return
		}
		ai, err := peer.AddrInfoFromP2pAddr(m)
		if err != nil {
			touch.FailedResponse(c, ctx, fmt.Errorf("multiaddr missing /p2p component: %s", err))
			return
		}
		info = *ai
	} else {
		pid, err := peer.Decode(peerIDStr)
		if err != nil {
			touch.FailedResponse(c, ctx, fmt.Errorf("invalid peer ID format: %s", err))
			return
		}
		findCtx, cancel := context.WithTimeout(c, timeout)
		defer cancel()
		ai, err := s.dht.FindPeer(findCtx, pid)
		if err != nil {
			touch.FailedResponse(c, ctx, fmt.Errorf("dht find_peer failed: %s", err))
			return
		}
		info = ai
	}

	dialCtx, dialCancel := context.WithTimeout(c, timeout)
	defer dialCancel()
	if err := s.host.Connect(dialCtx, info); err != nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("host connect blocked or failed: %s", err))
		return
	}

	// host.Connect can return success even when the remote side immediately
	// closed the connection after rejecting it via its ConnectionGater
	// (the secure handshake completed before the rejection arrived). We
	// short-poll Connectedness for a second to expose those phantom dials
	// as "rejected by remote gater" rather than mis-reporting them as OK.
	deadline := time.Now().Add(time.Second)
	connected := false
	for time.Now().Before(deadline) {
		if s.host.Network().Connectedness(info.ID) == network.Connected {
			connected = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !connected {
		touch.FailedResponse(c, ctx, fmt.Errorf("connection closed by remote (likely rejected by remote gater)"))
		return
	}

	addrs := make([]string, 0, len(info.Addrs))
	for _, a := range info.Addrs {
		addrs = append(addrs, a.String())
	}
	touch.SuccessResponse(c, ctx, "connected", map[string]interface{}{
		"peer_id":   info.ID.String(),
		"addresses": addrs,
	})
}

// locatorLookup resolves a federated handle through the federation DHT and
// returns the verified ActorLocatorRecord — or the precise verification
// error so an operator can distinguish "not found", "stale", "signature
// invalid", and "handle mismatch". Used by the cross-station verification
// matrix and intended as the on-station debugging tool until the resolver
// layer (Phase C) lands.
//
// Query: handle=user@host (or @user@host)
func (s *SubServer) locatorLookup(c context.Context, ctx *app.RequestContext) {
	handle := ctx.Query("handle")
	if handle == "" {
		touch.FailedResponse(c, ctx, fmt.Errorf("handle parameter is required"))
		return
	}

	timeout := 15 * time.Second
	if t := ctx.Query("timeout"); t != "" {
		if d, perr := time.ParseDuration(t); perr == nil && d > 0 {
			timeout = d
		}
	}

	queryCtx, cancel := context.WithTimeout(c, timeout)
	defer cancel()

	lookup := locator.NewLookup(locator.LookupConfig{})
	rec, err := lookup.GetByHandle(queryCtx, handle)
	if err != nil {
		if errors.Is(err, locator.ErrNotFound) {
			ctx.JSON(http.StatusNotFound, map[string]interface{}{
				"handle": handle,
				"error":  "not_found",
			})
			return
		}
		touch.FailedResponse(c, ctx, fmt.Errorf("locator lookup: %s", err))
		return
	}

	canon, _ := locator.CanonicalHandle(handle)
	dhtKey, _ := locator.DHTKey(canon)

	touch.SuccessResponse(c, ctx, "locator record verified", map[string]interface{}{
		"dht_key":              dhtKey,
		"federated_handle":     rec.GetFederatedHandle(),
		"home_station_peer_id": rec.GetHomeStationPeerId(),
		"home_station_domain":  rec.GetHomeStationDomain(),
		"inbox_relay_mounts":   rec.GetInboxRelayMounts(),
		"tombstone":            rec.GetTombstone(),
		"seq":                  rec.GetSeq(),
		"updated_at_unix_ms":   rec.GetUpdatedAtUnixMs(),
		"signing_key_kid":      rec.GetSigningKeyKid(),
	})
}

// locatorPublish (re-)publishes a local actor's locator record. Used for
// verification and for backfilling rows whose initial publish failed (e.g.
// SignUp ran before bootstrap.Init completed identity registration).
//
// Form / Query: actor_ptid=<ptid>
func (s *SubServer) locatorPublish(c context.Context, ctx *app.RequestContext) {
	ptid := strings.TrimSpace(ctx.Query("actor_ptid"))
	if ptid == "" {
		ptid = strings.TrimSpace(string(ctx.FormValue("actor_ptid")))
	}
	if ptid == "" {
		touch.FailedResponse(c, ctx, fmt.Errorf("actor_ptid parameter is required"))
		return
	}
	actorRecord, err := actor.GetActorByPTID(c, ptid)
	if err != nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("resolve actor_ptid: %w", err))
		return
	}
	if actorRecord == nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("actor_ptid not found: %s", ptid))
		return
	}

	pubCtx, cancel := context.WithTimeout(c, 30*time.Second)
	defer cancel()
	if err := actor.PublishVisibility(pubCtx, actorRecord.ID); err != nil {
		touch.FailedResponse(c, ctx, fmt.Errorf("publish: %s", err))
		return
	}
	touch.SuccessResponse(c, ctx, "locator publish triggered", map[string]interface{}{
		"actor_ptid": ptid,
	})
}

// federationResolve is the Phase C diagnostic that exercises the full
// federated user-discovery read path: locator DHT lookup → home-station
// /actor/federation/profile fetch via /relay/forward → signature
// verification against the locator's pinned key.
//
// Query: handle=user@host  (or @user@host)
// Returns: the verified ActorProfileEnvelope plus a is_local flag and
// the locator metadata that authenticated it.
func (s *SubServer) federationResolve(c context.Context, ctx *app.RequestContext) {
	handle := ctx.Query("handle")
	if handle == "" {
		touch.FailedResponse(c, ctx, fmt.Errorf("handle parameter is required"))
		return
	}

	timeout := 30 * time.Second
	if t := ctx.Query("timeout"); t != "" {
		if d, perr := time.ParseDuration(t); perr == nil && d > 0 {
			timeout = d
		}
	}

	resolveCtx, cancel := context.WithTimeout(c, timeout)
	defer cancel()

	res, err := resolverpkg.New(resolverpkg.Config{}).ResolveByHandle(
		resolveCtx,
		handle,
		actor.FederationProfileFetcher(""),
		actor.FederationKeyCache(),
	)
	if err != nil {
		if errors.Is(err, resolverpkg.ErrTombstoned) {
			ctx.JSON(http.StatusGone, map[string]interface{}{
				"handle": handle,
				"error":  "tombstoned",
			})
			return
		}
		touch.FailedResponse(c, ctx, fmt.Errorf("resolve: %s", err))
		return
	}

	env := res.Envelope
	touch.SuccessResponse(c, ctx, "federation resolve verified", map[string]interface{}{
		"handle":               env.GetFederatedHandle(),
		"is_local":             res.IsLocal,
		"home_station_peer_id": env.GetHomeStationPeerId(),
		"home_station_domain":  env.GetHomeStationDomain(),
		"profile": map[string]interface{}{
			"display_name": env.GetProfile().GetDisplayName(),
			"username":     env.GetProfile().GetUsername(),
			"acct":         env.GetProfile().GetAcct(),
			"avatar":       env.GetProfile().GetAvatar(),
			"note":         env.GetProfile().GetNote(),
			"url":          env.GetProfile().GetUrl(),
		},
		"issued_at_unix_ms":  env.GetIssuedAtUnixMs(),
		"expires_at_unix_ms": env.GetExpiresAtUnixMs(),
		"signing_key_kid":    env.GetSigningKeyKid(),
		"locator_seq":        res.Locator.GetSeq(),
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
