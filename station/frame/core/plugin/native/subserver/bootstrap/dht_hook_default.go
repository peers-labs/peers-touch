package bootstrap

import (
	"context"

	pb "github.com/libp2p/go-libp2p-kad-dht/pb"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
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
