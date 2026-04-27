package handler

import (
	"context"
	"strconv"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/actor"
)

func HandleVerifySession(ctx context.Context, req *pb.VerifySessionRequest) (*pb.VerifySessionResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		logger.Debug(ctx, "session verification failed: no subject in context")
		return &pb.VerifySessionResponse{
			Valid: false,
		}, nil
	}

	logger.Debug(ctx, "session verified successfully", "subject_id", subject.ID)

	resp := &pb.VerifySessionResponse{
		Valid:      true,
		SubjectId:  subject.ID,
		Attributes: subject.Attributes,
	}
	// TODO: pass a public base URL into session verify so acct can be user@host when not using edge headers.
	if id, err := strconv.ParseUint(subject.ID, 10, 64); err == nil && id > 0 {
		if act, err := touchactor.GetActorByID(ctx, id); err == nil && act != nil {
			resp.ActorRef = touchactor.ProtoActorRef(act, "")
		}
	}

	return resp, nil
}
