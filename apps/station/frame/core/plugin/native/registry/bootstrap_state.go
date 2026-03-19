package native

import (
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type bootstrapNodeState string

const (
	bootstrapActive  bootstrapNodeState = "active"
	bootstrapBackoff bootstrapNodeState = "backoff"
)

type bootstrapNode struct {
	id          peer.ID
	addrs       []multiaddr.Multiaddr
	failCount   int
	lastAttempt time.Time
	nextRetry   time.Time
	state       bootstrapNodeState
}

func (r *nativeRegistry) addBootstrapAddr(addr multiaddr.Multiaddr) {
	pi, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return
	}
	r.bootstrapLock.Lock()
	defer r.bootstrapLock.Unlock()
	if _, ok := r.bootstrapActive[pi.ID]; !ok {
		r.bootstrapActive[pi.ID] = &bootstrapNode{id: pi.ID, addrs: pi.Addrs, state: bootstrapActive}
	} else {
		r.bootstrapActive[pi.ID].addrs = pi.Addrs
	}
}

func (r *nativeRegistry) addBootstrapInfo(pi peer.AddrInfo) {
	r.bootstrapLock.Lock()
	defer r.bootstrapLock.Unlock()
	if _, ok := r.bootstrapActive[pi.ID]; !ok {
		r.bootstrapActive[pi.ID] = &bootstrapNode{id: pi.ID, addrs: pi.Addrs, state: bootstrapActive}
	} else {
		r.bootstrapActive[pi.ID].addrs = pi.Addrs
	}
}

func (r *nativeRegistry) getActiveBootstrapPeers() []peer.AddrInfo {
	r.bootstrapLock.RLock()
	defer r.bootstrapLock.RUnlock()
	var out []peer.AddrInfo
	for _, bn := range r.bootstrapActive {
		out = append(out, peer.AddrInfo{ID: bn.id, Addrs: bn.addrs})
	}
	return out
}

func (r *nativeRegistry) onBootstrapResult(id peer.ID, success bool) {
	r.bootstrapLock.Lock()
	defer r.bootstrapLock.Unlock()
	if bn, ok := r.bootstrapActive[id]; ok {
		bn.lastAttempt = time.Now()
		if success {
			bn.failCount = 0
			return
		}
		bn.failCount++
		if bn.failCount >= r.extOpts.bootstrapNodeRetryTimes {
			bn.state = bootstrapBackoff
			bn.nextRetry = time.Now().Add(10 * time.Minute)
			r.bootstrapBackoff[id] = bn
			delete(r.bootstrapActive, id)
		}
		return
	}
	if bn, ok := r.bootstrapBackoff[id]; ok {
		bn.lastAttempt = time.Now()
		if success {
			bn.failCount = 0
			bn.state = bootstrapActive
			r.bootstrapActive[id] = bn
			delete(r.bootstrapBackoff, id)
			return
		}
		bn.failCount++
		bn.nextRetry = time.Now().Add(10 * time.Minute)
		r.bootstrapBackoff[id] = bn
	}
}

func (r *nativeRegistry) dueBackoffPeers() []peer.AddrInfo {
	r.bootstrapLock.RLock()
	defer r.bootstrapLock.RUnlock()
	var out []peer.AddrInfo
	now := time.Now()
	for _, bn := range r.bootstrapBackoff {
		if !bn.nextRetry.IsZero() && !bn.nextRetry.After(now) {
			out = append(out, peer.AddrInfo{ID: bn.id, Addrs: bn.addrs})
		}
	}
	return out
}
