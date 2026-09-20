package social

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	nethttp "net/http"
	"net/url"
	"strconv"
	"strings"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Route constants. The legacy `/api/v1/social/posts*` routes are
// preserved for backward compatibility with the desktop scaffold; new
// clients SHOULD prefer the `/api/v1/social/moments*` family which
// exposes the Audience-aware semantics directly. Both groups route to
// the same MomentService internally.
//
// Reactions and circles are first-class P1 surfaces with their own
// route prefixes.
const (
	// Posts (legacy aliases)
	routeSocialPosts        = "/api/v1/social/posts"
	routeSocialPost         = "/api/v1/social/posts/:id"
	routeSocialPostRepost   = "/api/v1/social/posts/:id/repost"
	routeSocialPostComments = "/api/v1/social/posts/:id/comments"
	routeSocialUserPosts    = "/api/v1/social/users/:userId/posts"

	// Moments (preferred)
	routeSocialMoments               = "/api/v1/social/moments"
	routeSocialMoment                = "/api/v1/social/moments/:id"
	routeSocialMomentComment         = "/api/v1/social/moments/:id/comments"
	routeSocialPreparePrivateMoment  = "/api/v1/social/moments/prepare-private"
	routeSocialSubmitPrivateMoment   = "/api/v1/social/moments/submit-private"
	routeSocialPreparePrivateComment = "/api/v1/social/moments/:id/comments/prepare-private"
	routeSocialSubmitPrivateComment  = "/api/v1/social/moments/:id/comments/submit-private"
	routeSocialObjectUploadBegin     = "/api/v1/social/moments/objects/uploads/begin"
	routeSocialObjectUploadStatus    = "/api/v1/social/moments/objects/uploads/:upload_id"
	routeSocialObjectUploadChunk     = "/api/v1/social/moments/objects/uploads/:upload_id/chunks/:chunk_index"
	routeSocialObjectUploadComplete  = "/api/v1/social/moments/objects/uploads/:upload_id/complete"
	routeSocialObjectUploadCancel    = "/api/v1/social/moments/objects/uploads/:upload_id/cancel"
	routeSocialObjectDownload        = "/api/v1/social/moments/objects/:object_id"

	// Reactions
	routeSocialPostReact   = "/api/v1/social/posts/:id/react"
	routeSocialPostUnreact = "/api/v1/social/posts/:id/unreact"

	// Comments (top-level)
	routeSocialComment = "/api/v1/social/comments/:commentId"

	// Timeline
	routeSocialTimeline    = "/api/v1/social/timeline"
	routeSocialMomentsSync = "/api/v1/social/moments/sync"

	// Relationships
	routeSocialFollow       = "/api/v1/social/relationships/follow"
	routeSocialUnfollow     = "/api/v1/social/relationships/unfollow"
	routeSocialRelationship = "/api/v1/social/relationships"
	routeSocialFollowers    = "/api/v1/social/relationships/followers"
	routeSocialFollowing    = "/api/v1/social/relationships/following"

	// User search / me
	routeSocialUserSearch = "/api/v1/social/users/search"
	routeSocialUserMe     = "/api/v1/social/users/me"

	// Self-stats (drives the user-side dashboard panel)
	routeSocialMyStats = "/api/v1/social/me/stats"

	// Moderation / Station trust policy
	routeSocialStationModeration = "/api/v1/social/moderation/stations"

	// Circles
	routeSocialCircles      = "/api/v1/social/circles"
	routeSocialCircle       = "/api/v1/social/circles/:id"
	routeSocialCircleMember = "/api/v1/social/circles/:id/members"

	// Friend Requests
	routeSocialFriendRequestSend   = "/api/v1/social/friend-request/send"
	routeSocialFriendRequestAccept = "/api/v1/social/friend-request/accept"
	routeSocialFriendRequestReject = "/api/v1/social/friend-request/reject"
	routeSocialFriendRequests      = "/api/v1/social/friend-requests"
)

func (s *subServer) Handlers() []server.Handler {
	cw := s.commonWrapper
	jw := s.jwtWrapper
	ojw := s.optionalJWTWrapper
	deviceIDWrapper := serverwrapper.DeviceID()
	privateContentJWTWrapper := s.privateContentJWTWrapper
	privateContentOptionalJWTWrapper := s.privateContentOptionalJWTWrapper
	privateContentDeviceWrapper := serverwrapper.RequireStructuredDeviceID(
		int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
	)

	return []server.Handler{
		// Moments / Posts (write)
		server.NewTypedHandler("social-create-post", routeSocialPosts, server.POST, s.handleCreatePost, cw, jw),
		server.NewTypedHandler("social-create-moment", routeSocialMoments, server.POST, s.handleCreatePost, cw, jw),
		server.NewStrictTypedHandler("social-prepare-private-moment", routeSocialPreparePrivateMoment, server.POST, s.handlePreparePrivateMoment, cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewStrictTypedHandler("social-submit-private-moment", routeSocialSubmitPrivateMoment, server.POST, s.handleSubmitPrivateMoment, cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewStrictTypedHandler("social-private-object-upload-begin", routeSocialObjectUploadBegin, server.POST, s.handleBeginPrivateObjectUpload, cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewHTTPHandler("social-private-object-upload-status", routeSocialObjectUploadStatus, server.GET, socialObjectRawHandler(s.handlePrivateObjectUploadStatus), cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewHTTPHandler("social-private-object-upload-chunk", routeSocialObjectUploadChunk, server.PUT, socialObjectRawHandler(s.handlePrivateObjectChunk), cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewStrictTypedHandler("social-private-object-upload-complete", routeSocialObjectUploadComplete, server.POST, s.handleCompletePrivateObjectUpload, socialObjectPathWrapper("/api/v1/social/moments/objects/uploads/", "/complete"), cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewStrictTypedHandler("social-private-object-upload-cancel", routeSocialObjectUploadCancel, server.POST, s.handleCancelPrivateObjectUpload, socialObjectPathWrapper("/api/v1/social/moments/objects/uploads/", "/cancel"), cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewHTTPHandler("social-private-object-download", routeSocialObjectDownload, server.GET, socialObjectRawHandler(s.handlePrivateObjectDownload), cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewTypedHandler("social-update-post", routeSocialPost, server.PUT, s.handleUpdatePost, cw, jw),
		server.NewTypedHandler("social-delete-post", routeSocialPost, server.DELETE, s.handleDeletePost, cw, jw),
		server.NewTypedHandler("social-delete-moment", routeSocialMoment, server.DELETE, s.handleDeletePost, cw, jw),
		server.NewTypedHandler("social-repost-post", routeSocialPostRepost, server.POST, s.handleRepostPost, cw, jw),

		// Moments / Posts (read)
		server.NewTypedHandler("social-get-post", routeSocialPost, server.GET, s.handleGetPost, cw, ojw),
		server.NewStrictTypedHandler("social-list-recoverable-private-content", routeSocialRecoverablePrivateContent, server.GET, s.handleListRecoverablePrivateContent, socialRecoverableQueryWrapper, cw, privateContentAuthenticationFailureWrapper, privateContentJWTWrapper),
		server.NewTypedHandler("social-get-moment", routeSocialMoment, server.GET, s.handleGetMomentResource, socialMomentPathWrapper, cw, privateContentAuthenticationFailureWrapper, deviceIDWrapper, privateContentOptionalJWTWrapper),
		server.NewTypedHandler("social-get-timeline", routeSocialTimeline, server.GET, s.handleGetTimeline, cw, ojw),
		server.NewTypedHandler("social-sync-moments-projection", routeSocialMomentsSync, server.POST, s.handleSyncMomentsProjection, cw, jw),
		server.NewTypedHandler("social-get-user-posts", routeSocialUserPosts, server.GET, s.handleGetUserPosts, cw, ojw),

		// Reactions
		server.NewTypedHandler("social-react", routeSocialPostReact, server.POST, s.handleReact, cw, jw),
		server.NewTypedHandler("social-unreact", routeSocialPostUnreact, server.POST, s.handleUnreact, cw, jw),

		// Comments
		server.NewTypedHandler("social-get-post-comments", routeSocialPostComments, server.GET, s.handleGetPostComments, cw, ojw),
		server.NewTypedHandler("social-get-moment-comments", routeSocialMomentComment, server.GET, s.handleGetPostComments, cw, ojw),
		server.NewTypedHandler("social-create-comment", routeSocialPostComments, server.POST, s.handleCreateComment, cw, jw),
		server.NewTypedHandler("social-create-moment-comment", routeSocialMomentComment, server.POST, s.handleCreateComment, cw, jw),
		server.NewStrictTypedHandler("social-prepare-private-comment", routeSocialPreparePrivateComment, server.POST, s.handlePreparePrivateComment, cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewStrictTypedHandler("social-submit-private-comment", routeSocialSubmitPrivateComment, server.POST, s.handleSubmitPrivateComment, cw, privateContentAuthenticationFailureWrapper, privateContentDeviceWrapper, privateContentJWTWrapper),
		server.NewTypedHandler("social-delete-comment", routeSocialComment, server.DELETE, s.handleDeleteComment, cw, jw),

		// Relationships
		server.NewTypedHandler("social-follow", routeSocialFollow, server.POST, s.handleFollow, cw, jw),
		server.NewTypedHandler("social-unfollow", routeSocialUnfollow, server.POST, s.handleUnfollow, cw, jw),
		server.NewTypedHandler("social-get-relationship", routeSocialRelationship, server.GET, s.handleGetRelationship, cw, jw),
		server.NewTypedHandler("social-get-relationships", routeSocialRelationship, server.POST, s.handleGetRelationships, cw, jw),
		server.NewTypedHandler("social-get-followers", routeSocialFollowers, server.GET, s.handleGetFollowers, cw, jw),
		server.NewTypedHandler("social-get-following", routeSocialFollowing, server.GET, s.handleGetFollowing, cw, jw),

		// User search / me
		server.NewTypedHandler("social-search-users", routeSocialUserSearch, server.GET, s.handleSearchUsers, cw, jw),
		server.NewTypedHandler("social-get-me", routeSocialUserMe, server.GET, s.handleGetMe, cw, jw),
		server.NewTypedHandler("social-my-stats", routeSocialMyStats, server.GET, s.handleGetMyStats, cw, jw),

		// Moderation
		server.NewTypedHandler("social-upsert-station-moderation", routeSocialStationModeration, server.POST, s.handleUpsertStationModerationPolicy, cw, jw),
		server.NewTypedHandler("social-list-station-moderation", routeSocialStationModeration, server.GET, s.handleListStationModerationPolicies, cw, jw),
		server.NewTypedHandler("social-delete-station-moderation", routeSocialStationModeration, server.DELETE, s.handleDeleteStationModerationPolicy, cw, jw),

		// Circles
		server.NewTypedHandler("social-create-circle", routeSocialCircles, server.POST, s.handleCreateCircle, cw, jw),
		server.NewTypedHandler("social-list-circles", routeSocialCircles, server.GET, s.handleListMyCircles, cw, jw),
		server.NewTypedHandler("social-rename-circle", routeSocialCircle, server.PUT, s.handleRenameCircle, cw, jw),
		server.NewTypedHandler("social-delete-circle", routeSocialCircle, server.DELETE, s.handleDeleteCircle, cw, jw),
		server.NewTypedHandler("social-add-circle-member", routeSocialCircleMember, server.POST, s.handleAddCircleMembers, cw, jw),
		server.NewTypedHandler("social-remove-circle-member", routeSocialCircleMember, server.DELETE, s.handleRemoveCircleMembers, cw, jw),
		server.NewTypedHandler("social-list-circle-members", routeSocialCircleMember, server.GET, s.handleListCircleMembers, cw, jw),

		// Friend Requests
		server.NewTypedHandler("social-send-friend-request", routeSocialFriendRequestSend, server.POST, s.handleSendFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-accept-friend-request", routeSocialFriendRequestAccept, server.POST, s.handleAcceptFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-reject-friend-request", routeSocialFriendRequestReject, server.POST, s.handleRejectFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-list-friend-requests", routeSocialFriendRequests, server.GET, s.handleListFriendRequests, cw, jw),
	}
}

func (s *subServer) handlePreparePrivateMoment(
	ctx context.Context,
	req *privatecontentpb.PreparePrivateMomentRequest,
) (*privatecontentpb.PreparePrivateMomentResponse, error) {
	author, err := s.privateContentAuthor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.privateContentSvc.PreparePrivateMoment(ctx, author, req)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleSubmitPrivateMoment(
	ctx context.Context,
	req *privatecontentpb.SubmitPrivateMomentRequest,
) (*privatecontentpb.SubmitPrivateMomentResponse, error) {
	author, err := s.privateContentAuthor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.privateContentSvc.SubmitPrivateMoment(
		ctx,
		author.Endpoint,
		req,
	)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handlePreparePrivateComment(
	ctx context.Context,
	req *privatecontentpb.PreparePrivateCommentRequest,
) (*privatecontentpb.PreparePrivateCommentResponse, error) {
	author, err := s.privateContentAuthor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.privateContentSvc.PreparePrivateComment(ctx, author, req)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleSubmitPrivateComment(
	ctx context.Context,
	req *privatecontentpb.SubmitPrivateCommentRequest,
) (*privatecontentpb.SubmitPrivateCommentResponse, error) {
	author, err := s.privateContentAuthor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.privateContentSvc.SubmitPrivateComment(
		ctx,
		author.Endpoint,
		req,
	)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleBeginPrivateObjectUpload(
	ctx context.Context,
	req *securecontentpb.BeginEncryptedObjectUploadRequest,
) (*securecontentpb.BeginEncryptedObjectUploadResponse, error) {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.privateObjectSvc.Begin(ctx, endpoint, req)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handlePrivateObjectUploadStatus(
	ctx context.Context,
	req server.Request,
	resp server.Response,
) error {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return err
	}
	if err := rejectSocialRequestBody(
		req,
		"private object status body is forbidden",
	); err != nil {
		return err
	}
	uploadID, generation, err := canonicalSocialObjectStatusRequest(req.Path())
	if err != nil {
		return err
	}
	response, err := s.privateObjectSvc.Status(
		ctx,
		endpoint,
		&securecontentpb.GetEncryptedObjectUploadRequest{
			UploadId:   uploadID,
			Generation: generation,
		},
	)
	if err != nil {
		return privateContentHandlerError(err)
	}
	return writeSocialObjectProto(resp, response)
}

func (s *subServer) handleCompletePrivateObjectUpload(
	ctx context.Context,
	req *securecontentpb.CompleteEncryptedObjectUploadRequest,
) (*securecontentpb.CompleteEncryptedObjectUploadResponse, error) {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	uploadID, ok := ctx.Value(socialObjectPathContextKey{}).(string)
	if !ok || uploadID == "" ||
		(req.GetUploadId() != "" && req.GetUploadId() != uploadID) {
		return nil, server.BadRequest(
			"private object completion path does not match request",
		)
	}
	req.UploadId = uploadID
	response, err := s.privateObjectSvc.Complete(ctx, endpoint, req)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleCancelPrivateObjectUpload(
	ctx context.Context,
	req *securecontentpb.CancelEncryptedObjectUploadRequest,
) (*securecontentpb.CancelEncryptedObjectUploadResponse, error) {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	uploadID, ok := ctx.Value(socialObjectPathContextKey{}).(string)
	if !ok || uploadID == "" ||
		(req.GetUploadId() != "" && req.GetUploadId() != uploadID) {
		return nil, server.BadRequest(
			"private object cancellation path does not match request",
		)
	}
	req.UploadId = uploadID
	response, err := s.privateObjectSvc.Cancel(ctx, endpoint, req)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handlePrivateObjectChunk(
	ctx context.Context,
	req server.Request,
	resp server.Response,
) error {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return err
	}
	uploadID, chunkIndex, err := socialObjectChunkPath(req.Path())
	if err != nil {
		return err
	}
	if mediaType := strings.TrimSpace(
		socialObjectHeader(req, "Content-Type"),
	); mediaType != "application/octet-stream" {
		return server.BadRequest(
			"private object chunks require application/octet-stream",
		)
	}
	generation, err := canonicalUnsignedHeader(
		req,
		"X-Upload-Generation",
		64,
	)
	if err != nil {
		return err
	}
	offset, err := canonicalUnsignedHeader(req, "X-Chunk-Offset", 64)
	if err != nil {
		return err
	}
	size, err := canonicalUnsignedHeader(req, "X-Ciphertext-Size", 64)
	if err != nil {
		return err
	}
	contentLength, err := canonicalUnsignedHeader(req, "Content-Length", 64)
	if err != nil {
		return err
	}
	if size == 0 ||
		size > uint64(
			securecontentkernel.ObjectChunkSize+
				securecontentkernel.AES256GCMTagSize,
		) ||
		contentLength != size {
		return server.BadRequest(
			"private object chunk length is invalid",
		)
	}
	body, err := readBoundedSocialObjectBody(req, size)
	if err != nil {
		return server.BadRequest(
			"private object chunk body is invalid",
		)
	}
	ciphertextHash, err := canonicalSHA256Header(
		req,
		"X-Ciphertext-SHA256",
	)
	if err != nil {
		return err
	}
	idempotencyKey := strings.TrimSpace(
		socialObjectHeader(req, "Idempotency-Key"),
	)
	if idempotencyKey == "" ||
		len(idempotencyKey) > 128 ||
		idempotencyKey != socialObjectHeader(req, "Idempotency-Key") {
		return server.BadRequest(
			"private object chunk idempotency key is invalid",
		)
	}
	response, err := s.privateObjectSvc.PutChunk(
		ctx,
		endpoint,
		application.PrivateObjectChunk{
			UploadID:         uploadID,
			Generation:       generation,
			ChunkIndex:       chunkIndex,
			Offset:           offset,
			Size:             size,
			CiphertextSHA256: ciphertextHash,
			IdempotencyKey:   idempotencyKey,
			Body:             body,
		},
	)
	if err != nil {
		return privateContentHandlerError(err)
	}
	return writeSocialObjectProto(resp, response)
}

func readBoundedSocialObjectBody(
	request server.Request,
	size uint64,
) ([]byte, error) {
	var reader io.Reader
	if streaming, ok := request.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	} else {
		reader = bytes.NewReader(request.Body())
	}
	body, err := io.ReadAll(io.LimitReader(reader, int64(size)+1))
	if err != nil || uint64(len(body)) != size {
		return nil, errors.New("private object body length differs")
	}
	return body, nil
}

func (s *subServer) handlePrivateObjectDownload(
	ctx context.Context,
	req server.Request,
	resp server.Response,
) error {
	endpoint, err := s.privateObjectEndpoint(ctx)
	if err != nil {
		return err
	}
	objectID, err := socialObjectPathValue(
		req.Path(),
		"/api/v1/social/moments/objects/",
		"",
	)
	if err != nil {
		return err
	}
	query, err := socialObjectQuery(req.Path())
	if err != nil {
		return server.NotFound("private object not found")
	}
	expectedValues, ok := query["expected_descriptor_sha256"]
	if !ok || len(expectedValues) != 1 || len(query) != 1 {
		return server.NotFound("private object not found")
	}
	expectedDescriptor, err := decodeCanonicalSHA256(expectedValues[0])
	if err != nil {
		return server.NotFound("private object not found")
	}
	start, end, partial, err := socialObjectRange(
		socialObjectHeader(req, "Range"),
	)
	if err != nil {
		return err
	}
	download, err := s.privateObjectSvc.Download(
		ctx,
		endpoint,
		objectID,
		expectedDescriptor,
		start,
		end,
	)
	if err != nil {
		return privateObjectDownloadHandlerError(err, partial)
	}
	descriptorHex := hex.EncodeToString(download.DescriptorSHA256)
	resp.SetHeader("Accept-Ranges", "bytes")
	resp.SetHeader("Content-Type", "application/octet-stream")
	resp.SetHeader("ETag", `"sha256:`+descriptorHex+`"`)
	resp.SetHeader("X-Descriptor-SHA256", descriptorHex)
	resp.SetHeader(
		"X-Total-Ciphertext-Size",
		strconv.FormatUint(download.TotalSize, 10),
	)
	responseLength := download.TotalSize
	if partial {
		responseLength = uint64(download.End - download.Start + 1)
	}
	resp.SetHeader(
		"Content-Length",
		strconv.FormatUint(responseLength, 10),
	)
	if partial {
		resp.SetHeader(
			"Content-Range",
			fmt.Sprintf(
				"bytes %d-%d/%d",
				download.Start,
				download.End,
				download.TotalSize,
			),
		)
		resp.WriteHeader(nethttp.StatusPartialContent)
	} else {
		resp.WriteHeader(nethttp.StatusOK)
	}
	if streaming, ok := resp.(server.StreamingResponse); ok {
		return streaming.SetBodyStream(
			download.Body,
			int64(responseLength),
		)
	}
	defer download.Body.Close()
	_, err = io.Copy(resp, download.Body)
	return err
}

func privateObjectDownloadHandlerError(err error, partial bool) error {
	if partial &&
		domain.PrivateContentCodeOf(err) ==
			domain.PrivateContentInvalidArgument {
		return server.NewHandlerError(
			nethttp.StatusRequestedRangeNotSatisfiable,
			"private object range is not satisfiable",
		)
	}
	return privateContentHandlerError(err)
}

func (s *subServer) privateObjectEndpoint(
	ctx context.Context,
) (*model.ActorDeviceRef, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized(
			"authenticated private-content actor required",
		)
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return nil, server.Unauthorized(
			"authenticated private-content device required",
		)
	}
	if s.privateObjectSvc == nil {
		return nil, server.InternalError(
			"Social private-object service is unavailable",
		)
	}
	return &model.ActorDeviceRef{
		Actor: &model.ActorRef{
			Ptid: actorPTID,
			Kind: model.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: deviceID,
	}, nil
}

type socialObjectPathContextKey struct{}

type socialMomentPathContextKey struct{}

func socialMomentPathWrapper(next server.EndpointHandler) server.EndpointHandler {
	return func(
		ctx context.Context,
		request server.Request,
		response server.Response,
	) error {
		if strings.Contains(request.Path(), "?") {
			return server.BadRequest("moment point-read query is forbidden")
		}
		if err := rejectSocialRequestBody(
			request,
			"moment point-read body is forbidden",
		); err != nil {
			return err
		}
		postID, err := socialObjectPathValue(
			request.Path(),
			"/api/v1/social/moments/",
			"",
		)
		if err != nil {
			return err
		}
		return next(
			context.WithValue(ctx, socialMomentPathContextKey{}, postID),
			request,
			response,
		)
	}
}

func socialObjectPathWrapper(prefix string, suffix string) server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(
			ctx context.Context,
			req server.Request,
			resp server.Response,
		) error {
			value, err := socialObjectPathValue(req.Path(), prefix, suffix)
			if err != nil {
				return err
			}
			return next(
				context.WithValue(
					ctx,
					socialObjectPathContextKey{},
					value,
				),
				req,
				resp,
			)
		}
	}
}

func socialObjectPathValue(
	path string,
	prefix string,
	suffix string,
) (string, error) {
	clean := path
	if index := strings.IndexByte(clean, '?'); index >= 0 {
		clean = clean[:index]
	}
	if !strings.HasPrefix(clean, prefix) ||
		(suffix != "" && !strings.HasSuffix(clean, suffix)) {
		return "", server.BadRequest("private object route is invalid")
	}
	value := strings.TrimSuffix(strings.TrimPrefix(clean, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return "", server.BadRequest(
			"private object resource ID is invalid",
		)
	}
	return value, nil
}

func socialObjectChunkPath(path string) (string, uint32, error) {
	const prefix = "/api/v1/social/moments/objects/uploads/"
	const separator = "/chunks/"
	if strings.Contains(path, "?") {
		return "", 0, server.BadRequest(
			"private object chunk query is forbidden",
		)
	}
	clean := path
	if !strings.HasPrefix(clean, prefix) {
		return "", 0, server.BadRequest(
			"private object chunk route is invalid",
		)
	}
	uploadID, rawIndex, found := strings.Cut(
		strings.TrimPrefix(clean, prefix),
		separator,
	)
	if !found ||
		uploadID == "" ||
		rawIndex == "" ||
		strings.Contains(uploadID, "/") ||
		strings.Contains(rawIndex, "/") {
		return "", 0, server.BadRequest(
			"private object chunk route is invalid",
		)
	}
	index, err := strconv.ParseUint(rawIndex, 10, 32)
	if err != nil ||
		(rawIndex != "0" && strings.HasPrefix(rawIndex, "0")) {
		return "", 0, server.BadRequest(
			"private object chunk index is invalid",
		)
	}
	return uploadID, uint32(index), nil
}

func canonicalSocialObjectStatusRequest(
	path string,
) (string, uint64, error) {
	const prefix = "/api/v1/social/moments/objects/uploads/"
	index := strings.IndexByte(path, '?')
	if index < 0 {
		return "", 0, server.BadRequest(
			"private object status generation query is required",
		)
	}
	rawQuery := path[index+1:]
	const generationPrefix = "generation="
	if !strings.HasPrefix(rawQuery, generationPrefix) ||
		strings.Contains(rawQuery, "&") ||
		strings.Contains(rawQuery, ";") {
		return "", 0, server.BadRequest(
			"private object status query is invalid",
		)
	}
	rawGeneration := strings.TrimPrefix(rawQuery, generationPrefix)
	if rawGeneration == "" ||
		(rawGeneration != "0" && strings.HasPrefix(rawGeneration, "0")) ||
		strings.HasPrefix(rawGeneration, "+") ||
		strings.HasPrefix(rawGeneration, "-") {
		return "", 0, server.BadRequest(
			"private object status generation is not canonical",
		)
	}
	generation, err := strconv.ParseUint(rawGeneration, 10, 64)
	if err != nil || generation == 0 {
		return "", 0, server.BadRequest(
			"private object status generation is invalid",
		)
	}
	uploadID, err := socialObjectPathValue(path[:index], prefix, "")
	if err != nil {
		return "", 0, err
	}
	return uploadID, generation, nil
}

func rejectSocialRequestBody(
	request server.Request,
	message string,
) error {
	var reader io.Reader
	if streaming, ok := request.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	} else {
		reader = bytes.NewReader(request.Body())
	}
	var probe [1]byte
	read, err := reader.Read(probe[:])
	if read != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		return server.BadRequest(message)
	}
	return nil
}

func socialObjectHeader(req server.Request, name string) string {
	for key, value := range req.Header() {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}

func canonicalUnsignedHeader(
	req server.Request,
	name string,
	bitSize int,
) (uint64, error) {
	raw := socialObjectHeader(req, name)
	if raw == "" ||
		(raw != "0" && strings.HasPrefix(raw, "0")) ||
		strings.HasPrefix(raw, "+") ||
		strings.HasPrefix(raw, "-") {
		return 0, server.BadRequest(name + " is not canonical")
	}
	value, err := strconv.ParseUint(raw, 10, bitSize)
	if err != nil {
		return 0, server.BadRequest(name + " is invalid")
	}
	return value, nil
}

func canonicalSHA256Header(
	req server.Request,
	name string,
) ([]byte, error) {
	value, err := decodeCanonicalSHA256(socialObjectHeader(req, name))
	if err != nil {
		return nil, server.BadRequest(name + " is invalid")
	}
	return value, nil
}

func decodeCanonicalSHA256(value string) ([]byte, error) {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return nil, errors.New("SHA-256 is not lowercase hexadecimal")
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return nil, errors.New("SHA-256 is invalid")
	}
	return decoded, nil
}

func socialObjectQuery(path string) (url.Values, error) {
	index := strings.IndexByte(path, '?')
	if index < 0 {
		return nil, errors.New("query is required")
	}
	return url.ParseQuery(path[index+1:])
}

func socialObjectRange(
	value string,
) (int64, int64, bool, error) {
	if strings.TrimSpace(value) == "" {
		return -1, -1, false, nil
	}
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "bytes=") ||
		strings.Contains(value, ",") {
		return 0, 0, false, server.NewHandlerError(
			nethttp.StatusRequestedRangeNotSatisfiable,
			"private object range is invalid",
		)
	}
	startRaw, endRaw, found := strings.Cut(
		strings.TrimPrefix(value, "bytes="),
		"-",
	)
	if !found || startRaw == "" {
		return 0, 0, false, server.NewHandlerError(
			nethttp.StatusRequestedRangeNotSatisfiable,
			"private object range is invalid",
		)
	}
	start, err := strconv.ParseInt(startRaw, 10, 64)
	if err != nil ||
		start < 0 ||
		(startRaw != "0" && strings.HasPrefix(startRaw, "0")) {
		return 0, 0, false, server.NewHandlerError(
			nethttp.StatusRequestedRangeNotSatisfiable,
			"private object range is invalid",
		)
	}
	end := int64(-1)
	if endRaw != "" {
		end, err = strconv.ParseInt(endRaw, 10, 64)
		if err != nil ||
			end < start ||
			(endRaw != "0" && strings.HasPrefix(endRaw, "0")) {
			return 0, 0, false, server.NewHandlerError(
				nethttp.StatusRequestedRangeNotSatisfiable,
				"private object range is invalid",
			)
		}
	}
	return start, end, true, nil
}

func writeSocialObjectProto(
	response server.Response,
	message proto.Message,
) error {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return err
	}
	response.SetHeader("Content-Type", "application/protobuf")
	response.WriteHeader(nethttp.StatusOK)
	_, err = response.Write(body)
	return err
}

func privateContentAuthenticationFailureWrapper(
	next server.EndpointHandler,
) server.EndpointHandler {
	return func(
		ctx context.Context,
		request server.Request,
		response server.Response,
	) error {
		_, ok := server.RouteFailureFromContext(ctx)
		if !ok {
			return next(ctx, request, response)
		}
		body, err := privateContentErrorResponseBody(
			model.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			"unauthorized",
		)
		if err != nil {
			return err
		}
		response.SetHeader(
			"Content-Type",
			server.CanonicalProtobufContentType,
		)
		response.WriteHeader(nethttp.StatusUnauthorized)
		_, err = response.Write(body)
		return err
	}
}

func socialObjectRawHandler(
	next server.EndpointHandler,
) server.EndpointHandler {
	return func(
		ctx context.Context,
		request server.Request,
		response server.Response,
	) error {
		err := next(ctx, request, response)
		if err == nil {
			return nil
		}
		status := nethttp.StatusInternalServerError
		message := "private object request failed"
		if handlerError, ok := err.(*server.HandlerError); ok {
			status = handlerError.Code
			message = handlerError.Message
			for name, value := range handlerError.Headers {
				response.SetHeader(name, value)
			}
			if len(handlerError.Body) != 0 {
				if handlerError.ContentType != "" {
					response.SetHeader(
						"Content-Type",
						handlerError.ContentType,
					)
				}
				response.WriteHeader(status)
				_, writeErr := response.Write(handlerError.Body)
				return writeErr
			}
		}
		body, marshalErr := json.Marshal(map[string]any{
			"error": message,
			"code":  status,
		})
		if marshalErr != nil {
			return marshalErr
		}
		response.SetHeader("Content-Type", "application/json")
		response.WriteHeader(status)
		_, writeErr := response.Write(body)
		return writeErr
	}
}

func (s *subServer) privateContentAuthor(
	ctx context.Context,
) (domain.PrivateContentAuthor, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return domain.PrivateContentAuthor{},
			server.Unauthorized("authenticated private-content actor required")
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return domain.PrivateContentAuthor{},
			server.Unauthorized("authenticated private-content device required")
	}
	if s.privateContentSvc == nil {
		return domain.PrivateContentAuthor{},
			server.InternalError("Social private-content service is unavailable")
	}
	actors, err := resolvePrivateContentActorCapabilities()
	if err != nil {
		return domain.PrivateContentAuthor{},
			server.InternalErrorWithCause(
				"Actor Identity capability is unavailable",
				err,
			)
	}
	homeStation, err := actors.ResolveActorHomeStationPeerID(ctx, actorPTID)
	if err != nil {
		return domain.PrivateContentAuthor{},
			server.InternalErrorWithCause(
				"resolve private-content actor Home Station",
				err,
			)
	}
	return domain.PrivateContentAuthor{
		Endpoint: &model.ActorDeviceRef{
			Actor: &model.ActorRef{
				Ptid: actorPTID,
				Kind: model.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: deviceID,
		},
		HomeStationPeerID: homeStation,
	}, nil
}

func privateContentHandlerError(err error) error {
	status := nethttp.StatusInternalServerError
	code := model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR
	message := "private-content command failed"
	switch domain.PrivateContentCodeOf(err) {
	case domain.PrivateContentInvalidArgument,
		domain.PrivateContentUnsupported:
		status = nethttp.StatusBadRequest
		code = model.ErrorCode_ERROR_CODE_INVALID_REQUEST
		message = "invalid private-content command"
	case domain.PrivateContentUnauthorized:
		status = nethttp.StatusForbidden
		code = model.ErrorCode_ERROR_CODE_UNAUTHORIZED
		message = "private-content command is unauthorized"
	case domain.PrivateContentNotFound:
		status = nethttp.StatusNotFound
		code = model.ErrorCode_ERROR_CODE_POST_NOT_FOUND
		message = "private content not found"
	case domain.PrivateContentConflict,
		domain.PrivateContentStalePlan,
		domain.PrivateContentExpiredPlan:
		status = nethttp.StatusConflict
		code = model.ErrorCode_ERROR_CODE_INVALID_REQUEST
		message = "private-content command conflicts with current authority"
	}
	return privateContentResponseError(status, code, message, err)
}

func privateContentResponseError(
	status int,
	code model.ErrorCode,
	message string,
	cause error,
) error {
	body, err := privateContentErrorResponseBody(code, message)
	if err != nil {
		return server.InternalErrorWithCause(
			"encode private-content error response",
			err,
		)
	}
	handlerError := server.NewHandlerErrorWithResponse(
		status,
		message,
		server.CanonicalProtobufContentType,
		body,
		nil,
	)
	handlerError.Err = cause
	return handlerError
}

func privateContentErrorResponseBody(
	code model.ErrorCode,
	message string,
) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ErrorResponse{
			Code:    code,
			Message: message,
		},
	)
}

// getUserID extracts the authenticated user ID from context.
func getUserID(c context.Context) (uint64, bool) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		return 0, false
	}
	record, err := actor.GetActorByPTID(c, subject.ID)
	if err != nil || record == nil {
		return 0, false
	}
	return record.ID, true
}

func getActorPTID(c context.Context) (string, bool) {
	subject := coreauth.GetSubject(c)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", false
	}
	return subject.ID, true
}

// --- Post / Moment handlers --------------------------------------------------

func (s *subServer) handleCreatePost(ctx context.Context, req *model.CreatePostRequest) (*model.CreatePostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}
	if req.Audience == nil {
		// Backward-compat: synthesize an Audience from the legacy
		// `visibility` field for clients that haven't migrated yet.
		req.Audience = audienceFromLegacyVisibility(req.Visibility)
	}
	if !domain.IsPublic(req.Audience) {
		return nil, server.BadRequest(
			"private moments require the prepare-private and submit-private routes",
		)
	}
	post, err := s.momentSvc.CreateMoment(ctx, req, actorPTID)
	if err != nil {
		logger.Error(ctx, "failed to create moment", "error", err, "audience_kind", req.Audience.Kind)
		return nil, server.InternalErrorWithCause("failed to create moment", err)
	}
	return &model.CreatePostResponse{Post: post}, nil
}

// handleUpdatePost is intentionally unsupported in v1 — the new
// audience model freezes audience at creation, and editing the body
// after publication needs a separate edit-history pipeline that's out
// of scope. Returns a clear 501.
func (s *subServer) handleUpdatePost(_ context.Context, _ *model.UpdatePostRequest) (*model.UpdatePostResponse, error) {
	return nil, server.BadRequest("post update is not supported in v1; delete and re-create instead")
}

func (s *subServer) handleDeletePost(ctx context.Context, req *model.DeletePostRequest) (*model.DeletePostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.momentSvc.DeleteMoment(ctx, req.PostId, actorPTID); err != nil {
		logger.Error(ctx, "failed to delete moment", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to delete moment", err)
	}
	return &model.DeletePostResponse{Success: true}, nil
}

// handleRepostPost wraps the legacy `/repost` endpoint by constructing
// a CreatePostRequest with `Type=REPOST` and forwarding to MomentService.
func (s *subServer) handleRepostPost(ctx context.Context, req *model.RepostRequest) (*model.RepostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	createReq := &model.CreatePostRequest{
		Type:     model.PostType_REPOST,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{
				OriginalPostId: req.PostId,
				Comment:        req.GetComment(),
			},
		},
	}
	post, err := s.momentSvc.CreateMoment(ctx, createReq, actorPTID)
	if err != nil {
		logger.Error(ctx, "failed to repost", "error", err, "original_post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to repost", err)
	}
	return &model.RepostResponse{Repost: post}, nil
}

func (s *subServer) handleGetPost(ctx context.Context, req *model.GetPostRequest) (*model.GetPostResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	post, err := s.momentSvc.GetMoment(ctx, req.PostId, viewerPTID)
	if err != nil {
		logger.Error(ctx, "failed to get post", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to get post", err)
	}
	if post == nil {
		return nil, server.NotFound("post not found")
	}
	if blocked, err := s.moderationSvc.IsPostAuthorStationBlocked(ctx, post); err != nil {
		return nil, server.InternalErrorWithCause("station moderation check failed", err)
	} else if blocked {
		return nil, server.NotFound("post not found")
	}
	return &model.GetPostResponse{
		Post:        post,
		Explanation: application.BuildFeedObjectExplanation(post, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW),
	}, nil
}

func (s *subServer) handleGetMomentResource(
	ctx context.Context,
	req *privatecontentpb.GetMomentResourceRequest,
) (*privatecontentpb.GetMomentResourceResponse, error) {
	var privateReader privateMomentReader
	if s.privateContentSvc != nil {
		privateReader = s.privateContentSvc
	}
	return s.handleGetMomentResourceWithReader(ctx, req, privateReader)
}

type privateMomentReader interface {
	GetPrivateMoment(
		context.Context,
		*model.ActorDeviceRef,
		string,
	) (*privatecontentpb.GetMomentResourceResponse, error)
}

func (s *subServer) handleGetMomentResourceWithReader(
	ctx context.Context,
	req *privatecontentpb.GetMomentResourceRequest,
	privateReader privateMomentReader,
) (*privatecontentpb.GetMomentResourceResponse, error) {
	postID, ok := ctx.Value(socialMomentPathContextKey{}).(string)
	if !ok || postID == "" {
		return nil, server.BadRequest("moment path is invalid")
	}
	if req == nil {
		return nil, server.BadRequest("post_id is required")
	}
	if req.GetPostId() != "" && req.GetPostId() != postID {
		return nil, server.BadRequest("moment path does not match request")
	}
	req.PostId = postID
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	if legacyID, parseErr := strconv.ParseUint(
		req.GetPostId(),
		10,
		64,
	); parseErr == nil &&
		strconv.FormatUint(legacyID, 10) == req.GetPostId() {
		if publicPost, err := s.momentSvc.GetMoment(
			ctx,
			req.GetPostId(),
			viewerPTID,
		); err != nil {
			return nil, server.InternalErrorWithCause(
				"failed to resolve public moment",
				err,
			)
		} else if publicPost != nil &&
			domain.IsPublic(publicPost.GetAudience()) {
			return &privatecontentpb.GetMomentResourceResponse{
				Post: publicPost,
				Explanation: application.BuildFeedObjectExplanation(
					publicPost,
					model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW,
				),
				Resource: &privatecontentpb.PostResource{
					Metadata: &privatecontentpb.PostMetadata{
						PostId:       publicPost.GetId(),
						ContentId:    publicPost.GetId(),
						Author:       &model.ActorRef{Ptid: publicPost.GetAuthorPtid()},
						Type:         publicPost.GetType(),
						AudienceKind: model.Audience_PUBLIC,
						CreatedAt:    publicPost.GetCreatedAt(),
						UpdatedAt:    publicPost.GetUpdatedAt(),
						IsDeleted:    publicPost.GetIsDeleted(),
						Stats:        publicPost.GetStats(),
					},
					Body: &privatecontentpb.PostResource_PublicContent{
						PublicContent: &privatecontentpb.PublicPostContent{
							Post: publicPost,
						},
					},
				},
			}, nil
		}
	}
	if err := domain.ValidatePrivateContentID(
		req.GetPostId(),
		"post_id",
		"social.get_moment_resource",
	); err != nil {
		return nil, privateContentResponseError(
			nethttp.StatusNotFound,
			model.ErrorCode_ERROR_CODE_POST_NOT_FOUND,
			"moment not found",
			nil,
		)
	}
	actorPTID, ok := getActorPTID(ctx)
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if !ok || deviceID == "" {
		return nil, privateContentResponseError(
			nethttp.StatusNotFound,
			model.ErrorCode_ERROR_CODE_POST_NOT_FOUND,
			"moment not found",
			nil,
		)
	}
	if privateReader == nil {
		return nil, server.InternalError(
			"Social private-content service is unavailable",
		)
	}
	response, err := privateReader.GetPrivateMoment(
		ctx,
		&model.ActorDeviceRef{
			Actor: &model.ActorRef{
				Ptid: actorPTID,
				Kind: model.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: deviceID,
		},
		req.GetPostId(),
	)
	if err != nil {
		return nil, privateContentHandlerError(err)
	}
	return response, nil
}

func (s *subServer) handleGetUserPosts(ctx context.Context, req *model.ListPostsRequest) (*model.ListPostsResponse, error) {
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}
	authorPTID := req.Filter.AuthorPtid
	if authorPTID == "" {
		return nil, server.BadRequest("author_ptid is required")
	}
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}

	posts, nextCursor, hasMore, err := s.momentSvc.ListByAuthor(ctx, authorPTID, viewerPTID, "", int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list user posts", err)
	}
	return &model.ListPostsResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildProfileExplanations(posts),
	}, nil
}

func buildProfileExplanations(posts []*model.Post) []*model.FeedObjectExplanation {
	if len(posts) == 0 {
		return nil
	}

	explanations := make([]*model.FeedObjectExplanation, 0, len(posts))
	for _, post := range posts {
		explanation := application.BuildFeedObjectExplanation(post, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW)
		if explanation != nil {
			explanations = append(explanations, explanation)
		}
	}
	return explanations
}

// --- Reaction handlers ----------------------------------------------------

func (s *subServer) handleReact(ctx context.Context, req *model.ReactToPostRequest) (*model.ReactToPostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if req.Kind == model.ReactionKind_REACTION_UNSPECIFIED {
		return nil, server.BadRequest("reaction kind is required")
	}
	if err := s.assertReadable(ctx, req.PostId, actorPTID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.React(ctx, req.PostId, actorPTID, req.Kind)
	if err != nil {
		return nil, server.InternalErrorWithCause("react failed", err)
	}
	return &model.ReactToPostResponse{Success: true, Reactions: summaries}, nil
}

func (s *subServer) handleUnreact(ctx context.Context, req *model.UnreactToPostRequest) (*model.UnreactToPostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.assertReadable(ctx, req.PostId, actorPTID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.Unreact(ctx, req.PostId, actorPTID, req.Kind)
	if err != nil {
		return nil, server.InternalErrorWithCause("unreact failed", err)
	}
	return &model.UnreactToPostResponse{Success: true, Reactions: summaries}, nil
}

// assertReadable is the single-source-of-truth visibility gate used by
// every endpoint that mutates a post-bound resource WITHOUT going
// through MomentService directly (React / Unreact / list-comments).
//
// It must be called BEFORE the underlying service operates on the
// post — otherwise the service would happily write a row keyed on a
// post id the caller has no right to know exists, leaking existence
// + state through side-channels (reaction count bumps, comment-list
// non-emptiness).
//
// The check is intentionally identical in shape to the read path:
// MomentService.GetMoment applies CanRead with the viewer's own
// relationship graph. A nil result here means "post doesn't exist OR
// caller can't read it" — surfaced as 404, never 403, so the wire
// shape doesn't disclose existence to non-readers.
func (s *subServer) assertReadable(ctx context.Context, postID, viewerPTID string) error {
	post, err := s.momentSvc.GetMoment(ctx, postID, viewerPTID)
	if err != nil {
		return server.InternalErrorWithCause("visibility check failed", err)
	}
	if post == nil {
		return server.NotFound("post not found")
	}
	return nil
}

// --- Comment handlers ----------------------------------------------------

func (s *subServer) handleGetPostComments(ctx context.Context, req *model.GetCommentsRequest) (*model.GetCommentsResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	postID := domain.ParseID(req.PostId)
	if postID == 0 {
		return nil, server.BadRequest("invalid post_id")
	}
	// Comments inherit visibility from the parent post — gate on the
	// parent BEFORE listing rows, otherwise we'd happily return a
	// SELF post's comment thread to anyone holding the post id.
	// Anonymous viewers (viewerID == 0) get the same gate; PUBLIC
	// posts pass, anything else 404s on them.
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	resp, err := s.commentSvc.ListByPost(ctx, postID, viewerPTID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list comments", err)
	}
	return resp, nil
}

func (s *subServer) handleCreateComment(ctx context.Context, req *model.CreateCommentRequest) (*model.CreateCommentResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	postID := domain.ParseID(req.PostId)
	if postID == 0 {
		return nil, server.BadRequest("invalid post_id")
	}
	parent, err := s.momentSvc.GetMoment(ctx, req.PostId, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"failed to resolve comment parent",
			err,
		)
	}
	if parent == nil {
		return nil, server.NotFound("post not found")
	}
	if !domain.IsPublic(parent.GetAudience()) {
		return nil, server.BadRequest(
			"private comments require the prepare-private and submit-private routes",
		)
	}
	comment, err := s.commentSvc.CreateComment(ctx, req, postID, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create comment", err)
	}
	return &model.CreateCommentResponse{Comment: comment}, nil
}

func (s *subServer) handleDeleteComment(ctx context.Context, req *model.DeleteCommentRequest) (*model.DeleteCommentResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.CommentId == "" {
		return nil, server.BadRequest("comment_id is required")
	}
	commentID := domain.ParseID(req.CommentId)
	if commentID == 0 {
		return nil, server.BadRequest("invalid comment_id")
	}
	if err := s.commentSvc.DeleteComment(ctx, commentID, actorPTID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete comment", err)
	}
	return &model.DeleteCommentResponse{Success: true}, nil
}

// --- Timeline handler ----------------------------------------------------

func (s *subServer) handleGetTimeline(ctx context.Context, req *model.GetTimelineRequest) (*model.GetTimelineResponse, error) {
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	resp, err := s.timelineSvc.GetTimeline(ctx, req, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get timeline", err)
	}
	return resp, nil
}

func (s *subServer) handleSyncMomentsProjection(ctx context.Context, req *model.SyncMomentsProjectionRequest) (*model.SyncMomentsProjectionResponse, error) {
	viewerPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		req = &model.SyncMomentsProjectionRequest{}
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	home, err := s.timelineSvc.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:   model.TimelineType_TIMELINE_HOME,
		Cursor: req.HomeCursor,
		Limit:  limit,
	}, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to sync home moments projection", err)
	}

	public, err := s.timelineSvc.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:   model.TimelineType_TIMELINE_PUBLIC,
		Cursor: req.PublicCursor,
		Limit:  limit,
		Sort:   req.PublicSort,
	}, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to sync public moments projection", err)
	}

	return &model.SyncMomentsProjectionResponse{
		HomeTimeline:   home,
		PublicTimeline: public,
		SyncToken:      fmt.Sprintf("%s:%s", home.GetNextCursor(), public.GetNextCursor()),
	}, nil
}

// --- Relationship handlers ----------------------------------------------------

func (s *subServer) handleFollow(ctx context.Context, req *model.FollowRequest) (*model.FollowResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	relationship, err := s.relationshipSvc.Follow(ctx, actorPTID, req.TargetActorPtid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to follow", err)
	}
	return &model.FollowResponse{Success: true, Relationship: relationship}, nil
}

func (s *subServer) handleUnfollow(ctx context.Context, req *model.UnfollowRequest) (*model.UnfollowResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	if err := s.relationshipSvc.Unfollow(ctx, actorPTID, req.TargetActorPtid); err != nil {
		return nil, server.InternalErrorWithCause("failed to unfollow", err)
	}
	return &model.UnfollowResponse{Success: true}, nil
}

func (s *subServer) handleGetRelationship(ctx context.Context, req *model.GetRelationshipRequest) (*model.GetRelationshipResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	rel, err := s.relationshipSvc.GetRelationship(ctx, actorPTID, req.TargetActorPtid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationship", err)
	}
	return &model.GetRelationshipResponse{Relationship: rel}, nil
}

func (s *subServer) handleGetRelationships(ctx context.Context, req *model.GetRelationshipsRequest) (*model.GetRelationshipsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	rels, err := s.relationshipSvc.GetRelationships(ctx, actorPTID, req.TargetActorPtids)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationships", err)
	}
	return &model.GetRelationshipsResponse{Relationships: rels}, nil
}

func (s *subServer) handleGetFollowers(ctx context.Context, req *model.GetFollowersRequest) (*model.GetFollowersResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	targetActorPTID := actorPTID
	if req.ActorPtid != "" {
		targetActorPTID = req.ActorPtid
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	followers, nextCursor, total, err := s.relationshipSvc.GetFollowers(ctx, targetActorPTID, req.Cursor, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get followers", err)
	}
	return &model.GetFollowersResponse{Followers: followers, NextCursor: nextCursor, Total: total}, nil
}

func (s *subServer) handleGetFollowing(ctx context.Context, req *model.GetFollowingRequest) (*model.GetFollowingResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	targetActorPTID := actorPTID
	if req.ActorPtid != "" {
		targetActorPTID = req.ActorPtid
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	following, nextCursor, total, err := s.relationshipSvc.GetFollowing(ctx, targetActorPTID, req.Cursor, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get following", err)
	}
	return &model.GetFollowingResponse{Following: following, NextCursor: nextCursor, Total: total}, nil
}

// --- User search / me ----------------------------------------------------

func (s *subServer) handleSearchUsers(ctx context.Context, req *model.SearchUsersRequest) (*model.ActorList, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Q == "" {
		return nil, server.BadRequest("query parameter 'q' is required")
	}
	actors, err := actor.SearchActors(ctx, req.Q, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to search users", err)
	}
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		blocked, err := s.moderationSvc.IsStationBlocked(ctx, a.HomeStationDomain, a.HomeStationPeerID)
		if err != nil {
			return nil, server.InternalErrorWithCause("station moderation check failed", err)
		}
		if blocked {
			continue
		}
		items = append(items, actorSearchResult(a))
	}
	return &model.ActorList{Items: items, Total: int64(len(items))}, nil
}

func actorSearchResult(a *db.Actor) *model.Actor {
	return &model.Actor{
		Username:          a.PreferredUsername,
		DisplayName:       a.Name,
		Email:             a.Email,
		Avatar:            a.Icon,
		FederatedHandle:   a.FederatedHandle,
		HomeStationPeerId: a.HomeStationPeerID,
		HomeStationDomain: a.HomeStationDomain,
		Ref:               actor.ProtoActorRef(a, ""),
	}
}

func (s *subServer) handleGetMe(ctx context.Context, _ *model.GetMeRequest) (*model.ActorProfile, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	a, err := actor.GetActorByPTID(ctx, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get current user", err)
	}
	return &model.ActorProfile{
		Id:           a.PTID,
		DisplayName:  a.Name,
		Username:     a.PreferredUsername,
		Avatar:       a.Icon,
		ServerDomain: a.HomeStationDomain,
		Acct:         a.FederatedHandle,
		Ref:          actor.ProtoActorRef(a, ""),
	}, nil
}

// --- Circle handlers ----------------------------------------------------

func (s *subServer) handleCreateCircle(ctx context.Context, req *model.CreateCircleRequest) (*model.CreateCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Create(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create circle", err)
	}
	return &model.CreateCircleResponse{Circle: c}, nil
}

func (s *subServer) handleListMyCircles(ctx context.Context, req *model.ListMyCirclesRequest) (*model.ListMyCirclesResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMine(ctx, actorPTID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circles", err)
	}
	return resp, nil
}

func (s *subServer) handleRenameCircle(ctx context.Context, req *model.RenameCircleRequest) (*model.RenameCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Rename(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to rename circle", err)
	}
	return &model.RenameCircleResponse{Circle: c}, nil
}

func (s *subServer) handleDeleteCircle(ctx context.Context, req *model.DeleteCircleRequest) (*model.DeleteCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if err := s.circleSvc.Delete(ctx, req.CircleId, actorPTID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete circle", err)
	}
	return &model.DeleteCircleResponse{Success: true}, nil
}

func (s *subServer) handleAddCircleMembers(ctx context.Context, req *model.AddCircleMemberRequest) (*model.AddCircleMemberResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	added, total, err := s.circleSvc.AddMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to add circle members", err)
	}
	return &model.AddCircleMemberResponse{AddedCount: added, MemberCount: total}, nil
}

func (s *subServer) handleRemoveCircleMembers(ctx context.Context, req *model.RemoveCircleMemberRequest) (*model.RemoveCircleMemberResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	removed, total, err := s.circleSvc.RemoveMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to remove circle members", err)
	}
	return &model.RemoveCircleMemberResponse{RemovedCount: removed, MemberCount: total}, nil
}

func (s *subServer) handleListCircleMembers(ctx context.Context, req *model.ListCircleMembersRequest) (*model.ListCircleMembersResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circle members", err)
	}
	return resp, nil
}

// --- Stats ---------------------------------------------------------

func (s *subServer) handleGetMyStats(ctx context.Context, _ *model.GetMyMomentsStatsRequest) (*model.GetMyMomentsStatsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	stats, err := s.statsSvc.MyStats(ctx, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to compute moments stats", err)
	}
	return &model.GetMyMomentsStatsResponse{
		PostsCount:             stats.PostsCount,
		CommentsCount:          stats.CommentsCount,
		ReactionsGivenCount:    stats.ReactionsGivenCount,
		CommentsReceivedCount:  stats.CommentsReceivedCount,
		ReactionsReceivedCount: stats.ReactionsReceivedCount,
		FollowingCount:         stats.FollowingCount,
		FollowersCount:         stats.FollowersCount,
		CirclesCount:           stats.CirclesCount,
	}, nil
}

// --- Moderation ---------------------------------------------------------

func (s *subServer) handleUpsertStationModerationPolicy(
	ctx context.Context,
	req *model.UpsertStationModerationPolicyRequest,
) (*model.UpsertStationModerationPolicyResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	policy, err := s.moderationSvc.UpsertStationPolicy(ctx, req, actorPTID)
	if err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return &model.UpsertStationModerationPolicyResponse{Policy: policy}, nil
}

func (s *subServer) handleDeleteStationModerationPolicy(
	ctx context.Context,
	req *model.DeleteStationModerationPolicyRequest,
) (*model.DeleteStationModerationPolicyResponse, error) {
	if _, ok := getActorPTID(ctx); !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if err := s.moderationSvc.DeleteStationPolicy(ctx, req); err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return &model.DeleteStationModerationPolicyResponse{Success: true}, nil
}

func (s *subServer) handleListStationModerationPolicies(
	ctx context.Context,
	req *model.ListStationModerationPoliciesRequest,
) (*model.ListStationModerationPoliciesResponse, error) {
	if _, ok := getActorPTID(ctx); !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.moderationSvc.ListStationPolicies(ctx, req)
	if err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return resp, nil
}

// --- Helpers ----------------------------------------------------

// audienceFromLegacyVisibility synthesizes an Audience from the old
// `PostVisibility` enum so legacy clients (without an audience field)
// still get a sensible default during the transition window.
func audienceFromLegacyVisibility(v model.PostVisibility) *model.Audience {
	switch v {
	case model.PostVisibility_PRIVATE:
		return &model.Audience{Kind: model.Audience_SELF}
	case model.PostVisibility_FOLLOWERS_ONLY:
		return &model.Audience{Kind: model.Audience_FOLLOWERS}
	default:
		return &model.Audience{Kind: model.Audience_PUBLIC}
	}
}

// --- Friend Request handlers -------------------------------------------------

type federatedFriendRequestAPI interface {
	SubmitFriendRequestCommand(
		context.Context,
		*model.FriendRequestCommand,
	) (application.SubmitFriendRequestCommandResult, error)
	ListFriendRequestProjections(
		context.Context,
		string,
		model.FriendRequestState,
		int32,
		int32,
	) ([]domain.FriendRequestProjection, int64, error)
}

func (s *subServer) handleSendFriendRequest(
	ctx context.Context,
	req *model.SendSocialFriendRequestRequest,
) (*model.SendSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.SendSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleAcceptFriendRequest(
	ctx context.Context,
	req *model.AcceptSocialFriendRequestRequest,
) (*model.AcceptSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.AcceptSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleRejectFriendRequest(
	ctx context.Context,
	req *model.RejectSocialFriendRequestRequest,
) (*model.RejectSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.RejectSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleListFriendRequests(
	ctx context.Context,
	req *model.ListSocialFriendRequestsRequest,
) (*model.ListSocialFriendRequestsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	api, err := s.canonicalFriendRequestAPI()
	if err != nil {
		return nil, err
	}

	return handleListFriendRequestsWithAPI(ctx, actorPTID, req, api)
}

func handleListFriendRequestsWithAPI(
	ctx context.Context,
	actorPTID string,
	req *model.ListSocialFriendRequestsRequest,
	api federatedFriendRequestAPI,
) (*model.ListSocialFriendRequestsResponse, error) {
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}

	projections, total, err := api.ListFriendRequestProjections(
		ctx,
		actorPTID,
		req.GetState(),
		req.GetLimit(),
		req.GetOffset(),
	)
	if err != nil {
		return nil, mapFederatedFriendRequestError(
			ctx,
			"list Friend Requests",
			err,
		)
	}
	if total > math.MaxInt32 {
		return nil, server.InternalErrorWithCause(
			"Friend Request projection count exceeds the public API range",
			fmt.Errorf("projection count %d exceeds int32", total),
		)
	}
	requests := make([]*model.SocialFriendRequest, 0, len(projections))
	for _, projection := range projections {
		request := socialFriendRequestFromProjection(projection)
		if request == nil {
			return nil, server.InternalError(
				"Friend Request projection is missing its request identity",
			)
		}
		requests = append(requests, request)
	}
	return &model.ListSocialFriendRequestsResponse{
		Requests: requests,
		Total:    int32(total),
	}, nil
}

func (s *subServer) canonicalFriendRequestAPI() (
	federatedFriendRequestAPI,
	error,
) {
	if s == nil || s.federatedFriendRequestSvc == nil {
		return nil, server.InternalError(
			"federated Friend Request service is not initialized",
		)
	}
	return s.federatedFriendRequestSvc, nil
}

func (s *subServer) authenticatedFriendRequestAPI(
	ctx context.Context,
) (string, string, federatedFriendRequestAPI, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return "", "", nil, server.Unauthorized(
			"authenticated Friend Request actor required",
		)
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", "", nil, server.Unauthorized(
			"authenticated Friend Request device required",
		)
	}
	api, err := s.canonicalFriendRequestAPI()
	if err != nil {
		return "", "", nil, err
	}
	return strings.TrimSpace(actorPTID), deviceID, api, nil
}

func submitFriendRequestCommand(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	command *model.FriendRequestCommand,
	expectedAction model.FriendRequestAction,
	api federatedFriendRequestAPI,
) (domain.FriendRequestProjection, error) {
	if api == nil {
		return domain.FriendRequestProjection{}, server.InternalError(
			"federated Friend Request service is not initialized",
		)
	}
	if strings.TrimSpace(authenticatedActorPTID) == "" ||
		strings.TrimSpace(authenticatedDeviceID) == "" {
		return domain.FriendRequestProjection{}, server.Unauthorized(
			"authenticated Friend Request actor and device required",
		)
	}
	if command == nil || command.GetBody() == nil {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command.body is required",
		)
	}
	body := command.GetBody()
	if body.GetAction() != expectedAction {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command action does not match the Friend Request endpoint",
		)
	}
	authorizingDevice := body.GetAuthorizingDevice()
	if authorizingDevice == nil || authorizingDevice.GetActor() == nil {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command.body.authorizing_device is required",
		)
	}
	if authorizingDevice.GetActor().GetPtid() != authenticatedActorPTID ||
		authorizingDevice.GetDeviceId() != authenticatedDeviceID {
		return domain.FriendRequestProjection{}, server.Forbidden(
			"command authorizing device does not match the authenticated actor and device",
		)
	}

	result, err := api.SubmitFriendRequestCommand(ctx, command)
	if err != nil {
		return domain.FriendRequestProjection{}, mapFederatedFriendRequestError(
			ctx,
			"submit Friend Request command",
			err,
		)
	}
	return result.Projection, nil
}

func socialFriendRequestFromProjection(
	projection domain.FriendRequestProjection,
) *model.SocialFriendRequest {
	if projection.RequestID == "" {
		return nil
	}

	request := &model.SocialFriendRequest{
		RequestId:                 projection.RequestID,
		Sender:                    projection.Sender,
		Receiver:                  projection.Receiver,
		Message:                   projection.Message,
		State:                     projection.State,
		FederationId:              projection.FederationID,
		SenderHomeStationPeerId:   projection.SenderHomeStationPeerID,
		ReceiverHomeStationPeerId: projection.ReceiverHomeStationPeerID,
	}
	if !projection.CreatedAt.IsZero() {
		request.CreatedAt = timestamppb.New(projection.CreatedAt.UTC())
	}
	if projection.RespondedAt != nil {
		request.RespondedAt = timestamppb.New(projection.RespondedAt.UTC())
	}
	return request
}

func mapFederatedFriendRequestError(
	ctx context.Context,
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}

	logger.Warnf(ctx, "%s failed: %v", operation, err)
	switch domain.FederationErrorCodeOf(err) {
	case domain.FederationErrorInvalidArgument:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusBadRequest,
			"invalid Friend Request operation",
			err,
		)
	case domain.FederationErrorUnauthorized,
		domain.FederationErrorInvalidSignature,
		domain.FederationErrorBlocked:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusForbidden,
			"Friend Request operation is not authorized",
			err,
		)
	case domain.FederationErrorNotFound:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusNotFound,
			"Friend Request was not found",
			err,
		)
	case domain.FederationErrorAlreadyFriends,
		domain.FederationErrorStateConflict,
		domain.FederationErrorIdempotencyConflict:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusConflict,
			"Friend Request conflicts with current state",
			err,
		)
	case domain.FederationErrorIdentityUnavailable:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusServiceUnavailable,
			"Friend Request identity is temporarily unavailable",
			err,
		)
	default:
		return server.InternalErrorWithCause(
			"Friend Request operation failed",
			err,
		)
	}
}
