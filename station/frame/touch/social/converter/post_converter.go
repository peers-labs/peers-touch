package converter

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type PostConverter struct {
	likeRepo interface {
		IsPostLiked(ctx context.Context, userID, postID uint64) (bool, error)
	}
}

func NewPostConverter(likeRepo interface {
	IsPostLiked(ctx context.Context, userID, postID uint64) (bool, error)
}) *PostConverter {
	return &PostConverter{likeRepo: likeRepo}
}

func (c *PostConverter) DBToProto(ctx context.Context, dbPost *db.Post, viewerID uint64) (*model.Post, error) {
	if dbPost == nil {
		return nil, fmt.Errorf("dbPost is nil")
	}

	post := &model.Post{
		Id:         fmt.Sprintf("%d", dbPost.ID),
		AuthorId:   fmt.Sprintf("%d", dbPost.AuthorID),
		Type:       parsePostType(dbPost.Type),
		Visibility: parseVisibility(dbPost.Visibility),
		CreatedAt:  timestamppb.New(dbPost.CreatedAt),
		UpdatedAt:  timestamppb.New(dbPost.UpdatedAt),
		Stats: &model.PostStats{
			LikesCount:    dbPost.LikesCount,
			CommentsCount: dbPost.CommentsCount,
			RepostsCount:  dbPost.RepostsCount,
			ViewsCount:    dbPost.ViewsCount,
		},
	}

	if dbPost.Author != nil {
		post.Author = &model.PostAuthor{
			Id:          fmt.Sprintf("%d", dbPost.Author.ID),
			Username:    dbPost.Author.PreferredUsername,
			DisplayName: dbPost.Author.Name,
			AvatarUrl:   dbPost.Author.Icon,
		}
	}

	if viewerID > 0 {
		isLiked, _ := c.likeRepo.IsPostLiked(ctx, viewerID, dbPost.ID)
		post.Interaction = &model.PostInteraction{
			IsLiked: isLiked,
		}
	}

	if dbPost.Content != nil {
		if err := c.fillContent(post, dbPost.Content); err != nil {
			return nil, err
		}
	}

	return post, nil
}

func (c *PostConverter) fillContent(post *model.Post, dbContent *db.PostContent) error {
	switch post.Type {
	case model.PostType_TEXT:
		textPost := &model.TextPost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &textPost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &textPost.Mentions)
		}
		post.Content = &model.Post_TextPost{TextPost: textPost}

	case model.PostType_IMAGE:
		imagePost := &model.ImagePost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &imagePost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &imagePost.Mentions)
		}
		if dbContent.Images != "" {
			var images []*model.ImageAttachment
			json.Unmarshal([]byte(dbContent.Images), &images)
			imagePost.Images = images
		}
		post.Content = &model.Post_ImagePost{ImagePost: imagePost}

	case model.PostType_VIDEO:
		videoPost := &model.VideoPost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &videoPost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &videoPost.Mentions)
		}
		if dbContent.Video != "" {
			var video model.VideoAttachment
			json.Unmarshal([]byte(dbContent.Video), &video)
			videoPost.Video = &video
		}
		post.Content = &model.Post_VideoPost{VideoPost: videoPost}

	case model.PostType_LINK:
		linkPost := &model.LinkPost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &linkPost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &linkPost.Mentions)
		}
		if dbContent.Link != "" {
			var link model.LinkPreview
			json.Unmarshal([]byte(dbContent.Link), &link)
			linkPost.Link = &link
		}
		post.Content = &model.Post_LinkPost{LinkPost: linkPost}

	case model.PostType_POLL:
		pollPost := &model.PollPost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &pollPost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &pollPost.Mentions)
		}
		if dbContent.Poll != "" {
			var poll model.Poll
			json.Unmarshal([]byte(dbContent.Poll), &poll)
			pollPost.Poll = &poll
		}
		post.Content = &model.Post_PollPost{PollPost: pollPost}

	case model.PostType_REPOST:
		repostPost := &model.RepostPost{
			Comment:        dbContent.RepostComment,
			OriginalPostId: fmt.Sprintf("%d", *dbContent.OriginalPostID),
		}
		post.Content = &model.Post_RepostPost{RepostPost: repostPost}

	case model.PostType_LOCATION:
		locationPost := &model.LocationPost{
			Text: dbContent.Text,
		}
		if dbContent.Hashtags != "" {
			json.Unmarshal([]byte(dbContent.Hashtags), &locationPost.Hashtags)
		}
		if dbContent.Mentions != "" {
			json.Unmarshal([]byte(dbContent.Mentions), &locationPost.Mentions)
		}
		if dbContent.Location != "" {
			var location model.Location
			json.Unmarshal([]byte(dbContent.Location), &location)
			locationPost.Location = &location
		}
		if dbContent.Images != "" {
			var images []*model.ImageAttachment
			json.Unmarshal([]byte(dbContent.Images), &images)
			locationPost.Images = images
		}
		post.Content = &model.Post_LocationPost{LocationPost: locationPost}
	}

	return nil
}

func (c *PostConverter) ProtoToDB(protoPost *model.CreatePostRequest, authorID uint64) (*db.Post, *db.PostContent, error) {
	post := &db.Post{
		AuthorID:   authorID,
		Type:       protoPost.Type.String(),
		Visibility: protoPost.Visibility.String(),
	}

	content := &db.PostContent{}

	switch protoPost.Type {
	case model.PostType_TEXT:
		textReq := protoPost.GetText()
		if textReq != nil {
			content.Text = textReq.Text
		}

	case model.PostType_IMAGE:
		imageReq := protoPost.GetImage()
		if imageReq != nil {
			content.Text = imageReq.Text
			if len(imageReq.ImageIds) > 0 {
				imagesJSON, _ := json.Marshal(imageReq.ImageIds)
				content.Images = string(imagesJSON)
			}
		}

	case model.PostType_VIDEO:
		videoReq := protoPost.GetVideo()
		if videoReq != nil {
			content.Text = videoReq.Text
			content.Video = videoReq.VideoId
		}

	case model.PostType_LINK:
		linkReq := protoPost.GetLink()
		if linkReq != nil {
			content.Text = linkReq.Text
			linkJSON, _ := json.Marshal(map[string]string{"url": linkReq.Url})
			content.Link = string(linkJSON)
		}

	case model.PostType_POLL:
		pollReq := protoPost.GetPoll()
		if pollReq != nil {
			content.Text = pollReq.Text
			pollJSON, _ := json.Marshal(pollReq)
			content.Poll = string(pollJSON)
		}

	case model.PostType_REPOST:
		repostReq := protoPost.GetRepost()
		if repostReq != nil {
			content.RepostComment = repostReq.Comment
			originalID := parseID(repostReq.OriginalPostId)
			content.OriginalPostID = &originalID
		}

	case model.PostType_LOCATION:
		locationReq := protoPost.GetLocation()
		if locationReq != nil {
			content.Text = locationReq.Text
			if locationReq.Location != nil {
				locationJSON, _ := json.Marshal(locationReq.Location)
				content.Location = string(locationJSON)
			}
			if len(locationReq.ImageIds) > 0 {
				imagesJSON, _ := json.Marshal(locationReq.ImageIds)
				content.Images = string(imagesJSON)
			}
		}
	}

	return post, content, nil
}

func parsePostType(typeStr string) model.PostType {
	switch typeStr {
	case "TEXT":
		return model.PostType_TEXT
	case "IMAGE":
		return model.PostType_IMAGE
	case "VIDEO":
		return model.PostType_VIDEO
	case "LINK":
		return model.PostType_LINK
	case "POLL":
		return model.PostType_POLL
	case "REPOST":
		return model.PostType_REPOST
	case "LOCATION":
		return model.PostType_LOCATION
	default:
		return model.PostType_TEXT
	}
}

func parseVisibility(visStr string) model.PostVisibility {
	switch visStr {
	case "PUBLIC":
		return model.PostVisibility_PUBLIC
	case "FOLLOWERS_ONLY":
		return model.PostVisibility_FOLLOWERS_ONLY
	case "PRIVATE":
		return model.PostVisibility_PRIVATE
	default:
		return model.PostVisibility_PUBLIC
	}
}

func parseID(idStr string) uint64 {
	var id uint64
	fmt.Sscanf(idStr, "%d", &id)
	return id
}
