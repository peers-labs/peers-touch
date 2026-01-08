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
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

const (
	CollectionTypeInbox       = "inbox"
	CollectionTypeOutbox      = "outbox"
	CollectionTypeFollowers   = "followers"
	CollectionTypeFollowing   = "following"
	CollectionTypeLiked       = "liked"
	CollectionTypeSharedInbox = "shared_inbox"
)

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

func GetActorData(c context.Context, user string, baseURL string) (*ap.Person, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	urlGen := NewURLGenerator(baseURL)

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
				Inbox:             urlGen.InboxURL(user),
				Outbox:            urlGen.OutboxURL(user),
				Followers:         urlGen.FollowersURL(user),
				Following:         urlGen.FollowingURL(user),
				Liked:             urlGen.LikedURL(user),
				Endpoints:         fmt.Sprintf(`{"sharedInbox":"%s"}`, urlGen.SharedInboxURL()),
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

	actorID := urlGen.ActorURL(user)
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

	person.Inbox = ap.IRI(urlGen.InboxURL(user))
	person.Outbox = ap.IRI(urlGen.OutboxURL(user))
	person.Followers = ap.IRI(urlGen.FollowersURL(user))
	person.Following = ap.IRI(urlGen.FollowingURL(user))
	person.Liked = ap.IRI(urlGen.LikedURL(user))

	person.PublicKey = ap.PublicKey{
		ID:           ap.ID(fmt.Sprintf("%s#main-key", actorID)),
		Owner:        ap.IRI(actorID),
		PublicKeyPem: actor.PublicKey,
	}

	person.Endpoints = &ap.Endpoints{
		SharedInbox: ap.IRI(urlGen.SharedInboxURL()),
	}

	return person, nil
}

func FetchInbox(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found: %w", err)
	}

	urlGen := NewURLGenerator(baseURL)
	inboxID := urlGen.InboxURL(user)

	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).
		Where("actor_id = ? AND collection_type = ?", actor.ID, CollectionTypeInbox).
		Count(&total).Error; err != nil {
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
	if err := rds.Where("actor_id = ? AND collection_type = ?", actor.ID, CollectionTypeInbox).
		Order("added_at desc").
		Limit(20).
		Find(&items).Error; err != nil {
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

func FetchOutbox(c context.Context, user string, baseURL string, page bool, viewerID uint64) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found: %w", err)
	}

	urlGen := NewURLGenerator(baseURL)
	outboxID := urlGen.OutboxURL(user)

	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).
		Where("actor_id = ? AND collection_type = ?", actor.ID, CollectionTypeOutbox).
		Count(&total).Error; err != nil {
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
	if err := rds.Where("actor_id = ? AND collection_type = ?", actor.ID, CollectionTypeOutbox).
		Order("added_at desc").
		Limit(20).
		Find(&items).Error; err != nil {
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
			if act.Type != string(ap.CreateType) && act.Type != string(ap.AnnounceType) {
				continue
			}

			if act.Type == string(ap.CreateType) && act.Reply {
				continue
			}

			if act.ObjectID != 0 {
				var obj db.ActivityPubObject
				if err := rds.Where("id = ?", act.ObjectID).First(&obj).Error; err == nil {
					if obj.Type == "Tombstone" {
						continue
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
					enrichActivity(c, rds, &a, act.ObjectID, viewerID, baseURL)
					col.OrderedItems = append(col.OrderedItems, &a)
					continue
				}
			}
		}
		col.OrderedItems = append(col.OrderedItems, ap.IRI(it.ItemID))
	}
	return col, nil
}

func enrichActivity(c context.Context, rds *gorm.DB, a *ap.Activity, objectID uint64, viewerID uint64, baseURL string) {
	if objectID == 0 {
		return
	}

	var obj db.ActivityPubObject
	if err := rds.Where("id = ?", objectID).First(&obj).Error; err != nil {
		return
	}

	_ = ap.OnObject(a.Object, func(o *ap.Object) error {
		col := ap.OrderedCollectionNew(ap.ID(""))
		col.TotalItems = uint(obj.LikesCount)
		o.Likes = col

		colReplies := ap.OrderedCollectionNew(ap.ID(""))
		colReplies.TotalItems = uint(obj.RepliesCount)
		if obj.RepliesCount > 0 {
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
							if r.AttributedTo != "" {
								if attributedToID, err := ParseObjectID(r.AttributedTo); err == nil {
									var replyActor db.Actor
									if err := rds.Where("id = ?", attributedToID).First(&replyActor).Error; err == nil {
										urlGen := NewURLGenerator(baseURL)
										actorURL := urlGen.ActorURL(replyActor.PreferredUsername)
										person := ap.PersonNew(ap.ID(actorURL))
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
								}
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

		colShares := ap.OrderedCollectionNew(ap.ID(""))
		colShares.TotalItems = uint(obj.SharesCount)
		o.Shares = colShares

		if o.AttributedTo != nil {
			if o.AttributedTo.IsLink() {
				actorIRI := string(o.AttributedTo.GetLink())
				if actorID, err := ParseObjectID(actorIRI); err == nil {
					var actor db.Actor
					if err := rds.Where("id = ?", actorID).First(&actor).Error; err == nil {
						urlGen := NewURLGenerator(baseURL)
						expandedActorURL := urlGen.ActorURL(actor.PreferredUsername)
						person := ap.PersonNew(ap.ID(expandedActorURL))

						if actor.Name != "" {
							person.Name = ap.NaturalLanguageValuesNew()
							person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Name)})
						}
						person.PreferredUsername = ap.NaturalLanguageValuesNew()
						person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.PreferredUsername)})

						if actor.Icon != "" {
							ic := ap.ObjectNew(ap.ImageType)
							ic.URL = ap.IRI(actor.Icon)
							person.Icon = ic
						}
						o.AttributedTo = person
					}
				}
			}
		}

		return nil
	})
}

func FetchFollowers(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	urlGen := NewURLGenerator(baseURL)
	followersID := urlGen.FollowersURL(user)

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
		if err := rds.Where("id = ?", f.FollowerID).First(&a).Error; err == nil {
			followerURL := urlGen.ActorURL(a.PreferredUsername)
			col.OrderedItems[i] = ap.IRI(followerURL)
		} else {
			col.OrderedItems[i] = ap.IRI("")
		}
	}
	return col, nil
}

func FetchFollowing(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	urlGen := NewURLGenerator(baseURL)
	followingID := urlGen.FollowingURL(user)

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
		if err := rds.Where("id = ?", f.FollowingID).First(&a).Error; err == nil {
			followingURL := urlGen.ActorURL(a.PreferredUsername)
			col.OrderedItems[i] = ap.IRI(followingURL)
		} else {
			col.OrderedItems[i] = ap.IRI("")
		}
	}
	return col, nil
}

func FetchLiked(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	urlGen := NewURLGenerator(baseURL)
	likedID := urlGen.LikedURL(user)

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

func FetchSharedInbox(c context.Context, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	urlGen := NewURLGenerator(baseURL)
	inboxID := urlGen.SharedInboxURL()

	var total int64
	if err := rds.Model(&db.ActivityPubCollection{}).
		Where("actor_id = 0 AND collection_type = ?", CollectionTypeSharedInbox).
		Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count shared inbox: %w", err)
	}

	if !page {
		col := ap.OrderedCollectionNew(ap.ID(inboxID))
		col.TotalItems = uint(total)
		col.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		return col, nil
	}

	var items []db.ActivityPubCollection
	if err := rds.Where("actor_id = 0 AND collection_type = ?", CollectionTypeSharedInbox).
		Order("added_at desc").
		Limit(20).
		Find(&items).Error; err != nil {
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

func FetchObjectReplies(c context.Context, objectID string, baseURL string, page bool, afterID uint64, limit int) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	var obj db.ActivityPubObject
	if numericID, err := strconv.ParseUint(objectID, 10, 64); err == nil {
		if err := rds.Where("id = ?", numericID).First(&obj).Error; err != nil {
			return nil, fmt.Errorf("object not found by ID: %w", err)
		}
	} else {
		if parsedID, err := ParseObjectID(objectID); err == nil {
			if err := rds.Where("id = ?", parsedID).First(&obj).Error; err != nil {
				return nil, fmt.Errorf("object not found by parsed ID: %w", err)
			}
		} else {
			if err := rds.Where("activity_pub_id = ?", objectID).First(&obj).Error; err != nil {
				return nil, fmt.Errorf("object not found by ActivityPub ID: %w", err)
			}
		}
	}

	repliesID := fmt.Sprintf("%s?replies=true", obj.ActivityPubID)

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

	urlGen := NewURLGenerator(baseURL)
	var lastID uint64
	for i, r := range replies {
		var replyObj ap.Object
		if r.Metadata != "" {
			if err := json.Unmarshal([]byte(r.Metadata), &replyObj); err == nil {
				if r.AttributedTo != "" {
					if attributedToID, err := ParseObjectID(r.AttributedTo); err == nil {
						var replyActor db.Actor
						if err := rds.Where("id = ?", attributedToID).First(&replyActor).Error; err == nil {
							actorURL := urlGen.ActorURL(replyActor.PreferredUsername)
							person := ap.PersonNew(ap.ID(actorURL))
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
					}
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
				if parsedID, err := ParseObjectID(inReplyTo); err == nil {
					var parent db.ActivityPubObject
					if err := rds.Where("id = ?", parsedID).First(&parent).Error; err == nil {
						inReplyToID = parent.ID
					}
				} else {
					var parent db.ActivityPubObject
					if err := rds.Where("activity_pub_id = ?", inReplyTo).First(&parent).Error; err == nil {
						inReplyToID = parent.ID
					}
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
		if parsedID, err := ParseActivityID(aLink); err == nil {
			actorIDNum = parsedID
		} else {
			var a db.Actor
			if err := rds.Where("url = ?", aLink).First(&a).Error; err == nil {
				actorIDNum = a.ID
			}
		}
	}

	var objectIDNum uint64
	if oLink := getLink(activity.Object); oLink != "" {
		if parsedID, err := ParseObjectID(oLink); err == nil {
			objectIDNum = parsedID
		} else {
			var o db.ActivityPubObject
			if err := rds.Where("activity_pub_id = ?", oLink).First(&o).Error; err == nil {
				objectIDNum = o.ID
			}
		}
	}

	var activityIDNum uint64
	if parsedID, err := ParseActivityID(activityID); err == nil {
		activityIDNum = parsedID
	} else {
		activityIDNum = id.NextID()
	}

	apAct := db.ActivityPubActivity{
		ID:          activityIDNum,
		Type:        string(activity.Type),
		ActorID:     actorIDNum,
		ObjectID:    objectIDNum,
		InReplyTo:   inReplyToID,
		Sensitive:   sensitive,
		SpoilerText: spoilerText,
		Visibility:  visibility,
		IsPublic:    isPublic,
		Published:   time.Now(),
		IsLocal:     false,
		Content:     gzipBytes(rawBody),
	}
	if err := rds.FirstOrCreate(&apAct, db.ActivityPubActivity{ID: activityIDNum}).Error; err != nil {
		return err
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error; err != nil {
		return fmt.Errorf("actor not found: %w", err)
	}

	item := db.ActivityPubCollection{
		ActorID:        actor.ID,
		CollectionType: CollectionTypeInbox,
		ItemID:         apAct.ID,
		ItemType:       string(activity.Type),
		AddedAt:        time.Now(),
	}
	if err := rds.Create(&item).Error; err != nil {
		return err
	}

	return nil
}

func ApplyFollowInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}

	followerIRI := getLink(activity.Actor)
	var follower db.Actor
	var followerID uint64
	if parsedID, err := ParseActivityID(followerIRI); err == nil {
		followerID = parsedID
	} else {
		if err := rds.Where("url = ?", followerIRI).First(&follower).Error; err == nil {
			followerID = follower.ID
		}
	}

	var me db.Actor
	var meID uint64
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err == nil {
		meID = me.ID
	}

	follow := db.ActivityPubFollow{
		FollowerID:  followerID,
		FollowingID: meID,
		ActivityID:  0,
		IsActive:    true,
		CreatedAt:   time.Now(),
	}
	if err := rds.Create(&follow).Error; err != nil {
		return nil
	}
	return nil
}

func ApplyUndoInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}

	target := getLink(activity.Object)
	var activityID uint64
	if parsedID, err := ParseActivityID(target); err == nil {
		activityID = parsedID
	} else {
		var apAct db.ActivityPubActivity
		if err := rds.Where("activity_pub_id = ?", target).First(&apAct).Error; err == nil {
			activityID = apAct.ID
		}
	}

	if activityID != 0 {
		rds.Where("activity_id = ?", activityID).Delete(&db.ActivityPubFollow{})
		rds.Where("activity_id = ?", activityID).Delete(&db.ActivityPubLike{})
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

type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

func IsValidationError(err error) bool {
	_, ok := err.(*ValidationError)
	return ok
}

func ProcessActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return fmt.Errorf("failed to get DB: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		return fmt.Errorf("actor not found: %w", err)
	}

	activityJSON, err := json.Marshal(activity)
	if err != nil {
		return fmt.Errorf("failed to marshal activity: %w", err)
	}

	var objectID uint64
	if activity.Object != nil {
		if objMap, ok := activity.Object.(*ap.Object); ok && objMap.ID != "" {
			if parsedID, err := ParseObjectID(string(objMap.ID)); err == nil {
				objectID = parsedID
			}
		}
	}

	dbActivity := &db.ActivityPubActivity{
		ID:        id.NextID(),
		Type:      string(activity.Type),
		ActorID:   actor.ID,
		ObjectID:  objectID,
		Published: time.Now(),
		IsLocal:   true,
		IsPublic:  true,
		Content:   gzipBytes(activityJSON),
	}

	if err := rds.Create(dbActivity).Error; err != nil {
		return fmt.Errorf("failed to create activity: %w", err)
	}

	collection := &db.ActivityPubCollection{
		ID:             id.NextID(),
		ActorID:        actor.ID,
		CollectionType: "outbox",
		ItemID:         dbActivity.ID,
		ItemType:       "Activity",
		AddedAt:        time.Now(),
	}

	if err := rds.Create(collection).Error; err != nil {
		return fmt.Errorf("failed to add to outbox: %w", err)
	}

	return nil
}
