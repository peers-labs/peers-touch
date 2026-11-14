package domain

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const MaxPostImages = 9

// ValidatePostMedia is shared by signed and ordinary application write paths.
// Replication authenticates the author's signed references; only the author
// Home Station checks object existence against its local OSS owner.
func ValidatePostMedia(ctx context.Context, request *model.CreatePostRequest, media MediaResolver) error {
	if request == nil || media == nil {
		return ErrFeedInvalid
	}
	var cids []string
	switch request.Type {
	case model.PostType_IMAGE:
		if request.GetImage() == nil {
			return fmt.Errorf("IMAGE post requires CreateImagePostRequest content")
		}
		var err error
		cids, err = ImageIDsFromCreateRequest(request.GetImage())
		if err != nil {
			return err
		}
		if len(cids) == 0 {
			return fmt.Errorf("IMAGE post requires at least one image_id")
		}
		if len(cids) > MaxPostImages {
			return fmt.Errorf("IMAGE post supports at most %d images, got %d", MaxPostImages, len(cids))
		}
	case model.PostType_VIDEO:
		if request.GetVideo() != nil && request.GetVideo().VideoId != "" {
			cids = []string{request.GetVideo().VideoId}
		}
	case model.PostType_LOCATION:
		if request.GetLocation() != nil {
			cids = request.GetLocation().ImageIds
			if len(cids) > MaxPostImages {
				return fmt.Errorf("LOCATION post supports at most 9 images")
			}
		}
	}
	return media.ValidateCIDs(ctx, cids)
}

func ImageIDsFromCreateRequest(image *model.CreateImagePostRequest) ([]string, error) {
	if image == nil {
		return nil, nil
	}
	if len(image.ImageIds) > 0 && len(image.Images) > 0 {
		return nil, fmt.Errorf("IMAGE post accepts either image_ids or images, not both")
	}
	if len(image.ImageIds) > 0 {
		return image.ImageIds, nil
	}
	var ids []string
	for _, item := range image.Images {
		if item == nil {
			continue
		}
		if item.Id != "" {
			ids = append(ids, item.Id)
		} else if item.Url != "" {
			ids = append(ids, item.Url)
		}
	}
	return ids, nil
}
