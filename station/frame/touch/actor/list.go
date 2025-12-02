package actor

import (
	"context"
	"fmt"

	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type PresetActor struct {
	ID          string            `json:"id"`
	Username    string            `json:"username"`
	Email       string            `json:"email"`
	DisplayName string            `json:"display_name"`
	Inbox       string            `json:"inbox"`
	Outbox      string            `json:"outbox"`
	Endpoints   map[string]string `json:"endpoints"`
}

// LoadPresetActors reads actors from config (for seeding)
func LoadPresetActors(ctx context.Context) ([]PresetActor, error) {
	var actors []PresetActor
	if err := cfg.Get("peers.actor.preset_users").Scan(&actors); err != nil {
		return []PresetActor{}, nil
	}
	return actors, nil
}

// ListActors returns actors from database (if any)
func ListActors(ctx context.Context) ([]PresetActor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var rows []db.Actor
	if err := rds.Find(&rows).Error; err != nil {
		return nil, err
	}
	base := "https://station.local"
	out := make([]PresetActor, 0, len(rows))
	for _, a := range rows {
		uname := a.PeersActorID
		if uname == "" {
			uname = a.Name
		}
		id := fmt.Sprintf("%s/actor/%s", base, uname)
		out = append(out, PresetActor{
			ID:          id,
			Username:    uname,
			DisplayName: a.Name,
			Inbox:       fmt.Sprintf("%s/actor/%s/inbox", base, uname),
			Outbox:      fmt.Sprintf("%s/actor/%s/outbox", base, uname),
			Endpoints:   map[string]string{"sharedInbox": fmt.Sprintf("%s/inbox", base)},
		})
	}
	return out, nil
}
