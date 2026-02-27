package handler

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/peers-labs/peers-touch/station/frame/touch/peer"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func HandleSetPeerAddr(ctx context.Context, req *pb.SetPeerAddrRequest) (*pb.SetPeerAddrResponse, error) {
	if len(req.Addresses) == 0 {
		return nil, server.BadRequest("addresses cannot be empty")
	}

	for _, addr := range req.Addresses {
		param := &model.PeerAddressParam{
			Addr: addr,
		}

		if err := param.Check(); err != nil {
			return nil, server.BadRequest("invalid address format: " + err.Error())
		}

		if err := peer.SetPeerAddr(ctx, param); err != nil {
			if errors.Is(err, model.ErrPeerAddrExists) {
				return nil, server.NewHandlerError(409, "peer address already exists")
			}
			return nil, server.InternalErrorWithCause("failed to set peer address", err)
		}
	}

	return &pb.SetPeerAddrResponse{
		Success: true,
	}, nil
}

func HandleGetMyPeerAddr(ctx context.Context, req *pb.GetMyPeerAddrRequest) (*pb.GetMyPeerAddrResponse, error) {
	peerAddrInfo, err := peer.GetMyPeerInfos(ctx)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get peer address information", err)
	}

	addresses := make([]*pb.PeerAddrInfo, 0, len(peerAddrInfo.Addrs))
	for _, addr := range peerAddrInfo.Addrs {
		addresses = append(addresses, &pb.PeerAddrInfo{
			Address:  addr,
			Protocol: "tcp",
			LastSeen: timestamppb.Now(),
		})
	}

	return &pb.GetMyPeerAddrResponse{
		Addresses: addresses,
	}, nil
}

func HandleTouchHi(ctx context.Context, req *pb.TouchHiRequest) (*pb.TouchHiResponse, error) {
	if req.TargetPeerId == "" {
		return nil, server.BadRequest("target_peer_id cannot be empty")
	}

	param := &model.TouchHiToParam{
		PeerAddress: req.TargetPeerId,
	}

	if err := param.Check(); err != nil {
		return nil, server.BadRequest("invalid parameters: " + err.Error())
	}

	sessionID, err := peer.TouchHiTo(ctx, param)
	if err != nil {
		return nil, server.InternalErrorWithCause("connection failed", err)
	}

	return &pb.TouchHiResponse{
		Success:         true,
		ResponseMessage: sessionID,
	}, nil
}
