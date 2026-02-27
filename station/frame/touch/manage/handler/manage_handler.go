package handler

import (
	"context"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/manage"
)

func HandleHealth(ctx context.Context, req *pb.HealthRequest) (*pb.HealthResponse, error) {
	return &pb.HealthResponse{
		Status:  "ok",
		Message: "healthy",
	}, nil
}
