package handler

import (
	"context"
	"fmt"

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

	ptid, err := touchactor.ResolveSubjectPTID(ctx, subject.ID)
	if err != nil {
		logger.Debug(ctx, "session verification failed: subject is not a PTID")
		return &pb.VerifySessionResponse{Valid: false}, nil
	}

	record, err := touchactor.GetActorByPTID(ctx, ptid)
	if err != nil {
		return nil, fmt.Errorf("verify session actor lookup failed: %w", err)
	}
	if record == nil {
		logger.Debug(ctx, "session verification failed: actor not found")
		return &pb.VerifySessionResponse{Valid: false}, nil
	}

	logger.Debug(ctx, "session verified successfully")
	return &pb.VerifySessionResponse{
		Valid:      true,
		Attributes: subject.Attributes,
		ActorRef:   touchactor.ProtoActorRef(record),
	}, nil
}
