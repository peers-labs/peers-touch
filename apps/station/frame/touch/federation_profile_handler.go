// federation_profile_handler.go — Hertz handler that exposes a signed
// ActorProfileEnvelope for one of the local station's actors.
//
// Surface: GET /actor/federation/profile?handle=<canonical>
//
//   * No JWT — federation discovery must work for clients that have no
//     account on this station.
//   * 200 → ActorProfileEnvelope in the caller's negotiated format.
//   * 400 → missing handle.
//   * 404 → handle is not local (correct response for a stale resolver
//     hitting the wrong home station).
//   * 500 → key cache or DB error.

package touch

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	"google.golang.org/protobuf/encoding/protojson"
)

// FederationProfile is the Hertz handler bound to
// `GET /actor/federation/profile`. It loads the requested local actor,
// projects to ActorProfile, and signs an envelope using the station's
// federation Ed25519 key.
func FederationProfile(c context.Context, ctx *app.RequestContext) {
	handle := string(ctx.Query("handle"))
	if handle == "" {
		writeFederationError(
			c,
			ctx,
			http.StatusBadRequest,
			model.ErrorCode_ERROR_CODE_INVALID_QUERY_PARAMETERS,
			"handle parameter is required",
			nil,
		)
		return
	}

	// Federation envelopes MUST embed canonical URLs even when the
	// request reached us through the Station-terminated opaque tunnel.
	// The federation identity singleton owns the canonical origin; we
	// fall back to the request Host only if identity is not yet loaded.
	id := fednode.LocalIdentitySnapshot()
	canonicalBase := ""
	if d := strings.TrimSpace(id.StationDomain); d != "" {
		canonicalBase = "http://" + d
	} else {
		canonicalBase = baseURLFrom(ctx)
	}
	fetcher := actor.FederationProfileFetcher(canonicalBase)
	keys := actor.FederationKeyCache()

	envelope, bytes, err := fedprofile.Build(c, fedprofile.BuildInput{
		Handle:  handle,
		Fetcher: fetcher,
		Keys:    keys,
	})
	if err != nil {
		if errors.Is(err, fedprofile.ErrHandleNotLocal) {
			writeFederationError(
				c,
				ctx,
				http.StatusNotFound,
				model.ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND,
				"federated actor is not local",
				map[string]string{"handle": handle},
			)
			return
		}
		hlog.Warnf("[federation profile] build failed handle=%s err=%v", handle, err)
		writeFederationError(
			c,
			ctx,
			http.StatusInternalServerError,
			model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR,
			"failed to build federation profile",
			map[string]string{"handle": handle},
		)
		return
	}
	if shouldUseProto(ctx) {
		ctx.Data(http.StatusOK, model.ContentTypeProtobuf, bytes)
		return
	}

	envJSON, err := protojson.MarshalOptions{
		EmitUnpopulated: false,
		UseProtoNames:   false,
	}.Marshal(envelope)
	if err != nil {
		hlog.Warnf("[federation profile] protojson failed handle=%s err=%v", handle, err)
		writeFederationError(
			c,
			ctx,
			http.StatusInternalServerError,
			model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR,
			"failed to encode federation profile",
			map[string]string{"handle": handle},
		)
		return
	}

	ctx.Data(http.StatusOK, "application/json", envJSON)
}

func writeFederationError(
	c context.Context,
	ctx *app.RequestContext,
	httpStatus int,
	code model.ErrorCode,
	message string,
	details map[string]string,
) {
	response := &model.ErrorResponse{Code: code, Message: message}
	if len(details) > 0 {
		response.Details = details
	}
	util.RspError(c, ctx, httpStatus, response)
}
