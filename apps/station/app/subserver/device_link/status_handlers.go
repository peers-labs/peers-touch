package device_link

import (
	"context"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
)

func (s *subServer) handleApprove(ctx context.Context, request *pb.ApproveDeviceLinkRequest) (*pb.ApproveDeviceLinkResponse, error) {
	status, err := s.service.Approve(ctx, request)
	return &pb.ApproveDeviceLinkResponse{Status: status}, err
}

func (s *subServer) handleDeny(ctx context.Context, request *pb.DenyDeviceLinkRequest) (*pb.DenyDeviceLinkResponse, error) {
	status, err := s.service.Deny(ctx, request)
	return &pb.DenyDeviceLinkResponse{Status: status}, err
}

func (s *subServer) handleCancel(ctx context.Context, request *pb.CancelDeviceLinkRequest) (*pb.CancelDeviceLinkResponse, error) {
	status, err := s.service.Cancel(ctx, request)
	return &pb.CancelDeviceLinkResponse{Status: status}, err
}

func (s *subServer) handleStatus(ctx context.Context, request *pb.GetDeviceLinkStatusRequest) (*pb.GetDeviceLinkStatusResponse, error) {
	status, err := s.service.Status(ctx, request)
	return &pb.GetDeviceLinkStatusResponse{Status: status}, err
}

func (s *subServer) handleProve(ctx context.Context, request *pb.ProveDeviceLinkDeviceRequest) (*pb.ProveDeviceLinkDeviceResponse, error) {
	status, err := s.service.Prove(ctx, request)
	return &pb.ProveDeviceLinkDeviceResponse{Status: status}, err
}

func (s *subServer) handleAccess(ctx context.Context, request *pb.SubmitDeviceLinkAccessActionRequest) (*pb.SubmitDeviceLinkAccessActionResponse, error) {
	status, err := s.service.Submit(ctx, request)
	return &pb.SubmitDeviceLinkAccessActionResponse{Status: status}, err
}

func (s *subServer) handleAcknowledge(ctx context.Context, request *pb.AcknowledgeDeviceLinkRequest) (*pb.AcknowledgeDeviceLinkResponse, error) {
	status, err := s.service.Acknowledge(ctx, request)
	return &pb.AcknowledgeDeviceLinkResponse{Status: status}, err
}
