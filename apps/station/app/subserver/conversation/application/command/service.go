package command

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const (
	defaultAuthorityPlanTTL    = 5 * time.Minute
	maxAuthorityPlanTTL        = 5 * time.Minute
	maxLeaveIntentTTL          = 15 * time.Minute
	maxCommandProposalLifetime = 5 * time.Minute
	leaveIntentVersion         = uint32(1)
	commandProposalVersion     = uint32(1)
	commandProposalScope       = "conversation-command-proposal"
)

type Service struct {
	unitOfWork      ports.UnitOfWork
	localStation    valueobject.StationID
	clock           ports.Clock
	idGenerator     ports.IDGenerator
	stateEncoder    ports.ConversationStateEncoder
	eventEncoder    ports.DeviceEventEncoder
	cursorEncoder   ports.ReadCursorEncoder
	leaveEncoder    ports.LeaveIntentSigningEncoder
	proposalEncoder ports.CommandProposalSigningEncoder
	postCommit      ports.PostCommitPublisher
	eventSealer     domainevent.Sealer
}

func NewService(
	unitOfWork ports.UnitOfWork,
	localStation valueobject.StationID,
	clock ports.Clock,
	idGenerator ports.IDGenerator,
	stateEncoder ports.ConversationStateEncoder,
	eventEncoder ports.DeviceEventEncoder,
	cursorEncoder ports.ReadCursorEncoder,
	leaveEncoder ports.LeaveIntentSigningEncoder,
	proposalEncoder ports.CommandProposalSigningEncoder,
	postCommit ports.PostCommitPublisher,
	eventSealer domainevent.Sealer,
) (*Service, error) {
	if unitOfWork == nil || localStation == "" || clock == nil ||
		idGenerator == nil || stateEncoder == nil ||
		eventEncoder == nil || cursorEncoder == nil || leaveEncoder == nil ||
		proposalEncoder == nil || eventSealer == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.new_command_service",
			"dependencies",
			"unit of work, local Station, clock, ID generator, payload encoders, signing encoders, and event sealer are required",
		)
	}
	return &Service{
		unitOfWork:      unitOfWork,
		localStation:    localStation,
		clock:           clock,
		idGenerator:     idGenerator,
		stateEncoder:    stateEncoder,
		eventEncoder:    eventEncoder,
		cursorEncoder:   cursorEncoder,
		leaveEncoder:    leaveEncoder,
		proposalEncoder: proposalEncoder,
		postCommit:      postCommit,
		eventSealer:     eventSealer,
	}, nil
}

// BindUnitOfWork returns the same application service over an already-bound
// transaction view. This lets the shared Federation inbox own the outer
// transaction while Conversation retains all command invariants.
func (s *Service) BindUnitOfWork(unitOfWork ports.UnitOfWork) (*Service, error) {
	if s == nil || unitOfWork == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.bind_command_service",
			"unit_of_work",
			"is required",
		)
	}
	bound := *s
	bound.unitOfWork = unitOfWork

	return &bound, nil
}

// BindPostCommitPublisher replaces the publisher used after the bound unit of
// work completes. Federation receivers use this to defer wake hints until the
// shared inbox transaction commits.
func (s *Service) BindPostCommitPublisher(
	postCommit ports.PostCommitPublisher,
) (*Service, error) {
	if s == nil || postCommit == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.bind_post_commit_publisher",
			"post_commit",
			"is required",
		)
	}
	bound := *s
	bound.postCommit = postCommit

	return &bound, nil
}

type CreateDirectRequest struct {
	Creator           valueobject.Endpoint
	Peer              valueobject.PTID
	FederationID      valueobject.FederationID
	AuthorityEpoch    valueobject.AuthorityEpoch
	CommandID         valueobject.CommandID
	VerifiedRoutes    []ports.EndpointRoute
	ExactCommandBytes []byte
}

type CreateGroupRequest struct {
	ConversationID    valueobject.ConversationID
	Owner             valueobject.Endpoint
	VerifiedRoutes    []ports.EndpointRoute
	ManifestStateHash valueobject.Hash
	CommandID         valueobject.CommandID
	AuthorityPlanID   valueobject.PlanID
	AuthorityPlanHash valueobject.Hash
	Deliveries        []valueobject.PreparedDelivery
	ExactCommandBytes []byte
}

type SubmitRequest struct {
	Command           aggregate.Command
	Membership        *aggregate.MembershipTransition
	MemberAuthority   *aggregate.MemberAuthorityCommand
	Settings          *valueobject.SettingsPatch
	Dissolve          bool
	VerifiedRoutes    []ports.EndpointRoute
	ManifestStateHash valueobject.Hash
	AuthorityPlanID   valueobject.PlanID
	AuthorityPlanHash valueobject.Hash
	ExactCommandBytes []byte
}

type ForwardedCommandClaims struct {
	Scope          string
	Issuer         valueobject.StationID
	Audience       valueobject.StationID
	Subject        valueobject.PTID
	FederationID   valueobject.FederationID
	ConversationID valueobject.ConversationID
	CommandID      valueobject.CommandID
	CommandKind    domainevent.Kind
	DeviceID       valueobject.DeviceID
	SigningKeyID   string
	CommandHash    valueobject.Hash
	AuthorityEpoch valueobject.AuthorityEpoch
	ExpiresAt      time.Time
}

type ForwardedCommandRequest struct {
	Version          uint32
	FederationID     valueobject.FederationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	HomeStation      valueobject.StationID
	Actor            valueobject.Endpoint
	SigningKeyID     string
	CommandHash      valueobject.Hash
	Signature        []byte
	CreatedAt        time.Time
	ExpiresAt        time.Time
	Claims           ForwardedCommandClaims
	Command          SubmitRequest
}

type Result struct {
	Conversation    aggregate.Snapshot
	Event           domainevent.Record
	Replay          bool
	PostCommitError error
}

type PrepareMembershipRequest struct {
	ConversationID    valueobject.ConversationID
	Requester         valueobject.Endpoint
	Changes           []entity.MembershipChange
	VerifiedRoutes    []ports.EndpointRoute
	ManifestSetHash   valueobject.Hash
	ManifestStateHash valueobject.Hash
	TTL               time.Duration
}

type PrepareCommandRequest struct {
	ConversationID    valueobject.ConversationID
	Sender            valueobject.Endpoint
	SenderHomeStation valueobject.StationID
	VerifiedRoutes    []ports.EndpointRoute
	ActorScoped       bool
}

type PrepareGroupRequest struct {
	ConversationID    valueobject.ConversationID
	FederationID      valueobject.FederationID
	AuthorityEpoch    valueobject.AuthorityEpoch
	Name              string
	Owner             valueobject.Endpoint
	Members           []valueobject.PTID
	VerifiedRoutes    []ports.EndpointRoute
	ManifestSetHash   valueobject.Hash
	ManifestStateHash valueobject.Hash
	TTL               time.Duration
}

func (s *Service) PrepareGroup(
	ctx context.Context,
	request PrepareGroupRequest,
) (entity.AuthorityPlan, error) {
	if request.ConversationID == "" ||
		request.Owner.Validate() != nil ||
		request.ManifestSetHash.IsZero() ||
		request.ManifestStateHash.IsZero() {
		return entity.AuthorityPlan{}, invalid(
			"application.prepare_group",
			"request",
			"conversation and owner are required",
		)
	}
	if request.FederationID == "" || request.AuthorityEpoch == 0 {
		return entity.AuthorityPlan{}, invalid(
			"application.prepare_group",
			"authority_scope",
			"federation and authority epoch are required",
		)
	}
	ttl, err := authorityPlanTTL(request.TTL)
	if err != nil {
		return entity.AuthorityPlan{}, err
	}
	actors := uniqueActors(append(append([]valueobject.PTID(nil), request.Members...), request.Owner.Actor))
	var prepared entity.AuthorityPlan
	err = s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := validateTransaction(transaction); err != nil {
			return err
		}
		if _, err := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			request.ConversationID,
		); err == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"application.prepare_group",
				"conversation_id",
				"already exists",
			)
		} else if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			return err
		}
		routes, err := canonicalActorRoutes(request.VerifiedRoutes, actors)
		if err != nil {
			return err
		}
		ownerActive, err := transaction.Identity.IsActive(ctx, request.Owner)
		if err != nil {
			return err
		}
		if !ownerActive {
			return unauthorized("application.prepare_group", "owner device is not active")
		}
		if !routeSetContains(routes, request.Owner) {
			return unauthorized(
				"application.prepare_group",
				"owner is absent from the verified endpoint routes",
			)
		}
		for _, station := range routeStations(routes) {
			federationActive, federationErr := transaction.Federation.IsActiveStation(
				ctx,
				request.FederationID,
				station,
			)
			if federationErr != nil {
				return federationErr
			}
			if !federationActive {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeFederationInactive,
					"application.prepare_group",
					"home_station",
					"is not an active Federation Station",
				)
			}
		}
		postEndpoints := endpointsFromRoutes(routes)
		changes := genesisMembershipChanges(actors, request.Owner.Actor, routes)
		now := s.clock.Now()
		expiresAt := now.Add(ttl)
		planID := s.idGenerator.NewPlanID()
		reservationRoutes := make([]ports.EndpointRoute, 0, len(routes)-1)
		for _, route := range routes {
			if route.Endpoint != request.Owner {
				reservationRoutes = append(reservationRoutes, route)
			}
		}
		reservations, err := transaction.KeyPackageReservations.Reserve(
			ctx,
			planID,
			reservationRoutes,
			expiresAt,
		)
		if err != nil {
			return err
		}
		preview := aggregate.MembershipPreview{
			PostEndpoints:  postEndpoints,
			AddedEndpoints: postEndpoints,
		}
		planHash := authorityPlanHash(
			planID,
			request.ConversationID,
			request.FederationID,
			request.AuthorityEpoch,
			request.Owner,
			request.Name,
			preview,
			changes,
			reservations,
			expiresAt,
			request.ManifestSetHash,
			request.ManifestStateHash,
		)
		plan, err := entity.NewAuthorityPlan(entity.AuthorityPlan{
			ID:                        planID,
			ConversationID:            request.ConversationID,
			FederationID:              request.FederationID,
			AuthorityEpoch:            request.AuthorityEpoch,
			PreparedName:              request.Name,
			Requester:                 request.Owner,
			AuthorityHead:             valueobject.AuthorityHead{},
			Changes:                   changes,
			PostEndpoints:             postEndpoints,
			AddedEndpoints:            postEndpoints,
			EndpointManifestSetHash:   request.ManifestSetHash,
			EndpointManifestStateHash: request.ManifestStateHash,
			Hash:                      planHash,
			ExpiresAt:                 expiresAt,
			KeyPackageReservations:    reservations,
		})
		if err != nil {
			return err
		}
		if err := transaction.Repositories.AuthorityPlans.Create(ctx, *plan); err != nil {
			return err
		}
		prepared = *plan
		return nil
	})
	return prepared, err
}

func (s *Service) CreateDirect(
	ctx context.Context,
	request CreateDirectRequest,
) (Result, error) {
	return s.createDirect(ctx, request)
}

// EnsureDirect creates the deterministic Direct Conversation or returns the
// existing compatible aggregate. It is reserved for durable owner effects,
// whose idempotency is the deterministic Conversation identity rather than a
// client command receipt.
func (s *Service) EnsureDirect(
	ctx context.Context,
	request CreateDirectRequest,
) (Result, error) {
	return s.createDirect(ctx, request)
}

func (s *Service) createDirect(
	ctx context.Context,
	request CreateDirectRequest,
) (Result, error) {
	if request.Creator.Validate() != nil || request.Peer == "" ||
		request.FederationID == "" || request.AuthorityEpoch == 0 ||
		request.CommandID == "" || len(request.ExactCommandBytes) == 0 {
		return Result{}, invalid("application.create_direct", "request", "complete creation input is required")
	}
	conversationID, err := valueobject.DirectConversationID(request.Creator.Actor, request.Peer)
	if err != nil {
		return Result{}, err
	}
	commandHash := valueobject.HashBytes(request.ExactCommandBytes)
	var result Result
	var notifications []ports.CommittedDelivery
	err = s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(conversationID),
		func(transaction ports.Transaction) error {
			if err := validateTransaction(transaction); err != nil {
				return err
			}
			existing, loadErr := transaction.Repositories.Authority.LoadForUpdate(ctx, conversationID)
			switch {
			case loadErr == nil:
				_, receiptErr := transaction.Repositories.Receipts.Get(
					ctx,
					conversationID,
					request.CommandID,
				)
				switch {
				case receiptErr == nil:
					event, replayErr := replayCommittedCommand(
						ctx,
						transaction.Repositories,
						conversationID,
						request.CommandID,
						commandHash,
					)
					if replayErr != nil {
						return replayErr
					}
					result = Result{Conversation: existing, Event: event, Replay: true}

					return nil
				case !conversationdomain.IsCode(
					receiptErr,
					conversationdomain.ErrorCodeNotFound,
				):
					return receiptErr
				}
				if existing.AuthorityStation != s.localStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeCommandConflict,
						"application.create_direct",
						"authority_station",
						"does not match the local authority",
					)
				}
				if matchErr := validateExistingDirect(existing, request); matchErr != nil {
					return matchErr
				}
				result = Result{Conversation: existing, Replay: true}

				return nil
			case !conversationdomain.IsCode(loadErr, conversationdomain.ErrorCodeNotFound):
				return loadErr
			}
			follower, followerErr := transaction.Repositories.Followers.Get(
				ctx,
				conversationID,
			)
			switch {
			case followerErr == nil:
				if follower.Status != repository.FollowerStatusActive ||
					follower.Conversation.AuthorityStation == s.localStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeCommandConflict,
						"application.create_direct",
						"follower",
						"is not an active remote-authority projection",
					)
				}
				if matchErr := validateExistingDirect(
					follower.Conversation,
					request,
				); matchErr != nil {
					return matchErr
				}
				result = Result{
					Conversation: follower.Conversation,
					Replay:       true,
				}

				return nil
			case !conversationdomain.IsCode(
				followerErr,
				conversationdomain.ErrorCodeNotFound,
			):
				return followerErr
			}

			routes, routeErr := canonicalActorRoutes(
				request.VerifiedRoutes,
				[]valueobject.PTID{request.Creator.Actor, request.Peer},
			)
			if routeErr != nil {
				return routeErr
			}
			active, activeErr := transaction.Identity.IsActive(ctx, request.Creator)
			if activeErr != nil {
				return activeErr
			}
			if !active {
				return unauthorized(
					"application.create_direct",
					"creator is not an active local endpoint",
				)
			}
			if !routeSetContains(routes, request.Creator) {
				return unauthorized(
					"application.create_direct",
					"creator is absent from the verified endpoint routes",
				)
			}
			for _, station := range routeStations(routes) {
				federationActive, federationErr := transaction.Federation.IsActiveStation(
					ctx,
					request.FederationID,
					station,
				)
				if federationErr != nil {
					return federationErr
				}
				if !federationActive {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeFederationInactive,
						"application.create_direct",
						"home_station",
						"is not an active Federation Station",
					)
				}
			}
			participants, devices, buildErr := participantsAndDevices(
				[]valueobject.PTID{request.Creator.Actor, request.Peer},
				request.Creator.Actor,
				routes,
				1,
			)
			if buildErr != nil {
				return buildErr
			}
			deliveries, buildErr := s.creationDeliveries(
				conversationID,
				request.CommandID,
				routes,
			)
			if buildErr != nil {
				return buildErr
			}
			created, transition, createErr := aggregate.CreateDirect(aggregate.CreateInput{
				ID:               conversationID,
				Kind:             valueobject.ConversationKindDirect,
				FederationID:     request.FederationID,
				AuthorityStation: s.localStation,
				AuthorityEpoch:   request.AuthorityEpoch,
				Participants:     participants,
				Devices:          devices,
				CommandID:        request.CommandID,
				Creator:          request.Creator,
				Deliveries:       deliveries,
				EventPayload:     request.ExactCommandBytes,
				CreatedAt:        s.clock.Now(),
				EventSealer:      s.eventSealer,
			})
			if createErr != nil {
				return createErr
			}
			if persistErr := s.persistTransition(
				ctx,
				transaction,
				created,
				transition,
				request.CommandID,
				commandHash,
				s.localStation,
			); persistErr != nil {
				return persistErr
			}
			notifications = committedDeliveries(transition, s.localStation)
			result = Result{Conversation: created.Snapshot(), Event: transition.Event}
			return nil
		},
	)
	if err != nil {
		return Result{}, err
	}
	result.PostCommitError = s.notify(ctx, notifications)
	return result, nil
}

func validateExistingDirect(
	snapshot aggregate.Snapshot,
	request CreateDirectRequest,
) error {
	activeActors := make(map[valueobject.PTID]struct{}, len(snapshot.Members))
	for _, member := range snapshot.Members {
		if member.Active() {
			activeActors[member.Actor] = struct{}{}
		}
	}
	_, hasCreator := activeActors[request.Creator.Actor]
	_, hasPeer := activeActors[request.Peer]
	if snapshot.Kind != valueobject.ConversationKindDirect ||
		snapshot.Status != valueobject.ConversationStatusActive ||
		snapshot.FederationID != request.FederationID ||
		snapshot.AuthorityStation == "" ||
		snapshot.AuthorityEpoch != request.AuthorityEpoch ||
		len(snapshot.Members) != 2 ||
		len(activeActors) != 2 ||
		!hasCreator ||
		!hasPeer {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.ensure_direct",
			"conversation",
			"does not match the requested Direct Conversation",
		)
	}

	return nil
}

func conversationGenesisLockKey(
	conversationID valueobject.ConversationID,
) string {
	return "conversation-genesis:" + string(conversationID)
}

// ReplayGroupCreation resolves an existing exact command receipt without
// requiring a fresh remote endpoint-manifest lookup.
func (s *Service) ReplayGroupCreation(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	exactCommandBytes []byte,
) (Result, bool, error) {
	if conversationID == "" || commandID == "" || len(exactCommandBytes) == 0 {
		return Result{}, false, invalid(
			"application.replay_group_creation",
			"request",
			"conversation, command, and exact bytes are required",
		)
	}
	commandHash := valueobject.HashBytes(exactCommandBytes)
	var result Result
	var replayed bool
	err := s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(conversationID),
		func(transaction ports.Transaction) error {
			if err := validateTransaction(transaction); err != nil {
				return err
			}
			var replayErr error
			result, replayed, replayErr = resolveGroupCreationReceipt(
				ctx,
				transaction.Repositories,
				conversationID,
				commandID,
				commandHash,
			)
			return replayErr
		},
	)
	if err != nil {
		return Result{}, replayed, err
	}
	return result, replayed, nil
}

func (s *Service) CreateGroup(
	ctx context.Context,
	request CreateGroupRequest,
) (Result, error) {
	if request.ConversationID == "" || request.Owner.Validate() != nil ||
		request.CommandID == "" || request.AuthorityPlanID == "" ||
		request.AuthorityPlanHash.IsZero() ||
		request.ManifestStateHash.IsZero() ||
		len(request.ExactCommandBytes) == 0 {
		return Result{}, invalid("application.create_group", "request", "complete group input is required")
	}
	commandHash := valueobject.HashBytes(request.ExactCommandBytes)
	var result Result
	var notifications []ports.CommittedDelivery
	var rejection error
	err := s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(request.ConversationID),
		func(transaction ports.Transaction) error {
			if err := validateTransaction(transaction); err != nil {
				return err
			}
			replayedResult, replayed, replayErr := resolveGroupCreationReceipt(
				ctx,
				transaction.Repositories,
				request.ConversationID,
				request.CommandID,
				commandHash,
			)
			if replayErr != nil {
				return replayErr
			}
			if replayed {
				result = replayedResult
				return nil
			}
			persistRejection := func(candidate error, at time.Time) error {
				code := conversationdomain.CodeOf(candidate)
				if code == "" {
					return candidate
				}
				rejection = candidate
				if !terminalCommandRejection(code) {
					return nil
				}
				if err := transaction.Repositories.Receipts.Create(
					ctx,
					repository.CommandReceipt{
						ConversationID: request.ConversationID,
						CommandID:      request.CommandID,
						CommandHash:    commandHash,
						Outcome:        repository.CommandReceiptOutcomeRejected,
						RejectionCode:  code,
						CreatedAt:      at,
					},
				); err != nil {
					return err
				}
				return nil
			}
			if existing, loadErr := transaction.Repositories.Authority.LoadForUpdate(
				ctx,
				request.ConversationID,
			); loadErr == nil {
				event, replayErr := replayCommittedCommand(
					ctx,
					transaction.Repositories,
					request.ConversationID,
					request.CommandID,
					commandHash,
				)
				if replayErr != nil {
					plan, planErr := transaction.Repositories.AuthorityPlans.LoadForUpdate(
						ctx,
						request.AuthorityPlanID,
					)
					if planErr != nil {
						if !conversationdomain.IsCode(planErr, conversationdomain.ErrorCodeNotFound) {
							return planErr
						}
						return persistRejection(replayErr, s.clock.Now())
					}
					rejectedAt := s.clock.Now()
					if plan.State == entity.AuthorityPlanStatePrepared &&
						plan.ConversationID == request.ConversationID &&
						plan.Requester == request.Owner {
						if supersedeErr := supersedePlan(
							ctx,
							transaction,
							&plan,
							rejectedAt,
						); supersedeErr != nil {
							return supersedeErr
						}
					}
					return persistRejection(replayErr, rejectedAt)
				}
				result = Result{Conversation: existing, Event: event, Replay: true}
				return nil
			} else if !conversationdomain.IsCode(loadErr, conversationdomain.ErrorCodeNotFound) {
				return loadErr
			}
			plan, planErr := transaction.Repositories.AuthorityPlans.LoadForUpdate(
				ctx,
				request.AuthorityPlanID,
			)
			if planErr != nil {
				return planErr
			}
			now := s.clock.Now()
			if plan.Requester != request.Owner {
				return persistRejection(
					unauthorized(
						"application.create_group",
						"authority plan belongs to a different requester",
					),
					now,
				)
			}
			if plan.ConversationID != request.ConversationID ||
				!bytes.Equal(plan.Hash[:], request.AuthorityPlanHash[:]) {
				if supersedeErr := supersedePlan(ctx, transaction, &plan, now); supersedeErr != nil {
					return supersedeErr
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanStale,
					"application.create_group",
					"authority_plan",
					"does not match the group request",
				)
				return persistRejection(rejection, now)
			}
			if !plan.ExpiresAt.After(now) {
				if expireErr := expirePlan(
					ctx,
					transaction,
					&plan,
					now,
				); expireErr != nil {
					return expireErr
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanExpired,
					"application.create_group",
					"authority_plan",
					"has expired",
				)
				return persistRejection(rejection, now)
			}
			verifiedPlanHash := authorityPlanHash(
				plan.ID,
				plan.ConversationID,
				plan.FederationID,
				plan.AuthorityEpoch,
				plan.Requester,
				plan.PreparedName,
				aggregate.MembershipPreview{
					PreEndpoints:     plan.PreEndpoints,
					PostEndpoints:    plan.PostEndpoints,
					AddedEndpoints:   plan.AddedEndpoints,
					RemovedEndpoints: plan.RemovedEndpoints,
				},
				plan.Changes,
				plan.KeyPackageReservations,
				plan.ExpiresAt,
				plan.EndpointManifestSetHash,
				plan.EndpointManifestStateHash,
			)
			if verifiedPlanHash != plan.Hash {
				if supersedeErr := supersedePlan(ctx, transaction, &plan, now); supersedeErr != nil {
					return supersedeErr
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanStale,
					"application.create_group",
					"endpoint_manifest",
					"does not match the prepared authority plan",
				)
				return persistRejection(rejection, now)
			}
			if request.ManifestStateHash != plan.EndpointManifestStateHash {
				if supersedeErr := supersedePlan(ctx, transaction, &plan, now); supersedeErr != nil {
					return supersedeErr
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanStale,
					"application.create_group",
					"endpoint_manifest",
					"active directory state changed after preparation",
				)
				return persistRejection(rejection, now)
			}
			actors := genesisActors(plan.Changes)
			routes, routeErr := canonicalActorRoutes(request.VerifiedRoutes, actors)
			if routeErr != nil {
				return routeErr
			}
			ownerActive, activeErr := transaction.Identity.IsActive(ctx, request.Owner)
			if activeErr != nil {
				return activeErr
			}
			if !ownerActive {
				return unauthorized(
					"application.create_group",
					"owner device is not active",
				)
			}
			for _, station := range routeStations(routes) {
				federationActive, federationErr := transaction.Federation.IsActiveStation(
					ctx,
					plan.FederationID,
					station,
				)
				if federationErr != nil {
					return federationErr
				}
				if !federationActive {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeFederationInactive,
						"application.create_group",
						"home_station",
						"is not an active Federation Station",
					)
				}
			}
			if !routeSetContains(routes, request.Owner) ||
				!membershipChangesMatchRoutes(plan.Changes, aggregate.Snapshot{}, routes) ||
				!valueobject.EqualEndpointSets(plan.PostEndpoints, endpointsFromRoutes(routes)) {
				if supersedeErr := supersedePlan(ctx, transaction, &plan, now); supersedeErr != nil {
					return supersedeErr
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanStale,
					"application.create_group",
					"authority_plan",
					"endpoint snapshot is stale",
				)
				return persistRejection(rejection, now)
			}
			deliveries, routeErr := bindDeliveryRoutes(request.Deliveries, routes)
			if routeErr != nil {
				return persistRejection(routeErr, now)
			}
			participants, devices, buildErr := participantsAndDevices(
				actors,
				request.Owner.Actor,
				routes,
				1,
			)
			if buildErr != nil {
				return persistRejection(buildErr, now)
			}
			created, transition, createErr := aggregate.CreateGroup(aggregate.CreateInput{
				ID:               request.ConversationID,
				Kind:             valueobject.ConversationKindGroup,
				FederationID:     plan.FederationID,
				AuthorityStation: s.localStation,
				AuthorityEpoch:   plan.AuthorityEpoch,
				Owner:            request.Owner.Actor,
				Participants:     participants,
				Devices:          devices,
				Settings:         valueobject.ConversationSettings{Name: plan.PreparedName},
				CommandID:        request.CommandID,
				Creator:          request.Owner,
				Deliveries:       deliveries,
				EventPayload:     request.ExactCommandBytes,
				CreatedAt:        now,
				EventSealer:      s.eventSealer,
			})
			if createErr != nil {
				return persistRejection(createErr, now)
			}
			if consumeErr := plan.Consume(request.AuthorityPlanHash, now); consumeErr != nil {
				return persistRejection(consumeErr, now)
			}
			if saveErr := transaction.Repositories.AuthorityPlans.Save(ctx, plan); saveErr != nil {
				return saveErr
			}
			if consumeErr := transaction.KeyPackageReservations.Consume(
				ctx,
				plan.KeyPackageReservations,
				now,
			); consumeErr != nil {
				return consumeErr
			}
			if persistErr := s.persistTransition(
				ctx,
				transaction,
				created,
				transition,
				request.CommandID,
				commandHash,
				s.localStation,
			); persistErr != nil {
				return persistErr
			}
			notifications = committedDeliveries(transition, s.localStation)
			result = Result{Conversation: created.Snapshot(), Event: transition.Event}
			return nil
		},
	)
	if err != nil {
		return Result{}, err
	}
	if rejection != nil {
		return Result{}, rejection
	}
	result.PostCommitError = s.notify(ctx, notifications)
	return result, nil
}

func resolveGroupCreationReceipt(
	ctx context.Context,
	repositories repository.Repositories,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	commandHash valueobject.Hash,
) (Result, bool, error) {
	receipt, err := repositories.Receipts.Get(ctx, conversationID, commandID)
	if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, err
	}
	if !bytes.Equal(receipt.CommandHash[:], commandHash[:]) {
		return Result{}, true, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.create_group",
			"command_id",
			"was resolved with different exact bytes",
		)
	}
	switch receipt.Outcome {
	case repository.CommandReceiptOutcomeAccepted:
		existing, loadErr := repositories.Authority.LoadForUpdate(
			ctx,
			conversationID,
		)
		if loadErr != nil {
			return Result{}, true, loadErr
		}
		event, eventErr := repositories.Events.GetByID(ctx, receipt.EventID)
		if eventErr != nil {
			return Result{}, true, eventErr
		}
		if receiptErr := validateCreationReceiptEvent(receipt, event); receiptErr != nil {
			return Result{}, true, receiptErr
		}
		return Result{
			Conversation: existing,
			Event:        event,
			Replay:       true,
		}, true, nil
	case repository.CommandReceiptOutcomeRejected:
		return Result{}, true, conversationdomain.NewError(
			receipt.RejectionCode,
			"application.create_group",
			"command_id",
			"was terminally rejected",
		)
	default:
		return Result{}, true, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.create_group",
			"receipt",
			"contains an unknown command outcome",
		)
	}
}

func (s *Service) CommandRouteActors(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	sender valueobject.PTID,
) ([]valueobject.PTID, error) {
	if conversationID == "" || sender == "" {
		return nil, invalid(
			"application.command_route_actors",
			"request",
			"conversation and sender are required",
		)
	}
	var actors []valueobject.PTID
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := validateTransaction(transaction); err != nil {
			return err
		}
		snapshot, err := transaction.Repositories.Authority.Get(ctx, conversationID)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		if snapshot.AuthorityStation != s.localStation {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"application.command_route_actors",
				"authority_station",
				"does not identify the local Conversation authority",
			)
		}
		if !conversation.IsActiveMember(sender) {
			return unauthorized(
				"application.command_route_actors",
				"sender is not an active Conversation member",
			)
		}
		actors = conversation.ActiveMemberActors()
		return nil
	})
	return actors, err
}

func (s *Service) PrepareCommand(
	ctx context.Context,
	request PrepareCommandRequest,
) (aggregate.CommandPreparation, error) {
	if request.ConversationID == "" ||
		request.Sender.Validate() != nil ||
		request.SenderHomeStation == "" {
		return aggregate.CommandPreparation{}, invalid(
			"application.prepare_command",
			"request",
			"conversation, sender, and sender Home Station are required",
		)
	}
	var preparation aggregate.CommandPreparation
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := validateTransaction(transaction); err != nil {
			return err
		}
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			request.ConversationID,
		)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		routes, err := commandRouteSnapshot(conversation, request.VerifiedRoutes)
		if err != nil {
			return err
		}
		if err := s.authorizeCommandSender(
			ctx,
			transaction,
			conversation,
			request.Sender,
			request.SenderHomeStation,
			routes,
		); err != nil {
			return err
		}
		required := eligibleConversationEndpoints(conversation, routes)
		if request.ActorScoped {
			required = filterEndpointsForActor(required, request.Sender.Actor)
		}
		preparation, err = conversation.PrepareCommand(request.Sender, required)
		return err
	})
	return preparation, err
}

func (s *Service) PrepareMembership(
	ctx context.Context,
	request PrepareMembershipRequest,
) (entity.AuthorityPlan, error) {
	if request.ConversationID == "" || request.Requester.Validate() != nil ||
		len(request.Changes) == 0 ||
		request.ManifestSetHash.IsZero() ||
		request.ManifestStateHash.IsZero() {
		return entity.AuthorityPlan{}, invalid(
			"application.prepare_membership",
			"request",
			"conversation, requester, changes, and endpoint manifests are required",
		)
	}
	ttl, err := authorityPlanTTL(request.TTL)
	if err != nil {
		return entity.AuthorityPlan{}, err
	}
	var prepared entity.AuthorityPlan
	err = s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := validateTransaction(transaction); err != nil {
			return err
		}
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			request.ConversationID,
		)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		active, err := transaction.Identity.IsActive(ctx, request.Requester)
		if err != nil {
			return err
		}
		if !active {
			return unauthorized("application.prepare_membership", "requester device is not active")
		}
		planActors := append(conversation.ActiveMemberActors(), request.Requester.Actor)
		for _, change := range request.Changes {
			planActors = append(planActors, change.Actor)
		}
		routes, err := canonicalActorRoutes(request.VerifiedRoutes, planActors)
		if err != nil {
			return err
		}
		routes, err = addRemovalRoutes(snapshot, request.Changes, routes)
		if err != nil {
			return err
		}
		changes, err := canonicalizeMembershipChanges(snapshot, request.Changes, routes)
		if err != nil {
			return err
		}
		preview, err := conversation.PreviewMembership(request.Requester, changes)
		if err != nil {
			return err
		}
		preview.PreEndpoints = filterEndpointsByRoutes(preview.PreEndpoints, routes)
		preview.PostEndpoints = filterEndpointsByRoutes(preview.PostEndpoints, routes)
		preview.AddedEndpoints = endpointDifference(preview.PostEndpoints, preview.PreEndpoints)
		preview.RemovedEndpoints = endpointDifference(preview.PreEndpoints, preview.PostEndpoints)
		now := s.clock.Now()
		planID := s.idGenerator.NewPlanID()
		expiresAt := now.Add(ttl)
		reservations, err := transaction.KeyPackageReservations.Reserve(
			ctx,
			planID,
			filterRoutesByEndpoints(routes, preview.AddedEndpoints),
			expiresAt,
		)
		if err != nil {
			return err
		}
		planHash := authorityPlanHash(
			planID,
			request.ConversationID,
			snapshot.FederationID,
			snapshot.AuthorityEpoch,
			request.Requester,
			"",
			preview,
			changes,
			reservations,
			expiresAt,
			request.ManifestSetHash,
			request.ManifestStateHash,
		)
		plan, err := entity.NewAuthorityPlan(entity.AuthorityPlan{
			ID:                        planID,
			ConversationID:            request.ConversationID,
			FederationID:              snapshot.FederationID,
			AuthorityEpoch:            snapshot.AuthorityEpoch,
			Requester:                 request.Requester,
			AuthorityHead:             preview.Head,
			Changes:                   changes,
			PreEndpoints:              preview.PreEndpoints,
			PostEndpoints:             preview.PostEndpoints,
			AddedEndpoints:            preview.AddedEndpoints,
			RemovedEndpoints:          preview.RemovedEndpoints,
			EndpointManifestSetHash:   request.ManifestSetHash,
			EndpointManifestStateHash: request.ManifestStateHash,
			Hash:                      planHash,
			ExpiresAt:                 expiresAt,
			KeyPackageReservations:    reservations,
		})
		if err != nil {
			return err
		}
		if err := transaction.Repositories.AuthorityPlans.Create(ctx, *plan); err != nil {
			return err
		}
		prepared = *plan
		return nil
	})
	return prepared, err
}

func (s *Service) Submit(ctx context.Context, request SubmitRequest) (Result, error) {
	return s.submit(ctx, nil, request)
}

func (s *Service) submit(
	ctx context.Context,
	forwarded *ForwardedCommandRequest,
	request SubmitRequest,
) (Result, error) {
	if request.Command.ID == "" || len(request.ExactCommandBytes) == 0 ||
		!bytes.Equal(request.Command.Payload, request.ExactCommandBytes) {
		return Result{}, invalid("application.submit", "request", "command identity and exact bytes are required")
	}
	commandHash := valueobject.HashBytes(request.ExactCommandBytes)
	var proposalSigningBytes []byte
	var forwardedPreflightErr error
	if forwarded != nil {
		var err error
		proposalSigningBytes, err = s.validateForwardedRequest(*forwarded, commandHash)
		if err != nil {
			return Result{}, err
		}
		forwardedPreflightErr = s.validateForwardedFreshness(*forwarded)
	}
	var result Result
	var notifications []ports.CommittedDelivery
	var rejection error
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := validateTransaction(transaction); err != nil {
			return err
		}
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			request.Command.ConversationID,
		)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		var forwardedVerification ports.DeviceSignatureVerification
		if forwarded != nil {
			if snapshot.FederationID != forwarded.FederationID ||
				snapshot.AuthorityStation != forwarded.AuthorityStation ||
				snapshot.AuthorityEpoch != forwarded.AuthorityEpoch {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"application.submit_forwarded",
					"authority_scope",
					"does not match the Conversation authority",
				)
			}
			forwardedVerification, err = transaction.Identity.VerifyDeviceSignature(
				ctx,
				forwarded.Actor,
				forwarded.SigningKeyID,
				proposalSigningBytes,
				forwarded.Signature,
			)
			if err != nil {
				return err
			}
		}
		replayResult, replayed, replayErr := resolveCommandReceipt(
			ctx,
			transaction.Repositories,
			snapshot,
			request.Command.ID,
			commandHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed {
			result = replayResult
			return nil
		}
		if forwarded != nil && forwardedVerification.KeyRevoked {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyRevoked,
				"application.submit_forwarded",
				"actor_signing_key",
				"is revoked",
			)
		}
		persistRejection := func(candidate error) error {
			code := conversationdomain.CodeOf(candidate)
			if code == "" {
				return candidate
			}
			rejection = candidate
			if !terminalCommandRejection(code) {
				return nil
			}
			if err := transaction.Repositories.Receipts.Create(
				ctx,
				repository.CommandReceipt{
					ConversationID: conversation.ID(),
					CommandID:      request.Command.ID,
					CommandHash:    commandHash,
					Outcome:        repository.CommandReceiptOutcomeRejected,
					RejectionCode:  code,
					CreatedAt:      s.clock.Now(),
				},
			); err != nil {
				return err
			}
			return nil
		}
		if forwarded != nil {
			if forwardedPreflightErr != nil {
				return forwardedPreflightErr
			}
			if freshnessErr := s.validateForwardedFreshness(*forwarded); freshnessErr != nil {
				return freshnessErr
			}
			federationActive, err := transaction.Federation.IsActiveStation(
				ctx,
				forwarded.FederationID,
				forwarded.HomeStation,
			)
			if err != nil {
				return err
			}
			if !federationActive {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeFederationInactive,
					"application.submit_forwarded",
					"home_station",
					"is not an active Federation Station",
				)
			}
		}
		var commandRoutes []ports.EndpointRoute
		switch {
		case request.Membership == nil:
			commandRoutes, err = commandRouteSnapshot(
				conversation,
				request.VerifiedRoutes,
			)
			if err != nil {
				return err
			}
			senderHomeStation := s.localStation
			if forwarded != nil {
				senderHomeStation = forwarded.HomeStation
			}
			if err := s.authorizeCommandSender(
				ctx,
				transaction,
				conversation,
				request.Command.Sender,
				senderHomeStation,
				commandRoutes,
			); err != nil {
				if forwarded != nil {
					return err
				}
				return persistRejection(err)
			}
		default:
			active, activeErr := transaction.Identity.IsActive(
				ctx,
				request.Command.Sender,
			)
			if activeErr != nil {
				return activeErr
			}
			if !active {
				inactiveErr := unauthorized(
					"application.submit",
					"sender device is not active",
				)
				if forwarded != nil {
					return inactiveErr
				}
				return persistRejection(inactiveErr)
			}
			if forwarded != nil {
				routes, routeErr := resolveActorRoutes(
					ctx,
					transaction.Identity,
					[]valueobject.PTID{request.Command.Sender.Actor},
				)
				if routeErr != nil {
					return routeErr
				}
				if !routeSetContainsAtStation(
					routes,
					request.Command.Sender,
					forwarded.HomeStation,
				) {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeProposalBinding,
						"application.submit_forwarded",
						"home_station",
						"sender endpoint does not belong to the authenticated Home Station",
					)
				}
			}
		}
		var transition aggregate.Transition
		switch {
		case request.Membership != nil:
			transition, rejection, err = s.applyMembership(
				ctx,
				transaction,
				conversation,
				request,
			)
			if err != nil {
				return persistRejection(err)
			}
			if rejection != nil {
				return persistRejection(rejection)
			}
		case request.MemberAuthority != nil:
			memberCommand := *request.MemberAuthority
			memberCommand.Command = request.Command
			memberCommand.Command.EventSealer = s.eventSealer
			memberCommand.Command.RequiredEndpoints = eligibleConversationEndpoints(
				conversation,
				commandRoutes,
			)
			memberCommand.Command.Deliveries, err = bindDeliveryRoutes(
				memberCommand.Command.Deliveries,
				commandRoutes,
			)
			if err != nil {
				return persistRejection(err)
			}
			transition, err = conversation.ApplyMemberAuthority(memberCommand)
			if err != nil {
				return persistRejection(err)
			}
		default:
			if err := validateMessageCommand(
				ctx,
				transaction.Repositories.Events,
				request.Command,
			); err != nil {
				return persistRejection(err)
			}
			command := request.Command
			command.EventSealer = s.eventSealer
			command.RequiredEndpoints = eligibleConversationEndpoints(
				conversation,
				commandRoutes,
			)
			command.Deliveries, err = bindDeliveryRoutes(
				command.Deliveries,
				commandRoutes,
			)
			if err != nil {
				return persistRejection(err)
			}
			switch {
			case request.Settings != nil:
				transition, err = conversation.UpdateSettings(aggregate.SettingsCommand{
					Command: command,
					Patch:   *request.Settings,
				})
			case request.Dissolve:
				transition, err = conversation.Dissolve(aggregate.DissolveCommand{Command: command})
			default:
				transition, err = conversation.ApplyCommand(command)
			}
			if err != nil {
				return persistRejection(err)
			}
		}
		if err := s.persistTransition(
			ctx,
			transaction,
			conversation,
			transition,
			request.Command.ID,
			commandHash,
			s.localStation,
		); err != nil {
			return err
		}
		notifications = committedDeliveries(transition, s.localStation)
		result = Result{Conversation: conversation.Snapshot(), Event: transition.Event}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	if rejection != nil {
		return Result{}, rejection
	}
	result.PostCommitError = s.notify(ctx, notifications)
	return result, nil
}

func (s *Service) SubmitForwarded(
	ctx context.Context,
	request ForwardedCommandRequest,
) (Result, error) {
	return s.submit(ctx, &request, request.Command)
}

func (s *Service) validateForwardedRequest(
	request ForwardedCommandRequest,
	commandHash valueobject.Hash,
) ([]byte, error) {
	if request.Version != commandProposalVersion ||
		request.FederationID == "" ||
		request.AuthorityStation == "" ||
		request.AuthorityEpoch == 0 ||
		request.HomeStation == "" ||
		request.Actor.Validate() != nil ||
		request.SigningKeyID == "" ||
		request.CommandHash.IsZero() ||
		len(request.Signature) == 0 ||
		request.CreatedAt.IsZero() ||
		request.ExpiresAt.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"application.submit_forwarded",
			"proposal",
			"complete signed proposal is required",
		)
	}
	if !forwardableCommandKind(request.Command.Command.Kind) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"application.submit_forwarded",
			"command_kind",
			"is not a durable forwarded command",
		)
	}
	if request.CommandHash != commandHash ||
		request.Command.Command.Sender != request.Actor ||
		request.Command.Command.AuthorityStation != request.AuthorityStation {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"application.submit_forwarded",
			"command",
			"does not match the signed proposal",
		)
	}
	createdAt := request.CreatedAt.UTC()
	expiresAt := request.ExpiresAt.UTC()
	if !expiresAt.After(createdAt) ||
		expiresAt.Sub(createdAt) > maxCommandProposalLifetime {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"application.submit_forwarded",
			"time_window",
			"signed proposal time window is invalid",
		)
	}
	if !forwardedClaimsMatch(request, commandHash) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"application.submit_forwarded",
			"station_claims",
			"do not match the signed proposal",
		)
	}
	signingBytes, err := s.proposalEncoder.EncodeCommandProposalSigningInput(
		ports.CommandProposalSigningInput{
			Version:             request.Version,
			FederationID:        request.FederationID,
			AuthorityStation:    request.AuthorityStation,
			AuthorityEpoch:      request.AuthorityEpoch,
			HomeStation:         request.HomeStation,
			ConversationID:      request.Command.Command.ConversationID,
			CommandID:           request.Command.Command.ID,
			CommandKind:         request.Command.Command.Kind,
			Actor:               request.Actor,
			SigningKeyID:        request.SigningKeyID,
			CommandHash:         request.CommandHash,
			CreatedAtUnixMillis: createdAt.UnixMilli(),
			ExpiresAtUnixMillis: expiresAt.UnixMilli(),
		},
	)
	if err != nil {
		return nil, err
	}
	return signingBytes, nil
}

func (s *Service) validateForwardedFreshness(request ForwardedCommandRequest) error {
	now := s.clock.Now()
	if !request.ExpiresAt.After(now) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalExpired,
			"application.submit_forwarded",
			"expires_at",
			"signed proposal has expired",
		)
	}
	if request.CreatedAt.After(now.Add(30 * time.Second)) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"application.submit_forwarded",
			"created_at",
			"signed proposal is too far in the future",
		)
	}
	return nil
}

func forwardedClaimsMatch(
	request ForwardedCommandRequest,
	commandHash valueobject.Hash,
) bool {
	claims := request.Claims
	return claims.Scope == commandProposalScope &&
		claims.Issuer == request.HomeStation &&
		claims.Audience == request.AuthorityStation &&
		claims.Subject == request.Actor.Actor &&
		claims.FederationID == request.FederationID &&
		claims.ConversationID == request.Command.Command.ConversationID &&
		claims.CommandID == request.Command.Command.ID &&
		claims.CommandKind == request.Command.Command.Kind &&
		claims.DeviceID == request.Actor.Device &&
		claims.SigningKeyID == request.SigningKeyID &&
		claims.CommandHash == commandHash &&
		claims.AuthorityEpoch == request.AuthorityEpoch &&
		claims.ExpiresAt.UTC().Equal(request.ExpiresAt.UTC())
}

func forwardableCommandKind(kind domainevent.Kind) bool {
	switch kind {
	case domainevent.KindMessageCommitted,
		domainevent.KindMessageForwarded,
		domainevent.KindMessageEdited,
		domainevent.KindMessageRetracted,
		domainevent.KindMessageHiddenForActor,
		domainevent.KindMessageModerated,
		domainevent.KindConversationDissolved,
		domainevent.KindConversationSettings,
		domainevent.KindReactionCommitted,
		domainevent.KindMessagePinCommitted,
		domainevent.KindMembershipCommitted,
		domainevent.KindMemberAuthority:
		return true
	default:
		return false
	}
}

func (s *Service) applyMembership(
	ctx context.Context,
	transaction ports.Transaction,
	conversation *aggregate.Conversation,
	request SubmitRequest,
) (aggregate.Transition, error, error) {
	plan, err := transaction.Repositories.AuthorityPlans.LoadForUpdate(
		ctx,
		request.AuthorityPlanID,
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	now := s.clock.Now()
	if plan.Requester != request.Command.Sender {
		return aggregate.Transition{}, nil, unauthorized(
			"application.submit_membership",
			"authority plan belongs to a different requester",
		)
	}
	if plan.ConversationID != conversation.ID() ||
		plan.FederationID != conversation.FederationID() ||
		plan.AuthorityEpoch != conversation.AuthorityEpoch() ||
		!bytes.Equal(plan.Hash[:], request.AuthorityPlanHash[:]) {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"authority_plan",
			"does not match the command",
		), nil
	}
	if request.Membership.TransitionID == "" ||
		request.Membership.FromMembership != plan.AuthorityHead.MembershipEpoch ||
		request.Membership.FromMLS != plan.AuthorityHead.MLSEpoch ||
		request.Membership.ToMLS != plan.AuthorityHead.MLSEpoch.Next() ||
		!membershipChangesEqual(request.Membership.Changes, plan.Changes) {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"membership_transition",
			"does not match the prepared authority plan",
		), nil
	}
	if !plan.ExpiresAt.After(now) {
		if err := expirePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			"application.submit_membership",
			"authority_plan",
			"has expired",
		), nil
	}
	if plan.AuthorityHead != conversation.AuthorityHead() {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"authority_plan",
			"authority head changed after preparation",
		), nil
	}
	if request.ManifestStateHash.IsZero() ||
		request.ManifestStateHash != plan.EndpointManifestStateHash {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"endpoint_manifest",
			"active directory state changed after preparation",
		), nil
	}
	currentRoutes, err := canonicalActorRoutes(
		filterRoutesByActors(
			request.VerifiedRoutes,
			conversation.ActiveMemberActors(),
		),
		conversation.ActiveMemberActors(),
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	transitionRoutes, err := addRemovalRoutes(
		conversation.Snapshot(),
		plan.Changes,
		currentRoutes,
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	currentEndpoints := eligibleConversationEndpoints(conversation, transitionRoutes)
	if !valueobject.EqualEndpointSets(plan.PreEndpoints, currentEndpoints) {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"authority_plan",
			"pre-transition endpoint snapshot changed after preparation",
		), nil
	}
	activeRoutes, err := canonicalActorRoutes(
		request.VerifiedRoutes,
		uniqueActorsFromPlan(plan),
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	if !routeSetCovers(activeRoutes, plan.PostEndpoints) {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"authority_plan",
			"post-transition endpoint snapshot is no longer active",
		), nil
	}
	transitionRoutes, err = addRemovalRoutes(
		conversation.Snapshot(),
		plan.Changes,
		activeRoutes,
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	if !membershipChangesMatchRoutes(plan.Changes, conversation.Snapshot(), transitionRoutes) {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.submit_membership",
			"authority_plan",
			"membership Home Station bindings changed after preparation",
		), nil
	}
	if leaveRejection, leaveErr := consumeLeaveIntent(
		ctx,
		transaction,
		conversation,
		*request.Membership,
		plan,
		now,
	); leaveErr != nil {
		return aggregate.Transition{}, nil, leaveErr
	} else if leaveRejection != nil {
		if err := supersedePlan(ctx, transaction, &plan, now); err != nil {
			return aggregate.Transition{}, nil, err
		}
		return aggregate.Transition{}, leaveRejection, nil
	}
	membership := *request.Membership
	membership.Command = request.Command
	membership.Command.EventSealer = s.eventSealer
	membership.Command.RequiredEndpoints = endpointUnion(plan.PreEndpoints, plan.PostEndpoints)
	membership.Command.Deliveries, err = bindDeliveryRoutes(
		membership.Command.Deliveries,
		routesForTransition(transitionRoutes, plan),
	)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	membership.AuthorityPlanID = plan.ID
	membership.AuthorityPlanHash = plan.Hash
	membership.Command.DeliveryPlanHash = plan.Hash
	membership.FromMembership = plan.AuthorityHead.MembershipEpoch
	membership.FromMLS = plan.AuthorityHead.MLSEpoch
	membership.ToMLS = plan.AuthorityHead.MLSEpoch.Next()
	membership.Changes = append([]entity.MembershipChange(nil), plan.Changes...)
	membership.PreEndpoints = append([]valueobject.Endpoint(nil), plan.PreEndpoints...)
	membership.PostEndpoints = append([]valueobject.Endpoint(nil), plan.PostEndpoints...)
	transition, err := conversation.ApplyMembershipTransition(membership)
	if err != nil {
		return aggregate.Transition{}, nil, err
	}
	if err := plan.Consume(request.AuthorityPlanHash, now); err != nil {
		return aggregate.Transition{}, nil, err
	}
	if err := transaction.Repositories.AuthorityPlans.Save(ctx, plan); err != nil {
		return aggregate.Transition{}, nil, err
	}
	if err := transaction.KeyPackageReservations.Consume(
		ctx,
		plan.KeyPackageReservations,
		now,
	); err != nil {
		return aggregate.Transition{}, nil, err
	}
	return transition, nil, nil
}

func consumeLeaveIntent(
	ctx context.Context,
	transaction ports.Transaction,
	conversation *aggregate.Conversation,
	transition aggregate.MembershipTransition,
	plan entity.AuthorityPlan,
	now time.Time,
) (error, error) {
	var leaveActor valueobject.PTID
	for _, change := range plan.Changes {
		if change.Action != entity.MembershipActionLeave {
			continue
		}
		if leaveActor != "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeMembershipConflict,
				"application.consume_leave_intent",
				"changes",
				"one authority transition may contain only one delegated leave",
			), nil
		}
		leaveActor = change.Actor
	}
	if leaveActor == "" {
		if transition.LeaveIntentID != "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeMembershipConflict,
				"application.consume_leave_intent",
				"leave_intent_id",
				"is only valid for a leave transition",
			), nil
		}
		return nil, nil
	}
	if transition.LeaveIntentID == "" {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"application.consume_leave_intent",
			"leave_intent_id",
			"is required for a delegated leave",
		), nil
	}
	intent, err := transaction.Repositories.LeaveIntents.LoadForUpdate(
		ctx,
		transition.LeaveIntentID,
	)
	if err != nil {
		return nil, err
	}
	if intent.State != repository.LeaveIntentStatePending ||
		intent.FederationID != conversation.FederationID() ||
		intent.ConversationID != conversation.ID() ||
		intent.Actor.Actor != leaveActor ||
		intent.AuthorityEpoch != conversation.AuthorityEpoch() ||
		intent.AuthorityHead != plan.AuthorityHead ||
		intent.FederationID != plan.FederationID ||
		intent.AuthorityEpoch != plan.AuthorityEpoch ||
		intent.AuthorityStation != conversation.Snapshot().AuthorityStation {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"application.consume_leave_intent",
			"leave_intent",
			"does not match the authority plan",
		), nil
	}
	if !intent.ExpiresAt.After(now) {
		intent.State = repository.LeaveIntentStateExpired
		if err := transaction.Repositories.LeaveIntents.Save(ctx, intent); err != nil {
			return nil, err
		}
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			"application.consume_leave_intent",
			"leave_intent",
			"has expired",
		), nil
	}
	consumedAt := now.UTC()
	intent.State = repository.LeaveIntentStateConsumed
	intent.ConsumedAt = &consumedAt
	intent.TransitionID = transition.TransitionID
	if err := transaction.Repositories.LeaveIntents.Save(ctx, intent); err != nil {
		return nil, err
	}
	return nil, nil
}

func (s *Service) persistTransition(
	ctx context.Context,
	transaction ports.Transaction,
	conversation *aggregate.Conversation,
	transition aggregate.Transition,
	commandID valueobject.CommandID,
	commandHash valueobject.Hash,
	localStation valueobject.StationID,
) error {
	if transition.Event.Sequence == 1 {
		if err := transaction.Repositories.Authority.Create(ctx, conversation.Snapshot()); err != nil {
			return err
		}
	} else if err := transaction.Repositories.Authority.Save(ctx, conversation.Snapshot()); err != nil {
		return err
	}
	if err := transaction.Repositories.Events.Append(ctx, transition.Event); err != nil {
		return err
	}
	eventBytes := transition.Event.Bytes()
	if err := transaction.Repositories.Receipts.Create(ctx, repository.CommandReceipt{
		ConversationID: conversation.ID(),
		CommandID:      commandID,
		CommandHash:    commandHash,
		Outcome:        repository.CommandReceiptOutcomeAccepted,
		EventID:        transition.Event.ID,
		EventBytes:     eventBytes,
		CreatedAt:      transition.Event.CommittedAt,
	}); err != nil {
		return err
	}
	commitments, err := domainservice.BuildDeliveryCommitments(
		conversation.ID(),
		transition.Event.ID,
		transition.Deliveries,
	)
	if err != nil {
		return err
	}
	if len(commitments) != len(transition.Event.DeliveryCommitments) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"application.persist_transition",
			"delivery_commitments",
			"do not match the committed event",
		)
	}
	for index, commitment := range commitments {
		if commitment.Hash != transition.Event.DeliveryCommitments[index] {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"application.persist_transition",
				"delivery_commitments",
				"do not match the committed event",
			)
		}
	}
	senderActorIdentityKey, err := transaction.Identity.ActorIdentityPublicKey(
		ctx,
		transition.Event.Actor.Actor,
	)
	if err != nil {
		return err
	}
	commitmentByEndpoint := make(map[string]valueobject.Hash, len(commitments))
	for _, commitment := range commitments {
		commitmentByEndpoint[commitment.Recipient.Key()] = commitment.Hash
	}
	type encodedDelivery struct {
		delivery         valueobject.PreparedDelivery
		opaque           []byte
		queueItemID      string
		queuePayloadHash valueobject.Hash
		commitment       valueobject.Hash
	}
	encodedDeliveries := make([]encodedDelivery, 0, len(transition.Deliveries))
	authorityCommitments := make(
		[]ports.AuthorityDeliveryCommitment,
		0,
		len(transition.Deliveries),
	)
	for _, delivery := range transition.Deliveries {
		commitment := commitmentByEndpoint[delivery.Recipient.Key()]
		opaque, err := s.eventEncoder.EncodeDeviceEvent(
			transition.Event,
			delivery,
			commitment,
			senderActorIdentityKey,
		)
		if err != nil {
			return err
		}
		idempotencyKey := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("peers-touch/conversation-delivery"),
			[]byte(transition.Event.ID),
			[]byte(delivery.Recipient.Actor),
			[]byte(delivery.Recipient.Device),
		)).String()
		queuePayloadHash := valueobject.HashBytes(opaque)
		encodedDeliveries = append(encodedDeliveries, encodedDelivery{
			delivery:         delivery,
			opaque:           opaque,
			queueItemID:      idempotencyKey,
			queuePayloadHash: queuePayloadHash,
			commitment:       commitment,
		})
		authorityCommitments = append(
			authorityCommitments,
			ports.AuthorityDeliveryCommitment{
				ConversationID:      conversation.ID(),
				EventID:             transition.Event.ID,
				EventSequence:       transition.Event.Sequence,
				Originator:          transition.Event.Actor.Actor,
				Recipient:           delivery.Recipient,
				HomeStation:         delivery.HomeStation,
				PayloadKind:         delivery.Kind,
				EndpointPayloadHash: delivery.PayloadHash,
				Commitment:          commitment,
				QueueItemID:         idempotencyKey,
				QueuePayloadHash:    queuePayloadHash,
				RequiredRecipient: delivery.Recipient.Actor !=
					transition.Event.Actor.Actor,
				CreatedAt: transition.Event.CommittedAt,
			},
		)
	}
	if err := transaction.DeliveryCommitments.RecordCommitments(
		ctx,
		authorityCommitments,
	); err != nil {
		return err
	}
	for _, encoded := range encodedDeliveries {
		delivery := encoded.delivery
		if delivery.HomeStation == localStation {
			if err := transaction.DeviceInbox.Enqueue(ctx, ports.DeviceInboxIntent{
				IntentID:       encoded.queueItemID,
				ConversationID: conversation.ID(),
				EventID:        transition.Event.ID,
				EventSequence:  transition.Event.Sequence,
				Recipient:      delivery.Recipient,
				IdempotencyKey: encoded.queueItemID,
				PayloadKind:    ports.DeviceInboxPayloadConversationEvent,
				OpaquePayload:  encoded.opaque,
				PayloadHash:    encoded.queuePayloadHash,
				Commitment:     encoded.commitment,
				CreatedAt:      transition.Event.CommittedAt,
			}); err != nil {
				return err
			}
			continue
		}
		if err := transaction.FederationOutbox.Enqueue(ctx, ports.FederationOutboxIntent{
			IntentID:       encoded.queueItemID,
			ConversationID: conversation.ID(),
			EventID:        transition.Event.ID,
			EventSequence:  transition.Event.Sequence,
			Recipient:      delivery.Recipient,
			TargetStation:  delivery.HomeStation,
			IdempotencyKey: encoded.queueItemID,
			PayloadKind:    ports.DeviceInboxPayloadConversationEvent,
			OpaquePayload:  encoded.opaque,
			PayloadHash:    encoded.queuePayloadHash,
			CreatedAt:      transition.Event.CommittedAt,
		}); err != nil {
			return err
		}
	}
	if len(transition.ObjectIDs) > 0 {
		if err := transaction.ObjectGrants.GrantBatch(ctx, ports.ObjectGrantBatch{
			ConversationID: conversation.ID(),
			MessageID:      transition.Event.Fact.MessageID,
			Uploader:       transition.Event.Actor.Actor,
			EventID:        transition.Event.ID,
			ObjectIDs:      append([]valueobject.ObjectID(nil), transition.ObjectIDs...),
			Recipients:     append([]valueobject.PTID(nil), transition.RecipientActors...),
			GrantedAt:      transition.Event.CommittedAt,
		}); err != nil {
			return err
		}
	}
	return nil
}

func resolveCommandReceipt(
	ctx context.Context,
	repositories repository.Repositories,
	snapshot aggregate.Snapshot,
	commandID valueobject.CommandID,
	commandHash valueobject.Hash,
) (Result, bool, error) {
	receipt, err := repositories.Receipts.Get(ctx, snapshot.ID, commandID)
	if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, err
	}
	if !bytes.Equal(receipt.CommandHash[:], commandHash[:]) {
		return Result{}, true, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.replay_command",
			"command_id",
			"was resolved with different exact bytes",
		)
	}
	switch receipt.Outcome {
	case repository.CommandReceiptOutcomeAccepted:
		event, err := repositories.Events.GetByID(ctx, receipt.EventID)
		if err != nil {
			return Result{}, true, err
		}
		if receiptErr := validateReceiptEvent(receipt, event); receiptErr != nil {
			return Result{}, true, receiptErr
		}
		return Result{
			Conversation: snapshot,
			Event:        event,
			Replay:       true,
		}, true, nil
	case repository.CommandReceiptOutcomeRejected:
		return Result{}, true, conversationdomain.NewError(
			receipt.RejectionCode,
			"application.replay_command",
			"command_id",
			"was terminally rejected",
		)
	default:
		return Result{}, true, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.replay_command",
			"receipt",
			"contains an unknown command outcome",
		)
	}
}

func replayCommittedCommand(
	ctx context.Context,
	repositories repository.Repositories,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	commandHash valueobject.Hash,
) (domainevent.Record, error) {
	receipt, err := repositories.Receipts.Get(ctx, conversationID, commandID)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			return domainevent.Record{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"application.replay_command",
				"conversation_id",
				"already exists under a different creation command",
			)
		}
		return domainevent.Record{}, err
	}
	if !bytes.Equal(receipt.CommandHash[:], commandHash[:]) {
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.replay_command",
			"command_id",
			"was committed with different bytes",
		)
	}
	if receipt.Outcome == repository.CommandReceiptOutcomeRejected {
		return domainevent.Record{}, conversationdomain.NewError(
			receipt.RejectionCode,
			"application.replay_command",
			"command_id",
			"was terminally rejected",
		)
	}
	if receipt.Outcome != repository.CommandReceiptOutcomeAccepted {
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.replay_command",
			"receipt",
			"contains an unknown command outcome",
		)
	}
	event, err := repositories.Events.GetByID(ctx, receipt.EventID)
	if err != nil {
		return domainevent.Record{}, err
	}
	if err := validateCreationReceiptEvent(receipt, event); err != nil {
		return domainevent.Record{}, err
	}
	return event, nil
}

func validateCreationReceiptEvent(
	receipt repository.CommandReceipt,
	event domainevent.Record,
) error {
	if err := validateReceiptEvent(receipt, event); err != nil {
		return err
	}
	if event.Sequence != 1 || event.Fact.Kind != domainevent.KindConversationCreated {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.replay_command",
			"event",
			"creation receipt does not reference a Conversation creation event",
		)
	}
	return nil
}

func terminalCommandRejection(code conversationdomain.ErrorCode) bool {
	switch code {
	case conversationdomain.ErrorCodeReadOnly,
		conversationdomain.ErrorCodeHashChainInvalid,
		conversationdomain.ErrorCodeActorKeyUnavailable,
		conversationdomain.ErrorCodeFederationInactive:
		return false
	default:
		return true
	}
}

func validateReceiptEvent(
	receipt repository.CommandReceipt,
	event domainevent.Record,
) error {
	if event.ID != receipt.EventID ||
		event.ConversationID != receipt.ConversationID ||
		event.CommandID != receipt.CommandID ||
		!bytes.Equal(event.Bytes(), receipt.EventBytes) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.replay_command",
			"event",
			"does not match the durable command receipt",
		)
	}
	return nil
}

func validateMessageCommand(
	ctx context.Context,
	events repository.EventRepository,
	command aggregate.Command,
) error {
	requireMessage := func(messageID valueobject.MessageID) (repository.MessageIdentity, error) {
		identity, err := events.GetMessageIdentity(ctx, command.ConversationID, messageID)
		if err != nil {
			return repository.MessageIdentity{}, err
		}
		return identity, nil
	}

	switch command.Kind {
	case domainevent.KindMessageCommitted,
		domainevent.KindMessageForwarded:
		if command.MessageID == "" {
			return invalid("application.validate_message_command", "message_id", "is required")
		}
		if _, err := requireMessage(command.MessageID); err == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"application.validate_message_command",
				"message_id",
				"already exists in the conversation",
			)
		} else if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			return err
		}
		for _, target := range []valueobject.MessageID{
			command.ReplyToMessageID,
			command.ThreadRootMessageID,
		} {
			if target == "" {
				continue
			}
			if _, err := requireMessage(target); err != nil {
				return err
			}
		}
	case domainevent.KindMessageEdited, domainevent.KindMessageRetracted:
		if command.MessageID == "" {
			return invalid("application.validate_message_command", "message_id", "is required")
		}
		identity, err := requireMessage(command.MessageID)
		if err != nil {
			return err
		}
		if identity.Author != command.Sender.Actor {
			return unauthorized(
				"application.validate_message_command",
				"only the original message author may edit or retract it",
			)
		}
	case domainevent.KindMessageHiddenForActor,
		domainevent.KindMessageModerated:
		if command.MessageID == "" {
			return invalid(
				"application.validate_message_command",
				"message_id",
				"is required",
			)
		}
		_, err := requireMessage(command.MessageID)
		return err
	case domainevent.KindReactionCommitted:
		if command.MessageID == "" || command.Reaction == "" {
			return invalid(
				"application.validate_message_command",
				"reaction",
				"message identity and reaction are required",
			)
		}
		_, err := requireMessage(command.MessageID)
		return err
	case domainevent.KindMessagePinCommitted:
		if command.MessageID == "" {
			return invalid("application.validate_message_command", "message_id", "is required")
		}
		_, err := requireMessage(command.MessageID)
		return err
	}
	return nil
}

func validateTransaction(transaction ports.Transaction) error {
	repositories := transaction.Repositories
	if repositories.Authority == nil || repositories.Events == nil ||
		repositories.Receipts == nil || repositories.AuthorityPlans == nil ||
		transaction.Identity == nil || transaction.Federation == nil ||
		transaction.DeviceInbox == nil ||
		transaction.FederationOutbox == nil ||
		transaction.DeliveryCommitments == nil ||
		transaction.ObjectGrants == nil ||
		transaction.KeyPackageReservations == nil {
		return invalid(
			"application.validate_transaction",
			"dependencies",
			"transaction is missing a required port",
		)
	}
	return nil
}

func resolveActorRoutes(
	ctx context.Context,
	directory ports.IdentityDirectory,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	routes, err := directory.ListActiveEndpoints(ctx, uniqueActors(actors))
	if err != nil {
		return nil, err
	}
	return canonicalActorRoutes(routes, actors)
}

func canonicalActorRoutes(
	routes []ports.EndpointRoute,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	expectedActors := make(map[valueobject.PTID]struct{}, len(actors))
	for _, actor := range uniqueActors(actors) {
		expectedActors[actor] = struct{}{}
	}
	canonical := append([]ports.EndpointRoute(nil), routes...)
	seen := make(map[string]struct{}, len(routes))
	homeByActor := make(map[valueobject.PTID]valueobject.StationID, len(routes))
	for _, route := range canonical {
		homeStation, err := valueobject.NewStationID(string(route.HomeStation))
		if route.Endpoint.Validate() != nil ||
			err != nil ||
			homeStation != route.HomeStation {
			return nil, invalid("application.resolve_actor_routes", "route", "contains an invalid endpoint route")
		}
		if _, expected := expectedActors[route.Endpoint.Actor]; !expected {
			return nil, invalid(
				"application.resolve_actor_routes",
				"route",
				"contains an unexpected actor",
			)
		}
		if _, duplicate := seen[route.Endpoint.Key()]; duplicate {
			return nil, invalid("application.resolve_actor_routes", "route", "contains a duplicate endpoint")
		}
		seen[route.Endpoint.Key()] = struct{}{}
		if home, exists := homeByActor[route.Endpoint.Actor]; exists && home != route.HomeStation {
			return nil, invalid(
				"application.resolve_actor_routes",
				"home_station",
				"one actor resolved to multiple Home Stations",
			)
		}
		homeByActor[route.Endpoint.Actor] = route.HomeStation
	}
	for actor := range expectedActors {
		if _, resolved := homeByActor[actor]; !resolved {
			return nil, invalid(
				"application.resolve_actor_routes",
				"route",
				fmt.Sprintf("actor %s has no verified active endpoint", actor),
			)
		}
	}
	sort.Slice(canonical, func(i int, j int) bool {
		return canonical[i].Endpoint.Key() < canonical[j].Endpoint.Key()
	})
	return canonical, nil
}

func commandRouteSnapshot(
	conversation *aggregate.Conversation,
	verifiedRoutes []ports.EndpointRoute,
) ([]ports.EndpointRoute, error) {
	if conversation == nil {
		return nil, invalid(
			"application.command_route_snapshot",
			"conversation",
			"is required",
		)
	}
	routes, err := canonicalActorRoutes(
		verifiedRoutes,
		conversation.ActiveMemberActors(),
	)
	if err != nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"application.command_route_snapshot",
			"routes",
			fmt.Sprintf("do not match the locked Conversation actor set: %v", err),
		)
	}
	homeByActor := make(
		map[valueobject.PTID]valueobject.StationID,
		len(conversation.ActiveMemberActors()),
	)
	for _, route := range routes {
		homeByActor[route.Endpoint.Actor] = route.HomeStation
	}
	for _, member := range conversation.Members() {
		if !member.Active() {
			continue
		}
		if homeByActor[member.Actor] != member.HomeStation {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"application.command_route_snapshot",
				"home_station",
				fmt.Sprintf(
					"actor %s route no longer matches the Conversation member",
					member.Actor,
				),
			)
		}
	}
	return routes, nil
}

func (s *Service) authorizeCommandSender(
	ctx context.Context,
	transaction ports.Transaction,
	conversation *aggregate.Conversation,
	sender valueobject.Endpoint,
	senderHomeStation valueobject.StationID,
	routes []ports.EndpointRoute,
) error {
	if senderHomeStation == "" ||
		!routeSetContainsAtStation(routes, sender, senderHomeStation) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"application.authorize_command_sender",
			"home_station",
			"sender endpoint does not belong to the authenticated Home Station",
		)
	}
	if senderHomeStation == s.localStation {
		active, err := transaction.Identity.IsActive(ctx, sender)
		if err != nil {
			return err
		}
		if !active {
			return unauthorized(
				"application.authorize_command_sender",
				"sender device is not active",
			)
		}
		return nil
	}
	active, err := transaction.Federation.IsActiveStation(
		ctx,
		conversation.FederationID(),
		senderHomeStation,
	)
	if err != nil {
		return err
	}
	if !active {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeFederationInactive,
			"application.authorize_command_sender",
			"home_station",
			"is not an active Federation Station",
		)
	}
	return nil
}

func routeStations(routes []ports.EndpointRoute) []valueobject.StationID {
	unique := make(map[valueobject.StationID]struct{}, len(routes))
	for _, route := range routes {
		unique[route.HomeStation] = struct{}{}
	}
	stations := make([]valueobject.StationID, 0, len(unique))
	for station := range unique {
		stations = append(stations, station)
	}
	sort.Slice(stations, func(left int, right int) bool {
		return stations[left] < stations[right]
	})

	return stations
}

func addRemovalRoutes(
	snapshot aggregate.Snapshot,
	changes []entity.MembershipChange,
	routes []ports.EndpointRoute,
) ([]ports.EndpointRoute, error) {
	byEndpoint := make(map[string]ports.EndpointRoute, len(routes))
	for _, route := range routes {
		byEndpoint[route.Endpoint.Key()] = route
	}
	for _, change := range changes {
		switch change.Action {
		case entity.MembershipActionRemoveDevice:
			endpoint := valueobject.Endpoint{Actor: change.Actor, Device: change.Device}
			if err := addConversationRemovalRoute(byEndpoint, snapshot.Devices, endpoint); err != nil {
				return nil, err
			}
		case entity.MembershipActionRemoveActor, entity.MembershipActionLeave:
			for _, device := range snapshot.Devices {
				if device.Active && device.Endpoint.Actor == change.Actor {
					if err := addConversationRemovalRoute(
						byEndpoint,
						snapshot.Devices,
						device.Endpoint,
					); err != nil {
						return nil, err
					}
				}
			}
		}
	}
	result := make([]ports.EndpointRoute, 0, len(byEndpoint))
	for _, route := range byEndpoint {
		result = append(result, route)
	}
	sort.Slice(result, func(i int, j int) bool {
		return result[i].Endpoint.Key() < result[j].Endpoint.Key()
	})
	return result, nil
}

func addConversationRemovalRoute(
	routes map[string]ports.EndpointRoute,
	devices []entity.MemberDevice,
	endpoint valueobject.Endpoint,
) error {
	for _, device := range devices {
		if device.Endpoint == endpoint && device.Active {
			if route, exists := routes[endpoint.Key()]; exists {
				if route.HomeStation != device.HomeStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeAuthorityPlanStale,
						"application.add_removal_routes",
						"home_station",
						"active identity route disagrees with the Conversation member device",
					)
				}
				return nil
			}
			routes[endpoint.Key()] = ports.EndpointRoute{
				Endpoint:    endpoint,
				HomeStation: device.HomeStation,
			}
			return nil
		}
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeDeviceConflict,
		"application.add_removal_routes",
		"endpoint",
		"is not an active Conversation member device",
	)
}

func canonicalizeMembershipChanges(
	snapshot aggregate.Snapshot,
	changes []entity.MembershipChange,
	routes []ports.EndpointRoute,
) ([]entity.MembershipChange, error) {
	homeByActor := make(map[valueobject.PTID]valueobject.StationID, len(snapshot.Members))
	for _, member := range snapshot.Members {
		homeByActor[member.Actor] = member.HomeStation
	}
	homeByEndpoint := make(map[string]valueobject.StationID, len(routes))
	for _, route := range routes {
		homeByActor[route.Endpoint.Actor] = route.HomeStation
		homeByEndpoint[route.Endpoint.Key()] = route.HomeStation
	}
	explicitAddDevices := make(map[string]struct{}, len(changes))
	for _, change := range changes {
		if change.Action == entity.MembershipActionAddDevice {
			endpoint := valueobject.Endpoint{
				Actor:  change.Actor,
				Device: change.Device,
			}
			explicitAddDevices[endpoint.Key()] = struct{}{}
		}
	}

	canonical := make([]entity.MembershipChange, 0, len(changes)+len(routes))
	for _, requested := range changes {
		change := requested
		switch change.Action {
		case entity.MembershipActionAddActor:
			var actorRoutes []ports.EndpointRoute
			for _, route := range routes {
				if route.Endpoint.Actor == change.Actor {
					actorRoutes = append(actorRoutes, route)
				}
			}
			if len(actorRoutes) == 0 {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeDeviceConflict,
					"application.canonicalize_membership_changes",
					"endpoint",
					"does not resolve to an active identity route",
				)
			}
			primaryIndex := 0
			if change.Device != "" {
				primaryIndex = -1
				for index, route := range actorRoutes {
					if route.Endpoint.Device == change.Device {
						primaryIndex = index
						break
					}
				}
				if primaryIndex < 0 {
					return nil, conversationdomain.NewError(
						conversationdomain.ErrorCodeDeviceConflict,
						"application.canonicalize_membership_changes",
						"endpoint",
						"does not resolve to an active identity route",
					)
				}
			}
			for index, route := range actorRoutes {
				if index != primaryIndex {
					if _, explicit := explicitAddDevices[route.Endpoint.Key()]; explicit {
						continue
					}
				}
				action := entity.MembershipActionAddDevice
				role := valueobject.MemberRole("")
				if index == primaryIndex {
					action = entity.MembershipActionAddActor
					role = change.Role
				}
				canonical = append(canonical, entity.MembershipChange{
					Action:      action,
					Actor:       change.Actor,
					Device:      route.Endpoint.Device,
					HomeStation: route.HomeStation,
					Role:        role,
				})
			}
			continue
		case entity.MembershipActionAddDevice,
			entity.MembershipActionRemoveDevice:
			endpoint := valueobject.Endpoint{Actor: change.Actor, Device: change.Device}
			home := homeByEndpoint[endpoint.Key()]
			if home == "" {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeDeviceConflict,
					"application.canonicalize_membership_changes",
					"endpoint",
					"does not resolve to an active identity route",
				)
			}
			change.HomeStation = home
		case entity.MembershipActionRemoveActor,
			entity.MembershipActionLeave,
			entity.MembershipActionChangeRole:
			home := homeByActor[change.Actor]
			if home == "" {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeMembershipConflict,
					"application.canonicalize_membership_changes",
					"actor",
					"does not resolve to an authoritative Home Station",
				)
			}
			change.HomeStation = home
		default:
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnsupportedTransition,
				"application.canonicalize_membership_changes",
				"action",
				"is not supported",
			)
		}
		canonical = append(canonical, change)
	}
	return canonical, nil
}

func membershipChangesMatchRoutes(
	changes []entity.MembershipChange,
	snapshot aggregate.Snapshot,
	routes []ports.EndpointRoute,
) bool {
	canonical, err := canonicalizeMembershipChanges(snapshot, changes, routes)
	return err == nil && membershipChangesEqual(changes, canonical)
}

func participantsAndDevices(
	actors []valueobject.PTID,
	owner valueobject.PTID,
	routes []ports.EndpointRoute,
	joinedAt valueobject.Sequence,
) ([]aggregate.Participant, []entity.MemberDevice, error) {
	homeByActor := make(map[valueobject.PTID]valueobject.StationID, len(actors))
	devices := make([]entity.MemberDevice, 0, len(routes))
	for _, route := range routes {
		if existing, ok := homeByActor[route.Endpoint.Actor]; ok && existing != route.HomeStation {
			return nil, nil, invalid(
				"application.build_participants",
				"home_station",
				"one actor resolved to multiple Home Stations",
			)
		}
		homeByActor[route.Endpoint.Actor] = route.HomeStation
		device, err := entity.NewMemberDevice(route.Endpoint, route.HomeStation, joinedAt)
		if err != nil {
			return nil, nil, err
		}
		devices = append(devices, device)
	}
	participants := make([]aggregate.Participant, 0, len(actors))
	for _, actor := range uniqueActors(actors) {
		homeStation := homeByActor[actor]
		if homeStation == "" {
			return nil, nil, invalid(
				"application.build_participants",
				"endpoints",
				fmt.Sprintf("actor %s has no active endpoint", actor),
			)
		}
		role := valueobject.MemberRoleMember
		if actor == owner {
			role = valueobject.MemberRoleOwner
		}
		participants = append(participants, aggregate.Participant{
			Actor:       actor,
			HomeStation: homeStation,
			Role:        role,
		})
	}
	return participants, devices, nil
}

func genesisMembershipChanges(
	actors []valueobject.PTID,
	owner valueobject.PTID,
	routes []ports.EndpointRoute,
) []entity.MembershipChange {
	routesByActor := make(map[valueobject.PTID][]ports.EndpointRoute, len(actors))
	for _, route := range routes {
		routesByActor[route.Endpoint.Actor] = append(routesByActor[route.Endpoint.Actor], route)
	}
	var changes []entity.MembershipChange
	for _, actor := range actors {
		actorRoutes := routesByActor[actor]
		sort.Slice(actorRoutes, func(i int, j int) bool {
			return actorRoutes[i].Endpoint.Device < actorRoutes[j].Endpoint.Device
		})
		if len(actorRoutes) == 0 {
			continue
		}
		role := valueobject.MemberRoleMember
		if actor == owner {
			role = valueobject.MemberRoleOwner
		}
		changes = append(changes, entity.MembershipChange{
			Action:      entity.MembershipActionAddActor,
			Actor:       actor,
			Device:      actorRoutes[0].Endpoint.Device,
			HomeStation: actorRoutes[0].HomeStation,
			Role:        role,
		})
		for _, route := range actorRoutes[1:] {
			changes = append(changes, entity.MembershipChange{
				Action:      entity.MembershipActionAddDevice,
				Actor:       actor,
				Device:      route.Endpoint.Device,
				HomeStation: route.HomeStation,
			})
		}
	}
	return changes
}

func (s *Service) creationDeliveries(
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	routes []ports.EndpointRoute,
) ([]valueobject.PreparedDelivery, error) {
	eventID := valueobject.DeterministicEventID(conversationID, commandID)
	payload, err := s.stateEncoder.EncodeConversationStateMarker(conversationID, eventID)
	if err != nil {
		return nil, err
	}
	deliveries := make([]valueobject.PreparedDelivery, 0, len(routes))
	for _, route := range routes {
		delivery, err := valueobject.NewPreparedDelivery(
			route.Endpoint,
			route.HomeStation,
			valueobject.DeliveryKindConversation,
			payload,
		)
		if err != nil {
			return nil, err
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, nil
}

func bindDeliveryRoutes(
	deliveries []valueobject.PreparedDelivery,
	routes []ports.EndpointRoute,
) ([]valueobject.PreparedDelivery, error) {
	routeByEndpoint := make(map[string]valueobject.StationID, len(routes))
	for _, route := range routes {
		routeByEndpoint[route.Endpoint.Key()] = route.HomeStation
	}
	bound := make([]valueobject.PreparedDelivery, 0, len(deliveries))
	for _, delivery := range deliveries {
		homeStation, exists := routeByEndpoint[delivery.Recipient.Key()]
		if !exists {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"application.bind_delivery_routes",
				"recipient",
				"has no active endpoint route",
			)
		}
		delivery.HomeStation = homeStation
		bound = append(bound, delivery.Clone())
	}
	return bound, nil
}

func eligibleConversationEndpoints(
	conversation *aggregate.Conversation,
	routes []ports.EndpointRoute,
) []valueobject.Endpoint {
	eligibleRoutes := eligibleConversationRoutes(conversation, routes)
	endpoints := make([]valueobject.Endpoint, 0, len(eligibleRoutes))
	for _, route := range eligibleRoutes {
		endpoints = append(endpoints, route.Endpoint)
	}
	return valueobject.SortEndpoints(endpoints)
}

func filterEndpointsForActor(
	endpoints []valueobject.Endpoint,
	actor valueobject.PTID,
) []valueobject.Endpoint {
	filtered := make([]valueobject.Endpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if endpoint.Actor == actor {
			filtered = append(filtered, endpoint)
		}
	}
	return valueobject.SortEndpoints(filtered)
}

func eligibleConversationRoutes(
	conversation *aggregate.Conversation,
	routes []ports.EndpointRoute,
) []ports.EndpointRoute {
	activeActors := make(map[valueobject.PTID]struct{})
	for _, actor := range conversation.ActiveMemberActors() {
		activeActors[actor] = struct{}{}
	}
	active := make(map[string]struct{})
	for _, endpoint := range conversation.ActiveEndpoints() {
		active[endpoint.Key()] = struct{}{}
	}
	eligible := make([]ports.EndpointRoute, 0, len(routes))
	for _, route := range routes {
		_, actorIsActive := activeActors[route.Endpoint.Actor]
		_, endpointIsActive := active[route.Endpoint.Key()]
		if actorIsActive &&
			(conversation.Kind() == valueobject.ConversationKindDirect || endpointIsActive) {
			eligible = append(eligible, route)
		}
	}
	sort.Slice(eligible, func(i int, j int) bool {
		return eligible[i].Endpoint.Key() < eligible[j].Endpoint.Key()
	})
	return eligible
}

func endpointsFromRoutes(routes []ports.EndpointRoute) []valueobject.Endpoint {
	endpoints := make([]valueobject.Endpoint, 0, len(routes))
	for _, route := range routes {
		endpoints = append(endpoints, route.Endpoint)
	}
	return valueobject.SortEndpoints(endpoints)
}

func routeSetContains(routes []ports.EndpointRoute, endpoint valueobject.Endpoint) bool {
	for _, route := range routes {
		if route.Endpoint == endpoint {
			return true
		}
	}
	return false
}

func routeSetContainsAtStation(
	routes []ports.EndpointRoute,
	endpoint valueobject.Endpoint,
	station valueobject.StationID,
) bool {
	for _, route := range routes {
		if route.Endpoint == endpoint && route.HomeStation == station {
			return true
		}
	}
	return false
}

func routeSetCovers(routes []ports.EndpointRoute, endpoints []valueobject.Endpoint) bool {
	for _, endpoint := range endpoints {
		if !routeSetContains(routes, endpoint) {
			return false
		}
	}
	return true
}

func routesForTransition(
	current []ports.EndpointRoute,
	plan entity.AuthorityPlan,
) []ports.EndpointRoute {
	homeByEndpoint := make(map[string]valueobject.StationID, len(current))
	homeByActor := make(map[valueobject.PTID]valueobject.StationID, len(current))
	for _, route := range current {
		homeByEndpoint[route.Endpoint.Key()] = route.HomeStation
		homeByActor[route.Endpoint.Actor] = route.HomeStation
	}
	routes := make([]ports.EndpointRoute, 0, len(plan.PreEndpoints)+len(plan.PostEndpoints))
	for _, endpoint := range endpointUnion(plan.PreEndpoints, plan.PostEndpoints) {
		home := homeByEndpoint[endpoint.Key()]
		if home == "" {
			home = homeByActor[endpoint.Actor]
		}
		routes = append(routes, ports.EndpointRoute{Endpoint: endpoint, HomeStation: home})
	}
	return routes
}

func uniqueActorsFromPlan(plan entity.AuthorityPlan) []valueobject.PTID {
	actors := []valueobject.PTID{plan.Requester.Actor}
	for _, change := range plan.Changes {
		actors = append(actors, change.Actor)
	}
	for _, endpoint := range plan.PreEndpoints {
		actors = append(actors, endpoint.Actor)
	}
	for _, endpoint := range plan.PostEndpoints {
		actors = append(actors, endpoint.Actor)
	}
	return uniqueActors(actors)
}

func membershipChangesEqual(
	left []entity.MembershipChange,
	right []entity.MembershipChange,
) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func uniqueActors(actors []valueobject.PTID) []valueobject.PTID {
	set := make(map[valueobject.PTID]struct{}, len(actors))
	for _, actor := range actors {
		if actor != "" {
			set[actor] = struct{}{}
		}
	}
	result := make([]valueobject.PTID, 0, len(set))
	for actor := range set {
		result = append(result, actor)
	}
	sort.Slice(result, func(i int, j int) bool {
		return result[i] < result[j]
	})
	return result
}

func genesisActors(changes []entity.MembershipChange) []valueobject.PTID {
	actors := make([]valueobject.PTID, 0, len(changes))
	for _, change := range changes {
		if change.Action == entity.MembershipActionAddActor {
			actors = append(actors, change.Actor)
		}
	}
	return uniqueActors(actors)
}

func sameActorSets(left []valueobject.PTID, right []valueobject.PTID) bool {
	left = uniqueActors(left)
	right = uniqueActors(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func endpointUnion(left []valueobject.Endpoint, right []valueobject.Endpoint) []valueobject.Endpoint {
	byKey := make(map[string]valueobject.Endpoint, len(left)+len(right))
	for _, endpoint := range append(append([]valueobject.Endpoint(nil), left...), right...) {
		byKey[endpoint.Key()] = endpoint
	}
	result := make([]valueobject.Endpoint, 0, len(byKey))
	for _, endpoint := range byKey {
		result = append(result, endpoint)
	}
	return valueobject.SortEndpoints(result)
}

func endpointDifference(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	rightSet := make(map[string]struct{}, len(right))
	for _, endpoint := range right {
		rightSet[endpoint.Key()] = struct{}{}
	}
	result := make([]valueobject.Endpoint, 0)
	for _, endpoint := range left {
		if _, exists := rightSet[endpoint.Key()]; !exists {
			result = append(result, endpoint)
		}
	}
	return valueobject.SortEndpoints(result)
}

func filterEndpointsByRoutes(
	endpoints []valueobject.Endpoint,
	routes []ports.EndpointRoute,
) []valueobject.Endpoint {
	result := make([]valueobject.Endpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if routeSetContains(routes, endpoint) {
			result = append(result, endpoint)
		}
	}
	return valueobject.SortEndpoints(result)
}

func filterRoutesByEndpoints(
	routes []ports.EndpointRoute,
	endpoints []valueobject.Endpoint,
) []ports.EndpointRoute {
	expected := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		expected[endpoint.Key()] = struct{}{}
	}
	result := make([]ports.EndpointRoute, 0, len(endpoints))
	for _, route := range routes {
		if _, exists := expected[route.Endpoint.Key()]; exists {
			result = append(result, route)
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		return result[left].Endpoint.Key() < result[right].Endpoint.Key()
	})
	return result
}

func filterRoutesByActors(
	routes []ports.EndpointRoute,
	actors []valueobject.PTID,
) []ports.EndpointRoute {
	expected := make(map[valueobject.PTID]struct{}, len(actors))
	for _, actor := range actors {
		expected[actor] = struct{}{}
	}
	result := make([]ports.EndpointRoute, 0, len(routes))
	for _, route := range routes {
		if _, exists := expected[route.Endpoint.Actor]; exists {
			result = append(result, route)
		}
	}
	return result
}

func authorityPlanHash(
	planID valueobject.PlanID,
	conversationID valueobject.ConversationID,
	federationID valueobject.FederationID,
	authorityEpoch valueobject.AuthorityEpoch,
	requester valueobject.Endpoint,
	preparedName string,
	preview aggregate.MembershipPreview,
	changes []entity.MembershipChange,
	reservations []valueobject.KeyPackageReservation,
	expiresAt time.Time,
	manifestHashes ...valueobject.Hash,
) valueobject.Hash {
	fields := [][]byte{
		[]byte("peers-touch/conversation-authority-plan"),
		[]byte(planID),
		[]byte(conversationID),
		[]byte(federationID),
		[]byte(authorityEpoch.String()),
		[]byte(requester.Actor),
		[]byte(requester.Device),
		[]byte(preparedName),
		[]byte(fmt.Sprintf("%d", preview.Head.Sequence)),
		preview.Head.EventHash[:],
		[]byte(fmt.Sprintf("%d", preview.Head.MembershipEpoch)),
		[]byte(fmt.Sprintf("%d", preview.Head.MLSEpoch)),
		[]byte(fmt.Sprintf("%d", expiresAt.UTC().UnixNano())),
	}
	for _, manifestHash := range manifestHashes {
		fields = append(fields, manifestHash.Bytes())
	}
	for _, change := range changes {
		fields = append(fields,
			[]byte(change.Action),
			[]byte(change.Actor),
			[]byte(change.Device),
			[]byte(change.HomeStation),
			[]byte(change.Role),
		)
	}
	for _, endpoint := range preview.PreEndpoints {
		fields = append(fields, []byte(endpoint.Actor), []byte(endpoint.Device))
	}
	for _, endpoint := range preview.PostEndpoints {
		fields = append(fields, []byte(endpoint.Actor), []byte(endpoint.Device))
	}
	sortedReservations := valueobject.SortKeyPackageReservations(reservations)
	for _, reservation := range sortedReservations {
		fields = append(fields,
			[]byte(reservation.ID),
			[]byte(reservation.Endpoint.Actor),
			[]byte(reservation.Endpoint.Device),
			[]byte(reservation.PackageID),
			reservation.PackageHash[:],
			[]byte(reservation.HomeStation),
			[]byte(strconv.FormatBool(reservation.IrreversiblyConsumed)),
		)
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(fields...))
}

func authorityPlanTTL(requested time.Duration) (time.Duration, error) {
	switch {
	case requested == 0:
		return defaultAuthorityPlanTTL, nil
	case requested < 0 || requested > maxAuthorityPlanTTL:
		return 0, invalid(
			"application.prepare_authority_plan",
			"ttl",
			"must be positive and no greater than the configured short reservation TTL",
		)
	default:
		return requested, nil
	}
}

func expirePlan(
	ctx context.Context,
	transaction ports.Transaction,
	plan *entity.AuthorityPlan,
	at time.Time,
) error {
	if err := plan.Expire(at); err != nil {
		return err
	}
	if err := transaction.Repositories.AuthorityPlans.Save(ctx, *plan); err != nil {
		return err
	}
	return transaction.KeyPackageReservations.Release(ctx, plan.KeyPackageReservations, at)
}

func supersedePlan(
	ctx context.Context,
	transaction ports.Transaction,
	plan *entity.AuthorityPlan,
	at time.Time,
) error {
	if err := plan.Supersede(plan.Hash, at); err != nil {
		return err
	}
	if err := transaction.Repositories.AuthorityPlans.Save(ctx, *plan); err != nil {
		return err
	}
	return transaction.KeyPackageReservations.Release(ctx, plan.KeyPackageReservations, at)
}

func committedDeliveries(
	transition aggregate.Transition,
	localStation valueobject.StationID,
) []ports.CommittedDelivery {
	deliveries := make([]ports.CommittedDelivery, 0, len(transition.Deliveries))
	for _, delivery := range transition.Deliveries {
		if delivery.HomeStation != localStation {
			continue
		}
		deliveries = append(deliveries, ports.CommittedDelivery{
			Recipient: delivery.Recipient,
			EventID:   transition.Event.ID,
		})
	}
	return deliveries
}

func (s *Service) notify(
	ctx context.Context,
	deliveries []ports.CommittedDelivery,
) error {
	if s.postCommit == nil || len(deliveries) == 0 {
		return nil
	}
	return s.postCommit.NotifyCommitted(ctx, deliveries)
}

func invalid(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		operation,
		field,
		message,
	)
}

func unauthorized(operation string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		operation,
		"identity",
		message,
	)
}
