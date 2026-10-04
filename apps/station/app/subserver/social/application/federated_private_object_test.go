package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestFederatedPrivateObjectSourceReadAuthorizesAndStreamsRange(t *testing.T) {
	fixture := newFederatedPrivateObjectServiceFixture(t, 64)
	request, canonical := fixture.sourceRequest(t, 3, 11)
	download, err := fixture.service.ReadFederatedPrivateObjectRange(
		context.Background(),
		fixture.claims(t, request, canonical),
		request.GetObjectId(),
		request,
		canonical,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer download.Body.Close()
	body, err := io.ReadAll(download.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body, fixture.body[3:11]) ||
		download.Start != 3 ||
		download.End != 10 ||
		download.TotalSize != uint64(len(fixture.body)) {
		t.Fatalf("source range = %d-%d/%d body=%x", download.Start, download.End, download.TotalSize, body)
	}
}

func TestFederatedPrivateObjectSourceReadRejectsClaimMismatch(t *testing.T) {
	fixture := newFederatedPrivateObjectServiceFixture(t, 64)
	request, canonical := fixture.sourceRequest(t, 0, 8)
	claims := fixture.claims(t, request, canonical)
	claims.Custom["object_id"] = "object-other"

	_, err := fixture.service.ReadFederatedPrivateObjectRange(
		context.Background(),
		claims,
		request.GetObjectId(),
		request,
		canonical,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) || fixture.store.sourceCalls != 0 {
		t.Fatalf("claim mismatch = %v, source calls=%d", err, fixture.store.sourceCalls)
	}
}

func TestFederatedPrivateObjectSourceReadRejectsThirdStation(t *testing.T) {
	fixture := newFederatedPrivateObjectServiceFixture(t, 64)
	localities := canonicalFederatedPrivateObjectLocalities(t, "station-third")
	localitiesDigest := sha256.Sum256(localities)
	fixture.store.source.Plan.RecipientLocalitiesBytes = localities
	fixture.store.source.Plan.RecipientLocalitiesSHA256 =
		localitiesDigest[:]
	request, canonical := fixture.sourceRequest(t, 0, 8)

	_, err := fixture.service.ReadFederatedPrivateObjectRange(
		context.Background(),
		fixture.claims(t, request, canonical),
		request.GetObjectId(),
		request,
		canonical,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) || fixture.blobs.openCalls != 0 {
		t.Fatalf("third-Station read = %v, opens=%d", err, fixture.blobs.openCalls)
	}
}

func TestFederatedPrivateObjectRecipientRejectsRevokedEndpointBeforeMint(
	t *testing.T,
) {
	fixture := newFederatedPrivateObjectServiceFixture(t, 64)
	fixture.endpoints.err = ErrPrivateContentInactiveEndpoint
	fixture.configureRecipient(t)

	_, err := fixture.service.Download(
		context.Background(),
		fixture.viewer,
		fixture.objectID,
		fixture.descriptorSHA256,
		0,
		7,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) || fixture.peer.calls != 0 {
		t.Fatalf("revoked endpoint = %v, peer calls=%d", err, fixture.peer.calls)
	}
}

func TestFederatedPrivateObjectRecipientProxyPartitionsAndValidatesHeaders(
	t *testing.T,
) {
	total := int(2*socialdomain.FederatedPrivateObjectRangeLimit + 49)
	t.Run("normalizes an absent range to the full object", func(t *testing.T) {
		fixture := newFederatedPrivateObjectServiceFixture(t, 64)
		fixture.configureRecipient(t)
		download, err := fixture.service.Download(
			context.Background(),
			fixture.viewer,
			fixture.objectID,
			fixture.descriptorSHA256,
			-1,
			-1,
		)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(download.Body)
		if err != nil {
			t.Fatal(err)
		}
		if err := download.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(body, fixture.body) ||
			download.Start != 0 ||
			download.End != int64(len(fixture.body)-1) ||
			len(fixture.peer.requests) != 1 ||
			fixture.peer.requests[0].GetRange().GetStart() != 0 ||
			fixture.peer.requests[0].GetRange().GetEndExclusive() !=
				uint64(len(fixture.body)) {
			t.Fatalf(
				"full object = %d-%d body=%d requests=%v",
				download.Start,
				download.End,
				len(body),
				fixture.peer.requests,
			)
		}
	})

	t.Run("inactive membership precedes range disposition", func(t *testing.T) {
		fixture := newFederatedPrivateObjectServiceFixture(t, 64)
		fixture.configureRecipient(t)
		fixture.membership.err = errors.New("inactive Federation")
		_, err := fixture.service.Download(
			context.Background(),
			fixture.viewer,
			fixture.objectID,
			fixture.descriptorSHA256,
			64,
			65,
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentNotFound,
		) || fixture.peer.calls != 0 {
			t.Fatalf(
				"inactive membership = %v, peer calls=%d",
				err,
				fixture.peer.calls,
			)
		}
	})

	t.Run("partitions and preserves request identity", func(t *testing.T) {
		fixture := newFederatedPrivateObjectServiceFixture(t, total)
		fixture.configureRecipient(t)
		download, err := fixture.service.Download(
			context.Background(),
			fixture.viewer,
			fixture.objectID,
			fixture.descriptorSHA256,
			0,
			-1,
		)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(download.Body)
		if err != nil {
			t.Fatal(err)
		}
		if err := download.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(body, fixture.body) ||
			fixture.peer.calls != 3 ||
			fixture.endpoints.calls != 4 {
			t.Fatalf(
				"proxy bytes=%d peer calls=%d endpoint checks=%d",
				len(body),
				fixture.peer.calls,
				fixture.endpoints.calls,
			)
		}
		if fixture.peer.requestIDs[0] == "" ||
			fixture.peer.requestIDs[0] != fixture.peer.requestIDs[1] ||
			fixture.peer.requestIDs[1] != fixture.peer.requestIDs[2] {
			t.Fatalf("peer request IDs = %v", fixture.peer.requestIDs)
		}
		want := [][2]uint64{
			{0, socialdomain.FederatedPrivateObjectRangeLimit},
			{socialdomain.FederatedPrivateObjectRangeLimit, 2 * socialdomain.FederatedPrivateObjectRangeLimit},
			{2 * socialdomain.FederatedPrivateObjectRangeLimit, uint64(total)},
		}
		for index, request := range fixture.peer.requests {
			if request.GetRange().GetStart() != want[index][0] ||
				request.GetRange().GetEndExclusive() != want[index][1] {
				t.Fatalf("partition %d = %+v", index, request.GetRange())
			}
		}
	})

	t.Run("rejects mismatched peer headers before outer response", func(t *testing.T) {
		fixture := newFederatedPrivateObjectServiceFixture(t, 64)
		fixture.configureRecipient(t)
		fixture.peer.corruptHeader = true
		_, err := fixture.service.Download(
			context.Background(),
			fixture.viewer,
			fixture.objectID,
			fixture.descriptorSHA256,
			0,
			7,
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentIntegrityFailed,
		) {
			t.Fatalf("header mismatch = %v", err)
		}
	})
}

func TestFederatedPrivateObjectMetricsMatrix(t *testing.T) {
	valid := []struct {
		outcome federatedPrivateObjectStreamOutcome
		reason  federatedPrivateObjectStreamReason
	}{
		{federatedPrivateObjectOutcomeAccepted, federatedPrivateObjectReasonNone},
		{federatedPrivateObjectOutcomeRejected, federatedPrivateObjectReasonNotFound},
		{federatedPrivateObjectOutcomeRejected, federatedPrivateObjectReasonRangeInvalid},
		{federatedPrivateObjectOutcomeRejected, federatedPrivateObjectReasonIntegrity},
		{federatedPrivateObjectOutcomeInterrupted, federatedPrivateObjectReasonCancelled},
		{federatedPrivateObjectOutcomeRetryable, federatedPrivateObjectReasonDependency},
	}
	for _, stage := range []federatedPrivateObjectStreamStage{
		federatedPrivateObjectStageRecipientProxy,
		federatedPrivateObjectStageSourceRead,
	} {
		for _, tuple := range valid {
			if !validFederatedPrivateObjectStreamObservation(
				stage,
				tuple.outcome,
				tuple.reason,
			) {
				t.Fatalf("valid metric tuple rejected: %s/%s/%s", stage, tuple.outcome, tuple.reason)
			}
		}
	}
	if validFederatedPrivateObjectStreamObservation(
		federatedPrivateObjectStageSourceRead,
		federatedPrivateObjectOutcomeAccepted,
		federatedPrivateObjectReasonDependency,
	) {
		t.Fatal("invalid metric tuple was accepted")
	}
}

type federatedPrivateObjectServiceFixture struct {
	service          *PrivateObjectService
	store            *federatedPrivateObjectStore
	blobs            *federatedPrivateObjectBlobStore
	endpoints        *federatedPrivateObjectEndpointDirectory
	membership       *federatedPrivateObjectMembership
	peer             *federatedPrivateObjectPeer
	viewer           *actormodel.ActorDeviceRef
	resource         *securecontentpb.SecureResourceRef
	objectID         string
	descriptor       *securecontentpb.EncryptedObjectDescriptor
	descriptorSHA256 []byte
	body             []byte
}

func newFederatedPrivateObjectServiceFixture(
	t *testing.T,
	total int,
) *federatedPrivateObjectServiceFixture {
	t.Helper()
	resource := &securecontentpb.SecureResourceRef{
		OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
		ContentId:   "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		Generation:  7,
	}
	objectID := "object-0123456789abcdef0123456789abcdef"
	descriptor := federatedPrivateObjectDescriptor(
		resource,
		objectID,
		uint64(total),
	)
	descriptorBytes, err := securecontentkernel.CanonicalDescriptorBytes(
		descriptor,
		securecontentkernel.DefaultPolicy(),
	)
	if err != nil {
		t.Fatal(err)
	}
	descriptorDigest := sha256.Sum256(descriptorBytes)
	body := bytes.Repeat([]byte{0x5a}, total)
	recipientLocalities := canonicalFederatedPrivateObjectLocalities(
		t,
		"station-target",
	)
	recipientLocalitiesDigest := sha256.Sum256(recipientLocalities)
	store := &federatedPrivateObjectStore{
		source: infrastructure.FederatedPrivateObjectSource{
			Object: dbmodel.SocialPrivateObjectAttachment{
				ObjectID:                 objectID,
				ContentID:                resource.GetContentId(),
				CanonicalDescriptorBytes: descriptorBytes,
				DescriptorSHA256:         descriptorDigest[:],
				StorageKey:               "social-private/object",
				TotalCiphertextSize:      uint64(total),
				State:                    dbmodel.SocialPrivateObjectAttached,
				DomainCommitID:           resource.GetContentId(),
			},
			Plan: dbmodel.SocialPrivateContentPlan{
				ContentID:                 resource.GetContentId(),
				Generation:                resource.GetGeneration(),
				AuthorHomeStationPeerID:   "station-source",
				RecipientLocalitiesBytes:  recipientLocalities,
				RecipientLocalitiesSHA256: recipientLocalitiesDigest[:],
				State:                     dbmodel.SocialPrivatePlanStateConsumed,
				DomainCommitID:            resource.GetContentId(),
			},
		},
		remote: infrastructure.RemotePrivateObjectProjection{
			FederationID:        "federation:test",
			DeliveryID:          deterministicPrivateID("federated-resource", resource.GetContentId(), "ptid:bob"),
			SourceStationPeerID: "station-source",
			TargetStationPeerID: "station-target",
			TargetActorPTID:     "ptid:bob",
			LifecycleRevision:   resource.GetGeneration(),
			Resource:            proto.Clone(resource).(*securecontentpb.SecureResourceRef),
			Descriptor:          proto.Clone(descriptor).(*securecontentpb.EncryptedObjectDescriptor),
		},
	}
	blobs := &federatedPrivateObjectBlobStore{body: body}
	endpoints := &federatedPrivateObjectEndpointDirectory{}
	membership := &federatedPrivateObjectMembership{}
	peer := &federatedPrivateObjectPeer{
		body:             body,
		descriptorSHA256: descriptorDigest[:],
	}
	service, err := NewPrivateObjectService(
		store,
		blobs,
		endpoints,
		privateContentTestSigner{},
		&privateContentTestClock{now: time.Now()},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ConfigureFederatedRead(
		"station-source",
		membership,
		peer,
	); err != nil {
		t.Fatal(err)
	}
	fixture := &federatedPrivateObjectServiceFixture{
		service:    service,
		store:      store,
		blobs:      blobs,
		endpoints:  endpoints,
		membership: membership,
		peer:       peer,
		viewer: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "device-bob",
		},
		resource:         resource,
		objectID:         objectID,
		descriptor:       descriptor,
		descriptorSHA256: descriptorDigest[:],
		body:             body,
	}
	peer.fixture = fixture

	return fixture
}

func (f *federatedPrivateObjectServiceFixture) sourceRequest(
	t *testing.T,
	start uint64,
	end uint64,
) (*privatecontentpb.ReadFederatedPrivateObjectRequest, []byte) {
	t.Helper()
	binding := &privatecontentpb.FederatedPrivateObjectGrantBinding{
		FormatVersion:       socialdomain.PrivateContentFormatVersion,
		FederationId:        "federation:test",
		DeliveryId:          deterministicPrivateID("federated-resource", f.resource.GetContentId(), "ptid:bob"),
		SourceStationPeerId: "station-source",
		TargetStationPeerId: "station-target",
		TargetActorPtid:     "ptid:bob",
		Resource:            proto.Clone(f.resource).(*securecontentpb.SecureResourceRef),
		LifecycleRevision:   f.resource.GetGeneration(),
		ObjectId:            f.objectID,
		DescriptorSha256:    f.descriptorSHA256,
	}
	grantDigest, err := socialdomain.FederatedPrivateObjectGrantBindingSHA256(
		binding,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := &privatecontentpb.ReadFederatedPrivateObjectRequest{
		FormatVersion:       socialdomain.PrivateContentFormatVersion,
		FederationId:        "federation:test",
		Viewer:              proto.Clone(f.viewer).(*actormodel.ActorDeviceRef),
		Resource:            proto.Clone(f.resource).(*securecontentpb.SecureResourceRef),
		ObjectId:            f.objectID,
		ImportedGrantSha256: grantDigest[:],
		Range: &privatecontentpb.FederatedPrivateObjectRange{
			Start:        start,
			EndExclusive: end,
		},
	}
	canonical, err :=
		socialdomain.CanonicalFederatedPrivateObjectReadRequestBytes(request)
	if err != nil {
		t.Fatal(err)
	}

	return request, canonical
}

func (f *federatedPrivateObjectServiceFixture) claims(
	t *testing.T,
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
	canonical []byte,
) *authfed.VerifiedClaims {
	t.Helper()
	digest := sha256.Sum256(canonical)

	return &authfed.VerifiedClaims{
		Scope:    "social-private-object-read",
		Issuer:   "station-target",
		Audience: "station-source",
		Subject:  request.GetViewer().GetActor().GetPtid(),
		Custom: map[string]string{
			"federation_id":            request.GetFederationId(),
			"source_station_peer_id":   "station-source",
			"target_station_peer_id":   "station-target",
			"actor_ptid":               request.GetViewer().GetActor().GetPtid(),
			"device_id":                request.GetViewer().GetDeviceId(),
			"object_id":                request.GetObjectId(),
			"canonical_request_sha256": hex.EncodeToString(digest[:]),
		},
	}
}

func (f *federatedPrivateObjectServiceFixture) configureRecipient(t *testing.T) {
	t.Helper()
	if err := f.service.ConfigureFederatedRead(
		"station-target",
		f.membership,
		f.peer,
	); err != nil {
		t.Fatal(err)
	}
}

type federatedPrivateObjectStore struct {
	infrastructure.PrivateObjectStore
	source      infrastructure.FederatedPrivateObjectSource
	remote      infrastructure.RemotePrivateObjectProjection
	sourceErr   error
	remoteErr   error
	sourceCalls int
}

func (s *federatedPrivateObjectStore) AuthorizePrivateObjectDownload(
	context.Context,
	string,
	string,
	string,
	[]byte,
) (infrastructure.PrivateObjectDownload, error) {
	return infrastructure.PrivateObjectDownload{},
		infrastructure.ErrPrivateContentNotFound
}

func (s *federatedPrivateObjectStore) AuthorizeFederatedPrivateObjectSource(
	context.Context,
	*securecontentpb.SecureResourceRef,
	string,
	string,
	string,
) (infrastructure.FederatedPrivateObjectSource, error) {
	s.sourceCalls++

	return s.source, s.sourceErr
}

func (s *federatedPrivateObjectStore) FindRemotePrivateObject(
	context.Context,
	string,
	string,
	[]byte,
) (infrastructure.RemotePrivateObjectProjection, error) {
	return s.remote, s.remoteErr
}

type federatedPrivateObjectBlobStore struct {
	body      []byte
	openCalls int
}

func (s *federatedPrivateObjectBlobStore) Save(
	context.Context,
	string,
	io.Reader,
) error {
	return nil
}

func (s *federatedPrivateObjectBlobStore) Open(
	_ context.Context,
	_ string,
	start int64,
	end int64,
) (io.ReadCloser, int64, error) {
	s.openCalls++

	return io.NopCloser(bytes.NewReader(s.body[start : end+1])),
		int64(len(s.body)),
		nil
}

func (s *federatedPrivateObjectBlobStore) Stat(
	context.Context,
	string,
) (int64, error) {
	return int64(len(s.body)), nil
}

func (s *federatedPrivateObjectBlobStore) Delete(
	context.Context,
	string,
) error {
	return nil
}

type federatedPrivateObjectEndpointDirectory struct {
	err   error
	calls int
}

func (d *federatedPrivateObjectEndpointDirectory) ValidateActiveEndpoint(
	context.Context,
	*actormodel.ActorDeviceRef,
) error {
	d.calls++

	return d.err
}

type federatedPrivateObjectMembership struct {
	err error
}

func (m *federatedPrivateObjectMembership) ValidateActiveStationPair(
	context.Context,
	string,
	string,
	string,
) error {
	return m.err
}

type federatedPrivateObjectPeer struct {
	fixture          *federatedPrivateObjectServiceFixture
	body             []byte
	descriptorSHA256 []byte
	corruptHeader    bool
	calls            int
	requests         []*privatecontentpb.ReadFederatedPrivateObjectRequest
	requestIDs       []string
}

func (p *federatedPrivateObjectPeer) OpenFederatedPrivateObjectRange(
	_ context.Context,
	_ string,
	requestID string,
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
) (*FederatedPrivateObjectPeerResponse, error) {
	p.calls++
	p.requests = append(
		p.requests,
		proto.Clone(request).(*privatecontentpb.ReadFederatedPrivateObjectRequest),
	)
	p.requestIDs = append(p.requestIDs, requestID)
	start := request.GetRange().GetStart()
	end := request.GetRange().GetEndExclusive()
	length := end - start
	total := uint64(len(p.body))
	descriptorHex := hex.EncodeToString(p.descriptorSHA256)
	metadata, err := socialdomain.EncodeFederatedPrivateObjectMetadataHeader(
		&privatecontentpb.ReadFederatedPrivateObjectResponse{
			DescriptorSha256: p.descriptorSHA256,
			Range: proto.Clone(
				request.GetRange(),
			).(*privatecontentpb.FederatedPrivateObjectRange),
			TotalCiphertextSize: total,
		},
	)
	if err != nil {
		return nil, err
	}
	headers := http.Header{
		"Content-Type":                   {"application/octet-stream"},
		"Accept-Ranges":                  {"bytes"},
		"Content-Length":                 {strconv.FormatUint(length, 10)},
		"Content-Range":                  {fmt.Sprintf("bytes %d-%d/%d", start, end-1, total)},
		"Etag":                           {`"sha256:` + descriptorHex + `"`},
		"X-Descriptor-Sha256":            {descriptorHex},
		"X-Total-Ciphertext-Size":        {strconv.FormatUint(total, 10)},
		"X-Peers-Social-Object-Metadata": {metadata},
	}
	if p.corruptHeader {
		headers.Set("Content-Range", "bytes 0-0/1")
	}

	return &FederatedPrivateObjectPeerResponse{
		StatusCode: http.StatusPartialContent,
		Headers:    headers,
		Body: io.NopCloser(
			bytes.NewReader(p.body[int(start):int(end)]),
		),
	}, nil
}

func canonicalFederatedPrivateObjectLocalities(
	t *testing.T,
	targetStationPeerID string,
) []byte {
	t.Helper()
	encoded, err := socialdomain.CanonicalRecipientLocalitiesBytes(
		[]socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: targetStationPeerID,
			FederationID:      "federation:test",
		}},
	)
	if err != nil {
		t.Fatal(err)
	}

	return encoded
}

func federatedPrivateObjectDescriptor(
	resource *securecontentpb.SecureResourceRef,
	objectID string,
	total uint64,
) *securecontentpb.EncryptedObjectDescriptor {
	chunkSize := uint64(securecontentkernel.ObjectChunkSize)
	tagSize := uint64(securecontentkernel.AES256GCMTagSize)
	chunkCount := uint32(1)
	if total > chunkSize+tagSize {
		chunkCount = uint32((total + chunkSize + tagSize - 1) /
			(chunkSize + tagSize))
	}
	hashes := make([][]byte, chunkCount)
	for index := range hashes {
		hashes[index] = bytes.Repeat([]byte{byte(index + 1)}, sha256.Size)
	}

	return &securecontentpb.EncryptedObjectDescriptor{
		Resource:   proto.Clone(resource).(*securecontentpb.SecureResourceRef),
		ObjectId:   objectID,
		StorageRef: "social-private/object",
		Commitment: &securecontentpb.EncryptedObjectUploadSpec{
			Resource:       proto.Clone(resource).(*securecontentpb.SecureResourceRef),
			ObjectId:       objectID,
			CiphertextSize: total,
			CiphertextSha256: bytes.Repeat(
				[]byte{0x44},
				sha256.Size,
			),
			ChunkSize:             securecontentkernel.ObjectChunkSize,
			ChunkCount:            chunkCount,
			EncryptionSuite:       securecontentkernel.EncryptionSuiteAES256GCMChunked,
			TagSize:               securecontentkernel.AES256GCMTagSize,
			NonceStrategy:         securecontentkernel.NonceStrategyCounter32BE,
			ChunkCiphertextSha256: hashes,
		},
	}
}
