package touch

import (
    "context"
    "strconv"
    "time"

    "github.com/cloudwego/hertz/pkg/app"
    "github.com/peers-touch/peers-touch/station/frame/core/server"
    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
    "github.com/peers-touch/peers-touch/station/frame/touch/message/service"
)

type MessageHandlerInfo struct {
    RouterURL RouterPath
    Handler   func(context.Context, *app.RequestContext)
    Method    server.Method
    Wrappers  []server.Wrapper
}

func GetMessageHandlers() []MessageHandlerInfo {
    commonWrapper := CommonAccessControlWrapper(RoutersNameMessage)

    return []MessageHandlerInfo{
        {RouterURL: MessageRouterURLCreateConv, Handler: CreateConv, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLGetConv, Handler: GetConv, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLGetConvState, Handler: GetConvState, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLMembers, Handler: UpdateMembers, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLMembers, Handler: GetMembers, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLKeyRotate, Handler: KeyRotate, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLAppendMsg, Handler: AppendMessage, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLListMsg, Handler: ListMessages, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLStream, Handler: StreamMessages, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLReceipt, Handler: PostReceipt, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLReceipts, Handler: GetReceipts, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLAttach, Handler: PostAttachment, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLGetAttach, Handler: GetAttachment, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLSearch, Handler: SearchMessages, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLSnapshot, Handler: GetSnapshot, Method: server.GET, Wrappers: []server.Wrapper{commonWrapper}},
        {RouterURL: MessageRouterURLSnapshot, Handler: PostSnapshot, Method: server.POST, Wrappers: []server.Wrapper{commonWrapper}},
    }
}

func CreateConv(c context.Context, ctx *app.RequestContext) {
    var p struct{ ConvID string `json:"conv_id"`; Type string `json:"type"`; Title string `json:"title"`; AvatarCID string `json:"avatar_cid"`; Policy string `json:"policy"` }
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    svc := service.NewConversationService()
    conv, err := svc.Create(c, &service.CreateConvReq{ConvID: p.ConvID, Type: p.Type, Title: p.Title, AvatarCID: p.AvatarCID, Policy: p.Policy})
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", conv)
}

func GetConv(c context.Context, ctx *app.RequestContext) {
    id := ctx.Param("id")
    svc := service.NewConversationService()
    conv, err := svc.Get(c, id)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", conv)
}

func GetConvState(c context.Context, ctx *app.RequestContext) {
    id := ctx.Param("id")
    svc := service.NewConversationService()
    conv, err := svc.Get(c, id)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", map[string]interface{}{ "epoch": conv.Epoch })
}

func UpdateMembers(c context.Context, ctx *app.RequestContext) {
    var p struct{ ConvPK uint64 `json:"conv_pk"`; Add []string `json:"add"`; Remove []string `json:"remove"`; Role string `json:"role"` }
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    svc := service.NewConversationService()
    if len(p.Add) > 0 { if err := svc.AddMembers(c, p.ConvPK, p.Add, m.Role(p.Role)); err != nil { FailedResponse(ctx, err); return } }
    if len(p.Remove) > 0 { if err := svc.RemoveMembers(c, p.ConvPK, p.Remove); err != nil { FailedResponse(ctx, err); return } }
    SuccessResponse(ctx, "", map[string]interface{}{"ok": true})
}

func GetMembers(c context.Context, ctx *app.RequestContext) {
    var p struct{ ConvPK uint64 `json:"conv_pk"` }
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    svc := service.NewConversationService()
    list, err := svc.Members(c, p.ConvPK)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", list)
}

func KeyRotate(c context.Context, ctx *app.RequestContext) {
    id := ctx.Param("id")
    svc := service.NewConversationService()
    if err := svc.KeyRotate(c, id); err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", map[string]interface{}{"ok": true})
}

func AppendMessage(c context.Context, ctx *app.RequestContext) {
    var p struct{ ULID string `json:"ulid"`; SenderDID string `json:"sender_did"`; Type string `json:"type"`; ParentID string `json:"parent_id"`; ThreadID string `json:"thread_id"`; ContentCID string `json:"content_cid"`; TTLMillis int64 `json:"ttl_ms"` }
    convID := ctx.Param("id")
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    svc := service.NewMessageService()
    now := time.Now().UnixMilli()
    msg, err := svc.Append(c, &service.AppendReq{ULID: p.ULID, ConvID: convID, SenderDID: p.SenderDID, TS: now, Type: p.Type, ParentID: p.ParentID, ThreadID: p.ThreadID, ContentCID: p.ContentCID, TTLMillis: p.TTLMillis})
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", msg)
}

func ListMessages(c context.Context, ctx *app.RequestContext) {
    convID := ctx.Param("id")
    afterStr := string(ctx.QueryArgs().Peek("after"))
    limitStr := string(ctx.QueryArgs().Peek("limit"))
    var after int64
    var limit int
    if afterStr != "" { if v, err := strconv.ParseInt(afterStr, 10, 64); err == nil { after = v } }
    if limitStr != "" { if v, err := strconv.Atoi(limitStr); err == nil { limit = v } }
    svc := service.NewMessageService()
    list, err := svc.List(c, convID, after, limit)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", list)
}

func StreamMessages(c context.Context, ctx *app.RequestContext) { SuccessResponse(ctx, "", map[string]interface{}{"ok": true}) }

func PostReceipt(c context.Context, ctx *app.RequestContext) {
    var p struct{ MsgULID string `json:"msg_ulid"`; MemberDID string `json:"member_did"`; Delivered bool `json:"delivered"`; Read bool `json:"read"` }
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    svc := service.NewReceiptService()
    r, err := svc.Post(c, &service.PostReceiptReq{MsgULID: p.MsgULID, MemberDID: p.MemberDID, Delivered: p.Delivered, Read: p.Read})
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", r)
}

func GetReceipts(c context.Context, ctx *app.RequestContext) {
    convID := ctx.Param("id")
    afterStr := string(ctx.QueryArgs().Peek("after"))
    var after int64
    if afterStr != "" { if v, err := strconv.ParseInt(afterStr, 10, 64); err == nil { after = v } }
    svc := service.NewReceiptService()
    list, err := svc.List(c, convID, after)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", list)
}

func PostAttachment(c context.Context, ctx *app.RequestContext) {
    var p struct{ CID string `json:"cid"`; MIME string `json:"mime"`; Bytes int64 `json:"bytes"`; Digest string `json:"digest"`; Store string `json:"store"` }
    convID := ctx.Param("id")
    msgID := string(ctx.QueryArgs().Peek("msg_ulid"))
    if err := ctx.Bind(&p); err != nil { FailedResponse(ctx, err); return }
    a := &m.Attachment{CID: p.CID, ConvID: convID, MsgULID: msgID, MIME: p.MIME, Bytes: p.Bytes, Digest: p.Digest, Store: p.Store}
    svc := service.NewAttachmentService()
    if err := svc.Save(c, a); err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", a)
}

func GetAttachment(c context.Context, ctx *app.RequestContext) {
    cid := ctx.Param("cid")
    svc := service.NewAttachmentService()
    a, err := svc.Get(c, cid)
    if err != nil { FailedResponse(ctx, err); return }
    SuccessResponse(ctx, "", a)
}

func SearchMessages(c context.Context, ctx *app.RequestContext) { SuccessResponse(ctx, "", []interface{}{}) }

func GetSnapshot(c context.Context, ctx *app.RequestContext) { SuccessResponse(ctx, "", map[string]interface{}{"ok": true}) }

func PostSnapshot(c context.Context, ctx *app.RequestContext) { SuccessResponse(ctx, "", map[string]interface{}{"ok": true}) }