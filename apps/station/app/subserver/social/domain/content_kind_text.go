package domain

import (
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type textContentHandler struct{}

func (textContentHandler) Type() model.PostType { return model.PostType_TEXT }

func (textContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	if r := req.GetText(); r != nil {
		cols.Text = r.Text
	}
	return cols, nil
}

func (textContentHandler) Decode(out *model.Post, p *Post) error {
	out.Content = &model.Post_TextPost{TextPost: &model.TextPost{Text: p.TextBody}}
	return nil
}
