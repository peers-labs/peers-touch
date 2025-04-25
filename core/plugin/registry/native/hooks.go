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

func AppendDhtRequestHook(hook DHTRequestHook) {
	dhtRequestHooks = append(dhtRequestHooks, hook)
}

func dhtRequestHooksWrap(ctx context.Context, s network.Stream, req *pb.Message) {
	for _, hook := range dhtRequestHooks {
		hook(ctx, s, req)
	}
}
