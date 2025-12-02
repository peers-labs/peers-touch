package native

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/libp2p/go-libp2p/core/crypto/pb"
)

func (r *nativeRegistry) unmarshalPeer(data []byte) (peerReg *Peer, err error) {
	pk := &pb.PublicKey{}
	if err = proto.Unmarshal(data, pk); err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal public key: %w", err)
	}

	peerReg = &Peer{}
	err = json.Unmarshal(pk.Data, peerReg)
	if err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal peerReg: %w", err)
	}

	return peerReg, nil
}

func (r *nativeRegistry) marshalPeer(ctx context.Context, peerReg *Peer) ([]byte, error) {
	peerReg.Version = "1.0"

	dataToSign, err := json.Marshal(struct {
		Name      string
		Version   string
		Timestamp time.Time
	}{
		Name:      peerReg.Name,
		Version:   peerReg.Version,
		Timestamp: time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal data for signing: %w", err)
	}

	signData, err := r.signPayload(r.options.PrivateKey, dataToSign)
	if err != nil {
		return nil, fmt.Errorf("[marshal] native Registry failed to sign payload: %w", err)
	}
	peerReg.Metadata = map[string]interface{}{
		"signature": signData,
		"timestamp": time.Now(),
	}

	data, err := json.Marshal(peerReg)
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal peerReg: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	pk := &pb.PublicKey{
		Type: pb.KeyType_RSA.Enum(),
		Data: data,
	}

	dataPk, err := proto.Marshal(pk)
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal pk: %w", err)
	}

	return dataPk, nil
}
