package mastodon

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

func GetAccount(ctx context.Context, username string) (*model.MastodonAccount, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		return nil, err
	}
	return &model.MastodonAccount{Id: actor.PTID, Username: actor.PreferredUsername, Acct: actor.PreferredUsername, DisplayName: actor.Name, Note: actor.Summary, Avatar: actor.Icon, Header: actor.Image}, nil
}

func CreateStatus(ctx context.Context, username string, req model.MastodonCreateStatusRequest, baseURL string) (*model.MastodonStatus, error) {
	actorIRI := ap.IRI(baseURL + "/" + username + "/actor")
	obj := ap.ObjectNew(ap.NoteType)
	obj.Content = ap.NaturalLanguageValuesNew()
	obj.Content.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(req.Status)})
	obj.Published = time.Now()
	obj.AttributedTo = actorIRI
	act := ap.Activity{Type: ap.CreateType, Actor: actorIRI, Object: obj, Published: time.Now()}
	if err := activitypub.ProcessActivity(ctx, username, &act, baseURL); err != nil {
		return nil, err
	}
	return &model.MastodonStatus{Id: string(act.ID), Content: req.Status}, nil
}

func GetStatus(ctx context.Context, id string) (*model.MastodonStatus, error) {
	return nil, fmt.Errorf("Mastodon API is deprecated, use Social API /api/v1/social/posts/:id instead")
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func Favourite(ctx context.Context, username, id, baseURL string) (*model.MastodonStatus, error) {
	act := ap.Activity{Type: ap.LikeType, Actor: ap.IRI(baseURL + "/" + username + "/actor"), Object: ap.IRI(id), Published: time.Now()}
	if err := activitypub.ProcessActivity(ctx, username, &act, baseURL); err != nil {
		return nil, err
	}
	return &model.MastodonStatus{Id: id}, nil
}

func Unfavourite(ctx context.Context, username, id, baseURL string) (*model.MastodonStatus, error) {
	act := ap.Activity{Type: ap.UndoType, Actor: ap.IRI(baseURL + "/" + username + "/actor"), Object: ap.IRI(id), Published: time.Now()}
	if err := activitypub.ProcessActivity(ctx, username, &act, baseURL); err != nil {
		return nil, err
	}
	return &model.MastodonStatus{Id: id}, nil
}

func Reblog(ctx context.Context, username, id, baseURL string) (*model.MastodonStatus, error) {
	act := ap.Activity{Type: ap.AnnounceType, Actor: ap.IRI(baseURL + "/" + username + "/actor"), Object: ap.IRI(id), Published: time.Now()}
	if err := activitypub.ProcessActivity(ctx, username, &act, baseURL); err != nil {
		return nil, err
	}
	return &model.MastodonStatus{Id: id}, nil
}

func Unreblog(ctx context.Context, username, id, baseURL string) (*model.MastodonStatus, error) {
	act := ap.Activity{Type: ap.UndoType, Actor: ap.IRI(baseURL + "/" + username + "/actor"), Object: ap.IRI(id), Published: time.Now()}
	if err := activitypub.ProcessActivity(ctx, username, &act, baseURL); err != nil {
		return nil, err
	}
	return &model.MastodonStatus{Id: id}, nil
}

func RegisterApp(ctx context.Context, clientName, redirectURIs, scopes, website string) (map[string]interface{}, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var existing db.OAuthClient
	if err := rds.Where("name = ? AND redirect_uri = ?", clientName, redirectURIs).First(&existing).Error; err == nil {
		return map[string]interface{}{
			"id":            fmt.Sprintf("%d", existing.ID),
			"name":          existing.Name,
			"client_id":     existing.ClientID,
			"client_secret": "",
			"redirect_uri":  existing.RedirectURI,
			"website":       website,
			"scopes":        existing.Scopes,
			"vapid_key":     "",
		}, nil
	}
	cid, err := util.RandomString(24)
	if err != nil {
		return nil, err
	}
	secret, err := util.RandomString(48)
	if err != nil {
		return nil, err
	}
	oc := db.OAuthClient{Name: clientName, ClientID: cid, ClientSecretHash: util.HashString(secret), RedirectURI: redirectURIs, Scopes: scopes, CreatedAt: time.Now()}
	if err := rds.Create(&oc).Error; err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"id":            fmt.Sprintf("%d", oc.ID),
		"name":          clientName,
		"client_id":     cid,
		"client_secret": secret,
		"redirect_uri":  redirectURIs,
		"website":       website,
		"scopes":        scopes,
		"vapid_key":     "",
	}, nil
}

func VerifyCredentials(ctx context.Context, authorizationHeader, actorParam string) (*model.MastodonAccount, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var username string
	if authorizationHeader != "" && strings.HasPrefix(authorizationHeader, "Bearer ") {
		token := authorizationHeader[7:]
		var tok db.OAuthToken
		if err := rds.Where("access_token_hash = ?", util.HashString(token)).First(&tok).Error; err == nil {
			username = tok.UserID
		}
	}
	if username == "" {
		username = actorParam
	}
	if username == "" {
		return nil, fmt.Errorf("actor_required")
	}
	return GetAccount(ctx, username)
}

func Directory(ctx context.Context, limit, offset int) ([]model.MastodonAccount, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var actors []db.Actor
	if err := rds.Limit(limit).Offset(offset).Order("id ASC").Find(&actors).Error; err != nil {
		return nil, err
	}
	items := make([]model.MastodonAccount, 0, len(actors))
	for i := range actors {
		a := actors[i]
		items = append(items, model.MastodonAccount{Id: a.PTID, Username: a.PreferredUsername, Acct: a.PreferredUsername, DisplayName: a.Name, Note: a.Summary, Avatar: a.Icon, Header: a.Image})
	}
	return items, nil
}

func GetInstance(ctx context.Context, baseURL string) (*model.MastodonInstance, error) {
	// TODO: Read from configuration
	// Using a Mastodon-compatible version string is important for some clients
	domain := strings.TrimPrefix(strings.TrimPrefix(baseURL, "http://"), "https://")
	return &model.MastodonInstance{
		URI:              domain,
		Title:            "Peers Touch Station",
		ShortDescription: "A decentralized Peers Touch station",
		Description:      "This is a Peers Touch station running compatible ActivityPub and Mastodon API.",
		Email:            "admin@" + domain,
		Version:          "4.0.0 (compatible; PeersTouch 1.0.0)",
		Urls:             map[string]string{"streaming_api": strings.Replace(baseURL, "http", "ws", 1) + "/api/v1/streaming"},
		Stats:            &model.InstanceStats{UserCount: 1, StatusCount: 0, DomainCount: 0},
		Languages:        []string{"en"},
		Registrations:    true,
		ApprovalRequired: false,
		InvitesEnabled:   true,
	}, nil
}
