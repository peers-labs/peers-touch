package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type linkContentHandler struct{}

func (linkContentHandler) Type() model.PostType { return model.PostType_LINK }

func (linkContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	r := req.GetLink()
	if r == nil {
		return cols, nil
	}
	cols.Text = r.Text
	if r.Url != "" {
		b, err := json.Marshal(map[string]string{"url": r.Url})
		if err != nil {
			return cols, fmt.Errorf("encode link: %w", err)
		}
		cols.LinkPreview = string(b)
	}
	return cols, nil
}

func (linkContentHandler) Decode(out *model.Post, p *Post) error {
	body := &model.LinkPost{Text: p.TextBody}
	if p.LinkPreviewJSON != "" {
		var lp model.LinkPreview
		if err := json.Unmarshal([]byte(p.LinkPreviewJSON), &lp); err != nil {
			return fmt.Errorf("decode link preview: %w", err)
		}
		body.Link = &lp
	}
	out.Content = &model.Post_LinkPost{LinkPost: body}
	return nil
}
