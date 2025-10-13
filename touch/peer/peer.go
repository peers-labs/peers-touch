package peer

import (
	"context"
	"strings"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/node"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
)

// SetPeerAddr saves the peer address data to the database.
// It checks for duplicate entries based on PeerID, Addr, and Typ before saving.
func SetPeerAddr(c context.Context, param *model.PeerAddressParam) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[SetPeerAddr] Get db err: %v", err)
		return err
	}

	// Check for duplicate entries
	var existingPeerAddr db.PeerAddress
	err = rds.Where("peer_id =? AND addr =? AND typ =?", param.PeerID, param.Addr, param.Typ).First(&existingPeerAddr).Error
	if err == nil {
		// If no error, a duplicate entry was found
		return model.ErrPeerAddrExists
	} else if err.Error() != "record not found" {
		// listPeers other database errors
		log.Warnf(c, "[SetPeerAddr] Check existing peer address err: %v", err)
		return err
	}

	// Create a new PeerAddress record
	peerAddr := db.PeerAddress{
		PeerID: param.PeerID,
		Addr:   param.Addr,
		Typ:    param.Typ,
	}

	// Save the new record to the database
	if err = rds.Create(&peerAddr).Error; err != nil {
		log.Warnf(c, "[SetPeerAddr] Create peer address err: %v", err)
		return err
	}

	return nil
}

func GetMyPeerInfos(ctx context.Context) (*model.PeerAddrInfo, error) {
	p, err := node.GetService().Options().Registry.GetPeer(ctx, registry.GetMe())
	if err != nil {
		log.Warnf(ctx, "[GetMyPeerInfos] Get peer err: %v", err)
		return nil, err
	}

	ret := &model.PeerAddrInfo{
		PeerId: p.ID,
		Addrs:  strings.Split(p.Metadata["address"].(string), ","),
	}

	return ret, nil
}
