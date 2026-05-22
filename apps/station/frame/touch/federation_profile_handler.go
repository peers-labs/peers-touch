// federation_profile_handler.go — Hertz handler that exposes a signed
// ActorProfileEnvelope for one of the local station's actors.
//
// Surface: GET /actor/federation/profile?handle=<canonical>
//
//   * No JWT — federation discovery must work for clients that have no
//     account on this station.
//   * 200 → protojson(ActorProfileEnvelope) under content-type
//     application/json.
//   * 400 → missing handle.
//   * 404 → handle is not local (correct response for a stale resolver
//     hitting the wrong home station).
//   * 500 → key cache or DB error.

package touch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// FederationProfile is the Hertz handler bound to
// `GET /actor/federation/profile`. It loads the requested local actor,
// projects to ActorProfile, and signs an envelope using the station's
// federation Ed25519 key.
func FederationProfile(c context.Context, ctx *app.RequestContext) {
	handle := string(ctx.Query("handle"))
	if handle == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "handle parameter is required"})
		return
	}

	// Federation envelopes MUST embed canonical URLs even when the
	// request reached us via /relay/forward (where Host is 127.0.0.1).
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

	_, bytes, err := fedprofile.Build(c, fedprofile.BuildInput{
		Handle:  handle,
		Fetcher: fetcher,
		Keys:    keys,
	})
	if err != nil {
		if errors.Is(err, fedprofile.ErrHandleNotLocal) {
			ctx.JSON(http.StatusNotFound, map[string]string{
				"handle": handle,
				"error":  "not_local",
			})
			return
		}
		hlog.Warnf("[federation profile] build failed handle=%s err=%v", handle, err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{
			"handle": handle,
			"error":  fmt.Sprintf("build envelope: %s", err),
		})
		return
	}

	envJSON, err := envelopeBytesToProtojson(bytes)
	if err != nil {
		hlog.Warnf("[federation profile] protojson failed handle=%s err=%v", handle, err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "marshal envelope"})
		return
	}

	ctx.Data(http.StatusOK, "application/json", envJSON)
}

// envelopeBytesToProtojson round-trips a wire-format envelope through
// protojson so callers see a human-friendly JSON shape (bytes fields →
// base64) without losing byte fidelity. The resolver re-marshals via
// protojson before signature verification, so canonicalDigest still
// matches.
func envelopeBytesToProtojson(bytes []byte) ([]byte, error) {
	env := &pb.ActorProfileEnvelope{}
	if err := proto.Unmarshal(bytes, env); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}
	return protojson.MarshalOptions{
		EmitUnpopulated: false,
		UseProtoNames:   false,
	}.Marshal(env)
}
