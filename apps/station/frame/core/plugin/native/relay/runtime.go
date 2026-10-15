package relay

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	relayv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	nativeFederation "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"gorm.io/gorm"
)

type Runtime struct {
	config      RuntimeConfig
	manager     *ReservationManager
	control     *StationControl
	admission   *Admission
	host        host.Host
	peerAccess  *nativeFederation.Gater
	attachments *AttachmentController
}

func NewRuntime(config RuntimeConfig, manageReservations bool) (*Runtime, error) {
	runtime := &Runtime{
		config:    config,
		admission: NewAdmission(),
	}
	if manageReservations {
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

// ConfigurePeerAccess binds the Relay lifecycle to the exact ConnectionGater
// installed on the borrowed process Host.
func (r *Runtime) ConfigurePeerAccess(value *nativeFederation.Gater) {
	if r == nil {
		return
	}
	r.peerAccess = value
	for _, target := range r.targets() {
		r.allowPeer(target.RelayPeerID)
	}
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
	pool := r.config.Pool
	pool.Targets = r.manager.Targets()
	control, err := NewStationControl(
		pool,
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

func (r *Runtime) ConfigureAttachmentController(
	ctx context.Context,
	db *gorm.DB,
	stationPeerID string,
	credentialRoot string,
) error {
	if r == nil || r.manager == nil || r.control == nil {
		return ErrAttachmentUnavailable
	}
	if r.attachments != nil {
		return fmt.Errorf("Station Relay attachment controller is already configured")
	}
	controller, err := NewAttachmentController(
		db,
		r,
		stationPeerID,
		credentialRoot,
	)
	if err != nil {
		return err
	}
	if err := controller.Initialize(ctx); err != nil {
		return err
	}
	r.attachments = controller
	RegisterAttachmentService(controller)
	return nil
}

func (r *Runtime) restoreTarget(target Target) error {
	if r == nil || r.manager == nil || r.control == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	if err := r.control.AddTarget(target); err != nil {
		return err
	}
	r.allowPeer(target.RelayPeerID)
	if err := r.manager.AddTarget(target); err != nil {
		r.removePeer(target.RelayPeerID)
		_ = r.control.RemoveTarget(target.RelayPeerID)
		return err
	}
	return nil
}

func (r *Runtime) prepareTarget(
	ctx context.Context,
	target Target,
) (Target, RelayCredentialInfo, error) {
	if r == nil || r.control == nil {
		return Target{}, RelayCredentialInfo{}, fmt.Errorf(
			"Station Relay attachment runtime is unavailable",
		)
	}
	return r.control.PrepareTarget(ctx, target)
}

func (r *Runtime) activatePreparedTarget(target Target) error {
	if r == nil || r.manager == nil || r.control == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	r.allowPeer(target.RelayPeerID)
	if err := r.manager.AddTarget(target); err != nil {
		r.removePeer(target.RelayPeerID)
		return err
	}
	return nil
}

func (r *Runtime) disableTarget(relayPeerID peer.ID) error {
	if r == nil || r.manager == nil || r.control == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	if err := r.manager.RemoveTarget(relayPeerID); err != nil {
		return err
	}
	r.removePeer(relayPeerID)
	return r.control.RemoveTarget(relayPeerID)
}

func (r *Runtime) retireTarget(ctx context.Context, target Target) error {
	if r == nil || r.control == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	return r.control.RetireTarget(ctx, target)
}

func (r *Runtime) forgetTarget(relayPeerID peer.ID) error {
	if r == nil || r.control == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	return r.control.RemoveTarget(relayPeerID)
}

func (r *Runtime) retryTarget(relayPeerID peer.ID) error {
	if r == nil || r.manager == nil {
		return fmt.Errorf("Station Relay attachment runtime is unavailable")
	}
	return r.manager.RetryTarget(relayPeerID)
}

func (r *Runtime) reservationSnapshots() []ReservationSnapshot {
	if r == nil || r.manager == nil {
		return nil
	}
	return r.manager.Snapshots()
}

func (r *Runtime) targets() []Target {
	if r == nil || r.manager == nil {
		return nil
	}
	return r.manager.Targets()
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
	for _, target := range r.targets() {
		r.removePeer(target.RelayPeerID)
	}
	if r.manager != nil {
		closeErrors = append(closeErrors, r.manager.Close())
	}
	if r.control != nil {
		RegisterConnectionMaterialIssuer(nil)
		RegisterAttachmentService(nil)
		nativeFederation.ClearRelayAccess()
		r.control.close()
		r.control = nil
	}
	r.host = nil
	return errors.Join(closeErrors...)
}

func (r *Runtime) allowPeer(value peer.ID) {
	if r != nil && r.peerAccess != nil {
		r.peerAccess.AllowRuntimePeer(value)
	}
}

func (r *Runtime) removePeer(value peer.ID) {
	if r != nil && r.peerAccess != nil {
		r.peerAccess.RemoveRuntimePeer(value)
	}
}

func (r *Runtime) LiveRoutes(now time.Time) []CircuitRoute {
	if r == nil || r.manager == nil {
		return nil
	}
	return r.manager.LiveRoutes(now)
}
