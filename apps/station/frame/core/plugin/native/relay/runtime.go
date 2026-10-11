package relay

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	relayv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	nativeFederation "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
)

type Runtime struct {
	config    RuntimeConfig
	manager   *ReservationManager
	control   *StationControl
	admission *Admission
	host      host.Host
}

func NewRuntime(config RuntimeConfig, manageReservations bool) (*Runtime, error) {
	runtime := &Runtime{
		config:    config,
		admission: NewAdmission(),
	}
	if manageReservations && config.Pool.Mode != PoolModeOff {
		manager, err := NewReservationManager(config.Pool)
		if err != nil {
			return nil, err
		}
		runtime.manager = manager
	}
	return runtime, nil
}

func (r *Runtime) LibP2POptions(enableService bool) []libp2p.Option {
	if r == nil || !enableService {
		return nil
	}
	resources := r.config.Resources
	return []libp2p.Option{
		libp2p.ForceReachabilityPublic(),
		libp2p.EnableRelayService(
			relayv2.WithResources(relayv2.Resources{
				Limit: &relayv2.RelayLimit{
					Duration: resources.MaxCircuitDuration,
					Data:     resources.MaxBytesPerDirection,
				},
				ReservationTTL:         resources.ReservationTTL,
				MaxReservations:        resources.MaxReservations,
				MaxCircuits:            resources.MaxCircuitsPerPeer,
				BufferSize:             resources.BufferSize,
				MaxReservationsPerPeer: 1,
				MaxReservationsPerIP:   resources.MaxReservationsPerIP,
				MaxReservationsPerASN:  resources.MaxReservationsPerASN,
			}),
			relayv2.WithACL(r.admission),
		),
	}
}

func (r *Runtime) AttachHost(value host.Host) error {
	if r == nil || value == nil {
		return fmt.Errorf("Relay runtime requires a P2P Kernel Host")
	}
	if r.host != nil {
		return fmt.Errorf("Relay runtime already has a Host")
	}
	r.host = value
	if err := r.admission.AttachHost(value); err != nil {
		r.host = nil
		return err
	}
	if r.manager != nil {
		if err := r.manager.AttachHost(value); err != nil {
			r.host = nil
			return err
		}
	}
	return nil
}

func (r *Runtime) Admission() *Admission {
	if r == nil {
		return nil
	}
	return r.admission
}

func (r *Runtime) ConfigureStationControl(
	signer StationControlSigner,
	innerSPKI [sha256.Size]byte,
) error {
	if r == nil || r.manager == nil {
		return nil
	}
	if r.control != nil {
		return fmt.Errorf("Station Relay control is already configured")
	}
	control, err := NewStationControl(
		r.config.Pool,
		r.host,
		signer,
		innerSPKI,
		r.manager.LiveRoutes,
	)
	if err != nil {
		return err
	}
	if err := r.manager.SetControl(control.Authorize, control.Publish); err != nil {
		return err
	}
	r.control = control
	RegisterConnectionMaterialIssuer(r)
	nativeFederation.RegisterRelayAccess(r)
	return nil
}

func (r *Runtime) IssueConnectionMaterial(
	ctx context.Context,
	request ConnectionMaterialRequest,
) (*ConnectionMaterial, error) {
	if r == nil || r.control == nil {
		return nil, ErrConnectionMaterialUnavailable
	}
	return r.control.IssueConnectionMaterial(ctx, request)
}

func (r *Runtime) Start(ctx context.Context) error {
	if r == nil || r.manager == nil {
		return nil
	}
	return r.manager.Start(ctx)
}

func (r *Runtime) Close() error {
	if r == nil {
		return nil
	}
	var closeErrors []error
	if r.manager != nil {
		closeErrors = append(closeErrors, r.manager.Close())
	}
	if r.control != nil {
		RegisterConnectionMaterialIssuer(nil)
		nativeFederation.ClearRelayAccess()
		r.control = nil
	}
	r.host = nil
	return errors.Join(closeErrors...)
}

func (r *Runtime) LiveRoutes(now time.Time) []CircuitRoute {
	if r == nil || r.manager == nil {
		return nil
	}
	return r.manager.LiveRoutes(now)
}
