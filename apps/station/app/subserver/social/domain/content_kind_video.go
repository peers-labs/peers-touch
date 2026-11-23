package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type videoContentHandler struct{}

func (videoContentHandler) Type() model.PostType { return model.PostType_VIDEO }

func (videoContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	r := req.GetVideo()
	if r == nil {
		return cols, nil
	}
	cols.Text = r.Text
	if r.VideoId != "" {
		b, err := json.Marshal(map[string]string{"video_id": r.VideoId})
		if err != nil {
			return cols, fmt.Errorf("encode video: %w", err)
		}
		cols.Attachments = string(b)
	}
	return cols, nil
}

func (videoContentHandler) Decode(out *model.Post, p *Post) error {
	body := &model.VideoPost{Text: p.TextBody}
	if p.AttachmentsJSON != "" {
		var v map[string]string
		if err := json.Unmarshal([]byte(p.AttachmentsJSON), &v); err != nil {
			return fmt.Errorf("decode video attachments: %w", err)
		}
		if id := v["video_id"]; id != "" {
			body.Video = newVideoAttachment(id)
		}
	}
	out.Content = &model.Post_VideoPost{VideoPost: body}
	return nil
}
