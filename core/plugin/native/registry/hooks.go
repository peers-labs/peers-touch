package native

import (
	"context"

	pb "github.com/libp2p/go-libp2p-kad-dht/pb"
	"github.com/libp2p/go-libp2p/core/network"
)

var (
	dhtRequestHooks []DHTRequestHook
)

type DHTRequestHook = func(ctx context.Context, s network.Stream, req *pb.Message)

// AppendDhtRequestHook is designed to hook wrapper functions onto the stream of peer connections. This hook intercepts
// all incoming requests from any peer to the current node.
//
// CRITICAL USAGE NOTES:
// Do not call any network.Stream methods to modify stream state; control of the stream instance must remain entirely with libp2p.
// Hooks are only permitted to read some metainfo from the request object (req); do not modify any data in either the stream (s) or the request (req).
// Violating these rules may corrupt connection states and potentially disrupt peer communication.
func AppendDhtRequestHook(hook DHTRequestHook) {
	dhtRequestHooks = append(dhtRequestHooks, hook)
}

func dhtRequestHooksWrap(ctx context.Context, s network.Stream, req *pb.Message) {
	for _, hook := range dhtRequestHooks {
		hook(ctx, s, req)
	}
}
