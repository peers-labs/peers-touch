package native

import (
	"context"
	"fmt"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
)

var (
	networkNamespace = "/" + registry.DefaultPeersNetworkNamespace
	networkId        = protocol.ID(networkNamespace)

	// networkBootstrapNamespace is the namespace for bootstrap peers.
	// pb equals to peers-bootstrap
	networkBootstrapNamespace = networkNamespace + ":pb"

	peerKeyFormat = "%s/%s"
)

type NamespaceValidator struct {
}

func (*NamespaceValidator) Validate(key string, val []byte) error {
	if len(key) < len(networkNamespace) || key[:len(networkNamespace)] != networkNamespace {
		return fmt.Errorf("invalid key for name record: %s", key)
	}

	peerID := key[len(networkNamespace)+1:]
	id, err := peer.Decode(peerID)
	if err != nil {
		return fmt.Errorf("invalid peer ID: %s", peerID)
	}

	logger.Infof(context.Background(), "validating peerId %s", id)

	return err
}

func (v *NamespaceValidator) Select(key string, vals [][]byte) (int, error) {
	return 0, nil
}
