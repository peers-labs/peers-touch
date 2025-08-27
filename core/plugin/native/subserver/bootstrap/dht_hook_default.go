package bootstrap

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	pb "github.com/libp2p/go-libp2p-kad-dht/pb"
	"github.com/libp2p/go-libp2p/core/network"
)

func init() {
	AppendDhtRequestHook(handleDHTSetValue)
}

func handleDHTSetValue(ctx context.Context, s network.Stream, req *pb.Message) {
	id := s.ID()
	record := req.GetRecord()
	var v []byte
	if record != nil {
		v = record.Value
	}
	logger.Debugf(ctx, "Successfully stored value for key: %s (size: %d bytes)",
		id, len(v))
}
