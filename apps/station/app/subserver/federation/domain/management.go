package domain

import (
	"context"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

// ManagementPort is consumed only by the authenticated Dashboard control plane.
// Federation retains ledger policy, signer selection and all persistence.
type ManagementPort interface {
	ListManagedFederations(context.Context) (*pb.ListFederationsResponse, error)
	ListManagedStations(context.Context, *pb.ListMemberStationsRequest) (*pb.ListMemberStationsResponse, error)
	CreateFederation(context.Context, *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error)
	JoinFederation(context.Context, *pb.JoinFederationRequest) (*pb.JoinFederationResponse, error)
	LeaveFederation(context.Context, *pb.LeaveFederationRequest) (*pb.LeaveFederationResponse, error)
	DeleteFederation(context.Context, *pb.DeleteFederationRequest) (*pb.DeleteFederationResponse, error)
}
