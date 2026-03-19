package handler

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
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

	return &pb.VerifySessionResponse{
		Valid:      true,
		SubjectId:  subject.ID,
		Attributes: subject.Attributes,
	}, nil
}
