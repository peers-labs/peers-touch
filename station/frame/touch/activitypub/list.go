package activitypub

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
		uname := a.PTID
		if uname == "" {
			uname = a.PreferredUsername
		}

		// Use DB values if present, otherwise fallback to dynamic generation
		id := a.Url
		if id == "" {
			id = fmt.Sprintf("%s/actor/%s", base, uname)
		}
		inbox := a.Inbox
		if inbox == "" {
			inbox = fmt.Sprintf("%s/actor/%s/inbox", base, uname)
		}
		outbox := a.Outbox
		if outbox == "" {
			outbox = fmt.Sprintf("%s/actor/%s/outbox", base, uname)
		}

		// Parse endpoints if present (simple check for now)
		endpoints := map[string]string{"sharedInbox": fmt.Sprintf("%s/inbox", base)}
		// Real implementation would parse a.Endpoints JSON

		out = append(out, PresetActor{
			ID:          id,
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			Inbox:       inbox,
			Outbox:      outbox,
			Endpoints:   endpoints,
		})
	}
	return out, nil
}
