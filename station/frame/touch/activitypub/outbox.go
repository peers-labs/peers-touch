package activitypub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	"gorm.io/gorm"
)

func ProcessActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	switch activity.Type {
	case "Create":
		return processCreateActivity(c, username, activity, baseURL)
	case "Update":
		return processUpdateActivity(c, username, activity, baseURL)
	case "Delete":
		return processDeleteActivity(c, username, activity, baseURL)
	case "Like":
		return processLikeActivity(c, username, activity, baseURL)
	case "Announce":
		return processAnnounceActivity(c, username, activity, baseURL)
	case "Follow":
		return processFollowActivity(c, username, activity, baseURL)
	case "Undo":
		return processUndoActivity(c, username, activity, baseURL)
	default:
		return fmt.Errorf("unsupported activity type: %s", activity.Type)
	}
}

func processCreateActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		logger.Errorf(c, "Failed to get database connection: %v", err)
		return fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		logger.Warnf(c, "Actor not found: %s", username)
		return fmt.Errorf("actor not found: %s", username)
	}

	objBytes, err := json.Marshal(activity.Object)
	if err != nil {
		return fmt.Errorf("failed to marshal object: %w", err)
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(objBytes, &obj); err != nil {
		return fmt.Errorf("failed to unmarshal object: %w", err)
	}

	content, _ := obj["content"].(string)
	if content == "" {
		return fmt.Errorf("content is required")
	}

	// Check if this is a comment (has inReplyTo)
	inReplyTo, _ := obj["inReplyTo"].(string)
	
	if inReplyTo != "" {
		// This is a comment - write to touch_comments table
		return createComment(c, rds, actor.ID, content, inReplyTo, baseURL)
	}

	// This is a post - write to touch_posts table
	postID := id.NextID()
	post := db.Post{
		ID:         postID,
		AuthorID:   actor.ID,
		Type:       "note",
		Visibility: "public",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := rds.Create(&post).Error; err != nil {
		logger.Errorf(c, "Failed to create post: %v", err)
		return fmt.Errorf("create post failed: %w", err)
	}

	postContent := db.PostContent{
		PostID: postID,
		Text:   content,
	}

	if err := rds.Create(&postContent).Error; err != nil {
		logger.Errorf(c, "Failed to create post content: %v", err)
		return fmt.Errorf("create post content failed: %w", err)
	}

	logger.Infof(c, "Created post %d for actor %s", postID, username)
	return nil
}

func createComment(c context.Context, rds *gorm.DB, authorID uint64, content string, inReplyTo string, baseURL string) error {
	// Extract post ID from inReplyTo URL
	// Format: http://localhost:18080/posts/319006603456023042
	var postID uint64
	_, err := fmt.Sscanf(inReplyTo, "%s/posts/%d", &baseURL, &postID)
	if err != nil || postID == 0 {
		logger.Warnf(c, "Failed to parse inReplyTo URL: %s, error: %v", inReplyTo, err)
		return fmt.Errorf("invalid inReplyTo URL: %s", inReplyTo)
	}

	// Verify the post exists
	var post db.Post
	if err := rds.Where("id = ?", postID).First(&post).Error; err != nil {
		logger.Warnf(c, "Parent post not found: %d", postID)
		return fmt.Errorf("parent post not found: %d", postID)
	}

	commentID := id.NextID()
	comment := db.Comment{
		ID:        commentID,
		PostID:    postID,
		AuthorID:  authorID,
		Content:   content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := rds.Create(&comment).Error; err != nil {
		logger.Errorf(c, "Failed to create comment: %v", err)
		return fmt.Errorf("create comment failed: %w", err)
	}

	// Update post's comments count
	if err := rds.Model(&db.Post{}).Where("id = ?", postID).
		UpdateColumn("comments_count", gorm.Expr("comments_count + ?", 1)).Error; err != nil {
		logger.Warnf(c, "Failed to update comments count: %v", err)
	}

	logger.Infof(c, "Created comment %d for post %d", commentID, postID)
	return nil
}

func processUpdateActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("Update activity not yet implemented")
}

func processDeleteActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("Delete activity not yet implemented")
}

func processLikeActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		logger.Errorf(c, "Failed to get database connection: %v", err)
		return fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		logger.Warnf(c, "Actor not found: %s", username)
		return fmt.Errorf("actor not found: %s", username)
	}

	objBytes, err := json.Marshal(activity.Object)
	if err != nil {
		return fmt.Errorf("failed to marshal object: %w", err)
	}

	var objectID string
	if err := json.Unmarshal(objBytes, &objectID); err != nil {
		return fmt.Errorf("invalid object ID format: %w", err)
	}

	var postID uint64
	_, err = fmt.Sscanf(objectID, "%s/posts/%d", &baseURL, &postID)
	if err != nil {
		return fmt.Errorf("invalid post ID: %s", objectID)
	}

	like := db.PostLike{
		ID:        id.NextID(),
		UserID:    actor.ID,
		PostID:    postID,
		CreatedAt: time.Now(),
	}

	if err := rds.Create(&like).Error; err != nil {
		logger.Errorf(c, "Failed to create like: %v", err)
		return fmt.Errorf("create like failed: %w", err)
	}

	if err := rds.Model(&db.Post{}).Where("id = ?", postID).
		UpdateColumn("likes_count", gorm.Expr("likes_count + ?", 1)).Error; err != nil {
		logger.Warnf(c, "Failed to update likes count: %v", err)
	}

	logger.Infof(c, "Actor %s liked post %d", username, postID)
	return nil
}

func processAnnounceActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("Announce activity not yet implemented")
}

func processFollowActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		logger.Errorf(c, "Failed to get database connection: %v", err)
		return fmt.Errorf("database connection failed: %w", err)
	}

	var follower db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&follower).Error; err != nil {
		logger.Warnf(c, "Follower actor not found: %s", username)
		return fmt.Errorf("follower actor not found: %s", username)
	}

	objBytes, err := json.Marshal(activity.Object)
	if err != nil {
		return fmt.Errorf("failed to marshal object: %w", err)
	}

	var objectID string
	if err := json.Unmarshal(objBytes, &objectID); err != nil {
		return fmt.Errorf("invalid object ID format: %w", err)
	}

	var targetUsername string
	_, err = fmt.Sscanf(objectID, "%s/activitypub/%s/actor", &baseURL, &targetUsername)
	if err != nil {
		return fmt.Errorf("invalid actor ID: %s", objectID)
	}

	var following db.Actor
	if err := rds.Where("preferred_username = ?", targetUsername).First(&following).Error; err != nil {
		logger.Warnf(c, "Following actor not found: %s", targetUsername)
		return fmt.Errorf("following actor not found: %s", targetUsername)
	}

	follow := db.Follow{
		ID:          id.NextID(),
		FollowerID:  follower.ID,
		FollowingID: following.ID,
		CreatedAt:   time.Now(),
	}

	if err := rds.Create(&follow).Error; err != nil {
		logger.Errorf(c, "Failed to create follow: %v", err)
		return fmt.Errorf("create follow failed: %w", err)
	}

	logger.Infof(c, "Actor %s followed %s", username, targetUsername)
	return nil
}

func processUndoActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("Undo activity not yet implemented")
}
