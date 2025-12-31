package activitypub

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

// Re-export Create for backward compatibility
// TODO: Refactor handlers to use service package directly

// GenerateRSAKeyPair returns PEM-encoded RSA private/public keys.
func GenerateRSAKeyPair(bits int) (string, string, error) {
	priv, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return "", "", err
	}
	privBytes := x509.MarshalPKCS1PrivateKey(priv)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privBytes})
	pubBytes, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		return "", "", err
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})
	return string(privPEM), string(pubPEM), nil
}

// GetActorData loads or creates an ActivityPub Person for the user.
func GetActorData(c context.Context, user string, baseURL string) (*ap.Person, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	actorID := fmt.Sprintf("%s/%s/actor", baseURL, user)
	var actor db.Actor
	err = rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			priv, pub, e := GenerateRSAKeyPair(2048)
			if e != nil {
				return nil, fmt.Errorf("keygen: %w", e)
			}
			var ptid string
			if iden, ierr := identity.CreateIdentity(c, user, "peers", identity.TypePerson); ierr == nil && iden != nil && iden.PTID != "" {
				ptid = iden.PTID
			} else {
				ptid = fmt.Sprintf("ptid:v1:actor:peers:Person:%s:%d", user, time.Now().UnixNano())
			}
			actor = db.Actor{
				Name:              user,
				PreferredUsername: user,
				Namespace:         "peers",
				Type:              "Person",
				PTID:              ptid,
				PublicKey:         pub,
				PrivateKey:        priv,
				Url:               fmt.Sprintf("%s/users/%s", baseURL, user),
				Inbox:             fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user),
				Outbox:            fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user),
				Followers:         fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user),
				Following:         fmt.Sprintf("%s/activitypub/%s/following", baseURL, user),
				Liked:             fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user),
				Endpoints:         fmt.Sprintf(`{"sharedInbox":"%s/activitypub/inbox"}`, baseURL),
				CreatedAt:         time.Now(),
				UpdatedAt:         time.Now(),
			}
			if err := rds.Create(&actor).Error; err != nil {
				return nil, fmt.Errorf("create actor: %w", err)
			}
		} else {
			return nil, fmt.Errorf("get actor: %w", err)
		}
	} else if actor.PublicKey == "" {
		priv, pub, e := GenerateRSAKeyPair(2048)
		if e != nil {
			return nil, fmt.Errorf("keygen: %w", e)
		}
		actor.PrivateKey = priv
		actor.PublicKey = pub
		rds.Save(&actor)
	}
	person := ap.PersonNew(ap.ID(actorID))
	person.PreferredUsername = ap.NaturalLanguageValuesNew()
	person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.PreferredUsername)})
	if actor.Name != "" {
		person.Name = ap.NaturalLanguageValuesNew()
		person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Name)})
	}
	if actor.Summary != "" {
		person.Summary = ap.NaturalLanguageValuesNew()
		person.Summary.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Summary)})
	}
	if actor.Icon != "" {
		ic := ap.ObjectNew(ap.ImageType)
		ic.URL = ap.IRI(actor.Icon)
		person.Icon = ic
	}
	if actor.Image != "" {
		im := ap.ObjectNew(ap.ImageType)
		im.URL = ap.IRI(actor.Image)
		person.Image = im
	}
	if actor.Inbox != "" {
		person.Inbox = ap.IRI(actor.Inbox)
	} else {
		person.Inbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user))
	}
	if actor.Outbox != "" {
		person.Outbox = ap.IRI(actor.Outbox)
	} else {
		person.Outbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user))
	}
	if actor.Followers != "" {
		person.Followers = ap.IRI(actor.Followers)
	} else {
		person.Followers = ap.IRI(fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user))
	}
	if actor.Following != "" {
		person.Following = ap.IRI(actor.Following)
	} else {
		person.Following = ap.IRI(fmt.Sprintf("%s/activitypub/%s/following", baseURL, user))
	}
	if actor.Liked != "" {
		person.Liked = ap.IRI(actor.Liked)
	} else {
		person.Liked = ap.IRI(fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user))
	}
	person.PublicKey = ap.PublicKey{ID: ap.ID(fmt.Sprintf("%s#main-key", actorID)), Owner: ap.IRI(actorID), PublicKeyPem: actor.PublicKey}
	person.Endpoints = &ap.Endpoints{}
	if actor.Endpoints != "" {
		var m map[string]string
		if json.Unmarshal([]byte(actor.Endpoints), &m) == nil {
			if s, ok := m["sharedInbox"]; ok {
				person.Endpoints.SharedInbox = ap.IRI(s)
			}
		}
	} else {
		person.Endpoints.SharedInbox = ap.IRI(fmt.Sprintf("%s/activitypub/inbox", baseURL))
	}
	return person, nil
}

// FetchInbox returns the user's inbox collection or a page.
func FetchInbox(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)
	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count inbox: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(inboxID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		col.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", inboxID))
		return col, nil
	}
	var items []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list inbox: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", inboxID)
	inbox := ap.OrderedCollectionNew(ap.ID(inboxID))
	inbox.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(inbox)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(inboxID)
	col.OrderedItems = make(ap.ItemCollection, 0, len(items))
	for _, it := range items {
		var act db.ActivityPubActivity
		if err := rds.Where("id = ?", it.ItemID).First(&act).Error; err == nil {
			// Filtering
			if act.Type != string(ap.CreateType) && act.Type != string(ap.AnnounceType) {
				continue
			}
			if act.Type == string(ap.CreateType) && act.Reply {
				continue
			}

			var a ap.Activity
			var data []byte
			if len(act.Content) > 0 {
				if bz, e := gunzipBytes(act.Content); e == nil {
					data = bz
				}
			}
			if data != nil {
				if json.Unmarshal(data, &a) == nil {
					col.OrderedItems = append(col.OrderedItems, &a)
					continue
				}
			}
		}
		col.OrderedItems = append(col.OrderedItems, ap.IRI(it.ItemID))
	}
	return col, nil
}

// FetchOutbox returns the user's outbox collection or a page.
func FetchOutbox(c context.Context, user string, baseURL string, page bool, viewerID uint64) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	outboxID := fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user)
	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", outboxID).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count outbox: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(outboxID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", outboxID))
		col.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", outboxID))
		return col, nil
	}
	var items []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", outboxID).Order("added_at desc").Limit(20).Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list outbox: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", outboxID)
	out := ap.OrderedCollectionNew(ap.ID(outboxID))
	out.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(out)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(outboxID)
	col.OrderedItems = make(ap.ItemCollection, 0, len(items))

	for _, it := range items {
		var act db.ActivityPubActivity
		if err := rds.Where("id = ?", it.ItemID).First(&act).Error; err == nil {
			// Skip activities that shouldn't appear in the feed
			// 1. Skip non-content types (Like, Follow, Undo, Delete, Block, Update, etc.)
			//    Only allow Create and Announce.
			if act.Type != string(ap.CreateType) && act.Type != string(ap.AnnounceType) {
				continue
			}

			// 2. Skip replies (Create activities where Reply is true)
			//    Replies should be shown under the parent post, not as main feed items.
			//    Using explicit Reply field following Mastodon's approach.
			if act.Type == string(ap.CreateType) && act.Reply {
				continue
			}

			// Check if object is deleted (Tombstone)
			if act.ObjectID != 0 {
				var obj db.ActivityPubObject
				if err := rds.Where("id = ?", act.ObjectID).First(&obj).Error; err == nil {
					if obj.Type == "Tombstone" {
						continue // Skip deleted items
					}
				}
			}

			var a ap.Activity
			var data []byte
			if len(act.Content) > 0 {
				if bz, e := gunzipBytes(act.Content); e == nil {
					data = bz
				}
			}
			if data != nil {
				if json.Unmarshal(data, &a) == nil {
					// Enrich with dynamic stats and viewer state
					enrichActivity(c, rds, &a, act.ObjectID, viewerID)
					col.OrderedItems = append(col.OrderedItems, &a)
					continue
				}
			}
		}
		col.OrderedItems = append(col.OrderedItems, ap.IRI(it.ItemID))
	}
	return col, nil
}

func enrichActivity(c context.Context, rds *gorm.DB, a *ap.Activity, objectID uint64, viewerID uint64) {
	if objectID == 0 {
		return
	}

	// 1. Get Like Count
	var likesCount int64
	rds.Model(&db.ActivityPubLike{}).Where("object_id = ? AND is_active = ?", objectID, true).Count(&likesCount)

	// 2. Get Comment Count (Replies)
	var repliesCount int64
	rds.Model(&db.ActivityPubObject{}).Where("in_reply_to = ?", objectID).Count(&repliesCount)

	// 3. Get Announce Count (Shares)
	var sharesCount int64
	// Find activities of type Announce pointing to this object
	rds.Model(&db.ActivityPubActivity{}).Where("type = ? AND object_id = ?", "Announce", objectID).Count(&sharesCount)

	// 4. Check if viewer liked
	// liked := false // Unused variable
	if viewerID != 0 {
		var count int64
		// Note: ActivityPubLike table uses ActorID (numeric) and ObjectID (numeric)
		rds.Model(&db.ActivityPubLike{}).Where("object_id = ? AND actor_id = ? AND is_active = ?", objectID, viewerID, true).Count(&count)
		// liked = count > 0 // Unused variable
	}

	// Inject into Activity Object if it's a full object
	// We use the 'Object' field of the Activity
	_ = ap.OnObject(a.Object, func(o *ap.Object) error {
		// Likes
		// Always initialize collections even if empty, so frontend sees 0 instead of null/undefined
		col := ap.OrderedCollectionNew(ap.ID(""))
		col.TotalItems = uint(likesCount)
		o.Likes = col

		// Replies - preload first 10 comments
		colReplies := ap.OrderedCollectionNew(ap.ID(""))
		colReplies.TotalItems = uint(repliesCount)
		if repliesCount > 0 {
			var replyObjects []db.ActivityPubObject
			rds.Where("in_reply_to = ?", objectID).
				Order("id ASC").
				Limit(10).
				Find(&replyObjects)
			if len(replyObjects) > 0 {
				colReplies.OrderedItems = make(ap.ItemCollection, len(replyObjects))
				for i, r := range replyObjects {
					var replyObj ap.Object
					if r.Metadata != "" {
						if err := json.Unmarshal([]byte(r.Metadata), &replyObj); err == nil {
							var replyActor db.Actor
							if err := rds.Where("activity_pub_id = ?", r.AttributedTo).First(&replyActor).Error; err == nil {
								person := ap.PersonNew(ap.ID(r.AttributedTo))
								if replyActor.Name != "" {
									person.Name = ap.NaturalLanguageValuesNew()
									person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(replyActor.Name)})
								}
								person.PreferredUsername = ap.NaturalLanguageValuesNew()
								person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(replyActor.PreferredUsername)})
								if replyActor.Icon != "" {
									ic := ap.ObjectNew(ap.ImageType)
									ic.URL = ap.IRI(replyActor.Icon)
									person.Icon = ic
								}
								replyObj.AttributedTo = person
							}
							colReplies.OrderedItems[i] = &replyObj
						} else {
							colReplies.OrderedItems[i] = ap.IRI(r.ActivityPubID)
						}
					} else {
						colReplies.OrderedItems[i] = ap.IRI(r.ActivityPubID)
					}
				}
			}
		}
		o.Replies = colReplies

		// Shares
		colShares := ap.OrderedCollectionNew(ap.ID(""))
		colShares.TotalItems = uint(sharesCount)
		o.Shares = colShares

		// AttributedTo (Avatar) expansion
		// If AttributedTo is a link, try to fetch actor and set icon
		// Note: o.AttributedTo is ap.Item (interface), which can be Object or Link.
		// It is usually a single Item, not a collection, though the spec allows multiple.
		// In our ap package, AttributedTo is defined as `Item`.
		// If it's a link, we can check directly.
		if o.AttributedTo != nil {
			if o.AttributedTo.IsLink() {
				actorIRI := string(o.AttributedTo.GetLink())
				// Try to fetch actor from DB
				var actor db.Actor
				// We need to match either URL or specific ActivityPub IDs
				if err := rds.Where("url = ?", actorIRI).Or("activity_pub_id = ?", actorIRI).Or("id = ?", actorIRI).First(&actor).Error; err == nil {
					// Found actor, expand it to a Person object with Icon
					person := ap.PersonNew(ap.ID(actorIRI))

					// Set Name/PreferredUsername if available
					if actor.Name != "" {
						person.Name = ap.NaturalLanguageValuesNew()
						person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Name)})
					}
					person.PreferredUsername = ap.NaturalLanguageValuesNew()
					person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.PreferredUsername)})

					// Set Icon
					if actor.Icon != "" {
						ic := ap.ObjectNew(ap.ImageType)
						ic.URL = ap.IRI(actor.Icon)
						person.Icon = ic
					}
					// Replace the link with the expanded object
					o.AttributedTo = person
				}
			}
		}

		// Tag "liked" state in the object itself (non-standard but useful for client)
		// Or we can rely on client checking Likes collection if we exposed who liked it,
		// but typically we just add a boolean flag or the client checks if "viewer" is in "likes".
		// Since we don't standardly return "isLiked" in AP, we might need a custom property or
		// ensure the client logic works.
		// For now, let's assume client looks at o.Likes.TotalItems for count.
		// For "isLiked" state, standard Mastodon API puts it in 'favourited'.
		// Since we are returning raw ActivityPub, we might need to add a custom field or Context.
		// Let's add it to the 'context' or a custom property if possible, but ap.Object is strict.
		// We will rely on the "viewer" knowing they liked it via a separate mechanism or
		// if we are emulating Mastodon API (which is done in profile.go/status.go, not here).
		// Wait, this function enriches the ActivityPub object which is then returned.
		// If the frontend expects `isLiked`, it might be looking for a specific field.
		// But here we are just returning standard AP.

		return nil
	})
}

// FetchFollowers returns the user's followers collection or a page.
func FetchFollowers(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	followersID := fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}
	var total int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("following_id = ? AND is_active = ?", me.ID, true).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count followers: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(followersID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", followersID))
		return col, nil
	}
	var follows []db.ActivityPubFollow
	if err := rds.Where("following_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {
		return nil, fmt.Errorf("list followers: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", followersID)
	fol := ap.OrderedCollectionNew(ap.ID(followersID))
	fol.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(fol)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(followersID)
	col.OrderedItems = make(ap.ItemCollection, len(follows))
	for i, f := range follows {
		var a db.Actor
		if err := rds.Where("id = ?", f.FollowerID).First(&a).Error; err == nil && a.Url != "" {
			col.OrderedItems[i] = ap.IRI(a.Url)
		} else {
			col.OrderedItems[i] = ap.IRI("")
		}
	}
	return col, nil
}

// FetchFollowing returns the user's following collection or a page.
func FetchFollowing(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	followingID := fmt.Sprintf("%s/activitypub/%s/following", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}
	var total int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("follower_id = ? AND is_active = ?", me.ID, true).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count following: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(followingID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", followingID))
		return col, nil
	}
	var follows []db.ActivityPubFollow
	if err := rds.Where("follower_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {
		return nil, fmt.Errorf("list following: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", followingID)
	fol := ap.OrderedCollectionNew(ap.ID(followingID))
	fol.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(fol)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(followingID)
	col.OrderedItems = make(ap.ItemCollection, len(follows))
	for i, f := range follows {
		var a db.Actor
		if err := rds.Where("id = ?", f.FollowingID).First(&a).Error; err == nil && a.Url != "" {
			col.OrderedItems[i] = ap.IRI(a.Url)
		} else {
			col.OrderedItems[i] = ap.IRI("")
		}
	}
	return col, nil
}

// FetchLiked returns the user's liked collection or a page.
func FetchLiked(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	likedID := fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}
	var total int64
	if err := rds.Model(&db.ActivityPubLike{}).Where("actor_id = ? AND is_active = ?", me.ID, true).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count liked: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(likedID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", likedID))
		return col, nil
	}
	var likes []db.ActivityPubLike
	if err := rds.Where("actor_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&likes).Error; err != nil {
		return nil, fmt.Errorf("list liked: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", likedID)
	lk := ap.OrderedCollectionNew(ap.ID(likedID))
	lk.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(lk)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(likedID)
	col.OrderedItems = make(ap.ItemCollection, len(likes))
	for i, l := range likes {
		var obj db.ActivityPubObject
		if err := rds.Where("id = ?", l.ObjectID).First(&obj).Error; err == nil && obj.ActivityPubID != "" {
			col.OrderedItems[i] = ap.IRI(obj.ActivityPubID)
		} else {
			col.OrderedItems[i] = ap.IRI("")
		}
	}
	return col, nil
}

// FetchSharedInbox returns the shared inbox collection or a page.
func FetchSharedInbox(c context.Context, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	inboxID := fmt.Sprintf("%s/inbox", baseURL)
	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count shared inbox: %w", err)
	}
	if !page {
		col := ap.OrderedCollectionNew(ap.ID(inboxID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		return col, nil
	}
	var items []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list shared inbox: %w", err)
	}
	pageID := fmt.Sprintf("%s?page=true", inboxID)
	inx := ap.OrderedCollectionNew(ap.ID(inboxID))
	inx.TotalItems = uint(total)
	col := ap.OrderedCollectionPageNew(inx)
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(inboxID)
	col.OrderedItems = make(ap.ItemCollection, 0, len(items))
	for _, it := range items {
		var act db.ActivityPubActivity
		if err := rds.Where("id = ?", it.ItemID).First(&act).Error; err == nil {
			// Filtering
			if act.Type != string(ap.CreateType) && act.Type != string(ap.AnnounceType) {
				continue
			}
			if act.Type == string(ap.CreateType) && act.Reply {
				continue
			}

			var a ap.Activity
			var data []byte
			if len(act.Content) > 0 {
				if bz, e := gunzipBytes(act.Content); e == nil {
					data = bz
				}
			}
			if data != nil {
				if json.Unmarshal(data, &a) == nil {
					col.OrderedItems = append(col.OrderedItems, &a)
					continue
				}
			}
		}
		col.OrderedItems = append(col.OrderedItems, ap.IRI(it.ItemID))
	}
	return col, nil
}

// FetchObjectReplies returns the replies collection for a given object.
// Supports keyset pagination with afterID parameter.
func FetchObjectReplies(c context.Context, objectID string, baseURL string, page bool, afterID uint64, limit int) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var obj db.ActivityPubObject
	if err := rds.Where("activity_pub_id = ?", objectID).First(&obj).Error; err != nil {
		return nil, fmt.Errorf("object not found: %w", err)
	}

	repliesID := fmt.Sprintf("%s?replies=true", objectID)

	var total int64
	if err := rds.Model(&db.ActivityPubObject{}).
		Where("in_reply_to = ?", obj.ID).
		Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count replies: %w", err)
	}

	if !page {
		col := ap.OrderedCollectionNew(ap.ID(repliesID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s&page=true", repliesID))
		return col, nil
	}

	if limit <= 0 || limit > 50 {
		limit = 10
	}

	query := rds.Where("in_reply_to = ?", obj.ID)
	if afterID > 0 {
		query = query.Where("id > ?", afterID)
	}

	var replies []db.ActivityPubObject
	if err := query.Order("id ASC").
		Limit(limit).
		Find(&replies).Error; err != nil {
		return nil, fmt.Errorf("list replies: %w", err)
	}

	pageID := fmt.Sprintf("%s&page=true", repliesID)
	if afterID > 0 {
		pageID = fmt.Sprintf("%s&after=%d", pageID, afterID)
	}
	col := ap.OrderedCollectionPageNew(ap.OrderedCollectionNew(ap.ID(repliesID)))
	col.ID = ap.ID(pageID)
	col.PartOf = ap.IRI(repliesID)
	col.TotalItems = uint(total)
	col.OrderedItems = make(ap.ItemCollection, len(replies))

	var lastID uint64
	for i, r := range replies {
		var replyObj ap.Object
		if r.Metadata != "" {
			if err := json.Unmarshal([]byte(r.Metadata), &replyObj); err == nil {
				var replyActor db.Actor
				if err := rds.Where("activity_pub_id = ?", r.AttributedTo).First(&replyActor).Error; err == nil {
					person := ap.PersonNew(ap.ID(r.AttributedTo))
					if replyActor.Name != "" {
						person.Name = ap.NaturalLanguageValuesNew()
						person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(replyActor.Name)})
					}
					person.PreferredUsername = ap.NaturalLanguageValuesNew()
					person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(replyActor.PreferredUsername)})
					if replyActor.Icon != "" {
						ic := ap.ObjectNew(ap.ImageType)
						ic.URL = ap.IRI(replyActor.Icon)
						person.Icon = ic
					}
					replyObj.AttributedTo = person
				}
				col.OrderedItems[i] = &replyObj
			} else {
				col.OrderedItems[i] = ap.IRI(r.ActivityPubID)
			}
		} else {
			col.OrderedItems[i] = ap.IRI(r.ActivityPubID)
		}
		lastID = r.ID
	}

	if len(replies) == limit && lastID > 0 {
		col.Next = ap.IRI(fmt.Sprintf("%s&page=true&after=%d&limit=%d", repliesID, lastID, limit))
	}

	return col, nil
}

// PersistInboxActivity saves an incoming inbox activity and indexes it.
func PersistInboxActivity(c context.Context, user string, activity *ap.Activity, baseURL string, rawBody []byte) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	activityID := string(activity.ID)
	if activityID == "" {
		return nil
	}
	var inReplyTo string
	var inReplyToID uint64
	var sensitive bool
	var spoilerText string
	if activity.Object != nil {
		_ = ap.OnObject(activity.Object, func(o *ap.Object) error {
			if o.InReplyTo != nil {
				inReplyTo = getLink(o.InReplyTo)
				var parent db.ActivityPubObject
				if err := rds.Where("activity_pub_id = ?", inReplyTo).First(&parent).Error; err == nil {
					inReplyToID = parent.ID
				}
			}
			if len(o.Summary) > 0 {
				spoilerText = string(o.Summary.First().Value)
			}
			return nil
		})
	}
	isPublic := false
	for _, to := range activity.To {
		if to.GetLink() == ap.PublicNS {
			isPublic = true
			break
		}
	}
	if !isPublic {
		for _, cc := range activity.CC {
			if cc.GetLink() == ap.PublicNS {
				isPublic = true
				break
			}
		}
	}
	visibility := "private"
	if isPublic {
		visibility = "public"
	}
	var actorIDNum uint64
	if aLink := getLink(activity.Actor); aLink != "" {
		var a db.Actor
		if err := rds.Where("url = ?", aLink).First(&a).Error; err == nil {
			actorIDNum = a.ID
		}
	}
	var objectIDNum uint64
	if oLink := getLink(activity.Object); oLink != "" {
		var o db.ActivityPubObject
		if err := rds.Where("activity_pub_id = ?", oLink).First(&o).Error; err == nil {
			objectIDNum = o.ID
		}
	}
	apAct := db.ActivityPubActivity{ActivityPubID: activityID, ActorID: actorIDNum, ObjectID: objectIDNum, InReplyTo: inReplyToID, Sensitive: sensitive, SpoilerText: spoilerText, Visibility: visibility, IsPublic: isPublic, Content: gzipBytes(rawBody)}
	if err := rds.FirstOrCreate(&apAct, db.ActivityPubActivity{ActivityPubID: activityID}).Error; err != nil {
		return err
	}
	inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)
	item := db.ActivityPubCollection{CollectionID: inboxID, ItemID: apAct.ID, ItemType: string(activity.Type), AddedAt: time.Now()}
	if err := rds.Create(&item).Error; err != nil {
		return err
	}
	return nil
}

// ApplyFollowInbox persists follow state derived from an inbox activity.
func ApplyFollowInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	followerIRI := getLink(activity.Actor)
	var follower db.Actor
	var followerID uint64
	if err := rds.Where("url = ?", followerIRI).First(&follower).Error; err == nil {
		followerID = follower.ID
	}
	var me db.Actor
	var meID uint64
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err == nil {
		meID = me.ID
	}
	follow := db.ActivityPubFollow{FollowerID: followerID, FollowingID: meID, ActivityID: 0, IsActive: true, CreatedAt: time.Now()}
	if err := rds.Create(&follow).Error; err != nil {
		return nil
	}
	return nil
}

// ApplyUndoInbox clears follow/like relations derived from an undo activity.
func ApplyUndoInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	target := getLink(activity.Object)
	var apAct db.ActivityPubActivity
	if err := rds.Where("activity_pub_id = ?", target).First(&apAct).Error; err == nil {
		rds.Where("activity_id = ?", apAct.ID).Delete(&db.ActivityPubFollow{})
		rds.Where("activity_id = ?", apAct.ID).Delete(&db.ActivityPubLike{})
	}
	return nil
}

func gzipBytes(b []byte) []byte {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_, _ = zw.Write(b)
	_ = zw.Close()
	return buf.Bytes()
}

func gunzipBytes(b []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(zr)
	return out.Bytes(), nil
}

func getLink(item ap.Item) string {
	if item == nil {
		return ""
	}
	if item.IsLink() {
		return string(item.GetLink())
	}
	return string(item.GetID())
}
