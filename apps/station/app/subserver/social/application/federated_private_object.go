package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

const federatedPrivateObjectMetadataHeader = "X-Peers-Social-Object-Metadata"

// FederatedPrivateObjectPeerResponse is one bounded peer range response.
type FederatedPrivateObjectPeerResponse struct {
	StatusCode int
	Headers    http.Header
	Body       io.ReadCloser
}

// FederatedPrivateObjectPeer opens one authenticated bounded range.
type FederatedPrivateObjectPeer interface {
	OpenFederatedPrivateObjectRange(
		context.Context,
		string,
		string,
		*privatecontentpb.ReadFederatedPrivateObjectRequest,
	) (*FederatedPrivateObjectPeerResponse, error)
}

// FederatedPrivateObjectPeerError preserves a bounded peer HTTP disposition.
type FederatedPrivateObjectPeerError struct {
	StatusCode int
	Cause      error
}

func (e *FederatedPrivateObjectPeerError) Error() string {
	if e == nil {
		return ""
	}

	return fmt.Sprintf("Social private-object peer returned HTTP %d", e.StatusCode)
}

func (e *FederatedPrivateObjectPeerError) Unwrap() error {
	if e == nil {
		return nil
	}

	return e.Cause
}

type federatedPrivateObjectConfig struct {
	localStationPeerID string
	membership         PrivateContentFederationMembership
	peer               FederatedPrivateObjectPeer
}

// ConfigureFederatedRead installs the source and recipient-side CSS-D11 ports.
func (s *PrivateObjectService) ConfigureFederatedRead(
	localStationPeerID string,
	membership PrivateContentFederationMembership,
	peer FederatedPrivateObjectPeer,
) error {
	if s == nil ||
		strings.TrimSpace(localStationPeerID) == "" ||
		localStationPeerID != strings.TrimSpace(localStationPeerID) ||
		membership == nil ||
		peer == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_object.configure_federated_read",
			"dependencies",
			"local Station, membership, and peer transport are required",
		)
	}
	s.federated = &federatedPrivateObjectConfig{
		localStationPeerID: localStationPeerID,
		membership:         membership,
		peer:               peer,
	}

	return nil
}

// ReadFederatedPrivateObjectRange authorizes and opens one source-owned
// ciphertext range after checking every token, body, path, and durable grant
// binding.
func (s *PrivateObjectService) ReadFederatedPrivateObjectRange(
	ctx context.Context,
	claims *authfed.VerifiedClaims,
	pathObjectID string,
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
	canonicalRequest []byte,
) (PrivateObjectDownload, error) {
	startedAt := time.Now()
	reject := func(err error) (PrivateObjectDownload, error) {
		s.observeFederatedPrivateObjectFailure(
			startedAt,
			federatedPrivateObjectStageSourceRead,
			err,
		)

		return PrivateObjectDownload{}, err
	}
	if s.federated == nil {
		return reject(socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentDependency,
			"social.private_object.source_read",
			"federation",
			"is unavailable",
		))
	}
	if err := validateFederatedPrivateObjectClaims(
		claims,
		s.federated.localStationPeerID,
		pathObjectID,
		request,
		canonicalRequest,
	); err != nil {
		return reject(err)
	}
	if err := s.federated.membership.ValidateActiveStationPair(
		ctx,
		request.GetFederationId(),
		s.federated.localStationPeerID,
		claims.Issuer,
	); err != nil {
		return reject(federatedPrivateObjectNotFound(err))
	}
	source, err := s.store.AuthorizeFederatedPrivateObjectSource(
		ctx,
		request.GetResource(),
		request.GetObjectId(),
		request.GetViewer().GetActor().GetPtid(),
		request.GetViewer().GetDeviceId(),
	)
	if err != nil {
		return reject(federatedPrivateObjectNotFound(err))
	}
	descriptor, descriptorDigest, err := canonicalSourceObjectDescriptor(
		source.Object,
		s.policy,
	)
	if err != nil {
		return reject(err)
	}
	if descriptor.GetObjectId() != request.GetObjectId() ||
		!securecontentkernel.EqualResourceRef(
			descriptor.GetResource(),
			request.GetResource(),
		) ||
		descriptor.GetCommitment().GetCiphertextSize() !=
			source.Object.TotalCiphertextSize ||
		source.Plan.ContentID != request.GetResource().GetContentId() ||
		source.Plan.Generation != request.GetResource().GetGeneration() ||
		source.Object.DomainCommitID != source.Plan.DomainCommitID {
		return reject(federatedPrivateObjectIntegrityError(nil))
	}
	localityDigest := sha256.Sum256(source.Plan.RecipientLocalitiesBytes)
	if subtle.ConstantTimeCompare(
		localityDigest[:],
		source.Plan.RecipientLocalitiesSHA256,
	) != 1 {
		return reject(federatedPrivateObjectNotFound(nil))
	}
	localities, err := socialdomain.ParseCanonicalRecipientLocalities(
		source.Plan.RecipientLocalitiesBytes,
	)
	if err != nil {
		return reject(federatedPrivateObjectNotFound(err))
	}
	targetStationPeerID, err := exactFederatedPrivateObjectTarget(
		localities,
		request.GetFederationId(),
		request.GetViewer().GetActor().GetPtid(),
	)
	if err != nil ||
		targetStationPeerID != claims.Issuer ||
		source.Plan.AuthorHomeStationPeerID != s.federated.localStationPeerID {
		return reject(federatedPrivateObjectNotFound(err))
	}
	binding := &privatecontentpb.FederatedPrivateObjectGrantBinding{
		FormatVersion: socialdomain.PrivateContentFormatVersion,
		FederationId:  request.GetFederationId(),
		DeliveryId: deterministicPrivateID(
			"federated-resource",
			request.GetResource().GetContentId(),
			request.GetViewer().GetActor().GetPtid(),
		),
		SourceStationPeerId: s.federated.localStationPeerID,
		TargetStationPeerId: targetStationPeerID,
		TargetActorPtid: request.GetViewer().
			GetActor().
			GetPtid(),
		Resource: proto.Clone(
			request.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		LifecycleRevision: source.Plan.Generation,
		ObjectId:          request.GetObjectId(),
		DescriptorSha256:  descriptorDigest,
	}
	bindingDigest, err :=
		socialdomain.FederatedPrivateObjectGrantBindingSHA256(
			binding,
		)
	if err != nil ||
		subtle.ConstantTimeCompare(
			bindingDigest[:],
			request.GetImportedGrantSha256(),
		) != 1 {
		return reject(federatedPrivateObjectNotFound(err))
	}
	requestedRange := request.GetRange()
	if requestedRange.GetEndExclusive() > descriptor.GetCommitment().
		GetCiphertextSize() {
		return reject(federatedPrivateObjectRangeError())
	}
	body, totalSize, err := s.openFederatedSourceBlob(
		ctx,
		source.Object,
		requestedRange,
	)
	if err != nil {
		return reject(err)
	}
	length := requestedRange.GetEndExclusive() - requestedRange.GetStart()
	observed := newFederatedPrivateObjectObservedReadCloser(
		body,
		length,
		func(outcome federatedPrivateObjectStreamOutcome, reason federatedPrivateObjectStreamReason) {
			s.streamMetrics.observe(
				startedAt,
				federatedPrivateObjectStageSourceRead,
				outcome,
				reason,
			)
		},
	)

	return PrivateObjectDownload{
		Body:             observed,
		Start:            int64(requestedRange.GetStart()),
		End:              int64(requestedRange.GetEndExclusive() - 1),
		TotalSize:        totalSize,
		DescriptorSHA256: descriptorDigest,
	}, nil
}

func (s *PrivateObjectService) downloadFederatedPrivateObject(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	objectID string,
	expectedDescriptorSHA256 []byte,
	start int64,
	end int64,
) (PrivateObjectDownload, error) {
	startedAt := time.Now()
	reject := func(err error) (PrivateObjectDownload, error) {
		s.observeFederatedPrivateObjectFailure(
			startedAt,
			federatedPrivateObjectStageRecipientProxy,
			err,
		)

		return PrivateObjectDownload{}, err
	}
	projection, err := s.store.FindRemotePrivateObject(
		ctx,
		objectID,
		viewer.GetActor().GetPtid(),
		expectedDescriptorSHA256,
	)
	if err != nil {
		return reject(mapPrivateObjectStoreError(
			"social.private_object.remote_projection",
			err,
		))
	}
	if projection.TargetStationPeerID != s.federated.localStationPeerID ||
		projection.TargetActorPTID != viewer.GetActor().GetPtid() ||
		projection.Descriptor == nil ||
		!proto.Equal(projection.Descriptor.GetResource(), projection.Resource) {
		return reject(federatedPrivateObjectNotFound(nil))
	}
	descriptorBytes, err := securecontentkernel.CanonicalDescriptorBytes(
		projection.Descriptor,
		s.policy,
	)
	if err != nil {
		return reject(federatedPrivateObjectIntegrityError(err))
	}
	descriptorDigest := sha256.Sum256(descriptorBytes)
	if subtle.ConstantTimeCompare(
		descriptorDigest[:],
		expectedDescriptorSHA256,
	) != 1 {
		return reject(federatedPrivateObjectNotFound(nil))
	}
	totalSize := projection.Descriptor.GetCommitment().GetCiphertextSize()
	if err := s.federated.membership.ValidateActiveStationPair(
		ctx,
		projection.FederationID,
		projection.SourceStationPeerID,
		projection.TargetStationPeerID,
	); err != nil {
		return reject(federatedPrivateObjectNotFound(err))
	}
	normalizedStart, normalizedEnd, err := normalizePrivateObjectRange(
		start,
		end,
		totalSize,
	)
	if err != nil {
		return reject(err)
	}
	if normalizedStart < 0 {
		normalizedStart = 0
		normalizedEnd = int64(totalSize) - 1
	}
	binding := &privatecontentpb.FederatedPrivateObjectGrantBinding{
		FormatVersion:       socialdomain.PrivateContentFormatVersion,
		FederationId:        projection.FederationID,
		DeliveryId:          projection.DeliveryID,
		SourceStationPeerId: projection.SourceStationPeerID,
		TargetStationPeerId: projection.TargetStationPeerID,
		TargetActorPtid:     projection.TargetActorPTID,
		Resource: proto.Clone(
			projection.Resource,
		).(*securecontentpb.SecureResourceRef),
		LifecycleRevision: projection.LifecycleRevision,
		ObjectId:          objectID,
		DescriptorSha256:  descriptorDigest[:],
	}
	grantDigest, err := socialdomain.FederatedPrivateObjectGrantBindingSHA256(
		binding,
	)
	if err != nil {
		return reject(federatedPrivateObjectIntegrityError(err))
	}
	operationContext, cancel := context.WithCancel(ctx)
	reader := &federatedPrivateObjectPartitionReader{
		ctx:          operationContext,
		cancel:       cancel,
		service:      s,
		projection:   projection,
		viewer:       proto.Clone(viewer).(*actormodel.ActorDeviceRef),
		grantSHA256:  grantDigest[:],
		descriptor:   descriptorDigest[:],
		requestID:    uuid.NewString(),
		nextStart:    uint64(normalizedStart),
		endExclusive: uint64(normalizedEnd) + 1,
		totalSize:    totalSize,
		startedAt:    startedAt,
	}
	if err := reader.openNext(); err != nil {
		cancel()

		return reject(err)
	}

	return PrivateObjectDownload{
		Body:             reader,
		Start:            normalizedStart,
		End:              normalizedEnd,
		TotalSize:        totalSize,
		DescriptorSHA256: descriptorDigest[:],
	}, nil
}

func validateFederatedPrivateObjectClaims(
	claims *authfed.VerifiedClaims,
	localStationPeerID string,
	pathObjectID string,
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
	canonicalRequest []byte,
) error {
	if claims == nil || request == nil || len(canonicalRequest) == 0 {
		return federatedPrivateObjectNotFound(nil)
	}
	requestDigest := sha256.Sum256(canonicalRequest)
	viewer := request.GetViewer()
	actorPTID := viewer.GetActor().GetPtid()
	expected := map[string]string{
		federationruntime.ClaimFederationID:           request.GetFederationId(),
		federationruntime.ClaimSourceStationPeerID:    localStationPeerID,
		federationruntime.ClaimTargetStationPeerID:    claims.Issuer,
		federationruntime.ClaimActorPTID:              actorPTID,
		federationruntime.ClaimDeviceID:               viewer.GetDeviceId(),
		federationruntime.ClaimObjectID:               request.GetObjectId(),
		federationruntime.ClaimCanonicalRequestSHA256: hex.EncodeToString(requestDigest[:]),
	}
	if claims.Scope != federationruntime.SocialPrivateObjectReadScope ||
		strings.TrimSpace(claims.Issuer) == "" ||
		claims.Audience != localStationPeerID ||
		claims.Subject != actorPTID ||
		pathObjectID != request.GetObjectId() ||
		len(claims.Custom) != len(expected) {
		return federatedPrivateObjectNotFound(nil)
	}
	for key, value := range expected {
		if claims.Custom[key] != value {
			return federatedPrivateObjectNotFound(nil)
		}
	}

	return nil
}

func exactFederatedPrivateObjectTarget(
	localities []socialdomain.RecipientLocality,
	federationID string,
	actorPTID string,
) (string, error) {
	target := ""
	for _, locality := range localities {
		if locality.ActorPTID != actorPTID {
			continue
		}
		if target != "" ||
			locality.FederationID != federationID ||
			strings.TrimSpace(locality.HomeStationPeerID) == "" {
			return "", errors.New("recipient locality is ambiguous")
		}
		target = locality.HomeStationPeerID
	}
	if target == "" {
		return "", errors.New("recipient locality is missing")
	}

	return target, nil
}

func canonicalSourceObjectDescriptor(
	object dbmodel.SocialPrivateObjectAttachment,
	policy securecontentkernel.Policy,
) (*securecontentpb.EncryptedObjectDescriptor, []byte, error) {
	descriptor := &securecontentpb.EncryptedObjectDescriptor{}
	if err := proto.Unmarshal(object.CanonicalDescriptorBytes, descriptor); err != nil {
		return nil, nil, federatedPrivateObjectIntegrityError(err)
	}
	canonical, err := securecontentkernel.CanonicalDescriptorBytes(
		descriptor,
		policy,
	)
	if err != nil ||
		!bytes.Equal(canonical, object.CanonicalDescriptorBytes) {
		return nil, nil, federatedPrivateObjectIntegrityError(err)
	}
	digest := sha256.Sum256(canonical)
	if subtle.ConstantTimeCompare(digest[:], object.DescriptorSHA256) != 1 {
		return nil, nil, federatedPrivateObjectIntegrityError(nil)
	}

	return descriptor, digest[:], nil
}

func (s *PrivateObjectService) openFederatedSourceBlob(
	ctx context.Context,
	object dbmodel.SocialPrivateObjectAttachment,
	requestedRange *privatecontentpb.FederatedPrivateObjectRange,
) (io.ReadCloser, uint64, error) {
	storageContext, cancel := context.WithTimeout(
		ctx,
		privateObjectStorageTimeout,
	)
	size, err := s.blobs.Stat(storageContext, object.StorageKey)
	if err != nil {
		cancel()

		return nil, 0, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			"social.private_object.source_read",
			err,
		)
	}
	if size != int64(object.TotalCiphertextSize) {
		cancel()

		return nil, 0, federatedPrivateObjectIntegrityError(nil)
	}
	reader, totalSize, err := s.blobs.Open(
		storageContext,
		object.StorageKey,
		int64(requestedRange.GetStart()),
		int64(requestedRange.GetEndExclusive()-1),
	)
	if err != nil {
		cancel()

		return nil, 0, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			"social.private_object.source_read",
			err,
		)
	}
	if totalSize != size {
		_ = reader.Close()
		cancel()

		return nil, 0, federatedPrivateObjectIntegrityError(nil)
	}

	return &cancelOnCloseReadCloser{
		ReadCloser: reader,
		cancel:     cancel,
	}, uint64(totalSize), nil
}

type federatedPrivateObjectPartitionReader struct {
	ctx          context.Context
	cancel       context.CancelFunc
	service      *PrivateObjectService
	projection   infrastructure.RemotePrivateObjectProjection
	viewer       *actormodel.ActorDeviceRef
	grantSHA256  []byte
	descriptor   []byte
	requestID    string
	nextStart    uint64
	endExclusive uint64
	totalSize    uint64
	current      io.ReadCloser
	remaining    uint64
	startedAt    time.Time
	once         sync.Once
}

func (r *federatedPrivateObjectPartitionReader) Read(
	buffer []byte,
) (int, error) {
	for {
		if len(buffer) == 0 {
			return 0, nil
		}
		if r.current == nil {
			if r.nextStart >= r.endExclusive {
				r.finish(
					federatedPrivateObjectOutcomeAccepted,
					federatedPrivateObjectReasonNone,
				)

				return 0, io.EOF
			}
			if err := r.openNext(); err != nil {
				r.finishForError(err)

				return 0, err
			}
		}
		allowed := len(buffer)
		if uint64(allowed) > r.remaining {
			allowed = int(r.remaining)
		}
		read, err := r.current.Read(buffer[:allowed])
		r.remaining -= uint64(read)
		if err != nil && !errors.Is(err, io.EOF) {
			r.finish(
				federatedPrivateObjectOutcomeRetryable,
				federatedPrivateObjectReasonDependency,
			)

			return read, err
		}
		if errors.Is(err, io.EOF) && r.remaining != 0 {
			integrityErr := federatedPrivateObjectIntegrityError(
				io.ErrUnexpectedEOF,
			)
			r.finishForError(integrityErr)

			return read, integrityErr
		}
		if r.remaining == 0 {
			_ = r.current.Close()
			r.current = nil
			if r.nextStart >= r.endExclusive {
				r.finish(
					federatedPrivateObjectOutcomeAccepted,
					federatedPrivateObjectReasonNone,
				)
			}
		}
		if read != 0 {
			return read, nil
		}
	}
}

func (r *federatedPrivateObjectPartitionReader) Close() error {
	var closeErr error
	if r.current != nil {
		closeErr = r.current.Close()
		r.current = nil
	}
	r.cancel()
	r.finish(
		federatedPrivateObjectOutcomeInterrupted,
		federatedPrivateObjectReasonCancelled,
	)

	return closeErr
}

func (r *federatedPrivateObjectPartitionReader) openNext() error {
	if err := r.service.validateActiveEndpoint(
		r.ctx,
		r.viewer,
		"social.private_object.recipient_proxy",
	); err != nil {
		return federatedPrivateObjectNotFound(err)
	}
	partitionEnd := r.nextStart +
		socialdomain.FederatedPrivateObjectRangeLimit
	if partitionEnd < r.nextStart || partitionEnd > r.endExclusive {
		partitionEnd = r.endExclusive
	}
	request := &privatecontentpb.ReadFederatedPrivateObjectRequest{
		FormatVersion: socialdomain.PrivateContentFormatVersion,
		FederationId:  r.projection.FederationID,
		Viewer:        proto.Clone(r.viewer).(*actormodel.ActorDeviceRef),
		Resource:      proto.Clone(r.projection.Resource).(*securecontentpb.SecureResourceRef),
		ObjectId:      r.projection.Descriptor.GetObjectId(),
		ImportedGrantSha256: append(
			[]byte(nil),
			r.grantSHA256...,
		),
		Range: &privatecontentpb.FederatedPrivateObjectRange{
			Start:        r.nextStart,
			EndExclusive: partitionEnd,
		},
	}
	response, err := r.service.federated.peer.OpenFederatedPrivateObjectRange(
		r.ctx,
		r.projection.SourceStationPeerID,
		r.requestID,
		request,
	)
	if err != nil {
		return mapFederatedPrivateObjectPeerError(err)
	}
	if err := validateFederatedPrivateObjectPeerResponse(
		response,
		request.GetRange(),
		r.totalSize,
		r.descriptor,
	); err != nil {
		_ = response.Body.Close()

		return err
	}
	r.current = response.Body
	r.remaining = partitionEnd - r.nextStart
	r.nextStart = partitionEnd

	return nil
}

func (r *federatedPrivateObjectPartitionReader) finishForError(err error) {
	outcome, reason := federatedPrivateObjectFailureMetric(err)
	r.finish(outcome, reason)
}

func (r *federatedPrivateObjectPartitionReader) finish(
	outcome federatedPrivateObjectStreamOutcome,
	reason federatedPrivateObjectStreamReason,
) {
	r.once.Do(func() {
		r.service.streamMetrics.observe(
			r.startedAt,
			federatedPrivateObjectStageRecipientProxy,
			outcome,
			reason,
		)
	})
}

func validateFederatedPrivateObjectPeerResponse(
	response *FederatedPrivateObjectPeerResponse,
	requestedRange *privatecontentpb.FederatedPrivateObjectRange,
	totalSize uint64,
	descriptorSHA256 []byte,
) error {
	if response == nil || response.Body == nil ||
		response.StatusCode != http.StatusPartialContent {
		return federatedPrivateObjectIntegrityError(nil)
	}
	length := requestedRange.GetEndExclusive() - requestedRange.GetStart()
	descriptorHex := hex.EncodeToString(descriptorSHA256)
	expected := map[string]string{
		"Content-Type":            "application/octet-stream",
		"Accept-Ranges":           "bytes",
		"Content-Length":          strconv.FormatUint(length, 10),
		"Content-Range":           fmt.Sprintf("bytes %d-%d/%d", requestedRange.GetStart(), requestedRange.GetEndExclusive()-1, totalSize),
		"ETag":                    `"sha256:` + descriptorHex + `"`,
		"X-Descriptor-SHA256":     descriptorHex,
		"X-Total-Ciphertext-Size": strconv.FormatUint(totalSize, 10),
	}
	for name, value := range expected {
		values := response.Headers.Values(name)
		if len(values) != 1 || values[0] != value {
			return federatedPrivateObjectIntegrityError(nil)
		}
	}
	metadataValues := response.Headers.Values(
		federatedPrivateObjectMetadataHeader,
	)
	if len(metadataValues) != 1 {
		return federatedPrivateObjectIntegrityError(nil)
	}
	metadata, err := socialdomain.DecodeFederatedPrivateObjectMetadataHeader(
		metadataValues[0],
	)
	if err != nil ||
		!bytes.Equal(metadata.GetDescriptorSha256(), descriptorSHA256) ||
		metadata.GetTotalCiphertextSize() != totalSize ||
		!proto.Equal(metadata.GetRange(), requestedRange) {
		return federatedPrivateObjectIntegrityError(err)
	}

	return nil
}

func newFederatedPrivateObjectObservedReadCloser(
	body io.ReadCloser,
	expected uint64,
	finish func(
		federatedPrivateObjectStreamOutcome,
		federatedPrivateObjectStreamReason,
	),
) io.ReadCloser {
	return &federatedPrivateObjectObservedReadCloser{
		body:      body,
		remaining: expected,
		finish:    finish,
	}
}

type federatedPrivateObjectObservedReadCloser struct {
	body      io.ReadCloser
	remaining uint64
	finish    func(
		federatedPrivateObjectStreamOutcome,
		federatedPrivateObjectStreamReason,
	)
	once sync.Once
}

func (r *federatedPrivateObjectObservedReadCloser) Read(
	buffer []byte,
) (int, error) {
	allowed := len(buffer)
	if uint64(allowed) > r.remaining {
		allowed = int(r.remaining)
	}
	if allowed == 0 {
		r.complete()

		return 0, io.EOF
	}
	read, err := r.body.Read(buffer[:allowed])
	r.remaining -= uint64(read)
	if err != nil && !errors.Is(err, io.EOF) {
		r.once.Do(func() {
			r.finish(
				federatedPrivateObjectOutcomeRetryable,
				federatedPrivateObjectReasonDependency,
			)
		})
	}
	if errors.Is(err, io.EOF) && r.remaining != 0 {
		r.once.Do(func() {
			r.finish(
				federatedPrivateObjectOutcomeRejected,
				federatedPrivateObjectReasonIntegrity,
			)
		})

		return read, io.ErrUnexpectedEOF
	}
	if r.remaining == 0 {
		r.complete()
	}

	return read, err
}

func (r *federatedPrivateObjectObservedReadCloser) Close() error {
	err := r.body.Close()
	r.once.Do(func() {
		r.finish(
			federatedPrivateObjectOutcomeInterrupted,
			federatedPrivateObjectReasonCancelled,
		)
	})

	return err
}

func (r *federatedPrivateObjectObservedReadCloser) complete() {
	r.once.Do(func() {
		r.finish(
			federatedPrivateObjectOutcomeAccepted,
			federatedPrivateObjectReasonNone,
		)
	})
}

func (s *PrivateObjectService) observeFederatedPrivateObjectFailure(
	startedAt time.Time,
	stage federatedPrivateObjectStreamStage,
	err error,
) {
	outcome, reason := federatedPrivateObjectFailureMetric(err)
	s.streamMetrics.observe(startedAt, stage, outcome, reason)
}

func federatedPrivateObjectFailureMetric(
	err error,
) (
	federatedPrivateObjectStreamOutcome,
	federatedPrivateObjectStreamReason,
) {
	switch socialdomain.PrivateContentCodeOf(err) {
	case socialdomain.PrivateContentNotFound,
		socialdomain.PrivateContentUnauthorized:
		return federatedPrivateObjectOutcomeRejected,
			federatedPrivateObjectReasonNotFound
	case socialdomain.PrivateContentInvalidArgument:
		return federatedPrivateObjectOutcomeRejected,
			federatedPrivateObjectReasonRangeInvalid
	case socialdomain.PrivateContentIntegrityFailed,
		socialdomain.PrivateContentConflict:
		return federatedPrivateObjectOutcomeRejected,
			federatedPrivateObjectReasonIntegrity
	default:
		if errors.Is(err, context.Canceled) {
			return federatedPrivateObjectOutcomeInterrupted,
				federatedPrivateObjectReasonCancelled
		}

		return federatedPrivateObjectOutcomeRetryable,
			federatedPrivateObjectReasonDependency
	}
}

func mapFederatedPrivateObjectPeerError(err error) error {
	var peerError *FederatedPrivateObjectPeerError
	if errors.As(err, &peerError) {
		switch peerError.StatusCode {
		case http.StatusNotFound:
			return federatedPrivateObjectNotFound(err)
		case http.StatusRequestedRangeNotSatisfiable:
			return federatedPrivateObjectRangeError()
		}
	}
	if code, ok := federationdelivery.FailureCodeOf(err); ok &&
		code == federationdelivery.FailureInvalidResult {
		return federatedPrivateObjectIntegrityError(err)
	}

	return socialdomain.WrapPrivateContentError(
		socialdomain.PrivateContentDependency,
		"social.private_object.recipient_proxy",
		err,
	)
}

func federatedPrivateObjectNotFound(cause error) error {
	if cause == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentNotFound,
			"social.private_object.federated_read",
			"object_id",
			"was not found",
		)
	}

	return socialdomain.WrapPrivateContentError(
		socialdomain.PrivateContentNotFound,
		"social.private_object.federated_read",
		cause,
	)
}

func federatedPrivateObjectRangeError() error {
	return socialdomain.NewPrivateContentError(
		socialdomain.PrivateContentInvalidArgument,
		"social.private_object.federated_read",
		"range",
		"is not satisfiable",
	)
}

func federatedPrivateObjectIntegrityError(cause error) error {
	if cause == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"social.private_object.federated_read",
			"response",
			"failed integrity validation",
		)
	}

	return socialdomain.WrapPrivateContentError(
		socialdomain.PrivateContentIntegrityFailed,
		"social.private_object.federated_read",
		cause,
	)
}
