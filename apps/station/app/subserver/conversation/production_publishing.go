package conversation

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	botregistry "github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	publishingapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/publishing"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const publishingRoutePrefix = "/message-ingress/"

type productionPublishingActorMinter struct{}

func (productionPublishingActorMinter) MintServiceActor(
	ctx context.Context,
	handle string,
	displayName string,
	namespace string,
) (valueobject.PTID, error) {
	ptID, err := touchactor.MintInternalProgramActor(
		ctx,
		handle,
		displayName,
		namespace,
		identity.TypeService,
	)
	return valueobject.PTID(ptID), err
}

func (s *subServer) handleCreatePublishingGrant(
	ctx context.Context,
	request *chat.CreateMessagePublishingGrantRequest,
) (*chat.CreateMessagePublishingGrantResponse, error) {
	owner, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("publishing grant request is required")
	}
	var expiresAt *time.Time
	if request.ExpiresAt != nil {
		if err := request.ExpiresAt.CheckValid(); err != nil {
			return nil, server.BadRequest("publishing grant expiration is invalid")
		}
		value := request.ExpiresAt.AsTime().UTC()
		expiresAt = &value
	}
	created, err := s.composition.PublishingManagement.Create(
		ctx,
		owner,
		request.Name,
		expiresAt,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chat.CreateMessagePublishingGrantResponse{
		Grant:  productionPublishingGrant(created.Grant),
		Secret: created.Secret,
	}, nil
}

func (s *subServer) handleListPublishingGrants(
	ctx context.Context,
	_ *chat.ListMessagePublishingGrantsRequest,
) (*chat.ListMessagePublishingGrantsResponse, error) {
	owner, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	grants, err := s.composition.PublishingManagement.List(ctx, owner)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	result := make([]*chat.MessagePublishingGrant, 0, len(grants))
	for _, grant := range grants {
		result = append(result, productionPublishingGrant(grant))
	}
	return &chat.ListMessagePublishingGrantsResponse{Grants: result}, nil
}

func (s *subServer) handleRotatePublishingSecret(
	ctx context.Context,
	request *chat.RotateMessagePublishingSecretRequest,
) (*chat.RotateMessagePublishingSecretResponse, error) {
	owner, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("publishing rotation request is required")
	}
	rotated, err := s.composition.PublishingManagement.Rotate(
		ctx,
		owner,
		request.PublishingId,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chat.RotateMessagePublishingSecretResponse{
		Grant:  productionPublishingGrant(rotated.Grant),
		Secret: rotated.Secret,
	}, nil
}

func (s *subServer) handleRevokePublishingGrant(
	ctx context.Context,
	request *chat.RevokeMessagePublishingGrantRequest,
) (*chat.RevokeMessagePublishingGrantResponse, error) {
	owner, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("publishing revocation request is required")
	}
	grant, err := s.composition.PublishingManagement.Revoke(
		ctx,
		owner,
		request.PublishingId,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chat.RevokeMessagePublishingGrantResponse{
		Grant: productionPublishingGrant(grant),
	}, nil
}

func (s *subServer) handlePublishMessage(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	publishingID, ok := publishingIDFromPath(request.Path())
	if !ok {
		return writePublishingError(response, http.StatusUnauthorized, "unauthorized")
	}
	secret := publishingBearerSecret(request.Header())
	if secret == "" {
		return writePublishingError(response, http.StatusUnauthorized, "unauthorized")
	}
	body, err := readBoundedPublishingBody(request)
	if err != nil {
		return writePublishingError(response, http.StatusRequestEntityTooLarge, "request body exceeds the limit")
	}
	var input chat.PublishMessageRequest
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(body, &input); err != nil {
		return writePublishingError(response, http.StatusBadRequest, "invalid message publication")
	}
	result, err := s.composition.PublishingService.Publish(
		ctx,
		publishingID,
		secret,
		publishingHeader(request.Header(), "Idempotency-Key"),
		&input,
	)
	if err != nil {
		return writePublishingDomainError(ctx, response, err)
	}
	if result.NotificationWake != nil && s.composition.realtime != nil {
		if err := s.composition.realtime.PublishServiceNotification(ctx, *result.NotificationWake); err != nil {
			logger.Errorf(ctx, "[message-publishing] post-commit notification wake failed: %v", err)
		}
	}
	return writePublishingProto(response, result.Response)
}

func productionPublishingGrant(grant entity.PublishingGrant) *chat.MessagePublishingGrant {
	targets := make([]string, 0, len(grant.AllowedTargets))
	for _, target := range grant.AllowedTargets {
		targets = append(targets, string(target))
	}
	result := &chat.MessagePublishingGrant{
		PublishingId:       grant.ID,
		OwnerPtid:          string(grant.Owner),
		SenderPtid:         string(grant.Sender),
		Name:               grant.Name,
		SourceNamespace:    grant.SourceNamespace,
		DefaultTarget:      string(grant.DefaultTarget),
		AllowedTargets:     targets,
		SecretHint:         grant.SecretHint,
		Revoked:            grant.Revoked,
		CreatedAt:          timestamppb.New(grant.CreatedAt),
		RateLimitPerMinute: grant.RatePerMinute,
	}
	if grant.ExpiresAt != nil {
		result.ExpiresAt = timestamppb.New(*grant.ExpiresAt)
	}
	return result
}

func publishingIDFromPath(path string) (string, bool) {
	if index := strings.IndexByte(path, '?'); index >= 0 {
		path = path[:index]
	}
	if !strings.HasPrefix(path, publishingRoutePrefix) {
		return "", false
	}
	id := strings.TrimPrefix(path, publishingRoutePrefix)
	return id, id != "" && len(id) <= 128 && !strings.Contains(id, "/")
}

func publishingBearerSecret(headers map[string]string) string {
	value := publishingHeader(headers, "Authorization")
	const prefix = "Bearer "
	if len(value) < len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(value[len(prefix):])
}

func publishingHeader(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func readBoundedPublishingBody(request server.Request) ([]byte, error) {
	var reader io.Reader
	if streaming, ok := request.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	} else {
		reader = bytes.NewReader(request.Body())
	}
	body, err := io.ReadAll(io.LimitReader(reader, 64*1024+1))
	if err != nil {
		return nil, err
	}
	if len(body) > 64*1024 {
		return nil, io.ErrShortBuffer
	}
	return body, nil
}

func writePublishingDomainError(
	ctx context.Context,
	response server.Response,
	err error,
) error {
	switch conversationdomain.CodeOf(err) {
	case conversationdomain.ErrorCodeInvalidArgument:
		return writePublishingError(response, http.StatusBadRequest, "invalid message publication")
	case conversationdomain.ErrorCodeUnauthorized:
		return writePublishingError(response, http.StatusUnauthorized, "unauthorized")
	case conversationdomain.ErrorCodeNotFound:
		return writePublishingError(response, http.StatusNotFound, "publishing resource not found")
	case conversationdomain.ErrorCodeCommandConflict:
		return writePublishingError(response, http.StatusConflict, "publication conflicts with committed state")
	case conversationdomain.ErrorCodeRateLimited:
		response.SetHeader("Retry-After", "60")
		return writePublishingError(response, http.StatusTooManyRequests, "rate limit exceeded")
	default:
		logger.Errorf(ctx, "[message-publishing] publication failed: %v", err)
		return writePublishingError(response, http.StatusInternalServerError, "message publication failed")
	}
}

func writePublishingError(response server.Response, status int, message string) error {
	response.SetHeader("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(status)
	_, _ = response.Write([]byte(message))
	return nil
}

func writePublishingProto(response server.Response, message proto.Message) error {
	body, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(message)
	if err != nil {
		return err
	}
	response.SetHeader("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_, err = response.Write(body)
	return err
}

var _ publishingapp.ActorMinter = productionPublishingActorMinter{}

func (s *subServer) CreateForBot(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	name string,
) (botregistry.PublishingCreated, error) {
	created, err := s.composition.PublishingManagement.CreateForSender(
		ctx,
		valueobject.PTID(ownerPtid),
		valueobject.PTID(botPtid),
		name,
		"bot."+botPtid,
		nil,
	)
	if err != nil {
		return botregistry.PublishingCreated{}, err
	}
	return botregistry.PublishingCreated{
		Grant:  botPublishingGrant(created.Grant),
		Secret: created.Secret,
	}, nil
}

func (s *subServer) Get(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (botregistry.PublishingGrant, error) {
	grant, err := s.composition.PublishingManagement.GetOwned(
		ctx,
		valueobject.PTID(ownerPtid),
		publishingID,
	)
	return botPublishingGrant(grant), err
}

func (s *subServer) Rotate(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (botregistry.PublishingCreated, error) {
	created, err := s.composition.PublishingManagement.Rotate(
		ctx,
		valueobject.PTID(ownerPtid),
		publishingID,
	)
	if err != nil {
		return botregistry.PublishingCreated{}, err
	}
	return botregistry.PublishingCreated{
		Grant:  botPublishingGrant(created.Grant),
		Secret: created.Secret,
	}, nil
}

func (s *subServer) SetDisabled(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
	disabled bool,
) (botregistry.PublishingGrant, error) {
	grant, err := s.composition.PublishingManagement.SetDisabled(
		ctx,
		valueobject.PTID(ownerPtid),
		publishingID,
		disabled,
	)
	return botPublishingGrant(grant), err
}

func (s *subServer) Revoke(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (botregistry.PublishingGrant, error) {
	grant, err := s.composition.PublishingManagement.Revoke(
		ctx,
		valueobject.PTID(ownerPtid),
		publishingID,
	)
	return botPublishingGrant(grant), err
}

func botPublishingGrant(grant entity.PublishingGrant) botregistry.PublishingGrant {
	targets := make([]string, 0, len(grant.AllowedTargets))
	for _, target := range grant.AllowedTargets {
		targets = append(targets, string(target))
	}
	return botregistry.PublishingGrant{
		ID:                 grant.ID,
		OwnerPtid:          string(grant.Owner),
		SenderPtid:         string(grant.Sender),
		Name:               grant.Name,
		SourceNamespace:    grant.SourceNamespace,
		DefaultTarget:      string(grant.DefaultTarget),
		AllowedTargets:     targets,
		SecretHint:         grant.SecretHint,
		Disabled:           grant.Disabled,
		Revoked:            grant.Revoked,
		CreatedAt:          grant.CreatedAt,
		ExpiresAt:          grant.ExpiresAt,
		RateLimitPerMinute: grant.RatePerMinute,
	}
}

var _ botregistry.PublishingManager = (*subServer)(nil)
