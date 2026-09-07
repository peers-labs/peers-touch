package conversation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

const (
	productionAttachmentMetadataHeader = "X-Peers-Attachment-Metadata-Bin"
	productionAttachmentGeneration     = "X-Peers-Attachment-Generation"
	productionConversationHeader       = "X-Peers-Conversation-ID"
	productionAuthorityStationHeader   = "X-Peers-Authority-Station-ID"
	productionAttachmentActionBegin    = "begin"
	productionAttachmentActionStatus   = "status"
	productionAttachmentActionChunk    = "chunk"
	productionAttachmentActionComplete = "complete"
	productionAttachmentActionCancel   = "cancel"
	productionAttachmentActionObject   = "object"
	productionAttachmentResponseLimit  = 4 << 20
)

func (s *subServer) handleSubmitLeaveIntent(
	ctx context.Context,
	request *chatmodel.SubmitMlsLeaveIntentRequest,
) (*chatmodel.SubmitMlsLeaveIntentResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetIntent() == nil {
		return nil, server.BadRequest("MLS leave intent is required")
	}
	intent := request.GetIntent()
	if intent.GetActorPtid() != authenticated.PTID ||
		intent.GetActorDeviceId() != authenticated.DeviceID ||
		intent.GetHomeStationPeerId() != string(s.localStation) {
		return nil, server.Forbidden(
			"MLS leave intent does not match the authenticated Home Station endpoint",
		)
	}
	if intent.GetAuthorityStationPeerId() != string(s.localStation) {
		runtime, resolveErr := s.composition.FederationRuntime()
		if resolveErr != nil {
			return nil, mapProductionConversationError(ctx, resolveErr)
		}
		response := &chatmodel.SubmitFederatedMlsLeaveIntentResponse{}
		callErr := runtime.CallPeer(ctx, federationruntime.PeerCall{
			TargetStationPeerID: intent.GetAuthorityStationPeerId(),
			Route: federationruntime.
				PeerRouteConversationLeaveIntentSubmit,
			Subject: authenticated.PTID,
			Claims: map[string]string{
				federationruntime.ClaimFederationID:   intent.GetFederationId(),
				federationruntime.ClaimConversationID: intent.GetConversationId(),
				federationruntime.ClaimIntentID:       intent.GetIntentId(),
				federationruntime.ClaimDeviceID:       authenticated.DeviceID,
				federationruntime.ClaimAuthorityEpoch: strconv.FormatInt(
					intent.GetAuthorityEpoch(),
					10,
				),
			},
			Request: &chatmodel.SubmitFederatedMlsLeaveIntentRequest{
				Intent:                  proto.Clone(intent).(*chatmodel.MlsLeaveIntent),
				SourceHomeStationPeerId: string(s.localStation),
			},
			Response: response,
		})
		if callErr != nil {
			return nil, mapProductionConversationError(ctx, callErr)
		}
		if response.GetIntent() == nil ||
			!proto.Equal(response.GetIntent(), intent) {
			return nil, mapProductionConversationError(
				ctx,
				conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"production_federation.submit_leave_intent",
					"response",
					"does not match the submitted leave intent",
				),
			)
		}

		return &chatmodel.SubmitMlsLeaveIntentResponse{
			Intent: response.GetIntent(),
		}, nil
	}
	accepted, err := s.composition.submitLocalLeaveIntent(ctx, intent)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.SubmitMlsLeaveIntentResponse{
		Intent: productionLeaveIntent(accepted),
	}, nil
}

func (s *subServer) handleListLeaveIntents(
	ctx context.Context,
	request *chatmodel.ListPendingMlsLeaveIntentsRequest,
) (*chatmodel.ListPendingMlsLeaveIntentsResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	view, err := s.authenticatedConversationView(ctx, request.GetConversationId())
	if err != nil {
		return nil, err
	}
	if view.Conversation.AuthorityStation != s.localStation {
		runtime, resolveErr := s.composition.FederationRuntime()
		if resolveErr != nil {
			return nil, mapProductionConversationError(ctx, resolveErr)
		}
		response := &chatmodel.ListFederatedMlsLeaveIntentsResponse{}
		callErr := runtime.CallPeer(ctx, federationruntime.PeerCall{
			TargetStationPeerID: string(
				view.Conversation.AuthorityStation,
			),
			Route: federationruntime.
				PeerRouteConversationLeaveIntentList,
			Subject: authenticated.PTID,
			Claims: map[string]string{
				federationruntime.ClaimFederationID: string(
					view.Conversation.FederationID,
				),
				federationruntime.ClaimConversationID: request.GetConversationId(),
				federationruntime.ClaimAuthorityEpoch: strconv.FormatInt(
					int64(view.Conversation.AuthorityEpoch),
					10,
				),
			},
			Request: &chatmodel.ListFederatedMlsLeaveIntentsRequest{
				ConversationId:          request.GetConversationId(),
				SourceHomeStationPeerId: string(s.localStation),
			},
			Response: response,
		})
		if callErr != nil {
			return nil, mapProductionConversationError(ctx, callErr)
		}

		return &chatmodel.ListPendingMlsLeaveIntentsResponse{
			Intents: response.GetIntents(),
		}, nil
	}
	intents, err := s.composition.listLocalLeaveIntents(
		ctx,
		valueobject.ConversationID(request.GetConversationId()),
		valueobject.PTID(authenticated.PTID),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.ListPendingMlsLeaveIntentsResponse{
		Intents: productionLeaveIntents(intents),
	}, nil
}

func (c *ProductionComposition) submitFederatedLeaveIntent(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.SubmitFederatedMlsLeaveIntentRequest,
) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error) {
	if request == nil || request.GetIntent() == nil {
		return nil, fmt.Errorf("submit federated MLS leave intent: intent is required")
	}
	accepted, err := c.submitLocalLeaveIntent(ctx, request.GetIntent())
	if err != nil {
		return nil, err
	}
	if accepted.HomeStation != valueobject.StationID(sourceHomeStationPeerID) {
		return nil, fmt.Errorf(
			"submit federated MLS leave intent: authenticated source does not match accepted intent",
		)
	}

	return &chatmodel.SubmitFederatedMlsLeaveIntentResponse{
		Intent: productionLeaveIntent(accepted),
	}, nil
}

func (c *ProductionComposition) listFederatedLeaveIntents(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.ListFederatedMlsLeaveIntentsRequest,
) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil || claims.Issuer != sourceHomeStationPeerID ||
		strings.TrimSpace(claims.Subject) == "" {
		return nil, fmt.Errorf(
			"list federated MLS leave intents: authenticated actor claim is required",
		)
	}
	err := c.UnitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, loadErr := transaction.Repositories.Authority.Get(
			ctx,
			valueobject.ConversationID(request.GetConversationId()),
		)
		if loadErr != nil {
			return loadErr
		}
		if snapshot.AuthorityStation != c.localStation ||
			claims.Custom[federationruntime.ClaimFederationID] !=
				string(snapshot.FederationID) ||
			claims.Custom[federationruntime.ClaimConversationID] !=
				string(snapshot.ID) ||
			claims.Custom[federationruntime.ClaimAuthorityEpoch] !=
				strconv.FormatInt(int64(snapshot.AuthorityEpoch), 10) {
			return fmt.Errorf(
				"list federated MLS leave intents: authenticated authority scope mismatch",
			)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	intents, err := c.listLocalLeaveIntents(
		ctx,
		valueobject.ConversationID(request.GetConversationId()),
		valueobject.PTID(claims.Subject),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.ListFederatedMlsLeaveIntentsResponse{
		Intents: productionLeaveIntents(intents),
	}, nil
}

func (c *ProductionComposition) submitLocalLeaveIntent(
	ctx context.Context,
	intent *chatmodel.MlsLeaveIntent,
) (repository.LeaveIntent, error) {
	if intent == nil {
		return repository.LeaveIntent{}, fmt.Errorf(
			"submit MLS leave intent: intent is required",
		)
	}

	return c.CommandService.SubmitLeaveIntent(ctx, command.LeaveIntentRequest{
		Version:        intent.GetVersion(),
		ID:             intent.GetIntentId(),
		FederationID:   valueobject.FederationID(intent.GetFederationId()),
		ConversationID: valueobject.ConversationID(intent.GetConversationId()),
		Actor: valueobject.Endpoint{
			Actor:  valueobject.PTID(intent.GetActorPtid()),
			Device: valueobject.DeviceID(intent.GetActorDeviceId()),
		},
		SigningKeyID:     intent.GetActorSigningKeyId(),
		HomeStation:      valueobject.StationID(intent.GetHomeStationPeerId()),
		AuthorityStation: valueobject.StationID(intent.GetAuthorityStationPeerId()),
		AuthorityEpoch:   valueobject.AuthorityEpoch(intent.GetAuthorityEpoch()),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        valueobject.Sequence(intent.GetAuthoritySequence()),
			EventHash:       productionMustHash(intent.GetAuthorityHash()),
			MembershipEpoch: valueobject.Epoch(intent.GetObservedMembershipEpoch()),
			MLSEpoch:        valueobject.Epoch(intent.GetObservedMlsEpoch()),
		},
		Signature: append([]byte(nil), intent.GetActorSignature()...),
		CreatedAt: timeFromUnixMillis(intent.GetCreatedAtUnixMs()),
		ExpiresAt: timeFromUnixMillis(intent.GetExpiresAtUnixMs()),
	})
}

func (c *ProductionComposition) listLocalLeaveIntents(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) ([]repository.LeaveIntent, error) {
	var intents []repository.LeaveIntent
	err := c.UnitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		var listErr error
		intents, listErr = transaction.Repositories.LeaveIntents.ListPending(
			ctx,
			conversationID,
			actor,
			128,
		)

		return listErr
	})

	return intents, err
}

func (c *ProductionComposition) syncFederatedAuthorityEvents(
	ctx context.Context,
	sourceFollowerStationPeerID string,
	request *chatmodel.SyncAuthorityConversationEventsRequest,
) (*chatmodel.SyncAuthorityConversationEventsResponse, error) {
	var records []domainevent.Record
	err := c.UnitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		active, err := transaction.Federation.IsActiveStation(
			ctx,
			valueobject.FederationID(request.GetFederationId()),
			valueobject.StationID(sourceFollowerStationPeerID),
		)
		if err != nil {
			return err
		}
		if !active {
			return fmt.Errorf("follower Station is not active in the Federation")
		}
		snapshot, err := transaction.Repositories.Authority.Get(
			ctx,
			valueobject.ConversationID(request.GetConversationId()),
		)
		if err != nil {
			return err
		}
		if snapshot.FederationID != valueobject.FederationID(request.GetFederationId()) ||
			snapshot.AuthorityStation != c.localStation ||
			snapshot.AuthorityEpoch != valueobject.AuthorityEpoch(request.GetAuthorityEpoch()) {
			return fmt.Errorf("Conversation authority scope does not match the peer request")
		}
		limit := normalizedConversationLimit(int(request.GetLimit()))
		records, err = transaction.Repositories.Events.List(
			ctx,
			snapshot.ID,
			valueobject.Sequence(request.GetAfterGroupSeq()),
			limit,
		)

		return err
	})
	if err != nil {
		return nil, err
	}
	events, err := productionEvents(records)
	if err != nil {
		return nil, err
	}

	return &chatmodel.SyncAuthorityConversationEventsResponse{Events: events}, nil
}

func (c *ProductionComposition) beginFederatedAttachmentUpload(
	ctx context.Context,
	_ string,
	request *chatmodel.BeginFederatedConversationAttachmentUploadRequest,
) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := c.AttachmentHandler.Begin(
		ctx,
		authenticated,
		request.GetRequest(),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.BeginFederatedConversationAttachmentUploadResponse{
		Response: response,
	}, nil
}

func (c *ProductionComposition) getFederatedAttachmentUpload(
	ctx context.Context,
	_ string,
	request *chatmodel.GetFederatedConversationAttachmentUploadRequest,
) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := c.AttachmentHandler.Status(
		ctx,
		authenticated,
		request.GetRequest(),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.GetFederatedConversationAttachmentUploadResponse{
		Response: response,
	}, nil
}

func (c *ProductionComposition) putFederatedAttachmentChunk(
	ctx context.Context,
	_ string,
	request *chatmodel.PutFederatedConversationAttachmentChunkRequest,
	body io.Reader,
) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, err
	}
	chunk, err := io.ReadAll(io.LimitReader(body, int64(attachmentChunkBodyLimit())))
	if err != nil {
		return nil, err
	}
	response, err := c.AttachmentHandler.PutChunk(
		ctx,
		authenticated,
		request.GetRequest(),
		chunk,
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.PutFederatedConversationAttachmentChunkResponse{
		Response: response,
	}, nil
}

func (c *ProductionComposition) completeFederatedAttachmentUpload(
	ctx context.Context,
	_ string,
	request *chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := c.AttachmentHandler.Complete(
		ctx,
		authenticated,
		request.GetRequest(),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.CompleteFederatedConversationAttachmentUploadResponse{
		Response: response,
	}, nil
}

func (c *ProductionComposition) cancelFederatedAttachmentUpload(
	ctx context.Context,
	_ string,
	request *chatmodel.CancelFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := c.AttachmentHandler.Cancel(
		ctx,
		authenticated,
		request.GetRequest(),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.CancelFederatedConversationAttachmentUploadResponse{
		Response: response,
	}, nil
}

func (c *ProductionComposition) getFederatedAttachmentObject(
	ctx context.Context,
	_ string,
	request *chatmodel.GetFederatedConversationAttachmentObjectRequest,
	startInclusive int64,
	endInclusive int64,
) (
	*chatmodel.GetFederatedConversationAttachmentObjectResponse,
	io.ReadCloser,
	error,
) {
	authenticated, err := productionFederatedAttachmentActor(ctx)
	if err != nil {
		return nil, nil, err
	}
	result, err := c.AttachmentHandler.Download(
		ctx,
		authenticated,
		request.GetRequest(),
		startInclusive,
		endInclusive,
	)
	if err != nil {
		return nil, nil, err
	}

	return &chatmodel.GetFederatedConversationAttachmentObjectResponse{
		Response: result.Metadata,
	}, result.Body, nil
}

func productionFederatedAttachmentActor(
	ctx context.Context,
) (conversationhttp.AuthenticatedActor, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		strings.TrimSpace(claims.Custom["actor_ptid"]) == "" ||
		strings.TrimSpace(claims.Custom["device_id"]) == "" {
		return conversationhttp.AuthenticatedActor{},
			fmt.Errorf("federated attachment actor/device claims are required")
	}

	return conversationhttp.AuthenticatedActor{
		PTID:     claims.Custom["actor_ptid"],
		DeviceID: claims.Custom["device_id"],
	}, nil
}

func (s *subServer) handleBeginAttachmentUpload(
	ctx context.Context,
	request *chatmodel.BeginAttachmentUploadRequest,
) (*chatmodel.BeginAttachmentUploadResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("attachment upload metadata is required")
	}
	if request.GetAuthorityStationId() != string(s.localStation) {
		result, forwardErr := s.forwardBeginAttachmentUpload(
			ctx,
			authenticated,
			request,
		)
		return result, mapProductionConversationError(ctx, forwardErr)
	}
	response, err := s.composition.AttachmentHandler.Begin(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleAttachmentUploadStatus(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return err
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/conversation/attachments/uploads/",
		"",
	)
	if err != nil {
		return err
	}
	generation, err := productionPositiveUintHeader(
		request,
		productionAttachmentGeneration,
	)
	if err != nil {
		return err
	}
	authority := productionRequestHeader(request, productionAuthorityStationHeader)
	input := &chatmodel.GetAttachmentUploadRequest{
		UploadId:           uploadID,
		Generation:         generation,
		AuthorityStationId: authority,
		ConversationId: productionRequestHeader(
			request,
			productionConversationHeader,
		),
	}
	if authority != string(s.localStation) {
		result, forwardErr := s.forwardAttachmentUploadStatus(
			ctx,
			authenticated,
			input,
		)
		if forwardErr != nil {
			return mapProductionConversationError(ctx, forwardErr)
		}

		return productionWriteProto(response, http.StatusOK, result)
	}
	result, err := s.composition.AttachmentHandler.Status(
		ctx,
		authenticated,
		input,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWriteProto(response, http.StatusOK, result)
}

func (s *subServer) handleAttachmentChunk(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return err
	}
	uploadID, chunkIndex, err := productionAttachmentChunkPath(request.Path())
	if err != nil {
		return err
	}
	metadata := &chatmodel.PutAttachmentChunkRequest{}
	if err := productionDecodeMetadataHeader(request, metadata); err != nil {
		return err
	}
	if metadata.GetUploadId() != uploadID ||
		metadata.GetChunkIndex() != chunkIndex {
		return server.BadRequest(
			"attachment chunk path does not match canonical metadata",
		)
	}
	if metadata.GetAuthorityStationId() != string(s.localStation) {
		result, forwardErr := s.forwardAttachmentChunk(
			ctx,
			authenticated,
			metadata,
			request.Body(),
		)
		if forwardErr != nil {
			return mapProductionConversationError(ctx, forwardErr)
		}

		return productionWriteProto(response, http.StatusOK, result)
	}
	result, err := s.composition.AttachmentHandler.PutChunk(
		ctx,
		authenticated,
		metadata,
		request.Body(),
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWriteProto(response, http.StatusOK, result)
}

func (s *subServer) handleCompleteAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.CompleteAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil {
		return server.BadRequest("attachment completion metadata is invalid")
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/conversation/attachments/uploads/",
		"/complete",
	)
	if err != nil || input.GetUploadId() != uploadID {
		return server.BadRequest(
			"attachment completion path does not match canonical metadata",
		)
	}
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return err
	}
	if input.GetAuthorityStationId() != string(s.localStation) {
		result, forwardErr := s.forwardCompleteAttachmentUpload(
			ctx,
			authenticated,
			input,
		)
		if forwardErr != nil {
			return mapProductionConversationError(ctx, forwardErr)
		}

		return productionWriteProto(response, http.StatusOK, result)
	}
	result, err := s.composition.AttachmentHandler.Complete(
		ctx,
		authenticated,
		input,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWriteProto(response, http.StatusOK, result)
}

func (s *subServer) handleCancelAttachmentUpload(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.CancelAttachmentUploadRequest{}
	if err := proto.Unmarshal(request.Body(), input); err != nil {
		return server.BadRequest("attachment cancellation metadata is invalid")
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/conversation/attachments/uploads/",
		"/cancel",
	)
	if err != nil || input.GetUploadId() != uploadID {
		return server.BadRequest(
			"attachment cancellation path does not match canonical metadata",
		)
	}
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return err
	}
	if input.GetAuthorityStationId() != string(s.localStation) {
		result, forwardErr := s.forwardCancelAttachmentUpload(
			ctx,
			authenticated,
			input,
		)
		if forwardErr != nil {
			return mapProductionConversationError(ctx, forwardErr)
		}

		return productionWriteProto(response, http.StatusOK, result)
	}
	result, err := s.composition.AttachmentHandler.Cancel(
		ctx,
		authenticated,
		input,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWriteProto(response, http.StatusOK, result)
}

func (s *subServer) handleAttachmentObject(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return err
	}
	objectID, err := productionPathValue(
		request.Path(),
		"/conversation/attachments/objects/",
		"",
	)
	if err != nil {
		return err
	}
	authority := productionRequestHeader(request, productionAuthorityStationHeader)
	etag, err := productionAttachmentETag(
		productionRequestHeader(request, "If-Match"),
	)
	if err != nil {
		return err
	}
	start, end, partial, err := productionAttachmentRange(
		productionRequestHeader(request, "Range"),
	)
	if err != nil {
		return err
	}
	input := &chatmodel.GetAttachmentObjectRequest{
		ConversationId: productionRequestHeader(
			request,
			productionConversationHeader,
		),
		ObjectId:           objectID,
		ExpectedEtagSha256: etag,
		AuthorityStationId: authority,
	}
	if authority != string(s.localStation) {
		return s.forwardAttachmentObject(
			ctx,
			authenticated,
			input,
			productionRequestHeader(request, "Range"),
			response,
		)
	}
	result, err := s.composition.AttachmentHandler.Download(
		ctx,
		authenticated,
		input,
		start,
		end,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	defer result.Body.Close()
	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader(
		"ETag",
		`"`+hex.EncodeToString(result.Metadata.GetEtagSha256())+`"`,
	)
	response.SetHeader(
		"Content-Length",
		strconv.FormatInt(result.End-result.Start+1, 10),
	)
	if partial {
		response.SetHeader(
			"Content-Range",
			fmt.Sprintf(
				"bytes %d-%d/%d",
				result.Start,
				result.End,
				result.Metadata.GetTotalCiphertextSize(),
			),
		)
		response.WriteHeader(http.StatusPartialContent)
	} else {
		response.WriteHeader(http.StatusOK)
	}
	_, err = io.Copy(productionResponseWriter{response: response}, result.Body)

	return err
}

func (s *subServer) forwardBeginAttachmentUpload(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.BeginAttachmentUploadRequest,
) (*chatmodel.BeginAttachmentUploadResponse, error) {
	response := &chatmodel.BeginFederatedConversationAttachmentUploadResponse{}
	err := s.callAttachmentPeerProto(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionBegin,
		request.GetAttachmentId(),
		federationruntime.PeerRouteConversationAttachmentBegin,
		nil,
		&chatmodel.BeginFederatedConversationAttachmentUploadRequest{
			Request: proto.Clone(request).(*chatmodel.BeginAttachmentUploadRequest),
			SourceHomeStationPeerId: string(
				s.localStation,
			),
		},
		response,
	)
	if err != nil {
		return nil, err
	}
	result := response.GetResponse()
	if result == nil ||
		result.GetUploadId() == "" ||
		result.GetAuthorityStationId() != request.GetAuthorityStationId() {
		return nil, fmt.Errorf(
			"remote attachment begin response does not match the authority request",
		)
	}

	return result, nil
}

func (s *subServer) forwardAttachmentUploadStatus(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.GetAttachmentUploadRequest,
) (*chatmodel.GetAttachmentUploadResponse, error) {
	wireRequest := &chatmodel.GetFederatedConversationAttachmentUploadRequest{
		Request: proto.Clone(request).(*chatmodel.GetAttachmentUploadRequest),
		SourceHomeStationPeerId: string(
			s.localStation,
		),
	}
	metadata, err := productionEncodeAttachmentMetadata(wireRequest)
	if err != nil {
		return nil, err
	}
	response, err := s.openAttachmentPeer(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionStatus,
		request.GetUploadId(),
		federationruntime.PeerRouteConversationAttachmentStatus,
		map[string]string{"upload_id": request.GetUploadId()},
		map[string]string{
			"Accept":                           "application/protobuf",
			productionAttachmentMetadataHeader: metadata,
		},
		nil,
	)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	wireResponse := &chatmodel.GetFederatedConversationAttachmentUploadResponse{}
	if err := productionDecodeAttachmentPeerResponse(
		response,
		wireResponse,
	); err != nil {
		return nil, err
	}
	result := wireResponse.GetResponse()
	if result == nil ||
		result.GetUploadId() != request.GetUploadId() ||
		result.GetGeneration() != request.GetGeneration() {
		return nil, fmt.Errorf(
			"remote attachment status response does not match the request",
		)
	}

	return result, nil
}

func (s *subServer) forwardAttachmentChunk(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.PutAttachmentChunkRequest,
	ciphertext []byte,
) (*chatmodel.PutAttachmentChunkResponse, error) {
	wireRequest := &chatmodel.PutFederatedConversationAttachmentChunkRequest{
		Request: proto.Clone(request).(*chatmodel.PutAttachmentChunkRequest),
		SourceHomeStationPeerId: string(
			s.localStation,
		),
	}
	metadata, err := productionEncodeAttachmentMetadata(wireRequest)
	if err != nil {
		return nil, err
	}
	resourceID := productionAttachmentChunkResourceID(
		request.GetUploadId(),
		request.GetChunkIndex(),
	)
	response, err := s.openAttachmentPeer(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionChunk,
		resourceID,
		federationruntime.PeerRouteConversationAttachmentChunk,
		map[string]string{
			"upload_id": request.GetUploadId(),
			"chunk_index": strconv.FormatUint(
				uint64(request.GetChunkIndex()),
				10,
			),
		},
		map[string]string{
			"Accept":                           "application/protobuf",
			"Content-Type":                     "application/octet-stream",
			productionAttachmentMetadataHeader: metadata,
		},
		bytes.NewReader(ciphertext),
	)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	wireResponse := &chatmodel.PutFederatedConversationAttachmentChunkResponse{}
	if err := productionDecodeAttachmentPeerResponse(
		response,
		wireResponse,
	); err != nil {
		return nil, err
	}
	result := wireResponse.GetResponse()
	if result == nil || result.GetChunkIndex() != request.GetChunkIndex() {
		return nil, fmt.Errorf(
			"remote attachment chunk response does not match the request",
		)
	}

	return result, nil
}

func (s *subServer) forwardCompleteAttachmentUpload(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.CompleteAttachmentUploadRequest,
) (*chatmodel.CompleteAttachmentUploadResponse, error) {
	response := &chatmodel.CompleteFederatedConversationAttachmentUploadResponse{}
	err := s.callAttachmentPeerProto(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionComplete,
		request.GetUploadId(),
		federationruntime.PeerRouteConversationAttachmentComplete,
		map[string]string{"upload_id": request.GetUploadId()},
		&chatmodel.CompleteFederatedConversationAttachmentUploadRequest{
			Request: proto.Clone(request).(*chatmodel.CompleteAttachmentUploadRequest),
			SourceHomeStationPeerId: string(
				s.localStation,
			),
		},
		response,
	)
	if err != nil {
		return nil, err
	}
	result := response.GetResponse()
	if result == nil || result.GetObject() == nil {
		return nil, fmt.Errorf(
			"remote attachment completion response is incomplete",
		)
	}

	return result, nil
}

func (s *subServer) forwardCancelAttachmentUpload(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.CancelAttachmentUploadRequest,
) (*chatmodel.CancelAttachmentUploadResponse, error) {
	response := &chatmodel.CancelFederatedConversationAttachmentUploadResponse{}
	err := s.callAttachmentPeerProto(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionCancel,
		request.GetUploadId(),
		federationruntime.PeerRouteConversationAttachmentCancel,
		map[string]string{"upload_id": request.GetUploadId()},
		&chatmodel.CancelFederatedConversationAttachmentUploadRequest{
			Request: proto.Clone(request).(*chatmodel.CancelAttachmentUploadRequest),
			SourceHomeStationPeerId: string(
				s.localStation,
			),
		},
		response,
	)
	if err != nil {
		return nil, err
	}
	result := response.GetResponse()
	if result == nil ||
		result.GetState() ==
			chatmodel.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_UNSPECIFIED {
		return nil, fmt.Errorf(
			"remote attachment cancellation response is incomplete",
		)
	}

	return result, nil
}

func (s *subServer) forwardAttachmentObject(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	request *chatmodel.GetAttachmentObjectRequest,
	rangeHeader string,
	response server.Response,
) error {
	wireRequest := &chatmodel.GetFederatedConversationAttachmentObjectRequest{
		Request: proto.Clone(request).(*chatmodel.GetAttachmentObjectRequest),
		SourceHomeStationPeerId: string(
			s.localStation,
		),
	}
	metadataHeader, err := productionEncodeAttachmentMetadata(wireRequest)
	if err != nil {
		return err
	}
	headers := map[string]string{
		"Accept":                           "application/octet-stream",
		productionAttachmentMetadataHeader: metadataHeader,
	}
	if rangeHeader != "" {
		headers["Range"] = rangeHeader
	}
	peerResponse, err := s.openAttachmentPeer(
		ctx,
		authenticated,
		request.GetAuthorityStationId(),
		request.GetConversationId(),
		productionAttachmentActionObject,
		request.GetObjectId(),
		federationruntime.PeerRouteConversationAttachmentObject,
		map[string]string{"object_id": request.GetObjectId()},
		headers,
		nil,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	defer peerResponse.Body.Close()
	wireResponse := &chatmodel.GetFederatedConversationAttachmentObjectResponse{}
	if err := productionDecodeAttachmentMetadataValue(
		peerResponse.Headers.Get(productionAttachmentMetadataHeader),
		wireResponse,
	); err != nil {
		return err
	}
	result := wireResponse.GetResponse()
	if result == nil ||
		result.GetObject() == nil ||
		result.GetObject().GetObjectId() != request.GetObjectId() ||
		!bytes.Equal(result.GetEtagSha256(), request.GetExpectedEtagSha256()) {
		return fmt.Errorf(
			"remote attachment object metadata does not match the request",
		)
	}
	responseETag, err := productionAttachmentETag(
		peerResponse.Headers.Get("ETag"),
	)
	if err != nil || !bytes.Equal(responseETag, result.GetEtagSha256()) {
		return fmt.Errorf("remote attachment object ETag is invalid")
	}
	expectedStatus := http.StatusOK
	if rangeHeader != "" {
		expectedStatus = http.StatusPartialContent
	}
	if peerResponse.StatusCode != expectedStatus ||
		!strings.HasPrefix(
			strings.ToLower(peerResponse.Headers.Get("Content-Type")),
			"application/octet-stream",
		) ||
		strings.TrimSpace(peerResponse.Headers.Get("Content-Length")) == "" {
		return fmt.Errorf("remote attachment object response is invalid")
	}

	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("ETag", peerResponse.Headers.Get("ETag"))
	response.SetHeader("Content-Length", peerResponse.Headers.Get("Content-Length"))
	if expectedStatus == http.StatusPartialContent {
		contentRange := peerResponse.Headers.Get("Content-Range")
		if strings.TrimSpace(contentRange) == "" {
			return fmt.Errorf("remote attachment object range metadata is missing")
		}
		response.SetHeader("Content-Range", contentRange)
	}
	response.WriteHeader(peerResponse.StatusCode)
	_, err = io.Copy(productionResponseWriter{response: response}, peerResponse.Body)

	return err
}

func (s *subServer) callAttachmentPeerProto(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	targetStation string,
	conversationID string,
	action string,
	resourceID string,
	route federationruntime.PeerRoute,
	pathParameters map[string]string,
	request proto.Message,
	response proto.Message,
) error {
	runtime, err := s.composition.FederationRuntime()
	if err != nil {
		return err
	}

	return runtime.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: targetStation,
		Route:               route,
		Subject:             authenticated.PTID,
		Claims: s.attachmentPeerClaims(
			authenticated,
			targetStation,
			conversationID,
			action,
			resourceID,
		),
		PathParameters: pathParameters,
		Request:        request,
		Response:       response,
	})
}

func (s *subServer) openAttachmentPeer(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	targetStation string,
	conversationID string,
	action string,
	resourceID string,
	route federationruntime.PeerRoute,
	pathParameters map[string]string,
	headers map[string]string,
	body io.Reader,
) (*federationruntime.PeerStreamResponse, error) {
	runtime, err := s.composition.FederationRuntime()
	if err != nil {
		return nil, err
	}

	return runtime.OpenPeerStream(ctx, federationruntime.PeerStreamCall{
		TargetStationPeerID: targetStation,
		Route:               route,
		Subject:             authenticated.PTID,
		Claims: s.attachmentPeerClaims(
			authenticated,
			targetStation,
			conversationID,
			action,
			resourceID,
		),
		PathParameters: pathParameters,
		Headers:        headers,
		Body:           body,
	})
}

func (s *subServer) attachmentPeerClaims(
	authenticated conversationhttp.AuthenticatedActor,
	targetStation string,
	conversationID string,
	action string,
	resourceID string,
) map[string]string {
	return map[string]string{
		federationruntime.ClaimConversationID:       conversationID,
		federationruntime.ClaimActorPTID:            authenticated.PTID,
		federationruntime.ClaimDeviceID:             authenticated.DeviceID,
		federationruntime.ClaimAttachmentAction:     action,
		federationruntime.ClaimAttachmentResourceID: resourceID,
		federationruntime.ClaimSourceStationPeerID:  string(s.localStation),
		federationruntime.ClaimTargetStationPeerID:  targetStation,
	}
}

func productionEncodeAttachmentMetadata(message proto.Message) (string, error) {
	encoded, err := deterministicProductionProto(message)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(encoded), nil
}

func productionDecodeAttachmentPeerResponse(
	response *federationruntime.PeerStreamResponse,
	message proto.Message,
) error {
	if response == nil || response.Body == nil || message == nil {
		return fmt.Errorf("remote attachment protobuf response is incomplete")
	}
	if !strings.HasPrefix(
		strings.ToLower(response.Headers.Get("Content-Type")),
		"application/protobuf",
	) {
		return fmt.Errorf("remote attachment response is not protobuf")
	}
	body, err := io.ReadAll(
		io.LimitReader(response.Body, productionAttachmentResponseLimit+1),
	)
	if err != nil {
		return fmt.Errorf("read remote attachment response: %w", err)
	}
	if len(body) > productionAttachmentResponseLimit {
		return fmt.Errorf("remote attachment response exceeds the configured limit")
	}
	if err := proto.Unmarshal(body, message); err != nil {
		return fmt.Errorf("decode remote attachment response: %w", err)
	}
	if len(message.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf("remote attachment response contains unknown fields")
	}

	return nil
}

func productionDecodeAttachmentMetadataValue(
	value string,
	message proto.Message,
) error {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil || len(raw) == 0 ||
		len(raw) > productionAttachmentResponseLimit {
		return fmt.Errorf("remote attachment metadata header is invalid")
	}
	if err := proto.Unmarshal(raw, message); err != nil {
		return fmt.Errorf("decode remote attachment metadata header: %w", err)
	}
	if len(message.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf("remote attachment metadata contains unknown fields")
	}

	return nil
}

func productionAttachmentChunkResourceID(
	uploadID string,
	chunkIndex uint32,
) string {
	return uploadID + "/chunks/" + strconv.FormatUint(uint64(chunkIndex), 10)
}

func productionFederatedAttachmentEndpoint(
	ctx context.Context,
) (conversationhttp.AuthenticatedActor, error) {
	return productionFederatedAttachmentActor(ctx)
}

func productionLeaveIntent(
	intent repository.LeaveIntent,
) *chatmodel.MlsLeaveIntent {
	return &chatmodel.MlsLeaveIntent{
		Version:                 intent.Version,
		IntentId:                intent.ID,
		FederationId:            string(intent.FederationID),
		AuthorityStationPeerId:  string(intent.AuthorityStation),
		AuthorityEpoch:          int64(intent.AuthorityEpoch),
		HomeStationPeerId:       string(intent.HomeStation),
		ConversationId:          string(intent.ConversationID),
		ActorPtid:               string(intent.Actor.Actor),
		ActorDeviceId:           string(intent.Actor.Device),
		ActorSigningKeyId:       intent.SigningKeyID,
		ObservedMembershipEpoch: int64(intent.AuthorityHead.MembershipEpoch),
		ObservedMlsEpoch:        int64(intent.AuthorityHead.MLSEpoch),
		CreatedAtUnixMs:         intent.CreatedAt.UnixMilli(),
		ExpiresAtUnixMs:         intent.ExpiresAt.UnixMilli(),
		ActorSignature:          append([]byte(nil), intent.Signature...),
		AuthoritySequence:       int64(intent.AuthorityHead.Sequence),
		AuthorityHash:           intent.AuthorityHead.EventHash.Bytes(),
	}
}

func productionLeaveIntents(
	intents []repository.LeaveIntent,
) []*chatmodel.MlsLeaveIntent {
	result := make([]*chatmodel.MlsLeaveIntent, 0, len(intents))
	for _, intent := range intents {
		result = append(result, productionLeaveIntent(intent))
	}

	return result
}

func productionMustHash(value []byte) valueobject.Hash {
	var hash valueobject.Hash
	copy(hash[:], value)

	return hash
}

func timeFromUnixMillis(value int64) time.Time {
	return time.UnixMilli(value).UTC()
}

func productionRequestHeader(request server.Request, name string) string {
	if request == nil {
		return ""
	}
	for key, value := range request.Header() {
		if strings.EqualFold(key, name) {
			return strings.TrimSpace(value)
		}
	}

	return ""
}

func productionDecodeMetadataHeader(
	request server.Request,
	message proto.Message,
) error {
	raw, err := base64.StdEncoding.DecodeString(
		productionRequestHeader(request, productionAttachmentMetadataHeader),
	)
	if err != nil || len(raw) == 0 {
		return server.BadRequest("attachment metadata header is required")
	}
	if err := proto.Unmarshal(raw, message); err != nil {
		return server.BadRequest("attachment metadata header is invalid")
	}

	return nil
}

func productionPositiveUintHeader(
	request server.Request,
	name string,
) (uint64, error) {
	value, err := strconv.ParseUint(productionRequestHeader(request, name), 10, 64)
	if err != nil || value == 0 {
		return 0, server.BadRequest(name + " must be a positive integer")
	}

	return value, nil
}

func productionPathValue(path string, prefix string, suffix string) (string, error) {
	clean := path
	if index := strings.IndexByte(clean, '?'); index >= 0 {
		clean = clean[:index]
	}
	if !strings.HasPrefix(clean, prefix) ||
		(suffix != "" && !strings.HasSuffix(clean, suffix)) {
		return "", server.BadRequest("attachment route is invalid")
	}
	value := strings.TrimSuffix(strings.TrimPrefix(clean, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return "", server.BadRequest("attachment resource ID is invalid")
	}

	return value, nil
}

func productionAttachmentChunkPath(path string) (string, uint32, error) {
	const prefix = "/conversation/attachments/uploads/"
	const separator = "/chunks/"
	clean := path
	if index := strings.IndexByte(clean, '?'); index >= 0 {
		clean = clean[:index]
	}
	if !strings.HasPrefix(clean, prefix) {
		return "", 0, server.BadRequest("attachment chunk route is invalid")
	}
	uploadID, rawIndex, found := strings.Cut(
		strings.TrimPrefix(clean, prefix),
		separator,
	)
	if !found || uploadID == "" || rawIndex == "" ||
		strings.Contains(uploadID, "/") ||
		strings.Contains(rawIndex, "/") {
		return "", 0, server.BadRequest("attachment chunk route is invalid")
	}
	index, err := strconv.ParseUint(rawIndex, 10, 32)
	if err != nil {
		return "", 0, server.BadRequest("attachment chunk index is invalid")
	}

	return uploadID, uint32(index), nil
}

func productionAttachmentETag(value string) ([]byte, error) {
	value = strings.Trim(strings.TrimSpace(value), `"`)
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return nil, server.BadRequest("attachment ETag is invalid")
	}

	return decoded, nil
}

func productionAttachmentRange(value string) (int64, int64, bool, error) {
	if strings.TrimSpace(value) == "" {
		return 0, -1, false, nil
	}
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "bytes=") {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	startRaw, endRaw, found := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !found || startRaw == "" {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	start, err := strconv.ParseInt(startRaw, 10, 64)
	if err != nil || start < 0 {
		return 0, 0, false, server.NewHandlerError(
			http.StatusRequestedRangeNotSatisfiable,
			"attachment range is invalid",
		)
	}
	end := int64(-1)
	if endRaw != "" {
		end, err = strconv.ParseInt(endRaw, 10, 64)
		if err != nil || end < start {
			return 0, 0, false, server.NewHandlerError(
				http.StatusRequestedRangeNotSatisfiable,
				"attachment range is invalid",
			)
		}
	}

	return start, end, true, nil
}

func productionWriteProto(
	response server.Response,
	status int,
	message proto.Message,
) error {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return err
	}
	response.SetHeader("Content-Type", "application/protobuf")
	response.WriteHeader(status)
	_, err = response.Write(body)

	return err
}

func attachmentChunkBodyLimit() int {
	return 8 << 20
}

type productionResponseWriter struct {
	response server.Response
}

func (w productionResponseWriter) Write(value []byte) (int, error) {
	return w.response.Write(value)
}

func (s *subServer) forwardPrepareCommand(
	ctx context.Context,
	request *chatmodel.PrepareConversationCommandRequest,
) (*chatmodel.PrepareConversationCommandResponse, error) {
	if request == nil ||
		request.GetSender() == nil ||
		request.GetSender().GetActor() == nil {
		return nil, server.BadRequest(
			"remote Conversation command preparation is incomplete",
		)
	}
	targetStation := strings.TrimSpace(request.GetAuthorityStationPeerId())
	runtime, err := s.composition.FederationRuntime()
	if err != nil {
		return nil, err
	}
	response := &chatmodel.PrepareFederatedConversationCommandResponse{}
	err = runtime.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: targetStation,
		Route: federationruntime.
			PeerRouteConversationCommandPrepare,
		Subject: request.GetSender().GetActor().GetPtid(),
		Claims: map[string]string{
			federationruntime.ClaimConversationID: request.GetConversationId(),
			federationruntime.ClaimActorPTID: request.GetSender().
				GetActor().
				GetPtid(),
			federationruntime.ClaimDeviceID: request.GetSender().GetDeviceId(),
			federationruntime.ClaimSourceStationPeerID: string(
				s.localStation,
			),
			federationruntime.ClaimTargetStationPeerID: targetStation,
		},
		Request: &chatmodel.PrepareFederatedConversationCommandRequest{
			Request:                 proto.Clone(request).(*chatmodel.PrepareConversationCommandRequest),
			SourceHomeStationPeerId: string(s.localStation),
		},
		Response: response,
	})
	if err != nil {
		return nil, err
	}
	if response.GetPlan() == nil ||
		response.GetPlan().GetConversationId() != request.GetConversationId() ||
		response.GetPlan().GetAuthorityStationPeerId() != targetStation {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"production_federation.prepare_command",
			"response",
			"does not match the requested Conversation authority",
		)
	}

	return response.GetPlan(), nil
}

// EnsureAcceptedRelationshipDirectConversation is the typed Social effect
// boundary. It reuses the same canonical creation service and receipt journal.
func (s *subServer) EnsureAcceptedRelationshipDirectConversation(
	ctx context.Context,
	_ string,
	requestID string,
	federationID string,
	actorAPTID string,
	actorBPTID string,
) (string, error) {
	if requestID == "" {
		return "", fmt.Errorf(
			"ensure accepted-relationship Direct Conversation: request ID is required",
		)
	}
	actorA, err := valueobject.NewPTID(actorAPTID)
	if err != nil {
		return "", err
	}
	actorB, err := valueobject.NewPTID(actorBPTID)
	if err != nil {
		return "", err
	}
	federation, err := valueobject.NewFederationID(federationID)
	if err != nil {
		return "", err
	}
	conversationID, err := valueobject.DirectConversationID(actorA, actorB)
	if err != nil {
		return "", err
	}
	existing, getErr := s.composition.QueryService.Get(
		ctx,
		conversationID,
		actorA,
	)
	switch {
	case getErr == nil:
		if !existingDirectCanReopen(
			existing,
			federation,
			actorA,
			actorB,
			s.localStation,
		) {
			return "", conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"production_capabilities.ensure_accepted_relationship_direct",
				"conversation",
				"does not match the accepted relationship",
			)
		}

		return string(conversationID), nil
	case !conversationdomain.IsCode(getErr, conversationdomain.ErrorCodeNotFound):
		return "", getErr
	}

	var creator valueobject.Endpoint
	err = s.composition.UnitOfWork.Execute(
		ctx,
		func(transaction ports.Transaction) error {
			routes, listErr := transaction.Identity.ListActiveEndpoints(
				ctx,
				[]valueobject.PTID{actorA},
			)
			if listErr != nil {
				return listErr
			}
			if len(routes) == 0 {
				return fmt.Errorf(
					"ensure accepted-relationship Direct Conversation: actor has no active device",
				)
			}
			creator = routes[0].Endpoint

			return nil
		},
	)
	if err != nil {
		return "", err
	}
	wire := &chatmodel.CreateDirectConversationRequest{
		PeerPtid:     string(actorB),
		FederationId: string(federation),
		Creator: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: string(creator.Actor),
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: string(creator.Device),
		},
		CommandId: requestID,
	}
	exactBytes, err := deterministicProductionProto(wire)
	if err != nil {
		return "", err
	}
	verifiedRoutes, err := s.productionEndpointRoutes(
		ctx,
		[]valueobject.PTID{actorA, actorB},
	)
	if err != nil {
		return "", err
	}
	result, err := s.composition.CommandService.EnsureDirect(
		ctx,
		command.CreateDirectRequest{
			Creator:           creator,
			Peer:              actorB,
			FederationID:      federation,
			AuthorityEpoch:    initialConversationAuthorityEpoch,
			CommandID:         valueobject.CommandID(requestID),
			VerifiedRoutes:    verifiedRoutes,
			ExactCommandBytes: exactBytes,
		},
	)
	if err != nil {
		return "", err
	}
	if result.PostCommitError != nil {
		return "", result.PostCommitError
	}

	return string(result.Conversation.ID), nil
}

func existingDirectCanReopen(
	view query.ConversationView,
	federationID valueobject.FederationID,
	actorA valueobject.PTID,
	actorB valueobject.PTID,
	localStation valueobject.StationID,
) bool {
	snapshot := view.Conversation
	if snapshot.Kind != valueobject.ConversationKindDirect ||
		snapshot.Status != valueobject.ConversationStatusActive ||
		snapshot.FederationID != federationID {
		return false
	}
	activeMembers := make(map[valueobject.PTID]struct{}, len(snapshot.Members))
	for _, member := range snapshot.Members {
		if member.Active() {
			activeMembers[member.Actor] = struct{}{}
		}
	}
	if len(activeMembers) != 2 {
		return false
	}
	_, hasActorA := activeMembers[actorA]
	_, hasActorB := activeMembers[actorB]

	if !hasActorA || !hasActorB {
		return false
	}
	switch view.Source {
	case query.SourceAuthority:
		return snapshot.AuthorityStation == localStation
	case query.SourceFollower:
		return snapshot.AuthorityStation != localStation &&
			view.FollowerStatus == repository.FollowerStatusActive
	default:
		return false
	}
}

var (
	_ conversationfederation.LeaveIntentPort = conversationfederation.LeaveIntentFuncs{}
	_                                        = entity.AuthorityPlan{}
)
