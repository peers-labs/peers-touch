package handler

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	actor "github.com/peers-labs/peers-touch/station/frame/touch/model/domain/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

const SubjectContextKey = "auth_subject"

func VerifySession(c context.Context, ctx *app.RequestContext) {
	subject, ok := c.Value(SubjectContextKey).(*coreauth.Subject)
	if !ok || subject == nil {
		logger.Debug(c, "session verification failed: no subject in context")
		response := &actor.VerifySessionResponse{
			Valid: false,
		}
		util.RspBack(c, ctx, http.StatusUnauthorized, response)
		return
	}

	logger.Debug(c, "session verified successfully", "subject_id", subject.ID)

	response := &actor.VerifySessionResponse{
		Valid:      true,
		SubjectId:  subject.ID,
		Attributes: subject.Attributes,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}
