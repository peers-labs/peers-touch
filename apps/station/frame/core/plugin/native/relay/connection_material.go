package relay

import (
	"context"
	"errors"
	"sync/atomic"
	"time"
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
	RouteID       string
	RouteLifetime time.Duration
	GrantLifetime time.Duration
	MaxUses       uint32
}

type ConnectionMaterial struct {
	Code      string
	DeepLink  string
	ExpiresAt time.Time
}

type ConnectionMaterialIssuer interface {
	IssueConnectionMaterial(
		context.Context,
		ConnectionMaterialRequest,
	) (*ConnectionMaterial, error)
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
