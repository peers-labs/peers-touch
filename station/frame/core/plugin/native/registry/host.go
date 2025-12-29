package native

import (
	"context"
	"fmt"
	"net"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// GetHost returns the underlying libp2p host.
func (r *nativeRegistry) GetHost() host.Host {
	return r.host
}

func (r *nativeRegistry) addListenAddr(ctx context.Context, addr string, protocol string) error {
	var ma string
	h, port, err := net.SplitHostPort(addr)
	if err == nil {
		ip := net.ParseIP(h)
		if ip.To4() != nil {
			ma = fmt.Sprintf("/ip4/%s/udp/%s/%s", h, port, protocol)
		} else {
			ma = fmt.Sprintf("/ip6/%s/udp/%s/%s", h, port, protocol)
		}
	}
	listenAddr, err := multiaddr.NewMultiaddr(ma)
	if err != nil {
		return fmt.Errorf("[addListenAddr] failed to create multiaddr from string '%s': %w", ma, err)
	}
	if err := r.host.Network().Listen(listenAddr); err != nil {
		return fmt.Errorf("[addListenAddr] failed to listen on new address[%s]: %w", listenAddr, err)
	}
	logger.Infof(ctx, "Host started listening on new address: %s", listenAddr)
	return nil
}
