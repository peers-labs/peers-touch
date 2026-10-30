package domain

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestValidateTypedMentions(t *testing.T) {
	content := "hi 𝕏 @ada end"

	cases := []struct {
		name     string
		content  string
		mentions []*model.Mention
		wantErr  bool
	}{
		{
			name:    "empty",
			content: content,
		},
		{
			name:    "valid exact display range",
			content: content,
			mentions: []*model.Mention{{
				ActorPtid: "ptid:ada",
				// "𝕏" occupies two UTF-16 units, so "@ada" starts at 6.
				Offset: 6, Length: 4, Display: "@ada",
			}},
		},
		{
			name:    "valid multibyte cjk range",
			content: "你好 @张三",
			mentions: []*model.Mention{{
				ActorPtid: "ptid:zhang", Offset: 3, Length: 3, Display: "@张三",
			}},
		},
		{
			name:    "missing actor",
			content: content,
			mentions: []*model.Mention{{
				Offset: 6, Length: 4, Display: "@ada",
			}},
			wantErr: true,
		},
		{
			name:    "out of bounds",
			content: content,
			mentions: []*model.Mention{{
				ActorPtid: "ptid:ada", Offset: 6, Length: 40, Display: "@ada",
			}},
			wantErr: true,
		},
		{
			name:    "display mismatch",
			content: content,
			mentions: []*model.Mention{{
				ActorPtid: "ptid:ada", Offset: 6, Length: 4, Display: "@bob",
			}},
			wantErr: true,
		},
		{
			name:    "overlapping ranges rejected",
			content: "@ada @bob",
			mentions: []*model.Mention{
				{ActorPtid: "ptid:a", Offset: 0, Length: 4, Display: "@ada"},
				{ActorPtid: "ptid:b", Offset: 2, Length: 4, Display: "a @b"},
			},
			wantErr: true,
		},
		{
			name:    "duplicate actor rejected",
			content: "@ada @ada",
			mentions: []*model.Mention{
				{ActorPtid: "ptid:ada", Offset: 0, Length: 4, Display: "@ada"},
				{ActorPtid: "ptid:ada", Offset: 5, Length: 4, Display: "@ada"},
			},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateTypedMentions(tc.content, tc.mentions)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateTypedMentionsSortsByOffset(t *testing.T) {
	content := "@bob then @ada"
	mentions := []*model.Mention{
		{ActorPtid: "ptid:ada", Offset: 10, Length: 4, Display: "@ada"},
		{ActorPtid: "ptid:bob", Offset: 0, Length: 4, Display: "@bob"},
	}
	got, err := ValidateTypedMentions(content, mentions)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got[0].GetActorPtid() != "ptid:bob" || got[1].GetActorPtid() != "ptid:ada" {
		t.Fatalf("mentions not sorted by offset: %+v", got)
	}
}

func TestCommentMentionConverterRoundTrip(t *testing.T) {
	conv := NewPostConverter()
	req := &model.CreateCommentRequest{
		PostId:        "100",
		Content:       "hi @ada",
		TypedMentions: []*model.Mention{{ActorPtid: "ptid:ada", Offset: 3, Length: 4, Display: "@ada"}},
	}
	d, err := conv.CreateCommentRequestToDomain(req, "ptid:author", 100, PostClassPublic)
	if err != nil {
		t.Fatalf("request to domain: %v", err)
	}
	if d.MentionsJSON == "" {
		t.Fatal("MentionsJSON not populated")
	}
	out := conv.CommentToProto(d)
	if len(out.GetTypedMentions()) != 1 {
		t.Fatalf("typed mentions not projected to proto: %+v", out.GetTypedMentions())
	}
	if out.GetTypedMentions()[0].GetActorPtid() != "ptid:ada" {
		t.Fatalf("unexpected mention actor: %s", out.GetTypedMentions()[0].GetActorPtid())
	}
	decoded, err := conv.CommentMentions(d)
	if err != nil || len(decoded) != 1 {
		t.Fatalf("CommentMentions decode: %v %+v", err, decoded)
	}
}
