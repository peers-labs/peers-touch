package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type locationContentHandler struct{}

func (locationContentHandler) Type() model.PostType { return model.PostType_LOCATION }

func (locationContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	r := req.GetLocation()
	if r == nil {
		return cols, nil
	}
	cols.Text = r.Text
	payload := map[string]any{}
	if r.Location != nil {
		payload["location"] = r.Location
	}
	if len(r.ImageIds) > 0 {
		payload["image_ids"] = r.ImageIds
	}
	if len(payload) > 0 {
		b, err := json.Marshal(payload)
		if err != nil {
			return cols, fmt.Errorf("encode location: %w", err)
		}
		cols.Attachments = string(b)
	}
	return cols, nil
}

func (locationContentHandler) Decode(out *model.Post, p *Post) error {
	body := &model.LocationPost{Text: p.TextBody}
	if p.AttachmentsJSON != "" {
		var payload struct {
			Location *model.Location `json:"location,omitempty"`
			ImageIDs []string        `json:"image_ids,omitempty"`
		}
		if err := json.Unmarshal([]byte(p.AttachmentsJSON), &payload); err != nil {
			return fmt.Errorf("decode location attachments: %w", err)
		}
		body.Location = payload.Location
		for _, id := range payload.ImageIDs {
			body.Images = append(body.Images, newImageAttachment(id))
		}
	}
	out.Content = &model.Post_LocationPost{LocationPost: body}
	return nil
}
