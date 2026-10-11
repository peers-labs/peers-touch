package native

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

var _ transport.Transport = (*libp2pTransport)(nil)

// LibP2pTransport contributes Host construction options and then borrows the
// process-wide P2P Kernel Host. It owns no stream protocol and cannot close the
// Host.
type LibP2pTransport interface {
	transport.Transport
	Host() host.Host
	KernelHostOptions(...option.Option) ([]libp2p.Option, error)
}

type libp2pTransport struct {
	host        host.Host
	opts        *transport.Options
	initialized bool
	lock        sync.Mutex
}

func NewTransport(opts ...option.Option) LibP2pTransport {
	return &libp2pTransport{opts: transport.GetOptions(opts...)}
}

func (t *libp2pTransport) Init(opts ...option.Option) error {
	t.lock.Lock()
	defer t.lock.Unlock()
	if t.initialized {
		return nil
	}
	for _, value := range opts {
		t.opts.Apply(value)
	}
	extended, ok := t.opts.ExtOptions.(*options)
	if !ok || extended.libp2pHost == nil {
		return errors.New("P2P Kernel Host must be injected via WithHost")
	}
	t.host = extended.libp2pHost
	t.initialized = true
	return nil
}

func (t *libp2pTransport) KernelHostOptions(
	opts ...option.Option,
) ([]libp2p.Option, error) {
	for _, value := range opts {
		t.opts.Apply(value)
	}
	libp2pOptions := []libp2p.Option{
		libp2p.EnableNATService(),
		libp2p.EnableHolePunching(),
		libp2p.EnableRelay(),
	}
	if len(t.opts.Addrs) > 0 {
		listenAddrs := make([]multiaddr.Multiaddr, 0, len(t.opts.Addrs))
		for _, raw := range t.opts.Addrs {
			address, err := multiaddr.NewMultiaddr(raw)
			if err != nil {
				return nil, fmt.Errorf("invalid listen address %s: %w", raw, err)
			}
			listenAddrs = append(listenAddrs, address)
		}
		libp2pOptions = append(
			libp2pOptions,
			libp2p.ListenAddrs(listenAddrs...),
		)
	}
	libp2pOptions = append(
		libp2pOptions,
		libp2p.DefaultSecurity,
		libp2p.Ping(true),
	)
	extended, _ := t.opts.ExtOptions.(*options)
	if extended == nil || strings.TrimSpace(extended.libp2pIdentityKeyFile) == "" {
		return nil, errors.New("Node identity key file is required")
	}
	key, err := loadOrGenerateKey(extended.libp2pIdentityKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load Node identity: %w", err)
	}
	libp2pOptions = append(
		libp2pOptions,
		libp2p.Identity(key),
	)
	libp2pOptions = append(
		libp2pOptions,
		federation.LibP2PHostOptions()...,
	)
	return libp2pOptions, nil
}

func (t *libp2pTransport) Options() transport.Options {
	return *t.opts
}

func (t *libp2pTransport) Dial(
	string,
	...transport.DialOption,
) (transport.Client, error) {
	return nil, errors.New(
		"legacy transport-message dialing was removed; use secure canonical HTTP",
	)
}

func (t *libp2pTransport) Listen(
	string,
	...transport.ListenOption,
) (transport.Listener, error) {
	return nil, errors.New(
		"legacy transport-message listening was removed; use secure canonical HTTP ingress",
	)
}

func (t *libp2pTransport) Host() host.Host {
	return t.host
}

func (t *libp2pTransport) String() string {
	return "libp2p"
}

func loadOrGenerateKey(keyFilePath string) (crypto.PrivKey, error) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("get working directory: %w", err)
	}
	absolutePath, err := filepath.Abs(keyFilePath)
	if err != nil {
		return nil, fmt.Errorf("resolve Node identity path: %w", err)
	}
	relativePath, err := filepath.Rel(workingDirectory, absolutePath)
	if err != nil {
		return nil, fmt.Errorf("validate Node identity path: %w", err)
	}
	if filepath.IsAbs(relativePath) ||
		relativePath == ".." ||
		strings.HasPrefix(relativePath, ".."+string(os.PathSeparator)) {
		return nil, errors.New("Node identity path is outside the working directory")
	}
	if data, readErr := os.ReadFile(absolutePath); readErr == nil {
		key, decodeErr := crypto.UnmarshalPrivateKey(data)
		if decodeErr != nil {
			return nil, fmt.Errorf("decode Node identity: %w", decodeErr)
		}
		if key.Type() != crypto.Ed25519 {
			return nil, errors.New("Node identity must use Ed25519")
		}
		return key, nil
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return nil, fmt.Errorf("read Node identity: %w", readErr)
	}
	privateKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate Node identity: %w", err)
	}
	data, err := crypto.MarshalPrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("marshal Node identity: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0700); err != nil {
		return nil, fmt.Errorf("create Node identity directory: %w", err)
	}
	file, err := os.OpenFile(
		absolutePath,
		os.O_WRONLY|os.O_CREATE|os.O_EXCL,
		0600,
	)
	if err != nil {
		return nil, fmt.Errorf("create Node identity: %w", err)
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(absolutePath)
		}
	}()
	if _, err := file.Write(data); err != nil {
		return nil, fmt.Errorf("persist Node identity: %w", err)
	}
	if err := file.Sync(); err != nil {
		return nil, fmt.Errorf("sync Node identity: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close Node identity: %w", err)
	}
	cleanup = false
	return privateKey, nil
}
