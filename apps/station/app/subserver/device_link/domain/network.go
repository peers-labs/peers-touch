package domain

import (
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

type NetworkBundle struct {
	StationPeerID string
	Root          []byte
	Connections   []*pb.DeviceLinkConnectionCandidate
	Retrieval     *peerpb.PublicEndpointConnectionMaterial
}
