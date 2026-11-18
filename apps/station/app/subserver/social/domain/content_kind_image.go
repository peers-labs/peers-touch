package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type imageContentHandler struct{}

func (imageContentHandler) Type() model.PostType { return model.PostType_IMAGE }

func (imageContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	r := req.GetImage()
	if r == nil {
		return cols, nil
	}
	cols.Text = r.Text
	if len(r.Images) > 0 {
		b, err := json.Marshal(r.Images)
		if err != nil {
			return cols, fmt.Errorf("encode image attachments: %w", err)
		}
		cols.Attachments = string(b)
	} else if len(r.ImageIds) > 0 {
		b, err := json.Marshal(r.ImageIds)
		if err != nil {
			return cols, fmt.Errorf("encode image ids: %w", err)
		}
		cols.Attachments = string(b)
	}
	return cols, nil
}

func (imageContentHandler) Decode(out *model.Post, p *Post) error {
	body := &model.ImagePost{Text: p.TextBody}
	if p.AttachmentsJSON != "" {
		var images []*model.ImageAttachment
		if err := json.Unmarshal([]byte(p.AttachmentsJSON), &images); err == nil {
			body.Images = images
		} else {
			var ids []string
			if legacyErr := json.Unmarshal([]byte(p.AttachmentsJSON), &ids); legacyErr != nil {
				return fmt.Errorf("decode image attachments: %w", err)
			}
			for _, id := range ids {
				body.Images = append(body.Images, newImageAttachment(id))
			}
		}
	}
	out.Content = &model.Post_ImagePost{ImagePost: body}
	return nil
}
