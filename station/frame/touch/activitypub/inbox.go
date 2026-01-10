package activitypub

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func FetchInbox(c context.Context, username string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		logger.Errorf(c, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		logger.Warnf(c, "Actor not found: %s", username)
		return nil, fmt.Errorf("actor not found: %s", username)
	}

	var posts []db.Post
	query := rds.Where("author_id = ?", actor.ID).
		Order("created_at DESC").
		Limit(20)

	if err := query.Find(&posts).Error; err != nil {
		logger.Errorf(c, "Failed to query posts: %v", err)
		return nil, fmt.Errorf("query posts failed: %w", err)
	}

	items := make([]map[string]interface{}, 0)
	
	// Add posts
	for _, post := range posts {
		var content db.PostContent
		if err := rds.Where("post_id = ?", post.ID).First(&content).Error; err != nil {
			continue
		}

		// Get author info
		var author db.Actor
		if err := rds.Where("id = ?", post.AuthorID).First(&author).Error; err != nil {
			logger.Warnf(c, "Author not found for post %d", post.ID)
			continue
		}

		// Build attributedTo object with actor details
		attributedTo := buildActorObject(author, baseURL)

		item := map[string]interface{}{
			"id":           fmt.Sprintf("%s/posts/%d", baseURL, post.ID),
			"type":         "Create",
			"actor":        fmt.Sprintf("%s/activitypub/%s/actor", baseURL, author.PreferredUsername),
			"published":    post.CreatedAt.Format("2006-01-02T15:04:05Z"),
			"to":           []string{"https://www.w3.org/ns/activitystreams#Public"},
			"cc":           []string{fmt.Sprintf("%s/activitypub/%s/followers", baseURL, author.PreferredUsername)},
			"object": map[string]interface{}{
				"id":           fmt.Sprintf("%s/posts/%d", baseURL, post.ID),
				"type":         "Note",
				"content":      content.Text,
				"attributedTo": attributedTo,
				"published":    post.CreatedAt.Format("2006-01-02T15:04:05Z"),
				"to":           []string{"https://www.w3.org/ns/activitystreams#Public"},
				"cc":           []string{fmt.Sprintf("%s/activitypub/%s/followers", baseURL, author.PreferredUsername)},
			},
		}
		items = append(items, item)
		
		// Add comments for this post
		var comments []db.Comment
		if err := rds.Where("post_id = ?", post.ID).Order("created_at ASC").Find(&comments).Error; err == nil {
			for _, comment := range comments {
				var commentAuthor db.Actor
				if err := rds.Where("id = ?", comment.AuthorID).First(&commentAuthor).Error; err != nil {
					continue
				}
				
				commentAttributedTo := buildActorObject(commentAuthor, baseURL)
				
				commentItem := map[string]interface{}{
					"id":           fmt.Sprintf("%s/comments/%d", baseURL, comment.ID),
					"type":         "Create",
					"actor":        fmt.Sprintf("%s/activitypub/%s/actor", baseURL, commentAuthor.PreferredUsername),
					"published":    comment.CreatedAt.Format("2006-01-02T15:04:05Z"),
					"to":           []string{"https://www.w3.org/ns/activitystreams#Public"},
					"cc":           []string{fmt.Sprintf("%s/activitypub/%s/followers", baseURL, commentAuthor.PreferredUsername)},
					"object": map[string]interface{}{
						"id":           fmt.Sprintf("%s/comments/%d", baseURL, comment.ID),
						"type":         "Note",
						"content":      comment.Content,
						"attributedTo": commentAttributedTo,
						"inReplyTo":    fmt.Sprintf("%s/posts/%d", baseURL, post.ID),
						"published":    comment.CreatedAt.Format("2006-01-02T15:04:05Z"),
						"to":           []string{"https://www.w3.org/ns/activitystreams#Public"},
						"cc":           []string{fmt.Sprintf("%s/activitypub/%s/followers", baseURL, commentAuthor.PreferredUsername)},
					},
				}
				items = append(items, commentItem)
			}
		}
	}

	collection := map[string]interface{}{
		"@context":     "https://www.w3.org/ns/activitystreams",
		"id":           fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, username),
		"type":         "OrderedCollection",
		"totalItems":   len(items),
		"orderedItems": items,
	}

	return collection, nil
}

func buildActorObject(actor db.Actor, baseURL string) map[string]interface{} {
	attributedTo := map[string]interface{}{
		"id":                fmt.Sprintf("%s/activitypub/%s/actor", baseURL, actor.PreferredUsername),
		"type":              "Person",
		"preferredUsername": actor.PreferredUsername,
		"name":              actor.Name,
	}
	if actor.Icon != "" {
		attributedTo["icon"] = map[string]interface{}{
			"type": "Image",
			"url":  actor.Icon,
		}
	}
	return attributedTo
}
