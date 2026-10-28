package relay

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

var (
	ErrConnectionMaterialUnavailable = errors.New(
		"Relay connection material is unavailable",
	)
	ErrInvalidConnectionMaterialRequest = errors.New(
		"Relay connection material request is invalid",
	)
)

type ConnectionMaterialRequest struct {
	RelayPeerID   peer.ID
	RouteID       string
	RouteLifetime time.Duration
	GrantLifetime time.Duration
	MaxUses       uint32
}

type ConnectionMaterial struct {
	Code              string
	DeepLink          string
	ExpiresAt         time.Time
	Envelope          *peerpb.StationConnectionEnvelope
	BootstrapEndpoint *peerpb.PublicEndpointConnectionMaterial
}

type ConnectionMaterialIssuer interface {
	IssueConnectionMaterial(
		context.Context,
		ConnectionMaterialRequest,
	) (*ConnectionMaterial, error)
	IssueConnectionBundle(context.Context, ConnectionMaterialRequest, int) ([]*ConnectionMaterial, error)
	PublishBootstrapBlob(context.Context, *peerpb.PublishBootstrapBlobRequest) (*peerpb.PublishBootstrapBlobResponse, error)
}

type issuerHolder struct {
	issuer ConnectionMaterialIssuer
}

var activeIssuer atomic.Value

func RegisterConnectionMaterialIssuer(issuer ConnectionMaterialIssuer) {
	if issuer == nil {
		activeIssuer.Store(issuerHolder{})
		return
	}
	activeIssuer.Store(issuerHolder{issuer: issuer})
}

func ConnectionMaterialIssuerSnapshot() ConnectionMaterialIssuer {
	value := activeIssuer.Load()
	if value == nil {
		return nil
	}
	holder, ok := value.(issuerHolder)
	if !ok {
		return nil
	}
	return holder.issuer
}
