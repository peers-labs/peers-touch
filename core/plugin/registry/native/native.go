package native

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

var (
	// keep be a singleton
	regInstance registry.Registry
	regOnce     sync.RWMutex

	networkNamespace = "/" + registry.DefaultPeersNetworkNamespace
)

type bootstrapState struct {
	Connected bool
	UpdatedAt time.Time
	Logs      []string
}

// native registry is based on telibp2p kad-dht
// it works as a peer discovery service which serves entrance for peers to find each other
type nativeRegistry struct {
	options *registry.Options
	// for convenience
	extOpts *options

	peers map[string]*registry.Peer
	mu    sync.RWMutex

	host host.Host
	dht  *dht.IpfsDHT

	// bootstrap nodes status
	bootstrapStateLock   sync.RWMutex
	bootstrapNodesStatus map[string]*bootstrapState
}

func NewRegistry(opts ...option.Option) registry.Registry {
	regOnce.Lock()
	defer regOnce.Unlock()

	if regInstance != nil {
		return regInstance
	}

	regInstance = &nativeRegistry{
		peers:                make(map[string]*registry.Peer),
		options:              registry.GetPluginRegions(opts...),
		bootstrapNodesStatus: make(map[string]*bootstrapState),
	}

	return regInstance
}

func (r *nativeRegistry) Init(ctx context.Context, opts ...option.Option) error {
	r.options.Apply(opts...)
	r.extOpts = r.options.ExtOptions.(*options)

	if r.options.PrivateKey == "" {
		return errors.New("private key for Registry is required")
	}

	// Initialize libp2p host
	h, err := libp2p.New()
	if err != nil {
		return err
	}
	r.host = h

	// Create DHT instance in server mode
	r.dht, err = dht.New(ctx, h, dht.Mode(r.extOpts.runMode))
	if err != nil {
		return err
	}

	// merge bootstrap nodes
	bootstrapNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)
	// Bootstrap the DHT
	go r.bootstrap(ctx, bootstrapNodes)

	// todo init relay nodes

	return nil
}

func (r *nativeRegistry) Options() registry.Options {
	return *r.options
}

func (r *nativeRegistry) Register(ctx context.Context, peerReg *registry.Peer, opts ...registry.RegisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peerReg == nil {
		return errors.New("peerReg cannot be nil")
	}

	// Add security metadata
	peerReg.Version = "1.0"
	peerReg.Timestamp = time.Now()

	// Sign the payload
	dataToSign, err := json.Marshal(struct {
		Name      string
		Version   string
		Timestamp time.Time
	}{
		Name:      peerReg.Name,
		Version:   peerReg.Version,
		Timestamp: peerReg.Timestamp,
	})

	// Sign the payload using your service's private key
	signData, err := r.signPayload(r.options.PrivateKey, dataToSign) // Implement signing logic
	if err != nil {
		return fmt.Errorf("native Registry failed to sign payload: %w", err)
	}
	peerReg.Signature = signData

	// Serialize peerReg data
	data, err := json.Marshal(peerReg)
	if err != nil {
		return fmt.Errorf("marshal peerReg: %w", err)
	}

	// Store in DHT with 5min TTL
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := fmt.Sprintf("/%s/%s", networkNamespace, peerReg.Name)
	err = r.dht.PutValue(ctx, key, data)
	if err != nil {
		err = fmt.Errorf("failed to put value to dht: %w", err)
		logger.Errorf(ctx, "%s", err)
		return err
	}

	return nil
}

// Deregister removes a peer from the registry
// but DHT doesn't support delete operation, so we just remove it from the map
func (r *nativeRegistry) Deregister(ctx context.Context, peer *registry.Peer, opts ...registry.DeregisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peer == nil {
		return errors.New("peer cannot be nil")
	}

	// Remove from local cache
	delete(r.peers, peer.Name)

	// Remove from DHT network
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := fmt.Sprintf("%s/%s", networkNamespace, peer.Name)
	// Set empty value with short TTL
	return r.dht.PutValue(ctx, key, []byte{})
}

func (r *nativeRegistry) GetPeer(ctx context.Context, name string, opts ...registry.GetOption) ([]*registry.Peer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	key := fmt.Sprintf("%s/%s", networkNamespace, name)
	data, err := r.dht.GetValue(ctx, key)
	if err != nil {
		return nil, err
	}

	var p registry.Peer
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return []*registry.Peer{&p}, nil
}

func (r *nativeRegistry) Watch(ctx context.Context, opts ...registry.WatchOption) (registry.Watcher, error) {
	// Implement DHT-based watch functionality
	return nil, errors.New("not implemented")
}

func (r *nativeRegistry) String() string {
	return "libp2p-registry"
}

func (r *nativeRegistry) bootstrap(ctx context.Context, bootstraps []multiaddr.Multiaddr) {
	for {
		select {
		case <-time.After(r.extOpts.bootstrapRefreshInterval):
			wg := sync.WaitGroup{}
			// Connect to public bootstrap nodes
			for _, addr := range bootstraps {
				wg.Add(1)
				go func(addr multiaddr.Multiaddr) {
					defer wg.Done()

					ctxTimout, cancel := context.WithTimeout(ctx, r.options.ConnectTimeout)
					defer cancel()

					pi, _ := peer.AddrInfoFromP2pAddr(addr)
					if err := r.host.Connect(ctxTimout, *pi); err != nil {
						logger.Errorf(ctx, "failed to connect to public bootstrap node %s: %v", addr, err)
						r.updateBootstrapStatus(ctx, addr.String(), false)
						return // ignore error
					}

					logger.Infof(ctx, "successfully connected to public bootstrap node %s", addr)

				}(addr)
			}
			wg.Wait()

			if err := r.dht.Bootstrap(ctx); err != nil {
				logger.Errorf(ctx, "failed to bootstrap peers: %v", err)
			}
		case <-ctx.Done():
			logger.Warnf(ctx, "bootstrap stopped %+v", ctx.Err())
			return
		}
	}
}

func (r *nativeRegistry) updateBootstrapStatus(ctx context.Context, addr string, successful bool) {
	r.bootstrapStateLock.Lock()
	defer r.bootstrapStateLock.Unlock()

	t := time.Now()
	log := fmt.Sprintf("%+v:%t", t, successful)
	if status, ok := r.bootstrapNodesStatus[addr]; !ok {
		r.bootstrapNodesStatus[addr] = &bootstrapState{
			Connected: successful,
			UpdatedAt: t,
			Logs:      []string{log},
		}
	} else {
		status.Connected = successful
		status.UpdatedAt = t
		if len(status.Logs) == 10 {
			// remove the first element, we only keep the last 10 logs
			status.Logs = status.Logs[1:]
		}

		status.Logs = append(status.Logs, log)
	}

	return
}

// Add this new method
func (r *nativeRegistry) signPayload(privateKey string, data []byte) ([]byte, error) {
	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		return nil, errors.New("failed to parse PEM block")
	}

	priv, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	hashed := sha256.Sum256(data)
	return rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
}
