package infrastructure

import (
	"context"
	"errors"
	"strings"
	"time"

	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	nativerelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

type Network struct {
	Node *bootstrap.SubServer
}

func NewNetwork() (*Network, error) {
	node, ok := server.GetOptions().SubserverInstances["bootstrap"].(*bootstrap.SubServer)
	if !ok {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_BOOTSTRAP_UNSUPPORTED)
	}
	return &Network{Node: node}, nil
}

func (n *Network) SignNetworkMaterial(ctx context.Context, purpose string, raw []byte) ([]byte, *peerpb.StationNodeAuthorization, error) {
	return n.Node.SignNetworkMaterial(ctx, purpose, raw)
}

func (n *Network) Prepare(ctx context.Context, expires time.Time, uses uint32) (*link.NetworkBundle, error) {
	authority, err := n.Node.NetworkAuthorization(ctx)
	if err != nil {
		return nil, err
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(authority, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	bundle := &link.NetworkBundle{StationPeerID: verified.Statement.GetStationPeerId(), Root: authority.GetStationRootPublicKey()}
	direct, directErr := n.Node.PublicConnectionMaterial(ctx, expires)
	if directErr == nil {
		bundle.Connections = append(bundle.Connections, &pb.DeviceLinkConnectionCandidate{
			Material: &pb.DeviceLinkConnectionCandidate_Direct{Direct: direct},
		})
		if strings.HasPrefix(direct.GetCanonicalDiscoveryOrigin(), "https://") {
			bundle.Retrieval = direct
		}
	}
	issuer := nativerelay.ConnectionMaterialIssuerSnapshot()
	if issuer != nil {
		life := time.Until(expires)
		request := nativerelay.ConnectionMaterialRequest{
			RouteLifetime: life, GrantLifetime: life, MaxUses: uses,
		}
		materials, issueErr := issuer.IssueConnectionBundle(ctx, request, 4-len(bundle.Connections))
		if issueErr == nil {
			for _, material := range materials {
				bundle.Connections = append(bundle.Connections, &pb.DeviceLinkConnectionCandidate{
					Material: &pb.DeviceLinkConnectionCandidate_Circuit{Circuit: material.Envelope},
				})
				if material.BootstrapEndpoint != nil && (bundle.Retrieval == nil || bundle.Retrieval == direct) {
					bundle.Retrieval = material.BootstrapEndpoint
				}
			}
		} else if !errors.Is(issueErr, nativerelay.ErrConnectionMaterialUnavailable) {
			return nil, issueErr
		}
	}
	if len(bundle.Connections) == 0 {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_STATION_UNREACHABLE)
	}
	return bundle, nil
}

func (n *Network) Publish(ctx context.Context, request *peerpb.PublishBootstrapBlobRequest) error {
	blob := &peerpb.BootstrapBlobStatement{}
	if err := link.Decode(request.GetStatementBytes(), blob); err != nil {
		return err
	}
	authority, err := n.Node.NetworkAuthorization(ctx)
	if err != nil {
		return err
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(authority, time.Now().UTC())
	if err != nil {
		return err
	}
	if blob.GetRetrievalEndpointIdentity() == verified.Statement.GetStationPeerId() {
		_, err := n.Node.PublishBootstrapBlob(ctx, request)
		return err
	}
	publisher := nativerelay.ConnectionMaterialIssuerSnapshot()
	if publisher == nil {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_BOOTSTRAP_UNSUPPORTED)
	}
	_, err = publisher.PublishBootstrapBlob(ctx, request)
	return err
}
