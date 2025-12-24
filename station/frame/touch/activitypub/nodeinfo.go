package activitypub

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// NodeInfo Usage statistics
type NodeInfoUsage struct {
	Users      NodeInfoUsers `json:"users"`
	LocalPosts int64         `json:"localPosts"`
}

type NodeInfoUsers struct {
	Total          int64 `json:"total"`
	ActiveHalfyear int64 `json:"activeHalfyear"`
	ActiveMonth    int64 `json:"activeMonth"`
}

// NodeInfo Software information
type NodeInfoSoftware struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// NodeInfoServices Services information
type NodeInfoServices struct {
	Inbound  []string `json:"inbound"`
	Outbound []string `json:"outbound"`
}

// NodeInfo schema 2.1
type NodeInfo struct {
	Version           string           `json:"version"`
	Software          NodeInfoSoftware `json:"software"`
	Protocols         []string         `json:"protocols"`
	Services          NodeInfoServices `json:"services"`
	OpenRegistrations bool             `json:"openRegistrations"`
	Usage             NodeInfoUsage    `json:"usage"`
	Metadata          map[string]any   `json:"metadata"`
}

// GetNodeInfo retrieves NodeInfo 2.1 data
func GetNodeInfo(c context.Context, baseURL string) (*NodeInfo, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var usersTotal int64
	if err := rds.Model(&db.Actor{}).Where("type = ?", "Person").Count(&usersTotal).Error; err != nil {
		usersTotal = 0
	}

	var postsTotal int64
	if err := rds.Model(&db.ActivityPubObject{}).Where("type = ? AND is_local = ?", "Note", true).Count(&postsTotal).Error; err != nil {
		postsTotal = 0
	}

	return &NodeInfo{
		Version: "2.1",
		Software: NodeInfoSoftware{
			Name:    "peers-touch",
			Version: "0.1.0",
		},
		Protocols: []string{"activitypub"},
		Services: NodeInfoServices{
			Inbound:  []string{},
			Outbound: []string{},
		},
		OpenRegistrations: true,
		Usage: NodeInfoUsage{
			Users: NodeInfoUsers{
				Total:          usersTotal,
				ActiveHalfyear: usersTotal, // Placeholder
				ActiveMonth:    usersTotal, // Placeholder
			},
			LocalPosts: postsTotal,
		},
		Metadata: map[string]any{
			"nodeName":        "Peers Touch Station",
			"nodeDescription": "A decentralized social network station",
		},
	}, nil
}
