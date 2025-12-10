package activitypub

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
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

	var actor db.Actor
	var pubKey db.ActivityPubKey

	// Try to find the actor by name and namespace 'peers'
	// TODO: Support other namespaces if needed
	err := rds.Where("name = ? AND namespace = ?", user, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new actor if not exists (for testing/dev)
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				log.Errorf(c, "Failed to generate keys: %v", err)
				return nil, fmt.Errorf("failed to generate keys: %w", err)
			}

			// Start transaction
			tx := rds.Begin()

			// Create Actor
			actor = db.Actor{
				Name:         user,
				Namespace:    "peers",
				Type:         "Person",
				DisplayName:  user,
				PeersActorID: fmt.Sprintf("uuid-%s", user), // Temporary ID generation
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			if err := tx.Create(&actor).Error; err != nil {
				tx.Rollback()
				log.Errorf(c, "Failed to create actor: %v", err)
				return nil, fmt.Errorf("failed to create actor: %w", err)
			}

			// Create ActivityPubKey
			pubKey = db.ActivityPubKey{
				ActorID:       actor.ID,
				PublicKeyPEM:  publicKey,
				PrivateKeyPEM: privateKey,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
			}
			if err := tx.Create(&pubKey).Error; err != nil {
				tx.Rollback()
				log.Errorf(c, "Failed to save keys: %v", err)
				return nil, fmt.Errorf("failed to save keys: %w", err)
			}

			tx.Commit()
		} else {
			log.Errorf(c, "Failed to retrieve actor: %v", err)
			return nil, fmt.Errorf("failed to retrieve actor: %w", err)
		}
	} else {
		// Actor found, fetch keys
		if err := rds.Where("actor_id = ?", actor.ID).First(&pubKey).Error; err != nil {
			// If keys missing, generate them (recovery logic)
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				log.Errorf(c, "Failed to generate keys: %v", err)
				return nil, fmt.Errorf("failed to generate keys: %w", err)
			}

			pubKey = db.ActivityPubKey{
				ActorID:       actor.ID,
				PublicKeyPEM:  publicKey,
				PrivateKeyPEM: privateKey,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
			}
			if err := rds.Create(&pubKey).Error; err != nil {
				log.Errorf(c, "Failed to save keys: %v", err)
				return nil, fmt.Errorf("failed to save keys: %w", err)
			}
		}
	}

	// Construct ActivityPub Actor Object
	actorObj := ap.PersonNew(ap.ID(actorID))
	actorObj.PreferredUsername = ap.NaturalLanguageValuesNew()
	actorObj.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.Name)})

	if actor.DisplayName != "" {
		actorObj.Name = ap.NaturalLanguageValuesNew()
		actorObj.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(actor.DisplayName)})
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

	actorObj.Inbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user))
	actorObj.Outbox = ap.IRI(fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, user))
	actorObj.Followers = ap.IRI(fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user))
	actorObj.Following = ap.IRI(fmt.Sprintf("%s/activitypub/%s/following", baseURL, user))
	actorObj.Liked = ap.IRI(fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user))

	// Add Public Key
	publicKeyID := fmt.Sprintf("%s#main-key", actorID)
	actorObj.PublicKey = ap.PublicKey{
		ID:           ap.ID(publicKeyID),
		Owner:        ap.IRI(actorID),
		PublicKeyPem: pubKey.PublicKeyPEM,
	}

	// Endpoints including sharedInbox
	actorObj.Endpoints = &ap.Endpoints{}
	actorObj.Endpoints.SharedInbox = ap.IRI(fmt.Sprintf("%s/activitypub/inbox", baseURL))

	return actorObj, nil
}

// FetchInbox retrieves the inbox collection
func FetchInbox(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
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
	}

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
		if err := rds.Where("activity_pub_id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			if err := json.Unmarshal([]byte(activity.Content), &act); err == nil {
				collection.OrderedItems[i] = &act
				continue
			}
		}
		// Fallback to Link/IRI if content not found
		collection.OrderedItems[i] = ap.IRI(item.ItemID)
	}

	log.Infof(c, "Retrieving inbox activities page for user: %s", user)
	return collection, nil
}

// FetchOutbox retrieves the outbox collection
func FetchOutbox(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
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

		log.Infof(c, "Retrieving outbox collection for user: %s", user)
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
		if err := rds.Where("activity_pub_id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			if err := json.Unmarshal([]byte(activity.Content), &act); err == nil {
				collection.OrderedItems[i] = &act
				continue
			}
		}
		// Fallback to Link/IRI if content not found
		collection.OrderedItems[i] = ap.IRI(item.ItemID)
	}

	log.Infof(c, "Retrieving outbox activities page for user: %s", user)
	return collection, nil
}

// FetchFollowers retrieves the followers collection
func FetchFollowers(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	actorID := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user)
	followersID := fmt.Sprintf("%s/activitypub/%s/followers", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("following_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count followers: %v", err)
		return nil, fmt.Errorf("failed to count followers: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(followersID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", followersID))

		log.Infof(c, "Retrieving followers collection for user: %s", user)
		return collection, nil
	}

	var follows []db.ActivityPubFollow
	// Find who is following THIS actor (FollowingID = actorID)
	if err := rds.Where("following_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&follows).Error; err != nil {
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
		collection.OrderedItems[i] = ap.IRI(follow.FollowerID)
	}

	log.Infof(c, "Retrieving followers page for user: %s", user)
	return collection, nil
}

// FetchFollowing retrieves who an actor is following
func FetchFollowing(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	actorID := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user)
	followingID := fmt.Sprintf("%s/activitypub/%s/following", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("follower_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count following: %v", err)
		return nil, fmt.Errorf("failed to count following: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(followingID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", followingID))

		log.Infof(c, "Retrieving following collection for user: %s", user)
		return collection, nil
	}

	var follows []db.ActivityPubFollow
	// Find who THIS actor is following (FollowerID = actorID)
	if err := rds.Where("follower_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&follows).Error; err != nil {
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

	for i, follow := range follows {
		collection.OrderedItems[i] = ap.IRI(follow.FollowingID)
	}

	log.Infof(c, "Retrieving following page for user: %s", user)
	return collection, nil
}

// FetchLiked retrieves an actor's liked activities
func FetchLiked(c context.Context, rds *gorm.DB, user string, baseURL string, page bool) (interface{}, error) {
	actorID := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user)
	likedID := fmt.Sprintf("%s/activitypub/%s/liked", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubLike{}).Where("actor_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count liked items: %v", err)
		return nil, fmt.Errorf("failed to count liked items: %w", err)
	}

	if !page {
		collection := ap.OrderedCollectionNew(ap.ID(likedID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", likedID))

		log.Infof(c, "Retrieving liked collection for user: %s", user)
		return collection, nil
	}

	var likes []db.ActivityPubLike
	if err := rds.Where("actor_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&likes).Error; err != nil {
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
	collection.OrderedItems = make(ap.ItemCollection, len(likes))

	for i, like := range likes {
		collection.OrderedItems[i] = ap.IRI(like.ObjectID)
	}

	log.Infof(c, "Retrieving liked page for user: %s", user)
	return collection, nil
}

// FetchSharedInbox retrieves the shared inbox collection
func FetchSharedInbox(c context.Context, rds *gorm.DB, baseURL string, page bool) (interface{}, error) {
	inboxID := fmt.Sprintf("%s/inbox", baseURL)

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
		if err := rds.Where("activity_pub_id = ?", item.ItemID).First(&activity).Error; err == nil {
			var act ap.Activity
			if err := json.Unmarshal([]byte(activity.Content), &act); err == nil {
				collection.OrderedItems[i] = &act
				continue
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
		"protocols":         []string{"activitypub"},
		"services":          map[string][]string{"inbound": {}, "outbound": {}},
		"openRegistrations": false,
		"usage": map[string]interface{}{
			"users": map[string]int{"total": 0},
		},
		"metadata": map[string]interface{}{
			"baseURL": baseURL,
		},
	}
	return data
}

// Service-layer helpers without RequestContext
func PersistInboxActivity(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string, rawBody []byte) error {
	activityID := string(activity.ID)
	if activityID != "" {
		apActivity := db.ActivityPubActivity{
			ActivityPubID: activityID,
			Type:          string(activity.Type),
			ActorID:       getLink(activity.Actor),
			ObjectID:      getLink(activity.Object),
			Content:       string(rawBody),
		}
		if err := rds.FirstOrCreate(&apActivity, db.ActivityPubActivity{ActivityPubID: activityID}).Error; err != nil {
			return err
		}
		inboxID := fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, user)
		collectionItem := db.ActivityPubCollection{CollectionID: inboxID, ItemID: activityID, ItemType: string(activity.Type), AddedAt: time.Now()}
		if err := rds.Create(&collectionItem).Error; err != nil {
			return err
		}
	}
	return nil
}

func ApplyFollowInbox(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string) error {
	targetURI := getLink(activity.Object)
	myActorID := fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user)
	follower := getLink(activity.Actor)
	follow := db.ActivityPubFollow{FollowerID: follower, FollowingID: myActorID, ActivityID: string(activity.ID), IsActive: true, CreatedAt: time.Now()}
	if err := rds.Create(&follow).Error; err != nil {
		return err
	}

	acceptID := fmt.Sprintf("%s/activitypub/%s/accept/%d", baseURL, user, time.Now().UnixNano())
	accept := ap.ActivityNew(ap.ID(acceptID), ap.AcceptType, ap.IRI(activity.ID))
	accept.Actor = ap.IRI(myActorID)
	accept.To = ap.ItemCollection{ap.IRI(follower)}

	followerActor, err := FetchActorDoc(c, follower)
	if err != nil {
		return nil
	}
	targetInbox, err := ChooseInbox(followerActor, true)
	if err != nil || targetInbox == "" {
		return nil
	}

	var myActor db.Actor
	if e := rds.Where("name = ? AND namespace = ?", user, "peers").First(&myActor).Error; e != nil {
		return nil
	}
	var myKey db.ActivityPubKey
	if e := rds.Where("actor_id = ?", myActor.ID).First(&myKey).Error; e != nil {
		return nil
	}
	keyID := fmt.Sprintf("%s#main-key", myActorID)
	_, _ = DeliverActivity(c, targetInbox, accept, keyID, myKey.PrivateKeyPEM)
	_ = targetURI
	return nil
}

func ApplyUndoInbox(c context.Context, rds *gorm.DB, user string, activity *ap.Activity, baseURL string) error {
	targetActivityURI := getLink(activity.Object)
	rds.Where("activity_id = ?", targetActivityURI).Delete(&db.ActivityPubFollow{})
	rds.Where("activity_id = ?", targetActivityURI).Delete(&db.ActivityPubLike{})
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
