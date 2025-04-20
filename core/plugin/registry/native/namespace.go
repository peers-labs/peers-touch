package native

import (
	"context"
	"fmt"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

var (
	networkId = protocol.ID(registry.DefaultPeersNetworkNamespace)

	networkNamespace = "/" + registry.DefaultPeersNetworkNamespace
	peerKeyFormat    = "/%s/%s"
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
