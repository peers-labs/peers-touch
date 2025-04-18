package native

import (
	"fmt"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p/core/peer"
)

var (
	networkNamespace = "/" + registry.DefaultPeersNetworkNamespace
	peerKeyFormat    = "/%s/%s"
)

type NamespaceValidator struct {
}

func (*NamespaceValidator) Validate(key string, val []byte) error {
	// 简单验证，确保键以指定前缀开头
	if key[:len(networkNamespace)] != networkNamespace {
		return fmt.Errorf("invalid key for name record: %s", key)
	}
	// 验证值是否为有效的 peer.ID
	_, err := peer.Decode(string(val))
	return err
}

func (v *NamespaceValidator) Select(key string, vals [][]byte) (int, error) {
	return 0, nil
}
