package activitypub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

// ProcessActivity persists and delivers an outgoing ActivityPub activity.
func ProcessActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	// Ensure Actor is set
	if activity.Actor == nil {
		activity.Actor = ap.IRI(fmt.Sprintf("%s/%s/actor", baseURL, username))
	}

	if activity.Published.IsZero() {
		activity.Published = time.Now()
	}
	if activity.ID == "" {
		activity.ID = ap.ID(fmt.Sprintf("%s/activities/%d", activity.Actor, time.Now().UnixNano()))
	}

	dbConn, err := store.GetRDS(c)
	if err != nil {
		return fmt.Errorf("failed to get DB: %w", err)
	}

	switch activity.Type {
	case ap.CreateType:
		return handleCreateActivity(c, dbConn, username, activity, baseURL)
	case ap.FollowType:
		return handleFollowActivity(c, dbConn, username, activity, baseURL)
	case ap.LikeType:
		return handleLikeActivity(c, dbConn, username, activity, baseURL)
	case ap.UndoType:
		return handleUndoActivity(c, dbConn, username, activity, baseURL)
	case ap.AnnounceType:
		return handleAnnounceActivity(c, dbConn, username, activity, baseURL)
	case ap.UpdateType:
		return handleUpdateActivity(c, dbConn, username, activity, baseURL)
	case ap.DeleteType:
		return handleDeleteActivity(c, dbConn, username, activity, baseURL)
	default:
		return fmt.Errorf("unsupported activity type: %s", activity.Type)
	}
}

func handleCreateActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Create activity for user %s", username)

	// 1. Get the Object
	obj := activity.Object
	if obj == nil {
		return fmt.Errorf("activity object is required")
	}

	// 2. Process Object
	var object *ap.Object
	err := ap.OnObject(obj, func(o *ap.Object) error {
		object = o
		return nil
	})
	if err != nil {
		// Try to see if it is a map that can be converted?
		// For now assume strict typing
		return fmt.Errorf("invalid object type in Create activity: %v", err)
	}

	// 3. Complete Object Metadata
	if object.ID == "" {
		object.ID = ap.ID(fmt.Sprintf("%s/objects/%d", activity.Actor, time.Now().UnixNano()))
	}
	if object.AttributedTo == nil {
		object.AttributedTo = activity.Actor
	}
	if object.Published.IsZero() {
		object.Published = time.Now()
	}

	// 4. Persist Object
	dbObj := &db.ActivityPubObject{
		ActivityPubID: string(object.ID),
		Type:          string(object.Type),
		AttributedTo:  string(activity.Actor.GetLink()),
		Published:     object.Published,
		IsLocal:       true,
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
	var inReplyToID uint64
	if object.InReplyTo != nil {
		inReplyToID = localObjectIDFromItem(dbConn, object.InReplyTo)
		// If resolution failed by ID, try resolving by URL/Link if needed,
		// but localObjectIDFromItem handles both Link and Object ID lookups.
		// However, it relies on the parent object already existing in our DB.
		// If replying to a remote object that hasn't been fetched yet, this will be 0.
		// We might need to fetch it if missing? For now assuming it exists (fetched via inbox or search).
		dbObj.InReplyTo = inReplyToID
	}

	// Serialize full object for Metadata storage
	// This ensures we keep attachments, tags, etc. and fixes the JSON error.
	objJSON, err := json.Marshal(object)
	if err == nil {
		dbObj.Metadata = string(objJSON)
	} else {
		// Fallback to empty JSON if marshaling fails
		dbObj.Metadata = "{}"
		log.Warnf(c, "Failed to marshal object to JSON: %v", err)
	}

	if err := dbConn.Create(dbObj).Error; err != nil {
		return fmt.Errorf("failed to create object in DB: %w", err)
	}

	// Update Statuses Count for the actor
	var actor db.Actor
	if err := dbConn.Where("preferred_username = ?", username).First(&actor).Error; err == nil {
		// Ensure meta exists or create it? Usually exists for local users.
		// Using gorm.Expr to be safe against concurrency (simple +1)
		_ = dbConn.Model(&db.ActorTouchMeta{}).Where("actor_id = ?", actor.ID).
			Update("statuses_count", gorm.Expr("statuses_count + ?", 1)).Error
	}

	// 5. Persist Activity
	return persistActivity(dbConn, username, activity, dbObj.ID, baseURL, inReplyToID, object)
}

func handleFollowActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Follow activity for user %s", username)

	targetURI := string(activity.Object.GetLink())
	if targetURI == "" {
		return fmt.Errorf("follow target is required")
	}

	// Resolve target to canonical Actor IRI
	resolvedURI, err := ResolveActorIRI(c, targetURI)
	if err != nil {
		return fmt.Errorf("failed to resolve target %s: %w", targetURI, err)
	}
	activity.Object = ap.IRI(resolvedURI)

	// Resolve numeric IDs
	var follower db.Actor
	var followerID uint64
	if err := dbConn.Where("preferred_username = ?", username).First(&follower).Error; err == nil {
		followerID = follower.ID
	}
	var followingID uint64
	var remoteActor db.Actor
	if err := dbConn.Where("url = ?", resolvedURI).First(&remoteActor).Error; err == nil {
		followingID = remoteActor.ID
	}

	// Create follow (activity id to be set after persist)
	follow := &db.ActivityPubFollow{FollowerID: followerID, FollowingID: followingID, ActivityID: 0, Accepted: false, IsActive: true}
	if err := dbConn.Create(follow).Error; err != nil {
		return fmt.Errorf("failed to create follow in DB: %w", err)
	}

	// Update Counts
	// 1. Increment Following count for Follower (Local User)
	_ = dbConn.Model(&db.ActorTouchMeta{}).Where("actor_id = ?", followerID).
		Update("following_count", gorm.Expr("following_count + ?", 1)).Error

	// 2. Increment Followers count for Following (Remote/Local User)
	// Even if remote, if we have a record in our DB, we might want to track it,
	// though usually we only care about local users' meta.
	// But `remoteActor` was found in DB, so it exists.
	_ = dbConn.Model(&db.ActorTouchMeta{}).Where("actor_id = ?", followingID).
		Update("followers_count", gorm.Expr("followers_count + ?", 1)).Error

	if err := persistActivity(dbConn, username, activity, 0, baseURL, 0, nil); err != nil {
		return err
	}
	// Backfill activity numeric id
	var apAct db.ActivityPubActivity
	if err := dbConn.Where("activity_pub_id = ?", activity.ID).First(&apAct).Error; err == nil {
		_ = dbConn.Model(&db.ActivityPubFollow{}).Where("id = ?", follow.ID).Update("activity_id", apAct.ID).Error
	}
	return nil
}

func handleLikeActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Like activity for user %s", username)

	if activity.Object == nil {
		return fmt.Errorf("like target is required")
	}

	// Resolve numeric IDs
	var actorRec db.Actor
	var actorIDNum uint64
	if err := dbConn.Where("preferred_username = ?", username).First(&actorRec).Error; err == nil {
		actorIDNum = actorRec.ID
	}
	objIDNum := localObjectIDFromItem(dbConn, activity.Object)

	like := &db.ActivityPubLike{ActorID: actorIDNum, ObjectID: objIDNum, ActivityID: 0, IsActive: true}
	if err := dbConn.Create(like).Error; err != nil {
		return fmt.Errorf("failed to create like in DB: %w", err)
	}

	if err := persistActivity(dbConn, username, activity, objIDNum, baseURL, 0, nil); err != nil {
		return err
	}
	var apAct db.ActivityPubActivity
	if err := dbConn.Where("activity_pub_id = ?", activity.ID).First(&apAct).Error; err == nil {
		_ = dbConn.Model(&db.ActivityPubLike{}).Where("id = ?", like.ID).Update("activity_id", apAct.ID).Error
	}
	return nil
}

func handleUndoActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Undo activity for user %s", username)

	// The object of Undo is the Activity being undone
	targetActivityURI := activity.Object.GetLink()
	if targetActivityURI == "" {
		return fmt.Errorf("undo target activity is required")
	}

	// Find the original activity to know what to undo
	var originalActivity db.ActivityPubActivity
	if err := dbConn.Where("activity_pub_id = ?", targetActivityURI).First(&originalActivity).Error; err != nil {
		return fmt.Errorf("original activity not found: %w", err)
	}

	// Perform undo logic based on original activity type
	switch ap.ActivityVocabularyType(originalActivity.Type) {
	case ap.FollowType:
		// Deactivate Follow
		var follow db.ActivityPubFollow
		if err := dbConn.Where("activity_id = ?", originalActivity.ID).First(&follow).Error; err != nil {
			return fmt.Errorf("follow record not found for undo: %w", err)
		}

		if err := dbConn.Model(&follow).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("failed to deactivate follow: %w", err)
		}

		// Decrement Counts
		_ = dbConn.Model(&db.ActorTouchMeta{}).Where("actor_id = ?", follow.FollowerID).
			Update("following_count", gorm.Expr("following_count - ?", 1)).Error
		_ = dbConn.Model(&db.ActorTouchMeta{}).Where("actor_id = ?", follow.FollowingID).
			Update("followers_count", gorm.Expr("followers_count - ?", 1)).Error
	case ap.LikeType:
		// Deactivate Like
		if err := dbConn.Model(&db.ActivityPubLike{}).Where("activity_id = ?", originalActivity.ID).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("failed to deactivate like: %w", err)
		}
	case ap.BlockType:
		// Implement Block undo
	default:
		log.Warnf(c, "Undo not fully implemented for activity type %s", originalActivity.Type)
	}

	return persistActivity(dbConn, username, activity, 0, baseURL, 0, nil)
}

func handleUpdateActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Update activity for user %s", username)

	// Get updated object
	obj := activity.Object
	var object *ap.Object
	if err := ap.OnObject(obj, func(o *ap.Object) error {
		object = o
		return nil
	}); err != nil {
		return fmt.Errorf("invalid object in Update: %v", err)
	}

	// Update DB Object
	// We need to find by ActivityPubID
	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}
	if len(object.Name) > 0 {
		updates["name"] = string(object.Name.First().Value)
	}
	if len(object.Content) > 0 {
		updates["content"] = string(object.Content.First().Value)
	}
	if len(object.Summary) > 0 {
		updates["summary"] = string(object.Summary.First().Value)
	}

	if err := dbConn.Model(&db.ActivityPubObject{}).Where("activity_pub_id = ?", object.ID).Updates(updates).Error; err != nil {
		return fmt.Errorf("failed to update object: %w", err)
	}

	var objID uint64
	if object.ID != "" {
		var existing db.ActivityPubObject
		if err := dbConn.Where("activity_pub_id = ?", object.ID).First(&existing).Error; err == nil {
			objID = existing.ID
		}
	}
	return persistActivity(dbConn, username, activity, objID, baseURL, 0, object)
}

func handleDeleteActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Delete activity for user %s", username)

	targetURI := activity.Object.GetLink()
	if targetURI == "" {
		return fmt.Errorf("delete target is required")
	}

	// Delete (soft delete or mark deleted)
	// Currently we don't have DeletedAt in ActivityPubObject?
	// We can use IsActive or similar if it existed.
	// Or we can actually delete.
	// For now, let's just persist the Delete activity.

	// If we want to support Tombstone, we should update the object type to Tombstone.
	var objID uint64
	if activity.Object != nil {
		objID = localObjectIDFromItem(dbConn, activity.Object)
		if objID != 0 {
			_ = dbConn.Model(&db.ActivityPubObject{}).Where("id = ?", objID).Update("type", "Tombstone").Error
		}
	}
	return persistActivity(dbConn, username, activity, objID, baseURL, 0, nil)
}

func persistActivity(dbConn *gorm.DB, username string, activity *ap.Activity, objectID uint64, baseURL string, inReplyToID uint64, metadata *ap.Object) error {
	// Helper to simplify local IRIs
	simplify := func(iri string) string {
		if len(iri) > len(baseURL) && iri[:len(baseURL)] == baseURL {
			return iri[len(baseURL):]
		}
		return iri
	}

	actID := string(activity.ID)
	// Resolve local actor numeric ID
	var actorRec db.Actor
	var actorIDNum uint64
	if err := dbConn.Where("preferred_username = ?", username).First(&actorRec).Error; err == nil {
		actorIDNum = actorRec.ID
	}

	dbAct := &db.ActivityPubActivity{
		ActivityPubID: simplify(actID),
		Type:          string(activity.Type),
		ActorID:       actorIDNum,
		ObjectID:      objectID,
		TargetID:      0,
		InReplyTo:     0,
		Published:     activity.Published,
		IsLocal:       true,
		Visibility:    "public",
	}

	// Extract Metadata if provided (mainly for Create Note)
	if metadata != nil {
		if len(metadata.Content) > 0 {
			dbAct.Text = string(metadata.Content.First().Value)
		}
		// dbAct.Sensitive = metadata.Sensitive
		if len(metadata.Summary) > 0 {
			dbAct.SpoilerText = string(metadata.Summary.First().Value)
		}
		// Language could be extracted from ContentMap if available
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
			if cc.GetLink() == ap.PublicNS {
				isPublic = true
				break
			}
		}
	}

	if isPublic {
		dbAct.Visibility = "public"
		dbAct.IsPublic = true
	} else {
		// Simplified visibility logic
		dbAct.Visibility = "private" // or unlisted/direct
		dbAct.IsPublic = false
	}

	// Set numeric InReplyTo if provided
	if inReplyToID != 0 {
		dbAct.InReplyTo = inReplyToID
	}

	// Save compressed JSON content
	if actJSON, err := json.Marshal(activity); err == nil {
		dbAct.Content = gzipBytes(actJSON)
	}

	if err := dbConn.Create(dbAct).Error; err != nil {
		return fmt.Errorf("failed to create activity in DB: %w", err)
	}

	// Add to Outbox collection
	colItem := &db.ActivityPubCollection{
		CollectionID: fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, username),
		ItemID:       dbAct.ID,
		ItemType:     "Activity",
		AddedAt:      time.Now(),
	}
	dbConn.Create(colItem)

	// Trigger async delivery to remote instances
	go deliverToRemote(username, activity, baseURL)

	return nil
}

func deliverToRemote(username string, activity *ap.Activity, baseURL string) {
	ctx := context.Background()
	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Errorf(ctx, "Delivery: Failed to get DB: %v", err)
		return
	}

	// Get Actor
	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		log.Errorf(ctx, "Delivery: Actor %s not found: %v", username, err)
		return
	}

	keyID := fmt.Sprintf("%s/%s/actor#main-key", baseURL, username)

	// Determine targets
	targets := make(map[string]bool)

	// Helper to add targets
	addTarget := func(iri string) {
		if iri == "" || iri == ap.PublicNS.String() {
			return
		}

		// Handle Followers Collection
		// Check if it matches our followers collection ID
		// Typically: baseURL/ap/u/{username}/followers or similar
		// But here we constructed it as: baseURL/{username}/followers (see GetFollowing in activitypub.go)
		// Let's match the suffix or construct the expected ID.
		expectedFollowersID := fmt.Sprintf("%s/%s/followers", baseURL, username)
		if iri == expectedFollowersID {
			var followers []db.ActivityPubFollow
			// Who is following me? FollowingID = My Actor ID
			myActorID := actor.ID
			if err := rds.Where("following_id = ? AND is_active = ?", myActorID, true).Find(&followers).Error; err == nil {
				for _, f := range followers {
					var fa db.Actor
					if err := rds.Where("id = ?", f.FollowerID).First(&fa).Error; err == nil && fa.Inbox != "" {
						targets[fa.Inbox] = true
					} else if fa.Url != "" {
						targets[fa.Url] = true
					}
				}
			} else {
				log.Warnf(ctx, "Delivery: Failed to fetch followers for %s: %v", username, err)
			}
			return
		}

		targets[iri] = true
	}

	if activity.Type == ap.FollowType {
		// Deliver to object (the person being followed)
		addTarget(string(activity.Object.GetLink()))
	} else {
		// For Create, Announce, etc.
		for _, to := range activity.To {
			addTarget(string(to.GetLink()))
		}
		for _, cc := range activity.CC {
			addTarget(string(cc.GetLink()))
		}
	}

	// Process targets
	for targetIRI := range targets {
		// Resolve Inbox
		// We need to fetch the actor to find their inbox
		remoteActor, err := FetchActorDoc(ctx, targetIRI)
		if err != nil {
			log.Warnf(ctx, "Delivery: Failed to fetch remote actor %s: %v", targetIRI, err)
			continue
		}

		inbox, err := ChooseInbox(remoteActor, true) // Prefer shared inbox
		if err != nil {
			log.Warnf(ctx, "Delivery: No inbox for %s: %v", targetIRI, err)
			continue
		}

		// Send
		log.Infof(ctx, "Delivery: Sending activity %s to %s", activity.ID, inbox)
		statusCode, err := DeliverActivity(ctx, inbox, activity, keyID, actor.PrivateKey)
		if err != nil {
			log.Errorf(ctx, "Delivery: Failed to send to %s: %v", inbox, err)
		} else {
			log.Infof(ctx, "Delivery: Sent to %s, status: %d", inbox, statusCode)
		}
	}
}

func handleAnnounceActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Announce activity for user %s", username)

	targetURI := activity.Object.GetLink()
	if targetURI == "" {
		return fmt.Errorf("announce target is required")
	}

	// Persist Announce as a regular activity referencing target object
	if activity.ID == "" {
		activity.ID = ap.ID(fmt.Sprintf("%s/activities/%d", activity.Actor, time.Now().UnixNano()))
	}
	if activity.Published.IsZero() {
		activity.Published = time.Now()
	}

	var objID uint64
	if targetURI != "" {
		var obj db.ActivityPubObject
		if err := dbConn.Where("activity_pub_id = ?", targetURI).First(&obj).Error; err == nil {
			objID = obj.ID
		}
	}
	if err := persistActivity(dbConn, username, activity, objID, baseURL, 0, nil); err != nil {
		return err
	}
	return nil
}

// localObjectIDFromItem resolves an ActivityPub Item (object or link) to local numeric object ID.
func localObjectIDFromItem(dbConn *gorm.DB, item ap.Item) uint64 {
	if item == nil {
		return 0
	}
	if item.IsLink() {
		var obj db.ActivityPubObject
		if err := dbConn.Where("activity_pub_id = ?", item.GetLink()).First(&obj).Error; err == nil {
			return obj.ID
		}
		return 0
	}
	id := item.GetID()
	if id != "" {
		var obj db.ActivityPubObject
		if err := dbConn.Where("activity_pub_id = ?", id).First(&obj).Error; err == nil {
			return obj.ID
		}
	}
	return 0
}
