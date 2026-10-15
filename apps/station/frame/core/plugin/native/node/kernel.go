package native

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

type kernelHostOptionsProvider interface {
	KernelHostOptions(...option.Option) ([]libp2p.Option, error)
}

type kernelDHTProvider interface {
	DHT() *dht.IpfsDHT
}

type kernelComponent interface {
	AttachHost(host.Host) error
	Start(context.Context) error
	Close() error
}

// p2pKernel is the only owner allowed to create and close process-wide
// libp2p resources. Every transport-facing component borrows its Host.
type p2pKernel struct {
	host       host.Host
	dht        *dht.IpfsDHT
	components []kernelComponent

	closeOnce sync.Once
	closeErr  error
}

func newP2PKernel(
	transportComponent transport.Transport,
	additionalHostOptions []libp2p.Option,
	transportOptions ...option.Option,
) (*p2pKernel, error) {
	optionsProvider, ok := transportComponent.(kernelHostOptionsProvider)
	if !ok {
		return nil, fmt.Errorf("P2P kernel requires native transport host options")
	}
	hostOptions, err := optionsProvider.KernelHostOptions(transportOptions...)
	if err != nil {
		return nil, fmt.Errorf("build P2P kernel host options: %w", err)
	}
	hostOptions = append(hostOptions, additionalHostOptions...)
	kernelHost, err := libp2p.New(hostOptions...)
	if err != nil {
		return nil, fmt.Errorf("create P2P kernel Host: %w", err)
	}
	return &p2pKernel{host: kernelHost}, nil
}

func (k *p2pKernel) AttachDHT(registryComponent registry.Registry) error {
	dhtProvider, ok := registryComponent.(kernelDHTProvider)
	if !ok || dhtProvider.DHT() == nil {
		return fmt.Errorf("P2P kernel requires the native registry DHT")
	}
	k.dht = dhtProvider.DHT()
	return nil
}

func (k *p2pKernel) AttachComponent(component kernelComponent) error {
	if k == nil || k.host == nil || component == nil {
		return fmt.Errorf("P2P kernel component requires a live Host")
	}
	if err := component.AttachHost(k.host); err != nil {
		return err
	}
	k.components = append(k.components, component)
	return nil
}

func (k *p2pKernel) Start(ctx context.Context) error {
	if k == nil {
		return nil
	}
	for _, component := range k.components {
		if err := component.Start(ctx); err != nil {
			return fmt.Errorf("start P2P kernel component: %w", err)
		}
	}
	return nil
}

func (k *p2pKernel) Host() host.Host {
	if k == nil {
		return nil
	}
	return k.host
}

func (k *p2pKernel) DHT() *dht.IpfsDHT {
	if k == nil {
		return nil
	}
	return k.dht
}

func (k *p2pKernel) Close() error {
	if k == nil {
		return nil
	}
	k.closeOnce.Do(func() {
		var closeErrors []error
		for index := len(k.components) - 1; index >= 0; index-- {
			if err := k.components[index].Close(); err != nil {
				closeErrors = append(
					closeErrors,
					fmt.Errorf("close P2P kernel component: %w", err),
				)
			}
		}
		if k.dht != nil {
			if err := k.dht.Close(); err != nil {
				closeErrors = append(
					closeErrors,
					fmt.Errorf("close P2P kernel DHT: %w", err),
				)
			}
		}
		if k.host != nil {
			if err := k.host.Close(); err != nil {
				closeErrors = append(
					closeErrors,
					fmt.Errorf("close P2P kernel Host: %w", err),
				)
			}
		}
		k.closeErr = errors.Join(closeErrors...)
	})
	return k.closeErr
}
