package pluginlark

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkdispatcher "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkcallback "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkdrive "github.com/larksuite/oapi-sdk-go/v3/service/drive/v1"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
)

// CredentialFetcher returns in-memory credentials provisioned by the host.
type CredentialFetcher func(ctx context.Context, bindingID, usage string) (appID, appSecret string, err error)

// InboundCaller submits one normalized event to the host and returns its
// admission decision.
type InboundCaller func(ctx context.Context, event *model.NormalizedInboundEvent) (*model.InboundAck, error)

// StatusReporter forwards observed connection states to the host.
type StatusReporter func(ctx context.Context, bindingID, state, reason string) error
type IdentityReporter func(ctx context.Context, bindingID, botOpenID, tenantKey string) error
type CardActionCaller func(ctx context.Context, action *model.CardActionEvent) (*model.CardActionAck, error)

// Runtime owns the plugin-side binding processes and answers host RPCs.
type Runtime struct {
	fetchCredential CredentialFetcher
	callInbound     InboundCaller
	reportStatus    StatusReporter
	reportIdentity  IdentityReporter
	callCardAction  CardActionCaller

	mu                      sync.Mutex
	bindings                map[string]*bindingRuntime
	resources               map[string]cachedResource
	uploads                 map[string]*pendingUpload
	automationSubscriptions map[string]documentSubscription
}

type bindingRuntime struct {
	cfg    bindingConfig
	client *lark.Client
	cancel context.CancelFunc
	done   chan struct{}
}

type cachedResource struct {
	body      []byte
	fileName  string
	mimeType  string
	expiresAt time.Time
}

type pendingUpload struct {
	bindingID   string
	kind        string
	fileName    string
	mimeType    string
	checksum    string
	totalBytes  uint64
	body        []byte
	providerKey string
	expiresAt   time.Time
}

type documentSubscription struct {
	fileToken string
	fileType  string
	events    []string
}

type bindingConfig struct {
	bindingID string
	appID     string
	domain    string
}

// NewRuntime builds the plugin runtime. Inbound/status callers are injected
// by the command entry from the stdio Peer.
func NewRuntime(fetch CredentialFetcher, inbound InboundCaller, status StatusReporter) *Runtime {
	return &Runtime{
		fetchCredential:         fetch,
		callInbound:             inbound,
		reportStatus:            status,
		bindings:                make(map[string]*bindingRuntime),
		resources:               make(map[string]cachedResource),
		uploads:                 make(map[string]*pendingUpload),
		automationSubscriptions: make(map[string]documentSubscription),
	}
}

func (r *Runtime) SetIdentityReporter(reporter IdentityReporter) {
	r.mu.Lock()
	r.reportIdentity = reporter
	r.mu.Unlock()
}

func (r *Runtime) SetCardActionCaller(caller CardActionCaller) {
	r.mu.Lock()
	r.callCardAction = caller
	r.mu.Unlock()
}

// StartBinding starts (or confirms) one connection generation.
func (r *Runtime) StartBinding(ctx context.Context, req *model.BindingStartRequest) (*model.BindingStartResponse, error) {
	if strings.TrimSpace(req.GetBindingId()) == "" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "binding_id required"}
	}
	if strings.TrimSpace(req.GetProviderAppId()) == "" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "provider_app_id required"}
	}
	fetchedAppID, appSecret, err := r.fetchCredential(ctx, req.GetBindingId(), "ws")
	if err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: "credential unavailable"}
	}
	if fetchedAppID != "" && fetchedAppID != req.GetProviderAppId() {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: "credential app id mismatch"}
	}
	cfg := bindingConfig{
		bindingID: req.GetBindingId(),
		appID:     req.GetProviderAppId(),
		domain:    strings.TrimSpace(req.GetDomain()),
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.bindings[cfg.bindingID]; ok {
		if existing.cfg.appID == cfg.appID && existing.cfg.domain == cfg.domain {
			return &model.BindingStartResponse{Ok: true}, nil
		}
		r.stopLocked(cfg.bindingID)
	}

	bindingCtx, cancel := context.WithCancel(context.Background())
	options := make([]lark.ClientOptionFunc, 0, 1)
	if cfg.domain != "" {
		options = append(options, lark.WithOpenBaseUrl(cfg.domain))
	}
	client := lark.NewClient(cfg.appID, appSecret, options...)
	br := &bindingRuntime{
		cfg:    cfg,
		client: client,
		cancel: cancel,
		done:   make(chan struct{}),
	}
	r.bindings[cfg.bindingID] = br

	dispatcher := larkdispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(eventCtx context.Context, event *larkim.P2MessageReceiveV1) error {
			return r.handlePlatformEvent(eventCtx, cfg.bindingID, event)
		}).
		OnP2FileEditV1(func(eventCtx context.Context, event *larkdrive.P2FileEditV1) error {
			if event == nil || event.Event == nil {
				return nil
			}
			return r.handleNormalizedEvent(eventCtx, normalizeDocumentEvent(
				cfg.bindingID, event.EventV2Base, "edit",
				valueOf(event.Event.FileToken), valueOf(event.Event.FileType),
				firstDriveUserID(event.Event.OperatorIdList...), event.Event,
			))
		}).
		OnP2FileTitleUpdatedV1(func(eventCtx context.Context, event *larkdrive.P2FileTitleUpdatedV1) error {
			if event == nil || event.Event == nil {
				return nil
			}
			return r.handleNormalizedEvent(eventCtx, normalizeDocumentEvent(
				cfg.bindingID, event.EventV2Base, "title_updated",
				valueOf(event.Event.FileToken), valueOf(event.Event.FileType),
				firstDriveUserID(event.Event.OperatorId), event.Event,
			))
		}).
		OnP2FileCreatedInFolderV1(func(eventCtx context.Context, event *larkdrive.P2FileCreatedInFolderV1) error {
			if event == nil || event.Event == nil {
				return nil
			}
			return r.handleNormalizedEvent(eventCtx, normalizeDocumentEvent(
				cfg.bindingID, event.EventV2Base, "created",
				valueOf(event.Event.FileToken), valueOf(event.Event.FileType),
				firstDriveUserID(event.Event.OperatorId), event.Event,
			))
		}).
		OnP2FileDeletedV1(func(eventCtx context.Context, event *larkdrive.P2FileDeletedV1) error {
			if event == nil || event.Event == nil {
				return nil
			}
			return r.handleNormalizedEvent(eventCtx, normalizeDocumentEvent(
				cfg.bindingID, event.EventV2Base, "deleted",
				valueOf(event.Event.FileToken), valueOf(event.Event.FileType),
				firstDriveUserID(event.Event.OperatorId), event.Event,
			))
		}).
		OnP2FileTrashedV1(func(eventCtx context.Context, event *larkdrive.P2FileTrashedV1) error {
			if event == nil || event.Event == nil {
				return nil
			}
			return r.handleNormalizedEvent(eventCtx, normalizeDocumentEvent(
				cfg.bindingID, event.EventV2Base, "trashed",
				valueOf(event.Event.FileToken), valueOf(event.Event.FileType),
				firstDriveUserID(event.Event.OperatorId), event.Event,
			))
		}).
		OnP2CardActionTrigger(func(eventCtx context.Context, event *larkcallback.CardActionTriggerEvent) (*larkcallback.CardActionTriggerResponse, error) {
			return r.handleCardAction(eventCtx, cfg.bindingID, event)
		})

	ws := newWSClient(WSConfig{
		AppID:     cfg.appID,
		AppSecret: appSecret,
		BaseURL:   cfg.domain,
		OnEvent: func(handlerCtx context.Context, payload []byte) (any, error) {
			return dispatcher.Do(handlerCtx, payload)
		},
		OnState: func(state ConnectionState, reason string) {
			if r.reportStatus == nil {
				return
			}
			_ = r.reportStatus(context.Background(), cfg.bindingID, state.protoName(), reason)
		},
	})
	go r.reportBotIdentity(bindingCtx, cfg.bindingID, client)

	go func() {
		defer close(br.done)
		_ = ws.Run(bindingCtx)
	}()
	return &model.BindingStartResponse{Ok: true}, nil
}

// StopBinding cancels one generation and waits for its connection goroutines.
func (r *Runtime) StopBinding(_ context.Context, req *model.BindingStopRequest) (*model.BindingStopResponse, error) {
	if strings.TrimSpace(req.GetBindingId()) == "" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "binding_id required"}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked(req.GetBindingId())
	return &model.BindingStopResponse{Ok: true}, nil
}

func (r *Runtime) stopLocked(bindingID string) {
	if br, ok := r.bindings[bindingID]; ok {
		br.cancel()
		<-br.done
		delete(r.bindings, bindingID)
	}
}

// Deliver sends or updates one typed provider message with the host-authored
// delivery identity. A transport failure after dispatch is reported unknown,
// so Station can reconcile instead of blindly re-running the Turn.
func (r *Runtime) Deliver(ctx context.Context, req *model.DeliveryRequest) (*model.DeliveryReceipt, error) {
	if strings.TrimSpace(req.GetBindingId()) == "" || strings.TrimSpace(req.GetTargetChatId()) == "" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "binding_id and target_chat_id required"}
	}
	r.mu.Lock()
	br, ok := r.bindings[req.GetBindingId()]
	r.mu.Unlock()
	if !ok {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: "binding not started"}
	}

	messageType, content, err := deliveryContent(req)
	if err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	apiReq := &larkcore.ApiReq{
		HttpMethod:  http.MethodPost,
		ApiPath:     "/open-apis/im/v1/messages",
		QueryParams: larkcore.QueryParams{},
		Body: map[string]any{
			"receive_id": req.GetTargetChatId(),
			"msg_type":   messageType,
			"content":    content,
		},
		SupportedAccessTokenTypes: []larkcore.AccessTokenType{larkcore.AccessTokenTypeTenant},
	}
	apiReq.QueryParams.Set("receive_id_type", "chat_id")
	apiReq.QueryParams.Set("uuid", truncateUUID(req.GetIdempotencyKey()))
	switch req.GetOperation() {
	case model.DeliveryOperation_DELIVERY_OPERATION_UPDATE:
		if strings.TrimSpace(req.GetProviderMessageId()) == "" {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "provider_message_id is required for update"}
		}
		apiReq.HttpMethod = http.MethodPatch
		apiReq.ApiPath = "/open-apis/im/v1/messages/" + url.PathEscape(req.GetProviderMessageId())
		apiReq.QueryParams = larkcore.QueryParams{}
		apiReq.Body = map[string]any{"content": content}
	case model.DeliveryOperation_DELIVERY_OPERATION_REPLY:
		replyID := firstNonEmptyLocal(req.GetReplyToMessageId(), req.GetProviderMessageId())
		if replyID == "" {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "reply message id is required"}
		}
		apiReq.ApiPath = "/open-apis/im/v1/messages/" + url.PathEscape(replyID) + "/reply"
		apiReq.QueryParams = larkcore.QueryParams{}
		apiReq.QueryParams.Set("uuid", truncateUUID(req.GetIdempotencyKey()))
		apiReq.Body = map[string]any{"msg_type": messageType, "content": content}
	}
	apiResp, err := br.client.Do(ctx, apiReq)
	if err != nil {
		return &model.DeliveryReceipt{
			DeliveryId:    req.GetDeliveryId(),
			Ok:            false,
			ErrorCategory: "unknown",
			ErrorMessage:  err.Error(),
		}, nil
	}
	var parsed struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			MessageID string `json:"message_id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(apiResp.RawBody, &parsed)
	if parsed.Code != 0 {
		return &model.DeliveryReceipt{
			DeliveryId:    req.GetDeliveryId(),
			Ok:            false,
			ErrorCategory: apiErrorCategory(parsed.Code),
			ErrorMessage:  parsed.Msg,
		}, nil
	}
	return &model.DeliveryReceipt{
		DeliveryId:        req.GetDeliveryId(),
		ProviderMessageId: firstNonEmptyLocal(parsed.Data.MessageID, req.GetProviderMessageId()),
		Ok:                true,
		DeliveredAtUnixMs: time.Now().UnixMilli(),
	}, nil
}

func (r *Runtime) FetchResource(
	ctx context.Context,
	req *model.ResourceFetchRequest,
) (*model.ResourceFetchResponse, error) {
	if req == nil || strings.TrimSpace(req.GetBindingId()) == "" ||
		strings.TrimSpace(req.GetMessageId()) == "" ||
		strings.TrimSpace(req.GetProviderKey()) == "" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "binding, message and provider key are required"}
	}
	r.mu.Lock()
	br := r.bindings[req.GetBindingId()]
	r.pruneResourcesLocked()
	cacheKey := req.GetBindingId() + "\x00" + req.GetMessageId() + "\x00" + req.GetProviderKey()
	cached, ok := r.resources[cacheKey]
	r.mu.Unlock()
	if br == nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: "binding not started"}
	}
	if !ok {
		resourceType := req.GetKind()
		if resourceType != "image" {
			resourceType = "file"
		}
		response, err := br.client.Im.MessageResource.Get(
			ctx,
			larkim.NewGetMessageResourceReqBuilder().
				MessageId(req.GetMessageId()).
				FileKey(req.GetProviderKey()).
				Type(resourceType).
				Build(),
		)
		if err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: err.Error()}
		}
		if !response.Success() {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodePermanentDelivery, Message: response.Msg}
		}
		body, err := io.ReadAll(io.LimitReader(response.File, 32*1024*1024+1))
		if err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: err.Error()}
		}
		if len(body) > 32*1024*1024 {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodePermanentDelivery, Message: "resource exceeds 32 MiB limit"}
		}
		cached = cachedResource{
			body: body, fileName: response.FileName,
			mimeType:  resourceMIME(req.GetKind(), response.FileName),
			expiresAt: time.Now().Add(5 * time.Minute),
		}
		r.mu.Lock()
		r.resources[cacheKey] = cached
		r.mu.Unlock()
	}
	offset := int(req.GetOffset())
	if offset < 0 || offset > len(cached.body) {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "resource offset is invalid"}
	}
	maxBytes := int(req.GetMaxBytes())
	if maxBytes <= 0 || maxBytes > 512*1024 {
		maxBytes = 512 * 1024
	}
	end := min(offset+maxBytes, len(cached.body))
	chunk := append([]byte(nil), cached.body[offset:end]...)
	eof := end == len(cached.body)
	if eof {
		r.mu.Lock()
		delete(r.resources, cacheKey)
		r.mu.Unlock()
	}
	return &model.ResourceFetchResponse{
		Data: chunk, Eof: eof, FileName: cached.fileName,
		MimeType: cached.mimeType, TotalBytes: uint64(len(cached.body)),
	}, nil
}

func (r *Runtime) UploadResource(
	ctx context.Context,
	req *model.ResourceUploadRequest,
) (*model.ResourceUploadResponse, error) {
	if req == nil || strings.TrimSpace(req.GetBindingId()) == "" ||
		strings.TrimSpace(req.GetUploadId()) == "" {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "binding_id and upload_id required",
		}
	}
	if req.GetKind() != "image" && req.GetKind() != "file" {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "upload kind must be image or file",
		}
	}
	const maxFileBytes = 30 * 1024 * 1024
	const maxImageBytes = 10 * 1024 * 1024
	limit := uint64(maxFileBytes)
	if req.GetKind() == "image" {
		limit = maxImageBytes
	}
	if req.GetTotalBytes() == 0 || req.GetTotalBytes() > limit {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "upload size is outside provider limits",
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.pruneResourcesLocked()
	br, ok := r.bindings[req.GetBindingId()]
	if !ok {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeRetryableDelivery, Message: "binding not started",
		}
	}
	key := req.GetBindingId() + ":" + req.GetUploadId()
	upload := r.uploads[key]
	if upload == nil {
		if req.GetOffset() != 0 {
			return nil, &pluginrpc.RPCError{
				Code: pluginrpc.CodeInvalidParams, Message: "upload offset does not start at zero",
			}
		}
		upload = &pendingUpload{
			bindingID: req.GetBindingId(), kind: req.GetKind(),
			fileName:   strings.TrimSpace(req.GetFileName()),
			mimeType:   strings.TrimSpace(req.GetMimeType()),
			checksum:   strings.TrimSpace(req.GetChecksum()),
			totalBytes: req.GetTotalBytes(), expiresAt: time.Now().Add(10 * time.Minute),
		}
		r.uploads[key] = upload
	}
	if upload.providerKey != "" {
		return &model.ResourceUploadResponse{
			UploadId: req.GetUploadId(), AcceptedOffset: upload.totalBytes,
			Complete: true, ProviderKey: upload.providerKey,
		}, nil
	}
	if upload.bindingID != req.GetBindingId() || upload.kind != req.GetKind() ||
		upload.totalBytes != req.GetTotalBytes() ||
		upload.checksum != strings.TrimSpace(req.GetChecksum()) {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "upload metadata changed",
		}
	}
	if req.GetOffset() != uint64(len(upload.body)) {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams,
			Message: fmt.Sprintf("upload offset mismatch: got %d want %d",
				req.GetOffset(), len(upload.body)),
		}
	}
	if uint64(len(upload.body)+len(req.GetData())) > upload.totalBytes {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "upload exceeds declared size",
		}
	}
	upload.body = append(upload.body, req.GetData()...)
	accepted := uint64(len(upload.body))
	if !req.GetEof() {
		return &model.ResourceUploadResponse{
			UploadId: req.GetUploadId(), AcceptedOffset: accepted,
		}, nil
	}
	if accepted != upload.totalBytes {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "terminal upload size mismatch",
		}
	}
	sum := sha256.Sum256(upload.body)
	actualChecksum := fmt.Sprintf("sha256:%x", sum[:])
	if upload.checksum != "" && !strings.EqualFold(upload.checksum, actualChecksum) {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeInvalidParams, Message: "terminal upload checksum mismatch",
		}
	}
	var providerKey string
	if upload.kind == "image" {
		response, err := br.client.Im.Image.Create(
			ctx,
			larkim.NewCreateImageReqBuilder().Body(
				larkim.NewCreateImageReqBodyBuilder().
					ImageType("message").
					Image(bytes.NewReader(upload.body)).
					Build(),
			).Build(),
		)
		if err != nil {
			return nil, err
		}
		if !response.Success() || response.Data == nil {
			return nil, fmt.Errorf("provider image upload failed: %s", response.Msg)
		}
		providerKey = valueOf(response.Data.ImageKey)
	} else {
		fileType := strings.TrimPrefix(strings.ToLower(filepath.Ext(upload.fileName)), ".")
		if fileType == "" {
			fileType = "stream"
		}
		response, err := br.client.Im.File.Create(
			ctx,
			larkim.NewCreateFileReqBuilder().Body(
				larkim.NewCreateFileReqBodyBuilder().
					FileType(fileType).
					FileName(firstNonEmptyLocal(upload.fileName, "peers-output.bin")).
					File(bytes.NewReader(upload.body)).
					Build(),
			).Build(),
		)
		if err != nil {
			return nil, err
		}
		if !response.Success() || response.Data == nil {
			return nil, fmt.Errorf("provider file upload failed: %s", response.Msg)
		}
		providerKey = valueOf(response.Data.FileKey)
	}
	if providerKey == "" {
		return nil, fmt.Errorf("provider upload returned an empty resource key")
	}
	upload.providerKey = providerKey
	upload.body = nil
	return &model.ResourceUploadResponse{
		UploadId: req.GetUploadId(), AcceptedOffset: accepted,
		Complete: true, ProviderKey: providerKey,
	}, nil
}

func (r *Runtime) SyncAutomationTrigger(
	ctx context.Context,
	req *model.SyncAutomationTriggerRequest,
) (*model.SyncAutomationTriggerResponse, error) {
	if req == nil || strings.TrimSpace(req.GetBindingId()) == "" ||
		strings.TrimSpace(req.GetAutomationId()) == "" {
		return nil, &pluginrpc.RPCError{
			Code:    pluginrpc.CodeInvalidParams,
			Message: "binding_id and automation_id required",
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	br, ok := r.bindings[req.GetBindingId()]
	if !ok {
		return nil, &pluginrpc.RPCError{
			Code: pluginrpc.CodeRetryableDelivery, Message: "binding not started",
		}
	}
	key := req.GetBindingId() + ":" + req.GetAutomationId()
	previous, hadPrevious := r.automationSubscriptions[key]
	next, err := parseDocumentSubscription(req.GetTriggerValue())
	if req.GetTriggerType() != "document" || !req.GetEnabled() {
		next = documentSubscription{}
		err = nil
	}
	if err != nil {
		return &model.SyncAutomationTriggerResponse{
			Ok: false, ErrorMessage: err.Error(),
		}, nil
	}
	if hadPrevious && !sameDocumentSubscription(previous, next) {
		if err := deleteDocumentSubscription(ctx, br.client, previous); err != nil {
			return &model.SyncAutomationTriggerResponse{
				Ok: false, ErrorMessage: err.Error(),
			}, nil
		}
		delete(r.automationSubscriptions, key)
	}
	if next.fileToken == "" {
		return &model.SyncAutomationTriggerResponse{Ok: true}, nil
	}
	if !hadPrevious || !sameDocumentSubscription(previous, next) {
		if err := createDocumentSubscription(ctx, br.client, next); err != nil {
			return &model.SyncAutomationTriggerResponse{
				Ok: false, ErrorMessage: err.Error(),
			}, nil
		}
		r.automationSubscriptions[key] = next
	}
	return &model.SyncAutomationTriggerResponse{Ok: true}, nil
}

type documentSubscriptionInput struct {
	FileToken string   `json:"file_token"`
	FileType  string   `json:"file_type"`
	Events    []string `json:"events"`
}

func parseDocumentSubscription(value string) (documentSubscription, error) {
	value = strings.TrimSpace(value)
	var input documentSubscriptionInput
	if strings.HasPrefix(value, "{") {
		if err := json.Unmarshal([]byte(value), &input); err != nil {
			return documentSubscription{}, fmt.Errorf("decode document trigger: %w", err)
		}
	} else if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) >= 2 {
			input.FileType = parts[0]
			input.FileToken = parts[1]
		}
	} else {
		input.FileToken = value
		input.FileType = "docx"
	}
	input.FileToken = strings.TrimSpace(input.FileToken)
	input.FileType = normalizeDriveFileType(input.FileType)
	if input.FileToken == "" || input.FileType == "" {
		return documentSubscription{}, fmt.Errorf("document trigger requires a file token and supported file type")
	}
	events := input.Events
	if len(events) == 0 {
		events = []string{"file.edit_v1", "file.title_updated_v1"}
	}
	for index, event := range events {
		events[index] = normalizeDriveEventType(event)
		if events[index] == "" {
			return documentSubscription{}, fmt.Errorf("unsupported document event %q", event)
		}
	}
	return documentSubscription{
		fileToken: input.FileToken, fileType: input.FileType,
		events: uniqueLocalStrings(events),
	}, nil
}

func normalizeDriveFileType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "doc", "docx":
		return strings.ToLower(strings.TrimSpace(value))
	case "sheet", "sheets":
		return "sheet"
	case "bitable", "base":
		return "bitable"
	default:
		return ""
	}
}

func normalizeDriveEventType(value string) string {
	value = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "drive.")
	switch value {
	case "edit", "file.edit_v1":
		return "file.edit_v1"
	case "title_updated", "file.title_updated_v1":
		return "file.title_updated_v1"
	case "created", "file.created_in_folder_v1":
		return "file.created_in_folder_v1"
	case "deleted", "file.deleted_v1":
		return "file.deleted_v1"
	case "trashed", "file.trashed_v1":
		return "file.trashed_v1"
	default:
		return ""
	}
}

func createDocumentSubscription(
	ctx context.Context,
	client *lark.Client,
	subscription documentSubscription,
) error {
	for _, event := range subscription.events {
		response, err := client.Drive.V1.File.Subscribe(
			ctx,
			larkdrive.NewSubscribeFileReqBuilder().
				FileToken(subscription.fileToken).
				FileType(subscription.fileType).
				EventType(event).
				Build(),
		)
		if err != nil {
			return err
		}
		if !response.Success() {
			return fmt.Errorf("subscribe document event %s failed: %s", event, response.Msg)
		}
	}
	return nil
}

func deleteDocumentSubscription(
	ctx context.Context,
	client *lark.Client,
	subscription documentSubscription,
) error {
	for _, event := range subscription.events {
		response, err := client.Drive.V1.File.DeleteSubscribe(
			ctx,
			larkdrive.NewDeleteSubscribeFileReqBuilder().
				FileToken(subscription.fileToken).
				FileType(subscription.fileType).
				EventType(event).
				Build(),
		)
		if err != nil {
			return err
		}
		if !response.Success() {
			return fmt.Errorf("unsubscribe document event %s failed: %s", event, response.Msg)
		}
	}
	return nil
}

func sameDocumentSubscription(left, right documentSubscription) bool {
	return left.fileToken == right.fileToken &&
		left.fileType == right.fileType &&
		strings.Join(left.events, "\x00") == strings.Join(right.events, "\x00")
}

func uniqueLocalStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (r *Runtime) handlePlatformEvent(ctx context.Context, bindingID string, event *larkim.P2MessageReceiveV1) error {
	normalized := normalizeMessage(bindingID, "lark", event)
	r.enrichMessageContext(ctx, bindingID, normalized)
	return r.handleNormalizedEvent(ctx, normalized)
}

func (r *Runtime) enrichMessageContext(
	ctx context.Context,
	bindingID string,
	event *model.NormalizedInboundEvent,
) {
	if event == nil {
		return
	}
	r.mu.Lock()
	binding := r.bindings[bindingID]
	r.mu.Unlock()
	if binding == nil || binding.client == nil {
		return
	}
	if event.GetMessageType() == "merge_forward" {
		items, err := getMessageItems(ctx, binding.client, event.GetMessageId())
		if err == nil {
			text, resources := summarizeReferencedMessages(
				items,
				event.GetMessageId(),
			)
			if text != "" || len(resources) > 0 {
				event.Text = text
				event.Resources = resources
			}
		}
	}
	if event.GetParentId() == "" {
		return
	}
	items, err := getMessageItems(ctx, binding.client, event.GetParentId())
	if err != nil {
		return
	}
	text, _ := summarizeReferencedMessages(items, "")
	if text == "" {
		return
	}
	if event.Metadata == nil {
		event.Metadata = map[string]string{}
	}
	event.Metadata["quoted_text"] = text
}

func getMessageItems(
	ctx context.Context,
	client *lark.Client,
	messageID string,
) ([]*larkim.Message, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return nil, errors.New("message id is required")
	}
	response, err := client.Im.Message.Get(
		ctx,
		larkim.NewGetMessageReqBuilder().
			MessageId(messageID).
			UserIdType("open_id").
			WithSenderName(true).
			Build(),
	)
	if err != nil {
		return nil, err
	}
	if !response.Success() || response.Data == nil {
		return nil, fmt.Errorf("get referenced message failed: %s", response.Msg)
	}
	if len(response.Data.Items) > 100 {
		return response.Data.Items[:100], nil
	}
	return response.Data.Items, nil
}

func summarizeReferencedMessages(
	items []*larkim.Message,
	skipMessageID string,
) (string, []*model.ChannelResourceRef) {
	lines := make([]string, 0, len(items))
	resources := make([]*model.ChannelResourceRef, 0)
	for _, item := range items {
		if item == nil || valueOf(item.MessageId) == skipMessageID {
			continue
		}
		content := ""
		if item.Body != nil {
			content = valueOf(item.Body.Content)
		}
		text, itemResources := extractContent(valueOf(item.MsgType), content)
		messageID := valueOf(item.MessageId)
		for _, resource := range itemResources {
			if resource != nil {
				resource.SourceMessageId = messageID
				resources = append(resources, resource)
			}
		}
		if text == "" && len(itemResources) > 0 {
			text = referencedResourceSummary(itemResources)
		}
		if text == "" {
			continue
		}
		sender := ""
		if item.Sender != nil {
			sender = firstNonEmptyLocal(
				valueOf(item.Sender.SenderName),
				valueOf(item.Sender.Id),
			)
		}
		if sender != "" {
			text = sender + ": " + text
		}
		lines = append(lines, text)
	}
	return strings.Join(lines, "\n"), resources
}

func referencedResourceSummary(
	resources []*model.ChannelResourceRef,
) string {
	labels := make([]string, 0, len(resources))
	for _, resource := range resources {
		if resource == nil {
			continue
		}
		label := resource.GetKind()
		if resource.GetFileName() != "" {
			label += ": " + resource.GetFileName()
		}
		labels = append(labels, "["+label+"]")
	}
	return strings.Join(labels, " ")
}

func (r *Runtime) handleNormalizedEvent(
	ctx context.Context,
	normalized *model.NormalizedInboundEvent,
) error {
	if normalized == nil {
		// Unsupported envelope shapes still ack successfully.
		return nil
	}
	if r.callInbound == nil {
		return errors.New("inbound caller not configured")
	}
	ack, err := r.callInbound(ctx, normalized)
	if err != nil {
		// Host/transport failure: let the platform redeliver.
		return err
	}
	if ack.GetState() == model.InboundAckState_INBOUND_ACK_STATE_RETRY {
		return errors.New("host requests redelivery: " + ack.GetErrorCode())
	}
	return nil
}

func (r *Runtime) handleCardAction(
	ctx context.Context,
	bindingID string,
	event *larkcallback.CardActionTriggerEvent,
) (*larkcallback.CardActionTriggerResponse, error) {
	if event == nil || event.Event == nil || event.Event.Action == nil {
		return nil, nil
	}
	r.mu.Lock()
	caller := r.callCardAction
	r.mu.Unlock()
	if caller == nil {
		return &larkcallback.CardActionTriggerResponse{
			Toast: &larkcallback.Toast{Type: "error", Content: "Action handling is unavailable."},
		}, nil
	}
	value, _ := json.Marshal(event.Event.Action.Value)
	actionID := event.Event.Token
	if event.EventV2Base != nil && event.EventV2Base.Header.EventID != "" {
		actionID = event.EventV2Base.Header.EventID
	}
	action := &model.CardActionEvent{
		BindingId: bindingID, ActionId: actionID,
		Action: firstNonEmptyLocal(
			stringValue(event.Event.Action.Value["action"]),
			event.Event.Action.Name,
			event.Event.Action.Option,
		),
		ValueJson: string(value), Token: event.Event.Token,
	}
	if event.Event.Operator != nil {
		action.OpenId = event.Event.Operator.OpenID
		action.TenantKey = valueOf(event.Event.Operator.TenantKey)
	}
	if event.Event.Context != nil {
		action.MessageId = event.Event.Context.OpenMessageID
	}
	ack, err := caller(ctx, action)
	if err != nil {
		return nil, err
	}
	toastType := "success"
	if !ack.GetOk() {
		toastType = "error"
	}
	return &larkcallback.CardActionTriggerResponse{
		Toast: &larkcallback.Toast{Type: toastType, Content: ack.GetToast()},
	}, nil
}

func (r *Runtime) reportBotIdentity(
	ctx context.Context,
	bindingID string,
	client *lark.Client,
) {
	apiReq := &larkcore.ApiReq{
		HttpMethod: http.MethodGet, ApiPath: "/open-apis/bot/v3/info",
		SupportedAccessTokenTypes: []larkcore.AccessTokenType{larkcore.AccessTokenTypeTenant},
	}
	response, err := client.Do(ctx, apiReq)
	if err != nil {
		return
	}
	var payload struct {
		Code int `json:"code"`
		Bot  struct {
			OpenID    string `json:"open_id"`
			TenantKey string `json:"tenant_key"`
		} `json:"bot"`
	}
	if json.Unmarshal(response.RawBody, &payload) != nil || payload.Code != 0 {
		return
	}
	r.mu.Lock()
	reporter := r.reportIdentity
	r.mu.Unlock()
	if reporter != nil {
		_ = reporter(context.Background(), bindingID, payload.Bot.OpenID, payload.Bot.TenantKey)
	}
}

func (r *Runtime) pruneResourcesLocked() {
	now := time.Now()
	for key, resource := range r.resources {
		if !resource.expiresAt.After(now) {
			delete(r.resources, key)
		}
	}
	for key, upload := range r.uploads {
		if !upload.expiresAt.After(now) {
			delete(r.uploads, key)
		}
	}
}

func deliveryContent(req *model.DeliveryRequest) (string, string, error) {
	switch req.GetKind() {
	case model.DeliveryKind_DELIVERY_KIND_CARD:
		if !json.Valid([]byte(req.GetContentJson())) {
			return "", "", errors.New("card content_json is invalid")
		}
		return "interactive", req.GetContentJson(), nil
	case model.DeliveryKind_DELIVERY_KIND_POST:
		if !json.Valid([]byte(req.GetContentJson())) {
			return "", "", errors.New("post content_json is invalid")
		}
		return "post", req.GetContentJson(), nil
	case model.DeliveryKind_DELIVERY_KIND_IMAGE:
		if req.GetResource() == nil || req.GetResource().GetProviderKey() == "" {
			return "", "", errors.New("image resource key is required")
		}
		content, _ := json.Marshal(map[string]string{
			"image_key": req.GetResource().GetProviderKey(),
		})
		return "image", string(content), nil
	case model.DeliveryKind_DELIVERY_KIND_FILE:
		if req.GetResource() == nil || req.GetResource().GetProviderKey() == "" {
			return "", "", errors.New("file resource key is required")
		}
		content, _ := json.Marshal(map[string]string{
			"file_key": req.GetResource().GetProviderKey(),
		})
		return "file", string(content), nil
	default:
		content, _ := json.Marshal(map[string]string{"text": req.GetText()})
		return "text", string(content), nil
	}
}

func resourceMIME(kind, fileName string) string {
	switch kind {
	case "image":
		return "image/png"
	case "audio":
		return "audio/ogg"
	case "video":
		return "video/mp4"
	default:
		return mimeFromName(fileName)
	}
}

func firstNonEmptyLocal(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

// truncateUUID keeps the platform idempotency token within its length limit.
func truncateUUID(key string) string {
	key = strings.TrimSpace(key)
	if len(key) > 50 {
		return key[:50]
	}
	if key == "" {
		// SDK requires a non-empty value; delivery_id must always be set by
		// the host, but fail safe with a zero token omitted instead.
		return "no-idempotency-key"
	}
	return key
}

// apiErrorCategory maps a non-success OpenAPI code to retry/permanent/auth.
func apiErrorCategory(code int) string {
	switch {
	case code == 99991663 || code == 99991661 || code == 99991668:
		return "unauthorized"
	case code >= 500 && code < 600 || code == 429:
		return "retryable"
	default:
		return "permanent"
	}
}
