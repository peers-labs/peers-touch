package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strconv"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const federatedPrivateInteractionFrameLifetime = 24 * time.Hour

func (s *PrivateContentService) routeFederatedPrivateCommentPrepare(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *privatecontentpb.PreparePrivateCommentRequest,
) (*privatecontentpb.PreparePrivateCommentResponse, error) {
	result, _, err := s.routeFederatedPrivateInteraction(
		ctx,
		author,
		request.GetPostId(),
		request.GetCommandId(),
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT,
		request,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.PreparePrivateCommentResponse{}
	if err := decodeFederatedPrivateInteractionResult(result, response); err != nil {
		return nil, err
	}
	if err := s.localizeFederatedPrivateCommentPlan(ctx, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (s *PrivateContentService) routeFederatedPrivateCommentSubmit(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *privatecontentpb.SubmitPrivateCommentRequest,
) (*privatecontentpb.SubmitPrivateCommentResponse, error) {
	result, _, err := s.routeFederatedPrivateInteraction(
		ctx,
		author,
		request.GetPostId(),
		request.GetCommandId(),
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT,
		request,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.SubmitPrivateCommentResponse{}
	if err := decodeFederatedPrivateInteractionResult(result, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (s *PrivateContentService) IsRemotePrivateMoment(
	ctx context.Context,
	postID string,
	actorPTID string,
) (bool, error) {
	const operation = "social.private_content.is_remote_private_moment"
	if s.interactionStore == nil {
		return false, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			operation,
			"store",
			"is unavailable",
		)
	}
	_, err := s.interactionStore.FindRemotePrivatePostAuthority(
		ctx,
		postID,
		actorPTID,
	)
	if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
		return false, nil
	}
	if err != nil {
		return false, mapPrivateStoreError(operation, err)
	}
	return true, nil
}

func (s *PrivateContentService) ReactPrivateMoment(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *actormodel.ReactToPostRequest,
) (*actormodel.ReactToPostResponse, error) {
	const operation = "social.private_content.react_private_moment"
	if err := author.Validate(operation); err != nil {
		return nil, err
	}
	if err := validateFederatedPrivateReactionRequest(
		request,
		operation,
	); err != nil {
		return nil, err
	}
	result, exactReplay, err := s.routeFederatedPrivateInteraction(
		ctx,
		author,
		request.GetPostId(),
		request.GetCommandId(),
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT,
		request,
	)
	if err != nil {
		return nil, err
	}
	response := &actormodel.ReactToPostResponse{}
	if err := decodeFederatedPrivateInteractionResult(result, response); err != nil {
		return nil, err
	}
	if !response.GetSuccess() ||
		response.GetCommandId() != request.GetCommandId() ||
		response.GetProjectionRevision() == 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"result",
			"does not bind the reaction command",
		)
	}
	response.ExactReplay = exactReplay
	return response, nil
}

func (s *PrivateContentService) UnreactPrivateMoment(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *actormodel.UnreactToPostRequest,
) (*actormodel.UnreactToPostResponse, error) {
	const operation = "social.private_content.unreact_private_moment"
	if err := author.Validate(operation); err != nil {
		return nil, err
	}
	if err := validateFederatedPrivateReactionRequest(
		request,
		operation,
	); err != nil {
		return nil, err
	}
	result, exactReplay, err := s.routeFederatedPrivateInteraction(
		ctx,
		author,
		request.GetPostId(),
		request.GetCommandId(),
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT,
		request,
	)
	if err != nil {
		return nil, err
	}
	response := &actormodel.UnreactToPostResponse{}
	if err := decodeFederatedPrivateInteractionResult(result, response); err != nil {
		return nil, err
	}
	if !response.GetSuccess() ||
		response.GetCommandId() != request.GetCommandId() ||
		response.GetProjectionRevision() == 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"result",
			"does not bind the unreaction command",
		)
	}
	response.ExactReplay = exactReplay
	return response, nil
}

func (s *PrivateContentService) routeFederatedPrivateInteraction(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	postID string,
	commandID string,
	operation privatecontentpb.FederatedPrivateInteractionOperation,
	request proto.Message,
) (*privatecontentpb.FederatedPrivateInteractionResult, bool, error) {
	const operationName = "social.private_content.route_federated_interaction"
	if s.interactionStore == nil ||
		s.localStationPeerID == "" ||
		s.federationMembership == nil ||
		author.HomeStationPeerID != s.localStationPeerID {
		return nil, false, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			operationName,
			"dependencies",
			"federated private interaction routing is unavailable",
		)
	}
	authority, err := s.interactionStore.FindRemotePrivatePostAuthority(
		ctx,
		postID,
		author.Endpoint.GetActor().GetPtid(),
	)
	if err != nil {
		return nil, false, mapPrivateStoreError(operationName, err)
	}
	if authority.TargetStationPeerID != s.localStationPeerID ||
		authority.SourceStationPeerID == s.localStationPeerID {
		return nil, false, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			operationName,
			"parent",
			"does not bind a remote source authority",
		)
	}
	if err := s.federationMembership.ValidateActiveStationPair(
		ctx,
		authority.FederationID,
		s.localStationPeerID,
		authority.SourceStationPeerID,
	); err != nil {
		if errors.Is(err, federationdomain.ErrInactiveStationPair) {
			return nil, false, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operationName,
				err,
			)
		}
		return nil, false, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operationName,
			err,
		)
	}
	operationBytes, err := socialdomain.CanonicalProtoBytes(request)
	if err != nil {
		return nil, false, err
	}
	actorSigningKeyID, actorDeviceSignature, err :=
		federatedPrivateInteractionRequestSignature(request)
	if err != nil {
		return nil, false, err
	}
	command := &privatecontentpb.FederatedPrivateInteractionCommand{
		FormatVersion:               socialdomain.PrivateContentFormatVersion,
		FederationId:                authority.FederationID,
		CommandId:                   commandID,
		Actor:                       proto.Clone(author.Endpoint).(*actormodel.ActorDeviceRef),
		ActorHomeStationPeerId:      author.HomeStationPeerID,
		SourceResourceStationPeerId: authority.SourceStationPeerID,
		Parent:                      proto.Clone(authority.Parent).(*securecontentpb.SecureResourceRef),
		Operation:                   operation,
		CanonicalOperation:          operationBytes,
		ActorSigningKeyId:           actorSigningKeyID,
		ActorDeviceSignature:        actorDeviceSignature,
	}
	commandHash, err := canonicalFederatedPrivateInteractionCommandHash(command)
	if err != nil {
		return nil, false, err
	}
	command.CanonicalCommandSha256 = commandHash
	commandBytes, err := socialdomain.CanonicalProtoBytes(command)
	if err != nil {
		return nil, false, err
	}
	candidate := infrastructure.FederatedPrivateInteractionRecord{
		ActorPTID:              author.Endpoint.GetActor().GetPtid(),
		CommandID:              commandID,
		SourceStationPeerID:    authority.SourceStationPeerID,
		CanonicalCommandSHA256: append([]byte(nil), commandHash...),
		CommandBytes:           append([]byte(nil), commandBytes...),
		State:                  "PENDING_RESULT",
		CreatedAt:              s.now(),
	}
	var resultBytes []byte
	exactReplay := false
	startedAt := time.Now()
	err = s.store.Execute(ctx, func(tx infrastructure.PrivateContentTransaction) error {
		federationTx := tx.ContentPreKeyValidationTransaction()
		existing, loadErr := s.interactionStore.LoadFederatedPrivateInteraction(
			ctx,
			federationTx,
			candidate.ActorPTID,
			candidate.CommandID,
			candidate.SourceStationPeerID,
		)
		if loadErr != nil {
			return loadErr
		}
		if existing != nil {
			if !sameFederatedPrivateInteraction(*existing, candidate) {
				return infrastructure.ErrPrivateContentConflict
			}
			exactReplay = true
			resultBytes = append([]byte(nil), existing.ResultBytes...)
			return nil
		}
		frame, signErr := s.signFederatedPrivateInteractionFrame(
			ctx,
			federationTx,
			federationdelivery.PayloadKindSocialPrivateInteraction,
			commandID,
			authority.SourceStationPeerID,
			commandBytes,
			1,
			s.now(),
		)
		if signErr != nil {
			return signErr
		}
		persisted, inserted, putErr :=
			s.interactionStore.PutFederatedPrivateInteraction(
				ctx,
				federationTx,
				candidate,
			)
		if putErr != nil {
			return putErr
		}
		if !inserted {
			if !sameFederatedPrivateInteraction(persisted, candidate) {
				return infrastructure.ErrPrivateContentConflict
			}
			exactReplay = true
			resultBytes = append([]byte(nil), persisted.ResultBytes...)
			return nil
		}
		_, enqueueErr := tx.EnqueueFederationFrame(ctx, frame, s.now())
		return enqueueErr
	})
	if err != nil {
		s.observeFederatedPrivateInteraction(
			startedAt,
			operation.String(),
			"rejected",
			"route",
		)
		return nil, false, mapPrivateStoreError(operationName, err)
	}
	if len(resultBytes) == 0 {
		s.observeFederatedPrivateInteraction(
			startedAt,
			operation.String(),
			"pending",
			"result",
		)
		return nil, false, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentDependency,
			operationName,
			"result",
			"is pending durable Federation delivery",
		)
	}
	result := &privatecontentpb.FederatedPrivateInteractionResult{}
	if err := proto.Unmarshal(resultBytes, result); err != nil {
		return nil, false, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operationName,
			err,
		)
	}
	s.observeFederatedPrivateInteraction(
		startedAt,
		operation.String(),
		"resolved",
		"none",
	)
	return result, exactReplay, nil
}

func (s *PrivateContentService) ReceiveFederatedPrivateInteractionCommand(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	startedAt := time.Now()
	if err := s.validateFederatedPrivateInteractionCommand(
		ctx,
		transaction,
		command,
		frame,
	); err != nil {
		s.observeFederatedPrivateInteraction(
			startedAt,
			command.GetOperation().String(),
			"rejected",
			"domain",
		)
		return deliveryResultForPrivateContentError(err), nil
	}
	commandBytes, err := socialdomain.CanonicalProtoBytes(command)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	candidate := infrastructure.FederatedPrivateInteractionRecord{
		ActorPTID:              command.GetActor().GetActor().GetPtid(),
		CommandID:              command.GetCommandId(),
		SourceStationPeerID:    s.localStationPeerID,
		CanonicalCommandSHA256: append([]byte(nil), command.GetCanonicalCommandSha256()...),
		CommandBytes:           commandBytes,
		State:                  "PENDING_RESULT",
		CreatedAt:              s.now(),
	}
	existing, err := s.interactionStore.LoadFederatedPrivateInteraction(
		ctx,
		transaction,
		candidate.ActorPTID,
		candidate.CommandID,
		candidate.SourceStationPeerID,
	)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	if existing != nil {
		if !sameFederatedPrivateInteraction(*existing, candidate) {
			return federationdelivery.PayloadHashConflictResult(), nil
		}
		if len(existing.ResultBytes) == 0 {
			return federationdelivery.RetryableResult(
				federationdelivery.FrameErrorOverloaded,
			), nil
		}
		if err := s.enqueueFederatedPrivateInteractionResult(
			ctx,
			transaction,
			command,
			existing.ResultBytes,
			s.now(),
		); err != nil {
			return federationdelivery.Result{}, err
		}
		s.metrics.replayTotal.Inc("private_interaction", "replay", "exact")
		return federationdelivery.DuplicateResult(), nil
	}

	canonicalResult, executeErr := s.executeFederatedPrivateInteraction(
		ctx,
		transaction,
		command,
	)
	resultKind := privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED
	if executeErr != nil {
		if federatedPrivateInteractionRetryable(executeErr) {
			s.observeFederatedPrivateInteraction(
				startedAt,
				command.GetOperation().String(),
				"retryable",
				string(socialdomain.PrivateContentCodeOf(executeErr)),
			)
			return federationdelivery.RetryableResult(
				federationdelivery.FrameErrorOverloaded,
			), nil
		}
		resultKind = privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_TERMINAL_REJECTION
		canonicalResult, err = canonicalFederatedPrivateInteractionError(executeErr)
		if err != nil {
			return federationdelivery.Result{}, err
		}
	}
	resultHash := sha256.Sum256(canonicalResult)
	result := &privatecontentpb.FederatedPrivateInteractionResult{
		FormatVersion:          socialdomain.PrivateContentFormatVersion,
		CommandId:              command.GetCommandId(),
		CanonicalCommandSha256: append([]byte(nil), command.GetCanonicalCommandSha256()...),
		Kind:                   resultKind,
		CanonicalResult:        canonicalResult,
		CanonicalResultSha256:  resultHash[:],
	}
	resultBytes, err := socialdomain.CanonicalProtoBytes(result)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	persisted, inserted, err :=
		s.interactionStore.PutFederatedPrivateInteraction(
			ctx,
			transaction,
			candidate,
		)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	if !inserted && !sameFederatedPrivateInteraction(persisted, candidate) {
		return federationdelivery.PayloadHashConflictResult(), nil
	}
	if _, err := s.interactionStore.ResolveFederatedPrivateInteraction(
		ctx,
		transaction,
		candidate,
		resultBytes,
		s.now(),
	); err != nil {
		return federationdelivery.Result{}, err
	}
	if err := s.enqueueFederatedPrivateInteractionResult(
		ctx,
		transaction,
		command,
		resultBytes,
		s.now(),
	); err != nil {
		return federationdelivery.Result{}, err
	}
	outcome := "committed"
	reason := "none"
	if executeErr != nil {
		outcome = "rejected"
		reason = string(socialdomain.PrivateContentCodeOf(executeErr))
	}
	s.observeFederatedPrivateInteraction(
		startedAt,
		command.GetOperation().String(),
		outcome,
		reason,
	)
	return federationdelivery.AcceptedResult(), nil
}

func (s *PrivateContentService) ReceiveFederatedPrivateInteractionResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	result *privatecontentpb.FederatedPrivateInteractionResult,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	startedAt := time.Now()
	if transaction == nil || transaction.DB() == nil ||
		result == nil || frame == nil ||
		result.GetFormatVersion() != socialdomain.PrivateContentFormatVersion ||
		len(result.ProtoReflect().GetUnknown()) != 0 ||
		frame.GetPayloadKind() != federationdelivery.PayloadKindSocialPrivateResult ||
		frame.GetPayloadId() != result.GetCommandId() ||
		frame.GetTargetStationPeerId() != s.localStationPeerID {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorInvalidFrame,
		), nil
	}
	canonical, err := socialdomain.CanonicalProtoBytes(result)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	resultHash := sha256.Sum256(result.GetCanonicalResult())
	if !bytes.Equal(canonical, frame.GetOpaquePayload()) ||
		!bytes.Equal(frame.GetPayloadSha256(), federationdelivery.PayloadSHA256(canonical)) ||
		!bytes.Equal(resultHash[:], result.GetCanonicalResultSha256()) {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorInvalidFrame,
		), nil
	}
	record, err := s.interactionStore.LoadFederatedPrivateInteractionByCommand(
		ctx,
		transaction,
		result.GetCommandId(),
		frame.GetSourceStationPeerId(),
	)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	if record == nil ||
		!bytes.Equal(
			record.CanonicalCommandSHA256,
			result.GetCanonicalCommandSha256(),
		) {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	}
	if len(record.ResultBytes) != 0 {
		if bytes.Equal(record.ResultBytes, canonical) {
			s.metrics.replayTotal.Inc("private_interaction_result", "replay", "exact")
			return federationdelivery.DuplicateResult(), nil
		}
		return federationdelivery.PayloadHashConflictResult(), nil
	}
	command := &privatecontentpb.FederatedPrivateInteractionCommand{}
	if err := proto.Unmarshal(record.CommandBytes, command); err != nil {
		return federationdelivery.Result{}, err
	}
	if command.GetSourceResourceStationPeerId() != frame.GetSourceStationPeerId() ||
		command.GetActorHomeStationPeerId() != s.localStationPeerID ||
		command.GetActor().GetActor().GetPtid() != record.ActorPTID {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	}
	if err := s.federationMembership.ValidateActiveStationPair(
		ctx,
		command.GetFederationId(),
		frame.GetSourceStationPeerId(),
		s.localStationPeerID,
	); err != nil {
		if errors.Is(err, federationdomain.ErrInactiveStationPair) {
			return federationdelivery.TerminalResult(
				federationdelivery.FrameErrorDomainRejected,
			), nil
		}
		return federationdelivery.RetryableResult(
			federationdelivery.FrameErrorOverloaded,
		), nil
	}
	switch result.GetKind() {
	case privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED,
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_RETRYABLE_REJECTION,
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_TERMINAL_REJECTION:
	default:
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	}
	if result.GetKind() ==
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED &&
		command.GetOperation() ==
			privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT {
		if err := s.trustFederatedPrivateCommentPlan(
			ctx,
			transaction,
			result.GetCanonicalResult(),
			frame.GetSourceStationPeerId(),
		); err != nil {
			return deliveryResultForPrivateContentError(err), nil
		}
	}
	if result.GetKind() ==
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED &&
		command.GetOperation() ==
			privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT {
		if err := s.importFederatedPrivateCommentResult(
			ctx,
			transaction,
			command,
			result.GetCanonicalResult(),
			frame,
		); err != nil {
			return deliveryResultForPrivateContentError(err), nil
		}
	}
	if result.GetKind() ==
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED &&
		(command.GetOperation() ==
			privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT ||
			command.GetOperation() ==
				privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT) {
		if err := s.importFederatedPrivateReactionResult(
			ctx,
			transaction,
			command,
			result.GetCanonicalResult(),
			frame,
		); err != nil {
			return deliveryResultForPrivateContentError(err), nil
		}
	}
	if _, err := s.interactionStore.ResolveFederatedPrivateInteraction(
		ctx,
		transaction,
		*record,
		canonical,
		s.now(),
	); err != nil {
		return federationdelivery.Result{}, err
	}
	s.observeFederatedPrivateInteraction(
		startedAt,
		command.GetOperation().String(),
		"resolved",
		result.GetKind().String(),
	)
	return federationdelivery.AcceptedResult(), nil
}

func (s *PrivateContentService) trustFederatedPrivateCommentPlan(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	canonicalResult []byte,
	sourceStationPeerID string,
) error {
	const operation = "social.private_content.trust_federated_comment_plan"
	response := &privatecontentpb.PreparePrivateCommentResponse{}
	if err := proto.Unmarshal(canonicalResult, response); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	plan := response.GetPlan()
	attestation := response.GetStationSigningKeyAttestation()
	if plan == nil || attestation == nil ||
		attestation.GetStationPeerId() != sourceStationPeerID ||
		attestation.GetProofSigningKeyId() != plan.GetStationSigningKeyId() {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"attestation",
			"does not bind the source-signed plan",
		)
	}
	if err := s.stationSigner.TrustImportedContentProofVerificationKeyInTransaction(
		ctx,
		transaction,
		sourceStationPeerID,
		attestation.GetProofSigningKeyId(),
		attestation.GetProofEd25519PublicKey(),
		s.now(),
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	return nil
}

func (s *PrivateContentService) localizeFederatedPrivateCommentPlan(
	ctx context.Context,
	response *privatecontentpb.PreparePrivateCommentResponse,
) error {
	const operation = "social.private_content.localize_federated_comment_plan"
	plan := response.GetPlan()
	sourceAttestation := response.GetStationSigningKeyAttestation()
	if plan == nil || sourceAttestation == nil ||
		sourceAttestation.GetStationPeerId() == "" ||
		sourceAttestation.GetProofSigningKeyId() != plan.GetStationSigningKeyId() {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"attestation",
			"is unavailable",
		)
	}
	attestation, err := s.stationSigner.AttestImportedContentProofVerificationKey(
		ctx,
		sourceAttestation.GetStationPeerId(),
		plan.GetStationSigningKeyId(),
		s.now(),
	)
	if err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	response.StationSigningKeyAttestation = attestation
	return nil
}

func (s *PrivateContentService) executeFederatedPrivateInteraction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
) ([]byte, error) {
	binder, ok := s.store.(interface {
		BindFederationTransaction(
			federationdelivery.Transaction,
		) (*infrastructure.GORMPrivateContentStore, error)
	})
	if !ok {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.execute_federated_interaction",
			"store",
			"does not support transaction binding",
		)
	}
	boundStore, err := binder.BindFederationTransaction(transaction)
	if err != nil {
		return nil, mapPrivateStoreError(
			"social.private_content.execute_federated_interaction",
			err,
		)
	}
	bound := *s
	bound.store = boundStore
	bound.interactionStore = boundStore
	author := socialdomain.PrivateContentAuthor{
		Endpoint: proto.Clone(
			command.GetActor(),
		).(*actormodel.ActorDeviceRef),
		HomeStationPeerID: command.GetActorHomeStationPeerId(),
	}
	switch command.GetOperation() {
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT:
		request := &privatecontentpb.PreparePrivateCommentRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.decode_federated_prepare_comment",
				err,
			)
		}
		response, err := bound.preparePrivateComment(
			ctx,
			author,
			request,
			transaction,
			false,
			command.GetFederationId(),
		)
		if err != nil {
			return nil, err
		}
		return socialdomain.CanonicalProtoBytes(response)
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT:
		request := &privatecontentpb.SubmitPrivateCommentRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.decode_federated_submit_comment",
				err,
			)
		}
		response, err := bound.submitPrivateComment(
			ctx,
			author.Endpoint,
			request,
			command.GetFederationId(),
		)
		if err != nil {
			return nil, err
		}
		access := response.GetComment().GetPrivateContent()
		proof := access.GetVerification().GetCommitProof()
		attestation, err := s.stationSigner.
			AttestContentProofVerificationKeyInTransaction(
				ctx,
				transaction,
				proof.GetStationSigningKeyId(),
				s.now(),
			)
		if err != nil {
			return nil, mapPrivateDependencyError(
				"social.private_content.attest_federated_comment_result",
				err,
			)
		}
		access.Verification.StationSigningKeyAttestation = attestation
		return socialdomain.CanonicalProtoBytes(response)
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT:
		request := &actormodel.ReactToPostRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.decode_federated_reaction",
				err,
			)
		}
		response, err := bound.executeFederatedPrivateReaction(
			ctx,
			transaction,
			command,
			request.GetKind(),
			false,
		)
		if err != nil {
			return nil, err
		}
		return socialdomain.CanonicalProtoBytes(&actormodel.ReactToPostResponse{
			Success:            true,
			Reactions:          response.Reactions,
			CommandId:          command.GetCommandId(),
			ProjectionRevision: response.ProjectionRevision,
		})
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT:
		request := &actormodel.UnreactToPostRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				"social.private_content.decode_federated_unreaction",
				err,
			)
		}
		response, err := bound.executeFederatedPrivateReaction(
			ctx,
			transaction,
			command,
			request.GetKind(),
			true,
		)
		if err != nil {
			return nil, err
		}
		return socialdomain.CanonicalProtoBytes(&actormodel.UnreactToPostResponse{
			Success:            true,
			Reactions:          response.Reactions,
			CommandId:          command.GetCommandId(),
			ProjectionRevision: response.ProjectionRevision,
		})
	default:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.execute_federated_interaction",
			"operation",
			"is not supported",
		)
	}
}

type federatedPrivateReactionExecution struct {
	Reactions          []*actormodel.ReactionSummary
	ProjectionRevision uint64
}

func (s *PrivateContentService) executeFederatedPrivateReaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	kind actormodel.ReactionKind,
	removed bool,
) (federatedPrivateReactionExecution, error) {
	const operation = "social.private_content.execute_federated_reaction"
	if s.interactionStore == nil || s.events == nil {
		return federatedPrivateReactionExecution{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrationGap,
				operation,
				"dependencies",
				"reaction store and event publisher are required",
			)
	}
	actorPTID := command.GetActor().GetActor().GetPtid()
	mutation, err := s.interactionStore.MutateFederatedPrivateReaction(
		ctx,
		transaction,
		s.localStationPeerID,
		command.GetParent(),
		actorPTID,
		kind,
		removed,
		s.now(),
	)
	if err != nil {
		return federatedPrivateReactionExecution{},
			mapPrivateStoreError(operation, err)
	}
	reactionService := NewReactionService(
		transaction.DB(),
		infrastructure.NewRepos(transaction.DB()),
	)
	actorSummaries, err := reactionService.summarizeVisible(
		ctx,
		mutation.Reactions,
		mutation.PostAuthorPTID,
		actorPTID,
	)
	if err != nil {
		return federatedPrivateReactionExecution{}, err
	}
	actorProjection := reactionService.toProtoSummaries(actorSummaries)
	authorSummaries, err := reactionService.summarizeVisible(
		ctx,
		mutation.Reactions,
		mutation.PostAuthorPTID,
		mutation.PostAuthorPTID,
	)
	if err != nil {
		return federatedPrivateReactionExecution{}, err
	}
	projections := []infrastructure.FederatedPrivateReactionProjection{
		{
			SourceStationPeerID: s.localStationPeerID,
			PostID:              command.GetParent().GetContentId(),
			ViewerPTID:          actorPTID,
			ProjectionRevision:  mutation.ProjectionRevision,
			CommandID:           command.GetCommandId(),
			Reactions:           actorProjection,
			UpdatedAt:           s.now(),
		},
	}
	if mutation.PostAuthorPTID != actorPTID {
		projections = append(
			projections,
			infrastructure.FederatedPrivateReactionProjection{
				SourceStationPeerID: s.localStationPeerID,
				PostID:              command.GetParent().GetContentId(),
				ViewerPTID:          mutation.PostAuthorPTID,
				ProjectionRevision:  mutation.ProjectionRevision,
				CommandID:           command.GetCommandId(),
				Reactions: reactionService.toProtoSummaries(
					authorSummaries,
				),
				UpdatedAt: s.now(),
			},
		)
	}
	for _, projection := range projections {
		if _, err := s.interactionStore.
			PutFederatedPrivateReactionProjection(
				ctx,
				transaction,
				projection,
			); err != nil {
			return federatedPrivateReactionExecution{},
				mapPrivateStoreError(operation, err)
		}
	}
	if err := s.events.StagePrivateReacted(
		ctx,
		transaction,
		command.GetParent().GetContentId(),
		actorPTID,
		mutation.PostAuthorPTID,
		kind,
		removed,
	); err != nil {
		return federatedPrivateReactionExecution{},
			mapPrivateDependencyError(operation, err)
	}
	return federatedPrivateReactionExecution{
		Reactions:          actorProjection,
		ProjectionRevision: mutation.ProjectionRevision,
	}, nil
}

func (s *PrivateContentService) validateFederatedPrivateInteractionCommand(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.validate_federated_interaction"
	if s.interactionStore == nil ||
		s.localStationPeerID == "" ||
		s.federationMembership == nil ||
		transaction == nil || transaction.DB() == nil ||
		command == nil || frame == nil ||
		command.GetFormatVersion() != socialdomain.PrivateContentFormatVersion ||
		len(command.ProtoReflect().GetUnknown()) != 0 {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"command",
			"is invalid",
		)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(command)
	if err != nil {
		return err
	}
	expectedHash, err := canonicalFederatedPrivateInteractionCommandHash(command)
	if err != nil {
		return err
	}
	if frame.GetPayloadKind() != federationdelivery.PayloadKindSocialPrivateInteraction ||
		frame.GetPayloadId() != command.GetCommandId() ||
		frame.GetSourceStationPeerId() != command.GetActorHomeStationPeerId() ||
		frame.GetTargetStationPeerId() != command.GetSourceResourceStationPeerId() ||
		command.GetSourceResourceStationPeerId() != s.localStationPeerID ||
		!bytes.Equal(frame.GetOpaquePayload(), canonical) ||
		!bytes.Equal(frame.GetPayloadSha256(), federationdelivery.PayloadSHA256(canonical)) ||
		!bytes.Equal(command.GetCanonicalCommandSha256(), expectedHash) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"frame",
			"does not bind the canonical interaction command",
		)
	}
	for field, value := range map[string]string{
		"federation_id":                   command.GetFederationId(),
		"command_id":                      command.GetCommandId(),
		"actor_home_station_peer_id":      command.GetActorHomeStationPeerId(),
		"source_resource_station_peer_id": command.GetSourceResourceStationPeerId(),
	} {
		if value == "" || value != strings.TrimSpace(value) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				field,
				"must be canonical",
			)
		}
	}
	if command.GetActor() == nil ||
		command.GetActor().GetActor() == nil ||
		strings.TrimSpace(command.GetActor().GetActor().GetPtid()) == "" ||
		strings.TrimSpace(command.GetActor().GetActor().GetAcct()) == "" ||
		command.GetActor().GetActor().GetKind() !=
			actormodel.ActorKind_ACTOR_KIND_PERSON ||
		strings.TrimSpace(command.GetActor().GetDeviceId()) == "" ||
		command.GetParent() == nil ||
		command.GetParent().GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		command.GetParent().GetGeneration() == 0 ||
		len(command.GetCanonicalOperation()) == 0 ||
		strings.TrimSpace(command.GetActorSigningKeyId()) == "" ||
		len(command.GetActorDeviceSignature()) != 64 {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"command",
			"is incomplete or uses unsupported direct actor-signature fields",
		)
	}
	if err := socialdomain.ValidatePrivateContentID(
		command.GetParent().GetContentId(),
		"parent.content_id",
		operation,
	); err != nil {
		return err
	}
	if err := s.federationMembership.ValidateActiveStationPair(
		ctx,
		command.GetFederationId(),
		command.GetActorHomeStationPeerId(),
		s.localStationPeerID,
	); err != nil {
		if errors.Is(err, federationdomain.ErrInactiveStationPair) {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				err,
			)
		}
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	var signedRequest proto.Message
	switch command.GetOperation() {
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT:
		request := &privatecontentpb.PreparePrivateCommentRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil ||
			len(request.ProtoReflect().GetUnknown()) != 0 ||
			request.GetPostId() != command.GetParent().GetContentId() ||
			request.GetCommandId() != command.GetCommandId() ||
			request.GetActorSigningKeyId() != command.GetActorSigningKeyId() ||
			!bytes.Equal(
				request.GetActorDeviceSignature(),
				command.GetActorDeviceSignature(),
			) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"canonical_operation",
				"is not the bound prepare Comment request",
			)
		}
		signedRequest = request
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT:
		request := &privatecontentpb.SubmitPrivateCommentRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil ||
			len(request.ProtoReflect().GetUnknown()) != 0 ||
			request.GetPostId() != command.GetParent().GetContentId() ||
			request.GetCommandId() != command.GetCommandId() ||
			request.GetActorSigningKeyId() != command.GetActorSigningKeyId() ||
			!bytes.Equal(
				request.GetActorDeviceSignature(),
				command.GetActorDeviceSignature(),
			) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"canonical_operation",
				"is not the bound submit Comment request",
			)
		}
		signedRequest = request
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT:
		request := &actormodel.ReactToPostRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil ||
			validateFederatedPrivateReactionRequest(request, operation) != nil ||
			request.GetPostId() != command.GetParent().GetContentId() ||
			request.GetCommandId() != command.GetCommandId() ||
			request.GetActorSigningKeyId() != command.GetActorSigningKeyId() ||
			!bytes.Equal(
				request.GetActorDeviceSignature(),
				command.GetActorDeviceSignature(),
			) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"canonical_operation",
				"is not the bound Reaction request",
			)
		}
		signedRequest = request
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT:
		request := &actormodel.UnreactToPostRequest{}
		if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil ||
			validateFederatedPrivateReactionRequest(request, operation) != nil ||
			request.GetPostId() != command.GetParent().GetContentId() ||
			request.GetCommandId() != command.GetCommandId() ||
			request.GetActorSigningKeyId() != command.GetActorSigningKeyId() ||
			!bytes.Equal(
				request.GetActorDeviceSignature(),
				command.GetActorDeviceSignature(),
			) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"canonical_operation",
				"is not the bound unreaction request",
			)
		}
		signedRequest = request
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			operation,
			"operation",
			"is not supported by the private interaction flow",
		)
	}
	signingBytes, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		command.GetOperation(),
		signedRequest,
	)
	if err != nil {
		return err
	}
	if err := s.signatureVerifier.Verify(
		ctx,
		transaction,
		command.GetActor(),
		command.GetActorHomeStationPeerId(),
		command.GetActorSigningKeyId(),
		signingBytes,
		command.GetActorDeviceSignature(),
		frame.GetIssuedAt().AsTime(),
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			err,
		)
	}
	return nil
}

func (s *PrivateContentService) enqueueFederatedPrivateInteractionResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	resultBytes []byte,
	now time.Time,
) error {
	frame, err := s.signFederatedPrivateInteractionFrame(
		ctx,
		transaction,
		federationdelivery.PayloadKindSocialPrivateResult,
		command.GetCommandId(),
		command.GetActorHomeStationPeerId(),
		resultBytes,
		2,
		now,
	)
	if err != nil {
		return err
	}
	if transaction.Outbox() == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInternal,
			"social.private_content.enqueue_federated_interaction_result",
			"outbox",
			"is not transaction-bound",
		)
	}
	_, err = transaction.Outbox().Enqueue(ctx, frame, now)
	return err
}

func (s *PrivateContentService) signFederatedPrivateInteractionFrame(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	kind federationdelivery.PayloadKind,
	commandID string,
	targetStationPeerID string,
	payload []byte,
	orderingSequence int64,
	now time.Time,
) (*federationdelivery.Frame, error) {
	identity := deterministicPrivateID(
		"interaction-frame",
		kind.String(),
		s.localStationPeerID,
		targetStationPeerID,
		commandID,
	)
	keyID, err := s.stationSigner.SigningKeyIDInTransaction(ctx, transaction)
	if err != nil {
		return nil, mapPrivateDependencyError(
			"social.private_content.sign_federated_interaction",
			err,
		)
	}
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "social-private-interaction-frame:" + identity,
		SourceStationPeerId: s.localStationPeerID,
		TargetStationPeerId: targetStationPeerID,
		IdempotencyKey:      "social-private-interaction:" + identity,
		PayloadKind:         kind,
		PayloadId:           commandID,
		OrderingKey:         "social-private-interaction:" + commandID,
		OrderingSequence:    orderingSequence,
		OpaquePayload:       append([]byte(nil), payload...),
		PayloadSha256:       federationdelivery.PayloadSHA256(payload),
		IssuedAt:            timestamppb.New(now.UTC()),
		ExpiresAt: timestamppb.New(
			now.Add(federatedPrivateInteractionFrameLifetime).UTC(),
		),
		SigningKeyId: keyID,
	}
	signingBytes, err := federationdelivery.SigningBytes(frame)
	if err != nil {
		return nil, err
	}
	frame.StationSignature, err = s.stationSigner.SignInTransaction(
		ctx,
		transaction,
		keyID,
		signingBytes,
	)
	if err != nil {
		return nil, mapPrivateDependencyError(
			"social.private_content.sign_federated_interaction",
			err,
		)
	}
	if err := federationdelivery.ValidateFrame(
		frame,
		federationdelivery.DefaultFramePolicy(targetStationPeerID),
		now,
	); err != nil {
		return nil, err
	}
	return frame, nil
}

func canonicalFederatedPrivateInteractionCommandHash(
	command *privatecontentpb.FederatedPrivateInteractionCommand,
) ([]byte, error) {
	if command == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_content.hash_federated_interaction",
			"command",
			"is required",
		)
	}
	input := proto.Clone(command).(*privatecontentpb.FederatedPrivateInteractionCommand)
	input.CanonicalCommandSha256 = nil
	canonical, err := socialdomain.CanonicalProtoBytes(input)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	return digest[:], nil
}

func federatedPrivateInteractionRequestSignature(
	request proto.Message,
) (string, []byte, error) {
	switch request := request.(type) {
	case *privatecontentpb.PreparePrivateCommentRequest:
		return request.GetActorSigningKeyId(),
			append([]byte(nil), request.GetActorDeviceSignature()...),
			nil
	case *privatecontentpb.SubmitPrivateCommentRequest:
		return request.GetActorSigningKeyId(),
			append([]byte(nil), request.GetActorDeviceSignature()...),
			nil
	case *actormodel.ReactToPostRequest:
		return request.GetActorSigningKeyId(),
			append([]byte(nil), request.GetActorDeviceSignature()...),
			nil
	case *actormodel.UnreactToPostRequest:
		return request.GetActorSigningKeyId(),
			append([]byte(nil), request.GetActorDeviceSignature()...),
			nil
	default:
		return "", nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.interaction_request_signature",
			"request",
			"is not supported",
		)
	}
}

func federatedPrivateInteractionSigningBytes(
	operation privatecontentpb.FederatedPrivateInteractionOperation,
	canonicalOperation []byte,
) ([]byte, error) {
	const signingDomain = "peers-touch:social:federated-private-interaction:v1\x00"
	if operation ==
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNSPECIFIED ||
		len(canonicalOperation) == 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_content.interaction_signing_bytes",
			"operation",
			"is invalid",
		)
	}
	var operationBytes [4]byte
	binary.BigEndian.PutUint32(operationBytes[:], uint32(operation))
	signingBytes := make(
		[]byte,
		0,
		len(signingDomain)+len(operationBytes)+len(canonicalOperation),
	)
	signingBytes = append(signingBytes, signingDomain...)
	signingBytes = append(signingBytes, operationBytes[:]...)
	signingBytes = append(signingBytes, canonicalOperation...)
	return signingBytes, nil
}

func canonicalFederatedPrivateInteractionRequestSigningBytes(
	operation privatecontentpb.FederatedPrivateInteractionOperation,
	request proto.Message,
) ([]byte, error) {
	var unsigned proto.Message
	switch request := request.(type) {
	case *privatecontentpb.PreparePrivateCommentRequest:
		cloned := proto.Clone(request).(*privatecontentpb.PreparePrivateCommentRequest)
		cloned.ActorDeviceSignature = nil
		unsigned = cloned
	case *privatecontentpb.SubmitPrivateCommentRequest:
		cloned := proto.Clone(request).(*privatecontentpb.SubmitPrivateCommentRequest)
		cloned.ActorDeviceSignature = nil
		unsigned = cloned
	case *actormodel.ReactToPostRequest:
		cloned := proto.Clone(request).(*actormodel.ReactToPostRequest)
		cloned.ActorDeviceSignature = nil
		unsigned = cloned
	case *actormodel.UnreactToPostRequest:
		cloned := proto.Clone(request).(*actormodel.UnreactToPostRequest)
		cloned.ActorDeviceSignature = nil
		unsigned = cloned
	default:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.interaction_signing_bytes",
			"request",
			"is not supported",
		)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(unsigned)
	if err != nil {
		return nil, err
	}
	return federatedPrivateInteractionSigningBytes(operation, canonical)
}

func validateFederatedPrivateReactionRequest(
	request proto.Message,
	operation string,
) error {
	var (
		postID       string
		commandID    string
		signingKeyID string
		signature    []byte
		kind         actormodel.ReactionKind
	)
	switch request := request.(type) {
	case *actormodel.ReactToPostRequest:
		if request == nil || len(request.ProtoReflect().GetUnknown()) != 0 {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"request",
				"is invalid",
			)
		}
		postID = request.GetPostId()
		commandID = request.GetCommandId()
		signingKeyID = request.GetActorSigningKeyId()
		signature = request.GetActorDeviceSignature()
		kind = request.GetKind()
	case *actormodel.UnreactToPostRequest:
		if request == nil || len(request.ProtoReflect().GetUnknown()) != 0 {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"request",
				"is invalid",
			)
		}
		postID = request.GetPostId()
		commandID = request.GetCommandId()
		signingKeyID = request.GetActorSigningKeyId()
		signature = request.GetActorDeviceSignature()
		kind = request.GetKind()
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			operation,
			"request",
			"is not a private Reaction request",
		)
	}
	if err := socialdomain.ValidatePrivateContentID(
		postID,
		"post_id",
		operation,
	); err != nil {
		return err
	}
	if commandID == "" ||
		commandID != strings.TrimSpace(commandID) ||
		signingKeyID == "" ||
		signingKeyID != strings.TrimSpace(signingKeyID) ||
		len(signature) != 64 ||
		kind == actormodel.ReactionKind_REACTION_UNSPECIFIED ||
		actormodel.ReactionKind_name[int32(kind)] == "" {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"request",
			"is incomplete or non-canonical",
		)
	}
	return nil
}

func sameFederatedPrivateInteraction(
	left infrastructure.FederatedPrivateInteractionRecord,
	right infrastructure.FederatedPrivateInteractionRecord,
) bool {
	return left.ActorPTID == right.ActorPTID &&
		left.CommandID == right.CommandID &&
		left.SourceStationPeerID == right.SourceStationPeerID &&
		bytes.Equal(left.CanonicalCommandSHA256, right.CanonicalCommandSHA256) &&
		bytes.Equal(left.CommandBytes, right.CommandBytes)
}

func federatedPrivateInteractionRetryable(err error) bool {
	switch socialdomain.PrivateContentCodeOf(err) {
	case socialdomain.PrivateContentDependency,
		socialdomain.PrivateContentInternal,
		socialdomain.PrivateContentRecipientKeyUnavailable,
		socialdomain.PrivateContentRateLimited:
		return true
	default:
		return false
	}
}

func canonicalFederatedPrivateInteractionError(err error) ([]byte, error) {
	code := actormodel.ErrorCode_ERROR_CODE_INVALID_REQUEST
	switch socialdomain.PrivateContentCodeOf(err) {
	case socialdomain.PrivateContentUnauthorized:
		code = actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED
	case socialdomain.PrivateContentNotFound:
		code = actormodel.ErrorCode_ERROR_CODE_POST_NOT_FOUND
	case socialdomain.PrivateContentDependency,
		socialdomain.PrivateContentInternal:
		code = actormodel.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR
	}
	details := map[string]string{
		"private_content_code": string(socialdomain.PrivateContentCodeOf(err)),
	}
	if retryAfter := socialdomain.PrivateContentRetryAfter(err); retryAfter > 0 {
		details["retry_after_seconds"] = strconv.FormatInt(
			max(int64(retryAfter/time.Second), 1),
			10,
		)
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(&actormodel.ErrorResponse{
		Code:    code,
		Message: "federated private interaction rejected",
		Details: details,
	})
}

func decodeFederatedPrivateInteractionResult(
	result *privatecontentpb.FederatedPrivateInteractionResult,
	response proto.Message,
) error {
	const operation = "social.private_content.decode_federated_interaction_result"
	if result == nil ||
		result.GetFormatVersion() != socialdomain.PrivateContentFormatVersion ||
		len(result.ProtoReflect().GetUnknown()) != 0 {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"result",
			"is invalid",
		)
	}
	digest := sha256.Sum256(result.GetCanonicalResult())
	if !bytes.Equal(digest[:], result.GetCanonicalResultSha256()) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"result",
			"hash does not match",
		)
	}
	if result.GetKind() ==
		privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED {
		if err := proto.Unmarshal(result.GetCanonicalResult(), response); err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		return nil
	}
	wireError := &actormodel.ErrorResponse{}
	if err := proto.Unmarshal(result.GetCanonicalResult(), wireError); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	code := socialdomain.PrivateContentErrorCode(
		wireError.GetDetails()["private_content_code"],
	)
	if code == "" {
		if result.GetKind() ==
			privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_RETRYABLE_REJECTION {
			code = socialdomain.PrivateContentDependency
		} else {
			code = socialdomain.PrivateContentConflict
		}
	}
	domainError := &socialdomain.PrivateContentError{
		Code:      code,
		Operation: operation,
		Field:     "result",
		Message:   wireError.GetMessage(),
	}
	if seconds, err := strconv.ParseInt(
		wireError.GetDetails()["retry_after_seconds"],
		10,
		64,
	); err == nil && seconds > 0 {
		domainError.RetryAfter = time.Duration(seconds) * time.Second
	}
	return domainError
}

func (s *PrivateContentService) importFederatedPrivateReactionResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	canonicalResult []byte,
	frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.import_federated_reaction_result"
	var (
		reactions          []*actormodel.ReactionSummary
		commandID          string
		projectionRevision uint64
		success            bool
		removed            bool
		requestKind        actormodel.ReactionKind
	)
	switch command.GetOperation() {
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT:
		response := &actormodel.ReactToPostResponse{}
		if err := proto.Unmarshal(canonicalResult, response); err != nil ||
			len(response.ProtoReflect().GetUnknown()) != 0 {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"result",
				"is not a canonical Reaction response",
			)
		}
		request := &actormodel.ReactToPostRequest{}
		if err := proto.Unmarshal(
			command.GetCanonicalOperation(),
			request,
		); err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		reactions = response.GetReactions()
		commandID = response.GetCommandId()
		projectionRevision = response.GetProjectionRevision()
		success = response.GetSuccess()
		requestKind = request.GetKind()
	case privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT:
		response := &actormodel.UnreactToPostResponse{}
		if err := proto.Unmarshal(canonicalResult, response); err != nil ||
			len(response.ProtoReflect().GetUnknown()) != 0 {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"result",
				"is not a canonical unreaction response",
			)
		}
		request := &actormodel.UnreactToPostRequest{}
		if err := proto.Unmarshal(
			command.GetCanonicalOperation(),
			request,
		); err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		reactions = response.GetReactions()
		commandID = response.GetCommandId()
		projectionRevision = response.GetProjectionRevision()
		success = response.GetSuccess()
		requestKind = request.GetKind()
		removed = true
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			operation,
			"operation",
			"is not a private Reaction operation",
		)
	}
	if !success ||
		commandID != command.GetCommandId() ||
		projectionRevision == 0 ||
		requestKind == actormodel.ReactionKind_REACTION_UNSPECIFIED ||
		!federatedPrivateReactionStateMatches(
			reactions,
			requestKind,
			removed,
		) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"result",
			"does not bind the requested Reaction state",
		)
	}
	if err := s.interactionStore.ValidateRemotePrivateReactionParent(
		ctx,
		transaction,
		frame.GetSourceStationPeerId(),
		frame.GetTargetStationPeerId(),
		command.GetFederationId(),
		command.GetParent(),
		command.GetActor().GetActor().GetPtid(),
	); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	applied, err := s.interactionStore.PutFederatedPrivateReactionProjection(
		ctx,
		transaction,
		infrastructure.FederatedPrivateReactionProjection{
			SourceStationPeerID: frame.GetSourceStationPeerId(),
			PostID:              command.GetParent().GetContentId(),
			ViewerPTID:          command.GetActor().GetActor().GetPtid(),
			ProjectionRevision:  projectionRevision,
			CommandID:           commandID,
			Reactions:           reactions,
			UpdatedAt:           s.now(),
		},
	)
	if err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if !applied {
		return nil
	}
	return s.events.StagePrivateReacted(
		ctx,
		transaction,
		command.GetParent().GetContentId(),
		command.GetActor().GetActor().GetPtid(),
		command.GetActor().GetActor().GetPtid(),
		requestKind,
		removed,
	)
}

func federatedPrivateReactionStateMatches(
	reactions []*actormodel.ReactionSummary,
	requestKind actormodel.ReactionKind,
	removed bool,
) bool {
	for _, reaction := range reactions {
		if reaction == nil ||
			reaction.GetKind() ==
				actormodel.ReactionKind_REACTION_UNSPECIFIED ||
			actormodel.ReactionKind_name[int32(reaction.GetKind())] == "" ||
			reaction.GetCount() <= 0 {
			return false
		}
		if reaction.GetKind() == requestKind {
			return reaction.GetReactedByViewer() != removed
		}
	}
	return removed
}

func (s *PrivateContentService) privateMomentPostProjection(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	sourceStationPeerID string,
	viewerPTID string,
	metadata *privatecontentpb.PostMetadata,
) (*actormodel.Post, uint64, error) {
	const operation = "social.private_content.project_private_reactions"
	if metadata == nil || metadata.GetAuthor() == nil {
		return nil, 0, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"metadata",
			"is incomplete",
		)
	}
	if s.interactionStore == nil ||
		strings.TrimSpace(sourceStationPeerID) == "" {
		return nil, 0, nil
	}
	projection, err :=
		s.interactionStore.LoadFederatedPrivateReactionProjection(
			ctx,
			transaction,
			sourceStationPeerID,
			metadata.GetPostId(),
			viewerPTID,
		)
	if err != nil {
		return nil, 0, mapPrivateStoreError(operation, err)
	}
	if projection == nil {
		return nil, 0, nil
	}
	post := &actormodel.Post{
		Id:         metadata.GetPostId(),
		AuthorPtid: metadata.GetAuthor().GetPtid(),
		Type:       metadata.GetType(),
		IsDeleted:  metadata.GetIsDeleted(),
		Audience: &actormodel.Audience{
			Kind: metadata.GetAudienceKind(),
		},
	}
	if metadata.GetCreatedAt() != nil {
		post.CreatedAt = proto.Clone(
			metadata.GetCreatedAt(),
		).(*timestamppb.Timestamp)
	}
	if metadata.GetUpdatedAt() != nil {
		post.UpdatedAt = proto.Clone(
			metadata.GetUpdatedAt(),
		).(*timestamppb.Timestamp)
	}
	if metadata.GetStats() != nil {
		post.Stats = proto.Clone(metadata.GetStats()).(*actormodel.PostStats)
	}
	post.Reactions = make(
		[]*actormodel.ReactionSummary,
		0,
		len(projection.Reactions),
	)
	if post.Stats == nil {
		post.Stats = &actormodel.PostStats{}
	}
	post.Stats.LikesCount = 0
	for _, reaction := range projection.Reactions {
		post.Reactions = append(
			post.Reactions,
			proto.Clone(reaction).(*actormodel.ReactionSummary),
		)
		if reaction.GetKind() == actormodel.ReactionKind_REACTION_LIKE {
			post.Stats.LikesCount = reaction.GetCount()
			if reaction.GetReactedByViewer() {
				if post.Interaction == nil {
					post.Interaction = &actormodel.PostInteraction{}
				}
				post.Interaction.IsLiked = true
			}
		}
	}
	return post, projection.ProjectionRevision, nil
}

func (s *PrivateContentService) importFederatedPrivateCommentResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand,
	canonicalResult []byte,
	frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.import_federated_comment_result"
	response := &privatecontentpb.SubmitPrivateCommentResponse{}
	if err := proto.Unmarshal(canonicalResult, response); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	comment := response.GetComment()
	access := comment.GetPrivateContent()
	verification := access.GetVerification()
	proof := verification.GetCommitProof()
	attestation := verification.GetStationSigningKeyAttestation()
	resource := access.GetPayload().GetResource()
	if comment == nil || access == nil || verification == nil ||
		proof == nil || attestation == nil || resource == nil ||
		access.GetViewerEnvelope() == nil ||
		comment.GetMetadata().GetCreatedAt() == nil ||
		comment.GetMetadata().GetPostId() != command.GetParent().GetContentId() ||
		comment.GetMetadata().GetContentId() != resource.GetContentId() ||
		comment.GetMetadata().GetCommentId() != resource.GetContentId() ||
		comment.GetMetadata().GetAuthor().GetPtid() !=
			command.GetActor().GetActor().GetPtid() ||
		proof.GetAuthor().GetActor().GetPtid() !=
			command.GetActor().GetActor().GetPtid() ||
		attestation.GetStationPeerId() != frame.GetSourceStationPeerId() {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"comment",
			"does not bind the routed command and source proof",
		)
	}
	senderKey := verification.GetReceiverVerifiedSenderSigningKey()
	envelope := access.GetViewerEnvelope()
	binding := envelope.GetBinding()
	if senderKey == nil ||
		senderKey.GetHomeStationPeerId() != command.GetActorHomeStationPeerId() ||
		!proto.Equal(binding.GetSender(), proof.GetAuthor()) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"receiver_verified_sender_signing_key",
			"does not bind the remote Comment author",
		)
	}
	envelopeSigningBytes, err :=
		securecontentkernel.CanonicalEnvelopeBindingBytes(binding)
	if err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if err := verifyFederatedPrivateReceiverVerifiedSender(
		senderKey,
		binding.GetSender(),
		binding.GetSenderSigningKeyId(),
		envelopeSigningBytes,
		envelope.GetSenderSignature(),
		comment.GetMetadata().GetCreatedAt().AsTime(),
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if err := s.stationSigner.TrustImportedContentProofVerificationKeyInTransaction(
		ctx,
		transaction,
		frame.GetSourceStationPeerId(),
		attestation.GetProofSigningKeyId(),
		attestation.GetProofEd25519PublicKey(),
		s.now(),
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	localAttestation, err :=
		s.stationSigner.AttestImportedContentProofVerificationKeyInTransaction(
			ctx,
			transaction,
			frame.GetSourceStationPeerId(),
			proof.GetStationSigningKeyId(),
			s.now(),
		)
	if err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	projectedVerification := proto.Clone(
		verification,
	).(*privatecontentpb.PrivateContentVerification)
	projectedVerification.StationSigningKeyAttestation = localAttestation
	deliveryMessage := &privatecontentpb.FederatedPrivateResourceDelivery{
		FormatVersion: socialdomain.PrivateContentFormatVersion,
		FederationId:  command.GetFederationId(),
		DeliveryId: deterministicPrivateID(
			"federated-resource",
			resource.GetContentId(),
			command.GetActor().GetActor().GetPtid(),
		),
		SourceStationPeerId: frame.GetSourceStationPeerId(),
		TargetStationPeerId: frame.GetTargetStationPeerId(),
		TargetActor: proto.Clone(
			command.GetActor().GetActor(),
		).(*actormodel.ActorRef),
		ResourceKind: privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT,
		Resource: proto.Clone(
			resource,
		).(*securecontentpb.SecureResourceRef),
		LifecycleRevision: resource.GetGeneration(),
		Metadata: &privatecontentpb.FederatedPrivateResourceDelivery_Comment{
			Comment: proto.Clone(
				comment.GetMetadata(),
			).(*privatecontentpb.CommentMetadata),
		},
		Payload: proto.Clone(
			access.GetPayload(),
		).(*securecontentpb.EncryptedPayload),
		TargetActorEnvelopes: []*securecontentpb.ViewerContentKeyEnvelope{
			proto.Clone(
				access.GetViewerEnvelope(),
			).(*securecontentpb.ViewerContentKeyEnvelope),
		},
		Objects:      cloneEncryptedObjects(access.GetObjects()),
		Verification: projectedVerification,
		AudienceExplanation: &actormodel.AudienceExplanation{
			Kind:           actormodel.Audience_CUSTOM_ALLOW,
			ViewerIsAuthor: true,
		},
		CommittedAt: proto.Clone(
			comment.GetMetadata().GetCreatedAt(),
		).(*timestamppb.Timestamp),
	}
	canonicalDelivery, err := socialdomain.CanonicalProtoBytes(deliveryMessage)
	if err != nil {
		return err
	}
	if _, err := s.store.ApplyRemotePrivateResource(
		ctx,
		transaction,
		deliveryMessage,
		canonicalDelivery,
	); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	return s.events.StageImportedCommented(
		ctx,
		transaction,
		comment.GetMetadata().GetPostId(),
		comment.GetMetadata().GetCommentId(),
		comment.GetMetadata().GetAuthor().GetPtid(),
		command.GetActor().GetActor().GetPtid(),
	)
}

func (s *PrivateContentService) observeFederatedPrivateInteraction(
	startedAt time.Time,
	operation string,
	outcome string,
	reason string,
) {
	s.metrics.interactionTotal.Inc(operation, outcome, reason)
	s.metrics.interactionLatency.Observe(
		time.Since(startedAt).Seconds(),
		operation,
		outcome,
	)
}
