package peer

import (
	"context"
	"fmt"
	"strings"

	log "github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/node"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"github.com/peers-touch/peers-touch/station/frame/touch/model"
	"github.com/peers-touch/peers-touch/station/frame/touch/model/db"
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
	peers, err := node.GetService().Options().Registry.Query(ctx, registry.GetMe())
	if err != nil {
		log.Warnf(ctx, "[GetMyPeerInfos] Query peer err: %v", err)
		return nil, err
	}

	if len(peers) == 0 {
		log.Warnf(ctx, "[GetMyPeerInfos] No peer found")
		return nil, fmt.Errorf("no peer found")
	}

	p := peers[0]
	ret := &model.PeerAddrInfo{
		PeerId: p.ID,
		Addrs:  strings.Split(p.Metadata["address"].(string), ","),
	}

	return ret, nil
}
