package activity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

func Create(ctx context.Context, actor string, baseURL string, in *modelpb.ActivityInput) (string, string, error) {
	actorIRI := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, actor)
	objectID := fmt.Sprintf("%s/activitypub/%s/objects/%d", baseURL, actor, time.Now().UnixNano())
	activityID := fmt.Sprintf("%s/activitypub/%s/activities/%d", baseURL, actor, time.Now().UnixNano())

	// Build Note
	note := ap.ObjectNew(ap.NoteType)
	note.ID = ap.ID(objectID)
	note.AttributedTo = ap.IRI(actorIRI)
	note.Published = time.Now()
	if t := strings.TrimSpace(in.GetText()); t != "" {
		note.Content.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(t)})
	}
	if cw := strings.TrimSpace(in.GetCw()); cw != "" {
		note.Summary.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(cw)})
	}
	if rt := strings.TrimSpace(in.GetReplyTo()); rt != "" {
		note.InReplyTo = ap.IRI(rt)
	}
	if len(in.GetAttachments()) > 0 {
		a := in.GetAttachments()[0]
		mt := strings.ToLower(a.GetMediaType())
		var att *ap.Object
		if strings.HasPrefix(mt, "image/") {
			att = ap.ObjectNew(ap.ImageType)
		} else if strings.HasPrefix(mt, "video/") {
			att = ap.ObjectNew(ap.VideoType)
		} else if strings.HasPrefix(mt, "audio/") {
			att = ap.ObjectNew(ap.AudioType)
		} else {
			att = ap.ObjectNew(ap.DocumentType)
		}
		att.URL = ap.IRI(a.GetUrl())
		note.Attachment = att
	}

	// Build Activity
	act := ap.ActivityNew(ap.ID(activityID), ap.CreateType, note.GetLink())
	act.Actor = ap.IRI(actorIRI)
	act.Published = time.Now()

	vis := strings.ToLower(in.GetVisibility())
	followersIRI := ap.IRI(fmt.Sprintf("%s/activitypub/%s/followers", baseURL, actor))
	switch vis {
	case "followers":
		act.To = ap.ItemCollection{followersIRI}
	case "direct":
		// Direct audience list
		for _, aud := range in.GetAudience() {
			if aud = strings.TrimSpace(aud); aud != "" {
				act.To = append(act.To, ap.IRI(aud))
			}
		}
	case "custom":
		for _, aud := range in.GetAudience() {
			if aud = strings.TrimSpace(aud); aud != "" {
				act.To = append(act.To, ap.IRI(aud))
			}
		}
	default:
		// public
		act.To = ap.ItemCollection{ap.PublicNS}
		act.CC = ap.ItemCollection{followersIRI}
	}

	// Persist & deliver via existing ActivityPub pipeline
	if err := activitypub.ProcessActivity(ctx, actor, act, baseURL); err != nil {
		return "", "", err
	}
	return objectID, activityID, nil
}
