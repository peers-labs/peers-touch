package activitypub

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

// Helper to get BaseURL
func getBaseURL(ctx *app.RequestContext) string {
	scheme := string(ctx.URI().Scheme())
	if scheme == "" {
		scheme = "https"
	}
	host := string(ctx.Host())
	return fmt.Sprintf("%s://%s", scheme, host)
}

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

// GetActor handles GET requests for user actor
func GetActor(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	if user == "" {
		log.Warnf(c, "User parameter is required")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	actorID := fmt.Sprintf("%s/users/%s", baseURL, user)

	var actor db.Actor
	var pubKey db.ActivityPubKey

	// Try to find the actor by name and namespace 'peers'
	// TODO: Support other namespaces if needed
	err = rds.Where("name = ? AND namespace = ?", user, "peers").First(&actor).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new actor if not exists (for testing/dev)
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				log.Errorf(c, "Failed to generate keys: %v", err)
				ctx.JSON(http.StatusInternalServerError, "Failed to generate keys")
				return
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
				ctx.JSON(http.StatusInternalServerError, "Failed to create actor")
				return
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
				ctx.JSON(http.StatusInternalServerError, "Failed to save keys")
				return
			}

			tx.Commit()
		} else {
			log.Errorf(c, "Failed to retrieve actor: %v", err)
			ctx.JSON(http.StatusInternalServerError, "Failed to retrieve actor")
			return
		}
	} else {
		// Actor found, fetch keys
		if err := rds.Where("actor_id = ?", actor.ID).First(&pubKey).Error; err != nil {
			// If keys missing, generate them (recovery logic)
			privateKey, publicKey, err := GenerateRSAKeyPair(2048)
			if err != nil {
				log.Errorf(c, "Failed to generate keys: %v", err)
				ctx.JSON(http.StatusInternalServerError, "Failed to generate keys")
				return
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
				ctx.JSON(http.StatusInternalServerError, "Failed to save keys")
				return
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

	actorObj.Inbox = ap.IRI(fmt.Sprintf("%s/inbox", actorID))
	actorObj.Outbox = ap.IRI(fmt.Sprintf("%s/outbox", actorID))
	actorObj.Followers = ap.IRI(fmt.Sprintf("%s/followers", actorID))
	actorObj.Following = ap.IRI(fmt.Sprintf("%s/following", actorID))
	actorObj.Liked = ap.IRI(fmt.Sprintf("%s/liked", actorID))

	// Add Public Key
	publicKeyID := fmt.Sprintf("%s#main-key", actorID)
	actorObj.PublicKey = ap.PublicKey{
		ID:           ap.ID(publicKeyID),
		Owner:        ap.IRI(actorID),
		PublicKeyPem: pubKey.PublicKeyPEM,
	}

	WriteActivityPubResponse(c, ctx, actorObj)
}

// HandleInboxActivity handles incoming ActivityPub activities
func HandleInboxActivity(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	if user == "" {
		log.Warnf(c, "User parameter is required for inbox activity")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	// Verify HTTP Signature
	if err := VerifyHTTPSignature(c, ctx); err != nil {
		log.Warnf(c, "HTTP Signature verification failed: %v", err)
		ctx.JSON(http.StatusUnauthorized, "Invalid HTTP Signature")
		return
	}

	body, err := ctx.Body()
	if err != nil {
		log.Errorf(c, "Failed to read request body: %v", err)
		ctx.JSON(http.StatusBadRequest, "Failed to read request body")
		return
	}

	var activity ap.Activity
	if err := json.Unmarshal(body, &activity); err != nil {
		log.Errorf(c, "Failed to unmarshal activity: %v", err)
		ctx.JSON(http.StatusBadRequest, "Invalid activity JSON")
		return
	}

	// Persist Activity and Add to Inbox
	activityID := string(activity.ID)
	if activityID != "" {
		// Save to ActivityPubActivity
		apActivity := db.ActivityPubActivity{
			ActivityPubID: activityID,
			Type:          string(activity.Type),
			ActorID:       getLink(activity.Actor),
			ObjectID:      getLink(activity.Object),
			Content:       string(body), // Store original body
		}
		// Create if not exists
		if err := rds.FirstOrCreate(&apActivity, db.ActivityPubActivity{ActivityPubID: activityID}).Error; err != nil {
			log.Warnf(c, "Failed to persist activity: %v", err)
		}

		// Add to Inbox Collection
		baseURL := getBaseURL(ctx)
		inboxID := fmt.Sprintf("%s/users/%s/inbox", baseURL, user)

		collectionItem := db.ActivityPubCollection{
			CollectionID: inboxID,
			ItemID:       activityID,
			ItemType:     string(activity.Type),
			AddedAt:      time.Now(),
		}
		if err := rds.Create(&collectionItem).Error; err != nil {
			log.Warnf(c, "Failed to add to inbox collection: %v", err)
		}
	}

	switch activity.Type {
	case ap.FollowType:
		handleFollow(c, ctx, &activity, user, rds)
	case ap.LikeType:
		handleLike(c, ctx, &activity, user, rds)
	case ap.UndoType:
		handleUndo(c, ctx, &activity, user, rds)
	case ap.CreateType:
		handleCreate(c, ctx, &activity, user, rds)
	case ap.UpdateType:
		handleUpdate(c, ctx, &activity, user, rds)
	case ap.DeleteType:
		handleDelete(c, ctx, &activity, user, rds)
	default:
		log.Warnf(c, "Unsupported activity type: %s", activity.Type)
		ctx.JSON(http.StatusOK, "Activity processed")
	}
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

func handleFollow(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	target := getLink(activity.Object)
	baseURL := getBaseURL(ctx)
	myActorID := fmt.Sprintf("%s/users/%s", baseURL, user)

	// Simple check if target is us
	if target != myActorID {
		log.Warnf(c, "Follow target mismatch: expected %s, got %s", myActorID, target)
		// We still accept it if it's in our inbox, but maybe log warning.
	}

	follower := getLink(activity.Actor)

	follow := db.ActivityPubFollow{
		FollowerID:  follower,
		FollowingID: myActorID,
		ActivityID:  string(activity.ID),
		IsActive:    true,
		CreatedAt:   time.Now(),
	}

	if err := rds.Create(&follow).Error; err != nil {
		log.Errorf(c, "Failed to save follow: %v", err)
	}

	// Send Accept Activity
	acceptID := fmt.Sprintf("%s/accept/%d", myActorID, time.Now().UnixNano())
	accept := ap.ActivityNew(ap.ID(acceptID), ap.AcceptType, ap.IRI(activity.ID))
	accept.Actor = ap.IRI(myActorID)
	accept.To = ap.ItemCollection{ap.IRI(follower)}

	// Persist Accept Activity
	// In a real implementation, we would also deliver this to the follower's inbox
	// For now, we just save it to our outbox/db so it "exists"

	// TODO: Implement delivery queue to push to remote inboxes

	ctx.JSON(http.StatusOK, "Follow received")
}

func handleLike(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	objectID := getLink(activity.Object)
	actorID := getLink(activity.Actor)

	like := db.ActivityPubLike{
		ActorID:    actorID,
		ObjectID:   objectID,
		ActivityID: string(activity.ID),
		IsActive:   true,
		CreatedAt:  time.Now(),
	}

	if err := rds.Create(&like).Error; err != nil {
		log.Errorf(c, "Failed to save like: %v", err)
	}

	ctx.JSON(http.StatusOK, "Like received")
}

func handleUndo(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	objectID := getLink(activity.Object)

	// Delete from Follows
	rds.Where("activity_id = ?", objectID).Delete(&db.ActivityPubFollow{})

	// Delete from Likes
	rds.Where("activity_id = ?", objectID).Delete(&db.ActivityPubLike{})

	ctx.JSON(http.StatusOK, "Undo received")
}

func handleCreate(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	// The activity is already persisted in the Inbox collection and Activity table.
	// Now we extract the Object and persist it as a remote object for easier querying.

	obj := activity.Object
	if obj == nil {
		return
	}

	var object *ap.Object
	if err := ap.OnObject(obj, func(o *ap.Object) error {
		object = o
		return nil
	}); err != nil {
		log.Warnf(c, "Failed to extract object from Create activity: %v", err)
		return
	}

	dbObj := &db.ActivityPubObject{
		ActivityPubID: string(object.ID),
		Type:          string(object.Type),
		AttributedTo:  string(activity.Actor.GetLink()),
		Published:     object.Published,
		IsLocal:       false, // Remote object
	}

	if len(object.Name) > 0 {
		dbObj.Name = string(object.Name.First().Value)
	}
	if len(object.Content) > 0 {
		dbObj.Content = string(object.Content.First().Value)
	}
	if len(object.Summary) > 0 {
		dbObj.Summary = string(object.Summary.First().Value)
	}
	if object.URL != nil {
		dbObj.URL = string(object.URL.GetLink())
	}
	if object.InReplyTo != nil {
		dbObj.InReplyTo = string(object.InReplyTo.GetLink())
	}

	// Upsert the object
	if err := rds.Save(dbObj).Error; err != nil {
		log.Warnf(c, "Failed to save remote object: %v", err)
	}

	ctx.JSON(http.StatusOK, "Create received")
}

func handleUpdate(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	objectID := getLink(activity.Object)
	if objectID == "" {
		log.Warnf(c, "Update object ID missing")
		ctx.JSON(http.StatusBadRequest, "Update object ID missing")
		return
	}

	// TODO: Implement logic to update local cache of remote object
	// e.g. fetch objectID again or use content in activity.Object if present.

	ctx.JSON(http.StatusOK, "Update processed")
}

func handleDelete(c context.Context, ctx *app.RequestContext, activity *ap.Activity, user string, rds *gorm.DB) {
	objectID := getLink(activity.Object)
	if objectID == "" {
		log.Warnf(c, "Delete object ID missing")
		ctx.JSON(http.StatusBadRequest, "Delete object ID missing")
		return
	}

	// Delete local cache of remote object if it exists (and isn't local)
	if err := rds.Where("activity_pub_id = ? AND is_local = ?", objectID, false).Delete(&db.ActivityPubObject{}).Error; err != nil {
		log.Warnf(c, "Failed to delete remote object: %v", err)
	}

	ctx.JSON(http.StatusOK, "Delete processed")
}

// GetOutboxActivities retrieves activities from an actor's outbox
func GetOutboxActivities(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	page := ctx.Query("page")
	if user == "" {
		log.Warnf(c, "User parameter is required for outbox activities")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	outboxID := fmt.Sprintf("%s/users/%s/outbox", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", outboxID).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count outbox items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to count outbox items")
		return
	}

	if page != "true" {
		collection := ap.OrderedCollectionNew(ap.ID(outboxID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", outboxID))
		collection.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", outboxID))

		log.Infof(c, "Retrieving outbox collection for user: %s", user)
		WriteActivityPubResponse(c, ctx, collection)
		return
	}

	// Get items from ActivityPubCollection
	var collectionItems []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", outboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		log.Errorf(c, "Failed to retrieve outbox items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to retrieve outbox items")
		return
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
	WriteActivityPubResponse(c, ctx, collection)
}

// GetFollowers retrieves the followers collection for an actor
func GetFollowers(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	page := ctx.Query("page")
	if user == "" {
		log.Warnf(c, "User parameter is required for followers")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	actorID := fmt.Sprintf("%s/users/%s", baseURL, user)
	followersID := fmt.Sprintf("%s/followers", actorID)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("following_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count followers: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to count followers")
		return
	}

	if page != "true" {
		collection := ap.OrderedCollectionNew(ap.ID(followersID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", followersID))

		log.Infof(c, "Retrieving followers collection for user: %s", user)
		WriteActivityPubResponse(c, ctx, collection)
		return
	}

	var follows []db.ActivityPubFollow
	// Find who is following THIS actor (FollowingID = actorID)
	if err := rds.Where("following_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&follows).Error; err != nil {
		log.Errorf(c, "Failed to retrieve followers: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to retrieve followers")
		return
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
	WriteActivityPubResponse(c, ctx, collection)
}

// GetInboxActivities retrieves activities from an actor's inbox
func GetInboxActivities(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	page := ctx.Query("page")
	if user == "" {
		log.Warnf(c, "User parameter is required for inbox activities")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	inboxID := fmt.Sprintf("%s/users/%s/inbox", baseURL, user)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubCollection{}).Where("collection_id = ?", inboxID).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count inbox items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to count inbox items")
		return
	}

	if page != "true" {
		collection := ap.OrderedCollectionNew(ap.ID(inboxID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", inboxID))
		collection.Last = ap.IRI(fmt.Sprintf("%s?page=true&min_id=0", inboxID))

		log.Infof(c, "Retrieving inbox collection for user: %s", user)
		WriteActivityPubResponse(c, ctx, collection)
		return
	}

	// Get items from ActivityPubCollection
	var collectionItems []db.ActivityPubCollection
	if err := rds.Where("collection_id = ?", inboxID).Order("added_at desc").Limit(20).Find(&collectionItems).Error; err != nil {
		log.Errorf(c, "Failed to retrieve inbox items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to retrieve inbox items")
		return
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
	WriteActivityPubResponse(c, ctx, collection)
}

// GetFollowing retrieves who an actor is following
func GetFollowing(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	page := ctx.Query("page")
	if user == "" {
		log.Warnf(c, "User parameter is required for following")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	actorID := fmt.Sprintf("%s/users/%s", baseURL, user)
	followingID := fmt.Sprintf("%s/following", actorID)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubFollow{}).Where("follower_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count following: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to count following")
		return
	}

	if page != "true" {
		collection := ap.OrderedCollectionNew(ap.ID(followingID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", followingID))

		log.Infof(c, "Retrieving following collection for user: %s", user)
		WriteActivityPubResponse(c, ctx, collection)
		return
	}

	var follows []db.ActivityPubFollow
	// Find who THIS actor is following (FollowerID = actorID)
	if err := rds.Where("follower_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&follows).Error; err != nil {
		log.Errorf(c, "Failed to retrieve following: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to retrieve following")
		return
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
	WriteActivityPubResponse(c, ctx, collection)
}

// GetLiked retrieves an actor's liked activities
func GetLiked(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("user")
	page := ctx.Query("page")
	if user == "" {
		log.Warnf(c, "User parameter is required for liked")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := getBaseURL(ctx)
	actorID := fmt.Sprintf("%s/users/%s", baseURL, user)
	likedID := fmt.Sprintf("%s/liked", actorID)

	var totalItems int64
	if err := rds.Model(&db.ActivityPubLike{}).Where("actor_id = ? AND is_active = ?", actorID, true).Count(&totalItems).Error; err != nil {
		log.Errorf(c, "Failed to count liked items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to count liked items")
		return
	}

	if page != "true" {
		collection := ap.OrderedCollectionNew(ap.ID(likedID))
		collection.TotalItems = uint(totalItems)
		collection.First = ap.IRI(fmt.Sprintf("%s?page=true", likedID))

		log.Infof(c, "Retrieving liked collection for user: %s", user)
		WriteActivityPubResponse(c, ctx, collection)
		return
	}

	var likes []db.ActivityPubLike
	if err := rds.Where("actor_id = ? AND is_active = ?", actorID, true).Limit(20).Find(&likes).Error; err != nil {
		log.Errorf(c, "Failed to retrieve liked items: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to retrieve liked items")
		return
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
	WriteActivityPubResponse(c, ctx, collection)
}

// Stubs for missing handlers referenced in activitypub_handler.go

// CreateFollow handles simplified follow requests
func CreateFollow(c context.Context, ctx *app.RequestContext) {
	handleSimplifiedActivity(c, ctx, ap.FollowType)
}

// CreateUnfollow handles simplified unfollow requests (Undo Follow)
func CreateUnfollow(c context.Context, ctx *app.RequestContext) {
	handleSimplifiedActivity(c, ctx, ap.UndoType)
}

// CreateLike handles simplified like requests
func CreateLike(c context.Context, ctx *app.RequestContext) {
	handleSimplifiedActivity(c, ctx, ap.LikeType)
}

// CreateUndo handles simplified undo requests
func CreateUndo(c context.Context, ctx *app.RequestContext) {
	handleSimplifiedActivity(c, ctx, ap.UndoType)
}

type SimpleRequest struct {
	Target string `json:"target"`
	Object string `json:"object"`
}

func handleSimplifiedActivity(c context.Context, ctx *app.RequestContext, activityType ap.ActivityVocabularyType) {
	user := ctx.Param("user")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter required")
		return
	}

	body, err := ctx.Body()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, "Failed to read body")
		return
	}

	var req SimpleRequest
	if err := json.Unmarshal(body, &req); err != nil {
		ctx.JSON(http.StatusBadRequest, "Invalid JSON")
		return
	}

	target := req.Target
	if target == "" {
		target = req.Object
	}
	if target == "" {
		ctx.JSON(http.StatusBadRequest, "Target/Object required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "DB Error")
		return
	}

	facade := actor.NewDefaultActivityPubFacade(rds)
	baseURL := getBaseURL(ctx)

	activity := ap.Activity{
		Type:   activityType,
		Object: ap.IRI(target),
	}

	// Special handling for Unfollow (Undo Follow)
	if activityType == ap.UndoType && req.Target != "" {
		// "Target" implies we provided a user ID to unfollow, so we must find the Follow activity
		var follow db.ActivityPubFollow
		myID := fmt.Sprintf("%s/users/%s", baseURL, user)
		if err := rds.Where("follower_id = ? AND following_id = ? AND is_active = ?", myID, target, true).First(&follow).Error; err == nil {
			activity.Object = ap.IRI(follow.ActivityID)
		} else {
			// If we can't find the follow, we can't undo it.
			// But maybe the user passed the Activity ID directly in "Object"?
			// If "Target" was set, we assumed it was a user ID.
			// If we failed to find it, and req.Object was NOT set, we error.
			if req.Object == "" {
				ctx.JSON(http.StatusNotFound, "Active follow not found for target")
				return
			}
			// If Object was set, we assume it might be the ActivityID, so we proceed with what we have in activity.Object (which is set to target=Object above if target was empty, but here target was not empty)
		}
	}

	if err := ProcessActivity(c, rds, facade, user, &activity, baseURL); err != nil {
		log.Errorf(c, "Failed to process simplified activity: %v", err)
		ctx.JSON(http.StatusInternalServerError, fmt.Sprintf("Error: %v", err))
		return
	}

	ctx.JSON(http.StatusOK, activity)
}

// WriteActivityPubResponse writes a JSON response with the ActivityPub Content-Type
func WriteActivityPubResponse(c context.Context, ctx *app.RequestContext, obj interface{}) {
	resp, err := json.Marshal(obj)
	if err != nil {
		log.Errorf(c, "Failed to marshal activitypub response: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}
	ctx.Data(http.StatusOK, "application/activity+json; charset=utf-8", resp)
}
