package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type EndpointManifestService struct {
	repository   messaging.EndpointManifestRepository
	devices      messaging.DeviceDirectory
	signer       messaging.EndpointManifestSigner
	remote       messaging.RemoteEndpointManifestFetcher
	localStation string
	clock        func() time.Time
}

func NewEndpointManifestService(
	repository messaging.EndpointManifestRepository,
	devices messaging.DeviceDirectory,
	signer messaging.EndpointManifestSigner,
	remote messaging.RemoteEndpointManifestFetcher,
	localStation string,
	clock func() time.Time,
) (*EndpointManifestService, error) {
	if repository == nil ||
		devices == nil ||
		signer == nil ||
		remote == nil ||
		strings.TrimSpace(localStation) == "" ||
		clock == nil {
		return nil, fmt.Errorf("messaging: endpoint manifest service dependencies are invalid")
	}
	return &EndpointManifestService{
		repository:   repository,
		devices:      devices,
		signer:       signer,
		remote:       remote,
		localStation: localStation,
		clock:        clock,
	}, nil
}

func (s *EndpointManifestService) ResolveEndpointManifest(
	ctx context.Context,
	actorPTID string,
) (*chat.FederatedEndpointManifest, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	homeStationID, err := s.devices.ActorHomeStationID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStation {
		cached, cacheErr := s.repository.ListVerifiedManifests(
			ctx,
			[]string{actorPTID},
			s.clock().UTC(),
		)
		if cacheErr == nil {
			if len(cached) != 1 || cached[0].HomeStationId != homeStationID {
				return nil, messaging.ErrEndpointManifestConflict
			}
			return cached[0], nil
		}
		if !errors.Is(cacheErr, messaging.ErrEndpointManifestExpired) &&
			!errors.Is(cacheErr, messaging.ErrNotFound) {
			return nil, cacheErr
		}
		return s.remote.FetchEndpointManifest(ctx, homeStationID, actorPTID)
	}
	return s.BuildLocalEndpointManifest(ctx, actorPTID)
}

func (s *EndpointManifestService) BuildLocalEndpointManifest(
	ctx context.Context,
	actorPTID string,
) (*chat.FederatedEndpointManifest, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	homeStationID, err := s.devices.ActorHomeStationID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStation {
		return nil, messaging.ErrNotFound
	}
	manifest, err := s.repository.BuildLocalManifestSnapshot(
		ctx,
		actorPTID,
		s.localStation,
		s.clock().UTC(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.signer.SignEndpointManifest(ctx, manifest); err != nil {
		return nil, err
	}
	manifestBytes, manifestHash, err := EndpointManifestSHA256(manifest)
	if err != nil {
		return nil, err
	}
	if err := s.repository.SaveVerifiedManifest(
		ctx,
		manifest,
		manifestBytes,
		manifestHash,
	); err != nil {
		return nil, err
	}
	return manifest, nil
}

var _ messaging.EndpointManifestResolver = (*EndpointManifestService)(nil)
