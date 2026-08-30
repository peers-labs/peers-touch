package actor

import (
	"context"
	"fmt"
	"strings"

	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
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
	Ref         *modelpb.ActorRef `json:"ref"`
}

func LoadPresetActors(ctx context.Context) ([]PresetActor, error) {
	var actors []PresetActor
	if err := cfg.Get("peers.actor.preset_users").Scan(&actors); err != nil {
		return []PresetActor{}, nil
	}
	return actors, nil
}

func ListActorsAsPreset(ctx context.Context, excludeActorID uint64) ([]PresetActor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var rows []db.Actor
	query := rds
	if excludeActorID > 0 {
		query = query.Where("id != ?", excludeActorID)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	base := "https://station.local"
	out := make([]PresetActor, 0, len(rows))
	for _, a := range rows {
		uname := a.PTID
		if uname == "" {
			uname = a.PreferredUsername
		}

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

		endpoints := map[string]string{"sharedInbox": fmt.Sprintf("%s/inbox", base)}

		out = append(out, PresetActor{
			ID:          id,
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			Inbox:       inbox,
			Outbox:      outbox,
			Endpoints:   endpoints,
			Ref:         ProtoActorRef(&a, base),
		})
	}
	return out, nil
}

func SearchActorsAsPreset(ctx context.Context, query string, excludeActorID uint64) ([]PresetActor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var rows []db.Actor
	escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(query)
	searchPattern := "%" + escaped + "%"
	dbQuery := rds.Where("preferred_username LIKE ? OR name LIKE ?", searchPattern, searchPattern)
	if excludeActorID > 0 {
		dbQuery = dbQuery.Where("id != ?", excludeActorID)
	}
	if err := dbQuery.Find(&rows).Error; err != nil {
		return nil, err
	}

	base := "https://station.local"
	out := make([]PresetActor, 0, len(rows))
	for _, a := range rows {
		uname := a.PTID
		if uname == "" {
			uname = a.PreferredUsername
		}

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

		endpoints := map[string]string{"sharedInbox": fmt.Sprintf("%s/inbox", base)}

		out = append(out, PresetActor{
			ID:          id,
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			Inbox:       inbox,
			Outbox:      outbox,
			Endpoints:   endpoints,
			Ref:         ProtoActorRef(&a, base),
		})
	}
	return out, nil
}
