package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type pollContentHandler struct{}

func (pollContentHandler) Type() model.PostType { return model.PostType_POLL }

func (pollContentHandler) Encode(req *model.CreatePostRequest) (contentColumns, error) {
	cols := contentColumns{}
	r := req.GetPoll()
	if r == nil {
		return cols, nil
	}
	cols.Text = r.Text
	b, err := json.Marshal(r)
	if err != nil {
		return cols, fmt.Errorf("encode poll: %w", err)
	}
	cols.Attachments = string(b)
	return cols, nil
}

func (pollContentHandler) Decode(out *model.Post, p *Post) error {
	body := &model.PollPost{Text: p.TextBody}
	if p.AttachmentsJSON == "" {
		return fmt.Errorf("poll creation definition is missing")
	}
	var request model.CreatePollPostRequest
	if err := json.Unmarshal([]byte(p.AttachmentsJSON), &request); err != nil {
		return fmt.Errorf("decode poll creation: %w", err)
	}
	definition, err := FeedPollDefinitionFor(&request, p.CreatedAt.UnixMilli())
	if err != nil {
		return err
	}
	body.Poll = definition
	out.Content = &model.Post_PollPost{PollPost: body}
	return nil
}
