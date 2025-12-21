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

// CreateOutboxActivity has been moved to activitypub_handler.go as PostUserOutbox to comply with architectural rules.

func ProcessActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
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
	if object.InReplyTo != nil {
		dbObj.InReplyTo = string(object.InReplyTo.GetLink())
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

	// 5. Persist Activity
	return persistActivity(dbConn, username, activity, string(object.ID), baseURL, string(object.InReplyTo.GetLink()))
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

	// Persist Follow
	follow := &db.ActivityPubFollow{
		FollowerID:  string(activity.Actor.GetLink()),
		FollowingID: resolvedURI,
		ActivityID:  string(activity.ID),
		Accepted:    false,
		IsActive:    true,
	}

	if err := dbConn.Create(follow).Error; err != nil {
		return fmt.Errorf("failed to create follow in DB: %w", err)
	}

	return persistActivity(dbConn, username, activity, resolvedURI, baseURL, "")
}

func handleLikeActivity(c context.Context, dbConn *gorm.DB, username string, activity *ap.Activity, baseURL string) error {
	log.Infof(c, "Handling Like activity for user %s", username)

	targetURI := activity.Object.GetLink()
	if targetURI == "" {
		return fmt.Errorf("like target is required")
	}

	// Persist Like
	like := &db.ActivityPubLike{
		ActorID:    string(activity.Actor.GetLink()),
		ObjectID:   string(targetURI),
		ActivityID: string(activity.ID),
		IsActive:   true,
	}

	if err := dbConn.Create(like).Error; err != nil {
		return fmt.Errorf("failed to create like in DB: %w", err)
	}

	return persistActivity(dbConn, username, activity, string(targetURI), baseURL, "")
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
		if err := dbConn.Model(&db.ActivityPubFollow{}).Where("activity_id = ?", originalActivity.ActivityPubID).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("failed to deactivate follow: %w", err)
		}
	case ap.LikeType:
		// Deactivate Like
		if err := dbConn.Model(&db.ActivityPubLike{}).Where("activity_id = ?", originalActivity.ActivityPubID).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("failed to deactivate like: %w", err)
		}
	case ap.BlockType:
		// Implement Block undo
	default:
		log.Warnf(c, "Undo not fully implemented for activity type %s", originalActivity.Type)
	}

	return persistActivity(dbConn, username, activity, string(targetActivityURI), baseURL, "")
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

	return persistActivity(dbConn, username, activity, string(object.ID), baseURL, "")
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
	if err := dbConn.Model(&db.ActivityPubObject{}).Where("activity_pub_id = ?", targetURI).Update("type", "Tombstone").Error; err != nil {
		log.Warnf(c, "Failed to mark object as Tombstone: %v", err)
	}

	return persistActivity(dbConn, username, activity, string(targetURI), baseURL, "")
}

func persistActivity(dbConn *gorm.DB, username string, activity *ap.Activity, objectID string, baseURL string, inReplyTo string) error {
	// Helper to simplify local IRIs
	simplify := func(iri string) string {
		if len(iri) > len(baseURL) && iri[:len(baseURL)] == baseURL {
			return iri[len(baseURL):]
		}
		return iri
	}

	actID := string(activity.ID)
	actorID := string(activity.Actor.GetLink())

	dbAct := &db.ActivityPubActivity{
		ActivityPubID: simplify(actID),
		Type:          string(activity.Type),
		ActorID:       simplify(actorID),
		ObjectID:      simplify(objectID),
		TargetID:      "", // TargetID not used in outbox yet (Announce uses ObjectID)
		InReplyTo:     simplify(inReplyTo),
		Published:     activity.Published,
		IsLocal:       true,
	}

	// Save full JSON content
	actJSON, err := json.Marshal(activity)
	if err == nil {
		dbAct.Content = string(actJSON)
	}

	if err := dbConn.Create(dbAct).Error; err != nil {
		return fmt.Errorf("failed to create activity in DB: %w", err)
	}

	// Add to Outbox collection
	colItem := &db.ActivityPubCollection{
		CollectionID: fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, username),
		ItemID:       simplify(actID),
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
	if err := rds.Where("name = ?", username).First(&actor).Error; err != nil {
		log.Errorf(ctx, "Delivery: Actor %s not found: %v", username, err)
		return
	}

	// Get Keys
	var keys db.ActivityPubKey
	if err := rds.Where("actor_id = ?", actor.ID).First(&keys).Error; err != nil {
		log.Errorf(ctx, "Delivery: Keys for actor %s not found: %v", username, err)
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
			myActorID := fmt.Sprintf("%s/%s/actor", baseURL, username)
			if err := rds.Where("following_id = ? AND is_active = ?", myActorID, true).Find(&followers).Error; err == nil {
				for _, f := range followers {
					// Add the follower's IRI (Actor ID)
					targets[f.FollowerID] = true
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
		statusCode, err := DeliverActivity(ctx, inbox, activity, keyID, keys.PrivateKeyPEM)
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

	if err := persistActivity(dbConn, username, activity, string(targetURI), baseURL, ""); err != nil {
		return err
	}
	return nil
}
