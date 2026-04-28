package domain

import (
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PostConverter translates between the proto Post / Audience surface and
// both the domain `Post` aggregate and the two physical DB tables
// (`SocialPublicPost` / `SocialPrivatePost`).
//
// All translation routes through this struct so the body-shape mapping
// (text / image / video / link / poll / repost / location oneof variants)
// lives in a single place. Callers keep using untyped `*model.Post` /
// `*model.CreatePostRequest` at API boundaries; the application layer
// hands a `domain.Post` to repositories.
type PostConverter struct{}

func NewPostConverter() *PostConverter {
	return &PostConverter{}
}

// ---------------------------------------------------------------------------
// proto request → domain.Post (write path)
// ---------------------------------------------------------------------------

// CreateRequestToDomain translates a CreatePostRequest into a domain Post
// ready for repo persistence. Audience MUST be present on the request
// (the `/api/v1/social/moments` route requires it; the legacy
// `visibility` field is ignored by this method).
//
// The returned Post has zero ID and zero CreatedAt — repos populate
// those at insert time (`BeforeCreate` ULID + DB default timestamp).
//
// `mentions` is the parsed list of `Mention` extracted from the request
// body — passed in separately because the legacy CreatePostRequest body
// types only carry plain `mentions: []string`. P3 will wire the
// position-aware Mention pipeline; P1 stores whatever the caller hands
// over, so the column survives a future fill-in without a schema change.
func (c *PostConverter) CreateRequestToDomain(
	req *model.CreatePostRequest,
	authorID uint64,
	mentions []*model.Mention,
) (*Post, error) {
	if req == nil {
		return nil, fmt.Errorf("CreatePostRequest is nil")
	}
	if req.Audience == nil {
		return nil, fmt.Errorf("CreatePostRequest.audience is required for the moments route")
	}
	if err := ValidateAudience(req.Audience); err != nil {
		return nil, err
	}

	textBody, attachmentsJSON, linkPreviewJSON, repostRef, err := c.encodeContent(req)
	if err != nil {
		return nil, err
	}

	mentionsJSON := ""
	if len(mentions) > 0 {
		b, err := json.Marshal(mentions)
		if err != nil {
			return nil, fmt.Errorf("encode mentions: %w", err)
		}
		mentionsJSON = string(b)
	}

	return &Post{
		AuthorID:        authorID,
		Type:            req.Type,
		Audience:        req.Audience,
		TextBody:        textBody,
		AttachmentsJSON: attachmentsJSON,
		MentionsJSON:    mentionsJSON,
		LinkPreviewJSON: linkPreviewJSON,
		RepostOfRef:     repostRef,
	}, nil
}

// encodeContent flattens the proto oneof into the four JSON-or-string
// columns the DB schema uses. Body shape per type:
//
//	TEXT     → TextBody = req.text.text
//	IMAGE    → TextBody = req.image.text;
//	           Attachments = JSON(image_ids[] OR ImageAttachment[])
//	VIDEO    → TextBody = req.video.text;
//	           Attachments = JSON({video_id})
//	LINK     → TextBody = req.link.text;
//	           LinkPreview = JSON({url})  (server fetches title/desc in P3)
//	POLL     → TextBody = req.poll.text;
//	           Attachments = JSON(poll request body)
//	REPOST   → TextBody = req.repost.comment;
//	           RepostRef = original_post_id
//	LOCATION → TextBody = req.location.text;
//	           Attachments = JSON({location, image_ids})
func (c *PostConverter) encodeContent(req *model.CreatePostRequest) (text, attachments, linkPreview, repostRef string, err error) {
	switch req.Type {
	case model.PostType_TEXT:
		if r := req.GetText(); r != nil {
			text = r.Text
		}

	case model.PostType_IMAGE:
		if r := req.GetImage(); r != nil {
			text = r.Text
			if len(r.ImageIds) > 0 {
				b, e := json.Marshal(r.ImageIds)
				if e != nil {
					err = fmt.Errorf("encode image ids: %w", e)
					return
				}
				attachments = string(b)
			}
		}

	case model.PostType_VIDEO:
		if r := req.GetVideo(); r != nil {
			text = r.Text
			if r.VideoId != "" {
				b, e := json.Marshal(map[string]string{"video_id": r.VideoId})
				if e != nil {
					err = fmt.Errorf("encode video: %w", e)
					return
				}
				attachments = string(b)
			}
		}

	case model.PostType_LINK:
		if r := req.GetLink(); r != nil {
			text = r.Text
			if r.Url != "" {
				b, e := json.Marshal(map[string]string{"url": r.Url})
				if e != nil {
					err = fmt.Errorf("encode link: %w", e)
					return
				}
				linkPreview = string(b)
			}
		}

	case model.PostType_POLL:
		if r := req.GetPoll(); r != nil {
			text = r.Text
			b, e := json.Marshal(r)
			if e != nil {
				err = fmt.Errorf("encode poll: %w", e)
				return
			}
			attachments = string(b)
		}

	case model.PostType_REPOST:
		if r := req.GetRepost(); r != nil {
			text = r.Comment
			repostRef = r.OriginalPostId
		}

	case model.PostType_LOCATION:
		if r := req.GetLocation(); r != nil {
			text = r.Text
			payload := map[string]any{}
			if r.Location != nil {
				payload["location"] = r.Location
			}
			if len(r.ImageIds) > 0 {
				payload["image_ids"] = r.ImageIds
			}
			if len(payload) > 0 {
				b, e := json.Marshal(payload)
				if e != nil {
					err = fmt.Errorf("encode location: %w", e)
					return
				}
				attachments = string(b)
			}
		}

	default:
		err = fmt.Errorf("unsupported post type: %s", req.Type)
		return
	}
	return
}

// ---------------------------------------------------------------------------
// domain.Post ↔ db.Social{Public,Private}Post
// ---------------------------------------------------------------------------

// DomainToPublicDB serializes a Post into the public-table row form. The
// caller MUST have already verified `IsPublic` (PublicPostRepository does
// this on its first line); we re-check here as an invariant guard.
func (c *PostConverter) DomainToPublicDB(p *Post) (*db.SocialPublicPost, error) {
	if p == nil {
		return nil, fmt.Errorf("post is nil")
	}
	if !p.IsPublic() {
		return nil, fmt.Errorf("DomainToPublicDB: audience kind is not PUBLIC")
	}
	return &db.SocialPublicPost{
		ID:                 p.ID,
		AuthorID:           p.AuthorID,
		Type:               p.Type.String(),
		AudienceKind:       model.Audience_PUBLIC.String(),
		TextBody:           p.TextBody,
		AttachmentsJSON:    p.AttachmentsJSON,
		MentionsJSON:       p.MentionsJSON,
		LinkPreviewJSON:    p.LinkPreviewJSON,
		ReactionsCountJSON: p.ReactionsCountJSON,
		RepostOfRef:        p.RepostOfRef,
		CommentsCount:      p.CommentsCount,
		ViewsCount:         p.ViewsCount,
		EditedAt:           p.EditedAt,
	}, nil
}

// DomainToPrivateDB serializes a Post into the private-table row form
// plus the audience grants for CUSTOM_ALLOW / CUSTOM_DENY. The grants
// list is empty for FOLLOWERS / SELF / CIRCLE / GROUP audiences.
func (c *PostConverter) DomainToPrivateDB(p *Post) (*db.SocialPrivatePost, []db.SocialPrivateAudienceGrant, error) {
	if p == nil {
		return nil, nil, fmt.Errorf("post is nil")
	}
	if p.IsPublic() {
		return nil, nil, fmt.Errorf("DomainToPrivateDB: audience kind is PUBLIC")
	}
	a := p.Audience
	row := &db.SocialPrivatePost{
		ID:                 p.ID,
		AuthorID:           p.AuthorID,
		Type:               p.Type.String(),
		AudienceKind:       a.Kind.String(),
		AudienceTargetID:   a.TargetId,
		TextBody:           p.TextBody,
		AttachmentsJSON:    p.AttachmentsJSON,
		MentionsJSON:       p.MentionsJSON,
		LinkPreviewJSON:    p.LinkPreviewJSON,
		ReactionsCountJSON: p.ReactionsCountJSON,
		RepostOfRef:        p.RepostOfRef,
		CommentsCount:      p.CommentsCount,
		ViewsCount:         p.ViewsCount,
		EditedAt:           p.EditedAt,
	}
	if a.Kind == model.Audience_CUSTOM_ALLOW || a.Kind == model.Audience_CUSTOM_DENY {
		row.AudienceBaseKind = a.BaseKind.String()
	}

	var grants []db.SocialPrivateAudienceGrant
	if a.Kind == model.Audience_CUSTOM_ALLOW || a.Kind == model.Audience_CUSTOM_DENY {
		role := db.AudienceGrantRoleAllow
		if a.Kind == model.Audience_CUSTOM_DENY {
			role = db.AudienceGrantRoleDeny
		}
		// PostID is filled in by the repo after BeforeCreate sets it on
		// the parent row (the application layer wraps the two writes in
		// a single transaction so PostID is known before grants insert).
		grants = make([]db.SocialPrivateAudienceGrant, 0, len(a.ActorDids))
		for _, did := range a.ActorDids {
			grants = append(grants, db.SocialPrivateAudienceGrant{
				ActorDID: did,
				Role:     role,
			})
		}
	}
	return row, grants, nil
}

// PublicDBToDomain hydrates a Post from a `social_public_posts` row.
// Audience is reconstructed as Kind=PUBLIC since that is the only kind
// physically possible in this table.
func (c *PostConverter) PublicDBToDomain(row *db.SocialPublicPost) *Post {
	if row == nil {
		return nil
	}
	return &Post{
		ID:                 row.ID,
		AuthorID:           row.AuthorID,
		Type:               parsePostType(row.Type),
		Audience:           &model.Audience{Kind: model.Audience_PUBLIC},
		TextBody:           row.TextBody,
		AttachmentsJSON:    row.AttachmentsJSON,
		MentionsJSON:       row.MentionsJSON,
		LinkPreviewJSON:    row.LinkPreviewJSON,
		ReactionsCountJSON: row.ReactionsCountJSON,
		RepostOfRef:        row.RepostOfRef,
		CommentsCount:      row.CommentsCount,
		ViewsCount:         row.ViewsCount,
		EditedAt:           row.EditedAt,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
		DeletedAt:          row.DeletedAt,
	}
}

// PrivateDBToDomain hydrates a Post from a `social_private_posts` row.
// `grants` may be nil — it is populated only for CUSTOM_ALLOW/DENY rows
// by `AudienceGrantRepository.ListGrants`. The repo lazily resolves
// grants only when the row's audience_kind requires them, avoiding a
// per-row join.
func (c *PostConverter) PrivateDBToDomain(row *db.SocialPrivatePost, grants []db.SocialPrivateAudienceGrant) *Post {
	if row == nil {
		return nil
	}
	a := &model.Audience{
		Kind:     parseAudienceKind(row.AudienceKind),
		TargetId: row.AudienceTargetID,
		BaseKind: parseAudienceKind(row.AudienceBaseKind),
	}
	if len(grants) > 0 {
		a.ActorDids = make([]string, 0, len(grants))
		for _, g := range grants {
			a.ActorDids = append(a.ActorDids, g.ActorDID)
		}
	}
	return &Post{
		ID:                 row.ID,
		AuthorID:           row.AuthorID,
		Type:               parsePostType(row.Type),
		Audience:           a,
		TextBody:           row.TextBody,
		AttachmentsJSON:    row.AttachmentsJSON,
		MentionsJSON:       row.MentionsJSON,
		LinkPreviewJSON:    row.LinkPreviewJSON,
		ReactionsCountJSON: row.ReactionsCountJSON,
		RepostOfRef:        row.RepostOfRef,
		CommentsCount:      row.CommentsCount,
		ViewsCount:         row.ViewsCount,
		EditedAt:           row.EditedAt,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
		DeletedAt:          row.DeletedAt,
	}
}

// ---------------------------------------------------------------------------
// domain.Post → proto.Post (read path)
// ---------------------------------------------------------------------------

// DomainToProto hydrates the wire shape from the storage shape. The caller
// is responsible for filling in:
//
//   - `Author` (PostAuthor) — typically by joining against the actors
//     table; this method intentionally returns it nil so the application
//     layer can batch-fetch authors for a list of posts.
//   - `Reactions` (ReactionSummary[]) — populated by the ReactionService
//     hydration step.
//   - `Interaction` (PostInteraction) — viewer-bound, populated by the
//     application layer using the supplied viewerID context.
//
// Body content is decoded back into the appropriate `oneof` variant
// matching `Type`. On JSON decode error the body field is left nil — the
// post is still returned (better partial render than 500), but the error
// is surfaced via the second return value for logging.
func (c *PostConverter) DomainToProto(p *Post) (*model.Post, error) {
	if p == nil {
		return nil, nil
	}
	out := &model.Post{
		Id:        formatID(p.ID),
		AuthorId:  formatID(p.AuthorID),
		Type:      p.Type,
		Audience:  p.Audience,
		IsDeleted: p.IsDeleted(),
		CreatedAt: timestamppb.New(p.CreatedAt),
		UpdatedAt: timestamppb.New(p.UpdatedAt),
		Stats: &model.PostStats{
			CommentsCount: p.CommentsCount,
			ViewsCount:    p.ViewsCount,
			// LikesCount and RepostsCount are derived from the reactions
			// snapshot / outbox during hydration; left zero here so a
			// repo-only test doesn't depend on the reaction service.
		},
	}
	// Best-effort body fill; first error is returned but doesn't abort.
	if err := c.decodeContent(out, p); err != nil {
		return out, err
	}
	return out, nil
}

func (c *PostConverter) decodeContent(out *model.Post, p *Post) error {
	switch p.Type {
	case model.PostType_TEXT:
		out.Content = &model.Post_TextPost{TextPost: &model.TextPost{Text: p.TextBody}}

	case model.PostType_IMAGE:
		body := &model.ImagePost{Text: p.TextBody}
		if p.AttachmentsJSON != "" {
			var ids []string
			if err := json.Unmarshal([]byte(p.AttachmentsJSON), &ids); err == nil {
				for _, id := range ids {
					body.Images = append(body.Images, &model.ImageAttachment{Id: id})
				}
			} else {
				return fmt.Errorf("decode image attachments: %w", err)
			}
		}
		out.Content = &model.Post_ImagePost{ImagePost: body}

	case model.PostType_VIDEO:
		body := &model.VideoPost{Text: p.TextBody}
		if p.AttachmentsJSON != "" {
			var v map[string]string
			if err := json.Unmarshal([]byte(p.AttachmentsJSON), &v); err != nil {
				return fmt.Errorf("decode video attachments: %w", err)
			}
			if id := v["video_id"]; id != "" {
				body.Video = &model.VideoAttachment{Id: id}
			}
		}
		out.Content = &model.Post_VideoPost{VideoPost: body}

	case model.PostType_LINK:
		body := &model.LinkPost{Text: p.TextBody}
		if p.LinkPreviewJSON != "" {
			var lp model.LinkPreview
			if err := json.Unmarshal([]byte(p.LinkPreviewJSON), &lp); err != nil {
				return fmt.Errorf("decode link preview: %w", err)
			}
			body.Link = &lp
		}
		out.Content = &model.Post_LinkPost{LinkPost: body}

	case model.PostType_POLL:
		body := &model.PollPost{Text: p.TextBody}
		if p.AttachmentsJSON != "" {
			// PollPost stores the original CreatePollPostRequest as its
			// attachments JSON snapshot for now; full Poll hydration
			// requires the poll-vote subsystem (deferred to later phase).
			body.Hashtags = nil // explicit no-op for clarity
		}
		out.Content = &model.Post_PollPost{PollPost: body}

	case model.PostType_REPOST:
		out.Content = &model.Post_RepostPost{RepostPost: &model.RepostPost{
			Comment:        p.TextBody,
			OriginalPostId: p.RepostOfRef,
		}}

	case model.PostType_LOCATION:
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
				body.Images = append(body.Images, &model.ImageAttachment{Id: id})
			}
		}
		out.Content = &model.Post_LocationPost{LocationPost: body}
	}

	if p.MentionsJSON != "" {
		var mentions []*model.Mention
		if err := json.Unmarshal([]byte(p.MentionsJSON), &mentions); err == nil {
			out.TypedMentions = mentions
		} else {
			return fmt.Errorf("decode typed mentions: %w", err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Comment converters
// ---------------------------------------------------------------------------

// CreateCommentRequestToDomain translates a CreateCommentRequest into a
// domain Comment. Caller MUST supply `postClass` (resolved by the
// application layer when it loads the parent post) so the comment row
// carries the correct denormalized class. `parentPostID` is the same
// post id the caller already validated existed and was readable.
func (c *PostConverter) CreateCommentRequestToDomain(
	req *model.CreateCommentRequest,
	authorID, parentPostID uint64,
	postClass PostClass,
) (*Comment, error) {
	if req == nil {
		return nil, fmt.Errorf("CreateCommentRequest is nil")
	}
	if req.Content == "" {
		return nil, fmt.Errorf("comment content must not be empty")
	}
	parentCommentID := uint64(0)
	if req.ReplyToCommentId != "" {
		parentCommentID = ParseID(req.ReplyToCommentId)
	}
	return &Comment{
		PostID:          parentPostID,
		PostClass:       postClass,
		AuthorID:        authorID,
		ParentCommentID: parentCommentID,
		TextBody:        req.Content,
	}, nil
}

// CommentToDB serializes a domain Comment into the DB row form.
func (c *PostConverter) CommentToDB(d *Comment) *db.SocialComment {
	if d == nil {
		return nil
	}
	row := &db.SocialComment{
		ID:        d.ID,
		PostID:    d.PostID,
		PostClass: string(d.PostClass),
		AuthorID:  d.AuthorID,
		TextBody:  d.TextBody,
	}
	if d.ParentCommentID != 0 {
		pid := d.ParentCommentID
		row.ParentCommentID = &pid
	}
	if d.MentionsJSON != "" {
		row.MentionsJSON = d.MentionsJSON
	}
	row.EditedAt = d.EditedAt
	return row
}

// CommentDBToDomain hydrates a Comment from a row.
func (c *PostConverter) CommentDBToDomain(row *db.SocialComment) *Comment {
	if row == nil {
		return nil
	}
	out := &Comment{
		ID:           row.ID,
		PostID:       row.PostID,
		PostClass:    PostClass(row.PostClass),
		AuthorID:     row.AuthorID,
		TextBody:     row.TextBody,
		MentionsJSON: row.MentionsJSON,
		EditedAt:     row.EditedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
		DeletedAt:    row.DeletedAt,
	}
	if row.ParentCommentID != nil {
		out.ParentCommentID = *row.ParentCommentID
	}
	return out
}

// CommentToProto translates a domain Comment to wire form. `Author` is
// left nil for the application layer to fill in (same batch-fetch
// reasoning as Post).
func (c *PostConverter) CommentToProto(d *Comment) *model.Comment {
	if d == nil {
		return nil
	}
	out := &model.Comment{
		Id:        formatID(d.ID),
		PostId:    formatID(d.PostID),
		AuthorId:  formatID(d.AuthorID),
		Content:   d.TextBody,
		IsDeleted: d.DeletedAt != nil,
		CreatedAt: timestamppb.New(d.CreatedAt),
		UpdatedAt: timestamppb.New(d.UpdatedAt),
	}
	if d.ParentCommentID != 0 {
		out.ReplyToCommentId = formatID(d.ParentCommentID)
	}
	return out
}

// ---------------------------------------------------------------------------
// Reaction converters
// ---------------------------------------------------------------------------

// SummariesToProto maps the domain reaction summary list to the proto
// shape the wire returns.
func (c *PostConverter) SummariesToProto(in []ReactionSummary) []*model.ReactionSummary {
	out := make([]*model.ReactionSummary, 0, len(in))
	for _, s := range in {
		out = append(out, &model.ReactionSummary{
			Kind:            s.Kind,
			Count:           s.Count,
			ReactedByViewer: s.ReactedByViewer,
		})
	}
	return out
}

// ---------------------------------------------------------------------------
// Circle converters
// ---------------------------------------------------------------------------

func (c *PostConverter) CircleToProto(d *Circle) *model.Circle {
	if d == nil {
		return nil
	}
	return &model.Circle{
		Id:          d.ID,
		OwnerId:     d.OwnerID,
		Name:        d.Name,
		Description: d.Description,
		MemberCount: d.MemberCount,
		CreatedAt:   timestamppb.New(d.CreatedAt),
		UpdatedAt:   timestamppb.New(d.UpdatedAt),
	}
}

func (c *PostConverter) CircleFromDB(row *db.SocialCircle) *Circle {
	if row == nil {
		return nil
	}
	return &Circle{
		ID:          row.ID,
		OwnerID:     row.OwnerID,
		Name:        row.Name,
		Description: row.Description,
		MemberCount: row.MemberCount,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func (c *PostConverter) CircleToDB(d *Circle) *db.SocialCircle {
	if d == nil {
		return nil
	}
	return &db.SocialCircle{
		ID:          d.ID,
		OwnerID:     d.OwnerID,
		Name:        d.Name,
		Description: d.Description,
		MemberCount: d.MemberCount,
	}
}

func (c *PostConverter) CircleMemberToProto(d *CircleMember) *model.CircleMember {
	if d == nil {
		return nil
	}
	return &model.CircleMember{
		CircleId: d.CircleID,
		ActorDid: d.ActorDID,
		AddedAt:  timestamppb.New(d.AddedAt),
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func parsePostType(typeStr string) model.PostType {
	if v, ok := model.PostType_value[typeStr]; ok {
		return model.PostType(v)
	}
	return model.PostType_TEXT
}

func parseAudienceKind(s string) model.Audience_Kind {
	if s == "" {
		return model.Audience_KIND_UNSPECIFIED
	}
	if v, ok := model.Audience_Kind_value[s]; ok {
		return model.Audience_Kind(v)
	}
	return model.Audience_KIND_UNSPECIFIED
}

func formatID(id uint64) string {
	return fmt.Sprintf("%d", id)
}

// ParseID converts a string ID to uint64. Used by service code translating
// proto string IDs into the internal uint64 form. Returns 0 on parse
// failure (callers should validate non-zero before relying on the result).
func ParseID(idStr string) uint64 {
	var id uint64
	fmt.Sscanf(idStr, "%d", &id)
	return id
}
