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

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

// GenerateRSAKeyPair generates a new RSA key pair
func GenerateRSAKeyPair(bits int) (string, string, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return "", "", err
	}

	privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateKeyBytes,
	})

	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", "", err
	}
	publicKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	})

	return string(privateKeyPEM), string(publicKeyPEM), nil
}

// GetActorData retrieves the actor data for a user
func GetActorData(c context.Context, rds *gorm.DB, user string, baseURL string) (*ap.Person, error) {
	actorID := fmt.Sprintf("%s/%s/actor", baseURL, user)
	}
	actorID := fmt.Sprintf("%s/%s/actor", baseURL, user)

	var actor db.Actor

	err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error
	// TODO: Support other namespaces if needed
	err = rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new actor if not exists (for testing/dev)
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				log.Errorf(c, "Failed to generate keys: %v", err)
				return nil, fmt.Errorf("failed to generate keys: %w", err)
			}
			tx := rds.Begin()
			// Start transaction
			tx := rds.Begin()

			// Generate PTID via identity service (before creating actor)
			var ptid string
			if iden, ierr := identity.CreateIdentity(c, user, "peers", identity.TypePerson); ierr == nil && iden != nil && iden.PTID != "" {
				ptid = iden.PTID
			} else {
				ptid = fmt.Sprintf("ptid:v1:actor:peers:Person:%s:%d", user, time.Now().UnixNano())
			}

			// Create Actor
			actor = db.Actor{
				Name:              user, // Handle (JSON-LD: name)
				PreferredUsername: user, // Handle (JSON-LD: preferredUsername)
				Namespace:         "peers",
				Type:              "Person",
				// Name is DisplayName in new struct
				PTID:       ptid,
				PublicKey:  publicKey,
				PrivateKey: privateKey,
				Url:        fmt.Sprintf("%s/users/%s", baseURL, user),
				Inbox:      fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user),
				Outbox:     fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user),
				Followers:  fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user),
				Following:  fmt.Sprintf("%s/activitypub/%s/following", baseURL, user),
				Liked:      fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user),
				Endpoints:  fmt.Sprintf(`{"sharedInbox": "%s/activitypub/inbox"}`, baseURL),
				CreatedAt:  time.Now(),
				UpdatedAt:  time.Now(),
			}
			if err := tx.Create(&actor).Error; err != nil {
				tx.Rollback()
				log.Errorf(c, "Failed to create actor: %v", err)
				return nil, fmt.Errorf("failed to create actor: %w", err)
			}

			// PTID is set before actor creation; no post-update required

			// Create ActivityPubKey
			// Deprecated: Keys now in Actor table
			/*
				// Removed
			*/

			tx.Commit()
		} else {
			log.Errorf(c, "Failed to retrieve actor: %v", err)
			return nil, fmt.Errorf("failed to retrieve actor: %w", err)
		}
	} else {
		// Actor found, ensure keys exist (migration/check)
		if actor.PublicKey == "" {
			// If keys missing in Actor table, check old table or generate
			// Since ActivityPubKey is deleted, we can only check if keys are missing and generate new ones
			// or assume migration happened elsewhere.
			// For safety, generate new keys if missing.

			// Generate new keys
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				return nil, fmt.Errorf("failed to generate keys: %w", err)
			}
			rds.Save(&actor)
			actor.PrivateKey = privateKey
			rds.Save(&actor)
		}
	}

	// Construct ActivityPub Actor Object
	actorObj := ap.PersonNew(ap.ID(actorID))
	actorObj.PreferredUsername = ap.NaturalLanguageValuesNew()
	actorObj.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.PreferredUsername)})

	if actor.Name != "" {
		actorObj.Name = ap.NaturalLanguageValuesNew()
		actorObj.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Name)})
	}

	if actor.Summary != "" {
		actorObj.Summary = ap.NaturalLanguageValuesNew()
		actorObj.Summary.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Summary)})
	}

	if actor.Icon != "" {
		icon := ap.ObjectNew(ap.ImageType)
		icon.URL = ap.IRI(actor.Icon)
		actorObj.Icon = icon
	}

	if actor.Image != "" {
		image := ap.ObjectNew(ap.ImageType)
		image.URL = ap.IRI(actor.Image)
		actorObj.Image = image
	}

	if actor.Inbox != "" {
		actorObj.Inbox = ap.IRI(actor.Inbox)
	} else {
		actorObj.Inbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user))
	}
	if actor.Outbox != "" {
		actorObj.Outbox = ap.IRI(actor.Outbox)
	} else {
		actorObj.Outbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user))
	}
	if actor.Followers != "" {
		actorObj.Followers = ap.IRI(actor.Followers)
	} else {
		actorObj.Followers = ap.IRI(fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user))
	}
	if actor.Following != "" {
		actorObj.Following = ap.IRI(actor.Following)
	} else {
		actorObj.Following = ap.IRI(fmt.Sprintf("%s/activitypub/%s/following", baseURL, user))
	}
	if actor.Liked != "" {
		actorObj.Liked = ap.IRI(actor.Liked)
	} else {
		actorObj.Liked = ap.IRI(fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user))
	}

	// Add Public Key
	publicKeyID := fmt.Sprintf("%s#main-key", actorID)
	actorObj.PublicKey = ap.PublicKey{
		ID:           ap.ID(publicKeyID),
		Owner:        ap.IRI(actorID),
		PublicKeyPem: actor.PublicKey,
	}

	// Endpoints including sharedInbox
	actorObj.Endpoints = &ap.Endpoints{}
	if actor.Endpoints != "" {
		var epMap map[string]string
		if err := json.Unmarshal([]byte(actor.Endpoints), &epMap); err == nil {
			if shared, ok := epMap["sharedInbox"]; ok {
				actorObj.Endpoints.SharedInbox = ap.IRI(shared)
			}
		}
	} else {
		actorObj.Endpoints.SharedInbox = ap.IRI(fmt.Sprintf("%s/activitypub/inbox", baseURL))
	return actorObj, nil

	return actorObj, nil
}
func FetchInbox(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)
	if err != nil {
		return nil, err
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&totalItems).Error; err != nil {
	inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count inbox items: %v", err)
		return nil, fmt.Errorf("failed to count inbox items: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(inboxID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		collection.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", inboxID))

		log.Infof(c, "Retrieving inbox collection for user: %s", user)
		return collection, nil
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {

	// Get items from ActivityPubCollection
	var collectionItems []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		log.Errorf(c, "Failed to retrieve inbox items: %v", err)
		return nil, fmt.Errorf("failed to retrieve inbox items: %w", err)
	}

	// Create OrderedCollectionPage
	pageID := fmt.Sprintf("%s?page=true", inboxID)
	inbox := ap.OrderedCollectionNew(ap.ID(inboxID))
	inbox.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(inbox)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(inboxID)

	collection.OrderedItems = make(ap.ItemCollection, len(collectionItems))
	for i, item := range collectionItems {
		var activity db.ActivityPubActivity
		if err := rds.Where("id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			var data []byte
			if len(activity.Content) > 0 {
				if bz, err := gunzipBytes(activity.Content); err == nil {
					data = bz
				}
			}
			if data != nil {
				if err := json.Unmarshal(data, &act); err == nil {
					collection.OrderedItems[i] = &act
					continue
				}
			}
		}
		// Fallback to Link/IRI if content not found
	return collection, nil
	}

	log.Infof(c, "Retrieving inbox activities page for user: %s", user)
func FetchOutbox(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	outboxID := fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user)
func FetchOutbox(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", outboxID).Count(&totalItems).Error; err != nil {
		return nil, err
	}
	outboxID := fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", outboxID).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count outbox items: %v", err)
		return nil, fmt.Errorf("failed to count outbox items: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(outboxID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", outboxID))
		collection.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", outboxID))

	if err := rds.Where("collection_id = ?", outboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		return collection, nil
	}

	// Get items from ActivityPubCollection
	var collectionItems []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", outboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		log.Errorf(c, "Failed to retrieve outbox items: %v", err)
		return nil, fmt.Errorf("failed to retrieve outbox items: %w", err)
	}

	// Create OrderedCollectionPage
	pageID := fmt.Sprintf("%s?page=true", outboxID)
	outbox := ap.OrderedCollectionNew(ap.ID(outboxID))
	outbox.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(outbox)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(outboxID)

	collection.OrderedItems = make(ap.ItemCollection, len(collectionItems))
	for i, item := range collectionItems {
		var activity db.ActivityPubActivity
		if err := rds.Where("id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			var data []byte
			if len(activity.Content) > 0 {
				if bz, err := gunzipBytes(activity.Content); err == nil {
					data = bz
				}
			}
			if data != nil {
				if err := json.Unmarshal(data, &act); err == nil {
					collection.OrderedItems[i] = &act
					continue
				}
			}
	return collection, nil
		// Fallback to Link/IRI if content not found
		collection.OrderedItems[i] = ap.IRI(item.ItemID)
	}
func FetchFollowers(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	followersID := fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user)

	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
func FetchFollowers(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	if err := rds.Model(&db.ActivityPubFollow{}).Where("following_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
	followersID := fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("following_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count followers: %v", err)
		return nil, fmt.Errorf("failed to count followers: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(followersID))
		collection.TotalItems = uint(totalItems)
	if err := rds.Where("following_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {

		log.Infof(c, "Retrieving followers collection for user: %s", user)
		return collection, nil
	}

	var follows []db.ActivityPubFollow
	// Find who is following THIS actor (FollowingID = actorID)
	if err := rds.Where("following_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {
		log.Errorf(c, "Failed to retrieve followers: %v", err)
		return nil, fmt.Errorf("failed to retrieve followers: %w", err)
	}

	pageID := fmt.Sprintf("%s?page=true", followersID)
	// Create OrderedCollectionPage
	followers := ap.OrderedCollectionNew(ap.ID(followersID))
	followers.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(followers)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(followersID)
	collection.OrderedItems = make(ap.ItemCollection, len(follows))

	for i, follow := range follows {
		var fa db.Actor
	return collection, nil
			collection.OrderedItems[i] = ap.IRI(fa.Url)
		} else {
			collection.OrderedItems[i] = ap.IRI("")
func FetchFollowing(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	followingID := fmt.Sprintf("%s/activitypub/%s/following", baseURL, user)
	return collection, nil
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {

// FetchFollowing retrieves who an actor is following
func FetchFollowing(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err := rds.Model(&db.ActivityPubFollow{}).Where("follower_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
		return nil, err
	}
	followingID := fmt.Sprintf("%s/activitypub/%s/following", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("follower_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count following: %v", err)
		return nil, fmt.Errorf("failed to count following: %w", err)
	}

	if !page {
	if err := rds.Where("follower_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", followingID))

		log.Infof(c, "Retrieving following collection for user: %s", user)
		return collection, nil
	}

	var follows []db.ActivityPubFollow
	// Find who THIS actor is following (FollowerID = actorID)
	if err := rds.Where("follower_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&follows).Error; err != nil {
		log.Errorf(c, "Failed to retrieve following: %v", err)
		return nil, fmt.Errorf("failed to retrieve following: %w", err)
	}

	pageID := fmt.Sprintf("%s?page=true", followingID)
	// Create OrderedCollectionPage
	following := ap.OrderedCollectionNew(ap.ID(followingID))
	following.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(following)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(followingID)
	collection.OrderedItems = make(ap.ItemCollection, len(follows))

	return collection, nil
		var ta db.Actor
		if err := rds.Where("id = ?", follow.FollowingID).First(&ta).Error; err == nil && ta.Url != "" {
			collection.OrderedItems[i] = ap.IRI(ta.Url)
func FetchLiked(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	likedID := fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user)

	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
	return collection, nil
}

// FetchLiked retrieves an actor's liked activities
	if err := rds.Model(&db.ActivityPubLike{}).Where("actor_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	likedID := fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user)
	var me db.Actor
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&me).Error; err != nil {
		return nil, fmt.Errorf("actor_not_found")
	}

	var totalItems int64
	if err := rds.Model(&db.ActivityPubLike{}).Where("actor_id = ? AND is_active = ?", me.ID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count liked items: %v", err)
		return nil, fmt.Errorf("failed to count liked items: %w", err)
	if err := rds.Where("actor_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&likes).Error; err != nil {

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(likedID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", likedID))

		log.Infof(c, "Retrieving liked collection for user: %s", user)
		return collection, nil
	}

	var likes []db.ActivityPubLike
	if err := rds.Where("actor_id = ? AND is_active = ?", me.ID, true).Limit(20).Find(&likes).Error; err != nil {
		log.Errorf(c, "Failed to retrieve liked items: %v", err)
		return nil, fmt.Errorf("failed to retrieve liked items: %w", err)
	}

	pageID := fmt.Sprintf("%s?page=true", likedID)
	// Create OrderedCollectionPage
	liked := ap.OrderedCollectionNew(ap.ID(likedID))
	liked.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(liked)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(likedID)
	return collection, nil

	for i, like := range likes {
		var obj db.ActivityPubObject
func FetchSharedInbox(c context.Context, rds *gorm.DB, baseURL string, page bool) (interface{}, error) {
	inboxID := fmt.Sprintf("%s/inbox", baseURL)
		}
	}
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&totalItems).Error; err != nil {
	log.Infof(c, "Retrieving liked page for user: %s", user)
	return collection, nil
}

// FetchSharedInbox retrieves the shared inbox collection
func FetchSharedInbox(c context.Context, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}
	inboxID := fmt.Sprintf("%s/inbox", baseURL)
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
	var totalItems int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&totalItems).Error; err != nil {
		return nil, fmt.Errorf("failed to count inbox items: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(inboxID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		return collection, nil
	}

	var collectionItems []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		return nil, fmt.Errorf("failed to retrieve inbox items: %w", err)
	}

	pageID := fmt.Sprintf("%s?page=true", inboxID)
	inbox := ap.OrderedCollectionNew(ap.ID(inboxID))
	inbox.TotalItems = uint(totalItems)
	collection := ap.OrderedCollectionPageNew(inbox)
	collection.ID = ap.ID(pageID)
	collection.PartOf = ap.IRI(inboxID)
	collection.OrderedItems = make(ap.ItemCollection, len(collectionItems))
	for i, item := range collectionItems {
		var activity db.ActivityPubActivity
		if err := rds.Where("id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			var data []byte
	return collection, nil
				if bz, err := gunzipBytes(activity.Content); err == nil {
					data = bz
				}
			}
			if data != nil {
				if err := json.Unmarshal(data, &act); err == nil {
					collection.OrderedItems[i] = &act
					continue
				}
			}
		}
		collection.OrderedItems[i] = ap.IRI(item.ItemID)
	}
	return collection, nil
}

// GetNodeInfo returns the NodeInfo 2.1 data
func GetNodeInfo(baseURL string) map[string]interface{} {
	data := map[string]interface{}{
		"version":           "2.1",
		"software":          map[string]string{"name": "peers-touch", "version": "dev"},
func PersistInboxActivity(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string, rawBody []byte) error {
	activityID := string(activity.ID)
			"users": map[string]int{"total": 0},
		},
		"metadata": map[string]interface{}{
			"baseURL": baseURL,
		},
	}
	return data
}

// Service-layer helpers without RequestContext
func PersistInboxActivity(c context.Context, user string, activity *ap.Activity, baseURL string, rawBody []byte) error {
	rds, err := store.GetRDS(c)
					if err := rds.Where("activity_pub_id = ?", inReplyTo).First(&parentObj).Error; err == nil {
		return err
	}
	activityID := string(activity.ID)
	if activityID != "" {
		var inReplyTo string
		var inReplyToID uint64
		var text string
		var sensitive bool
		var spoilerText string

		if activity.Object != nil {
			_ = ap.OnObject(activity.Object, func(o *ap.Object) error {
				if o.InReplyTo != nil {
					inReplyTo = getLink(o.InReplyTo)
					var parentObj db.ActivityPubObject
					if err := rds.Where("activity_pub_id = ?", inReplyTo).First(&parentObj).Error; err == nil {
						inReplyToID = parentObj.ID
					} else {
						inReplyToID = 0
					}
				}
				if len(o.Content) > 0 {
					text = string(o.Content.First().Value)
				}
				if len(o.Summary) > 0 {
					spoilerText = string(o.Summary.First().Value)
				}
				return nil
			})
		}

		// Determine Visibility
		isPublic := false
		for _, to := range activity.To {
			if to.GetLink() == ap.PublicNS {
				isPublic = true
				break
			}
		}
		if !isPublic {
			for _, cc := range activity.CC {
			if err := rds.Where("url = ?", aLink).First(&actorRec).Error; err == nil {
					isPublic = true
					break
				}
			}
		}
		visibility := "private"
			if err := rds.Where("activity_pub_id = ?", oLink).First(&objRec).Error; err == nil {
		if isPublic {
			visibility = "public"
			isPublicFlag = true
		}

		var actorIDNum uint64
		if aLink := getLink(activity.Actor); aLink != "" {
			var actorRec db.Actor
			if err := rds.Where("url = ?", aLink).First(&actorRec).Error; err == nil {
				actorIDNum = actorRec.ID
			}
		}
		var objectIDNum uint64
		if oLink := getLink(activity.Object); oLink != "" {
			var objRec db.ActivityPubObject
			if err := rds.Where("activity_pub_id = ?", oLink).First(&objRec).Error; err == nil {
				objectIDNum = objRec.ID
		if err := rds.FirstOrCreate(&apActivity, db.ActivityPubActivity{ActivityPubID: activityID}).Error; err != nil {
		}

		apActivity := db.ActivityPubActivity{
			ActivityPubID: activityID,
		if err := rds.Create(&collectionItem).Error; err != nil {
			ActorID:       actorIDNum,
			ObjectID:      objectIDNum,
			InReplyTo:     inReplyToID,
	return nil
			Sensitive:     sensitive,
			SpoilerText:   spoilerText,
			Visibility:    visibility,
			IsPublic:      isPublicFlag,
			Content:       gzipBytes(rawBody),
		}
		if err := rds.FirstOrCreate(&apActivity, db.ActivityPubActivity{ActivityPubID: activityID}).Error; err != nil {
			return err
		}
		inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)
		collectionItem := db.ActivityPubCollection{CollectionID: inboxID, ItemID: apActivity.ID, ItemType: string(activity.Type), AddedAt: time.Now()}
		if err := rds.Create(&collectionItem).Error; err != nil {
			return err
		}
	}
	return nil
}

func gzipBytes(b []byte) []byte {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
func ApplyFollowInbox(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string) error {
	targetURI := getLink(activity.Object)

func gunzipBytes(b []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
	if err := rds.Where("url = ?", followerIRI).First(&followerRec).Error; err == nil {
	}
	defer zr.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(zr)
	return out.Bytes(), nil
}

func ApplyFollowInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	targetURI := getLink(activity.Object)
	myActorIRI := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user)
	followerIRI := getLink(activity.Actor)
	var followerRec db.Actor
	var followerID uint64
	if err := rds.Where("url = ?", followerIRI).First(&followerRec).Error; err == nil {
		followerID = followerRec.ID
	}
	var myActorRec db.Actor
	var myActorID uint64
	if err := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&myActorRec).Error; err == nil {
		myActorID = myActorRec.ID
	}
	follow := db.ActivityPubFollow{FollowerID: followerID, FollowingID: myActorID, ActivityID: 0, IsActive: true, CreatedAt: time.Now()}
	if err := rds.Create(&follow).Error; err != nil {
	if e := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&myActor).Error; e != nil {
		return nil
	}
	acceptID := fmt.Sprintf("%s/activitypub/%s/accept/%d", baseURL, user, time.Now().UnixNano())
	accept := ap.ActivityNew(ap.ID(acceptID), ap.AcceptType, ap.IRI(activity.ID))
	accept.Actor = ap.IRI(myActorIRI)
	accept.To = ap.ItemCollection{ap.IRI(followerIRI)}

	followerActor, err := FetchActorDoc(c, followerIRI)
	if err != nil {
func ApplyUndoInbox(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string) error {
	targetActivityURI := getLink(activity.Object)
		return nil
	}

	var myActor db.Actor
	if e := rds.Where("preferred_username = ? AND namespace = ?", user, "peers").First(&myActor).Error; e != nil {
	return nil
	}

	keyID := fmt.Sprintf("%s#main-key", myActorIRI)
	_, _ = DeliverActivity(c, targetInbox, accept, keyID, myActor.PrivateKey)
	_ = targetURI
	return nil
}

func ApplyUndoInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		return err
	}
	targetActivityURI := getLink(activity.Object)
	var apAct db.ActivityPubActivity
	if err := rds.Where("activity_pub_id = ?", targetActivityURI).First(&apAct).Error; err == nil {
		rds.Where("activity_id = ?", apAct.ID).Delete(&db.ActivityPubFollow{})
		rds.Where("activity_id = ?", apAct.ID).Delete(&db.ActivityPubLike{})
	}
	return nil
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
