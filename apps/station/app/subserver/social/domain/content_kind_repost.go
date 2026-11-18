package domain

import (
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type repostContentHandler struct{}

func (repostContentHandler) Type() model.PostType { return model.PostType_REPOST }

func (repostContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	if r := req.GetRepost(); r != nil {
		cols.Text = r.Comment
		cols.RepostRef = r.OriginalPostId
	}
	return cols, nil
}

func (repostContentHandler) Decode(out *model.Post, p *Post) error {
	out.Content = &model.Post_RepostPost{RepostPost: &model.RepostPost{
		Comment:        p.TextBody,
		OriginalPostId: p.RepostOfRef,
	}}
	return nil
}
