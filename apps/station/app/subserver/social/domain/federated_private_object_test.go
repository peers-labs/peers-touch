package domain

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type federatedPrivateObjectFixture struct {
	Binding struct {
		FormatVersion       uint32 `json:"formatVersion"`
		FederationID        string `json:"federationId"`
		DeliveryID          string `json:"deliveryId"`
		SourceStationPeerID string `json:"sourceStationPeerId"`
		TargetStationPeerID string `json:"targetStationPeerId"`
		TargetActorPTID     string `json:"targetActorPtid"`
		Resource            struct {
			ContentID  string `json:"contentId"`
			Generation uint64 `json:"generation"`
		} `json:"resource"`
		LifecycleRevision   uint64 `json:"lifecycleRevision"`
		ObjectID            string `json:"objectId"`
		DescriptorSHA256Hex string `json:"descriptorSha256Hex"`
	} `json:"binding"`
	CanonicalBytesHex string `json:"canonicalBytesHex"`
	SHA256Hex         string `json:"sha256Hex"`
}

func TestFederatedPrivateObjectGrantBindingKnownAnswer(t *testing.T) {
	fixture := readFederatedPrivateObjectFixture(t)
	descriptorSHA256, err := hex.DecodeString(
		fixture.Binding.DescriptorSHA256Hex,
	)
	if err != nil {
		t.Fatal(err)
	}
	binding := &privatecontentpb.FederatedPrivateObjectGrantBinding{
		FormatVersion:       fixture.Binding.FormatVersion,
		FederationId:        fixture.Binding.FederationID,
		DeliveryId:          fixture.Binding.DeliveryID,
		SourceStationPeerId: fixture.Binding.SourceStationPeerID,
		TargetStationPeerId: fixture.Binding.TargetStationPeerID,
		TargetActorPtid:     fixture.Binding.TargetActorPTID,
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   fixture.Binding.Resource.ContentID,
			Generation:  fixture.Binding.Resource.Generation,
		},
		LifecycleRevision: fixture.Binding.LifecycleRevision,
		ObjectId:          fixture.Binding.ObjectID,
		DescriptorSha256:  descriptorSHA256,
	}
	canonical, err := CanonicalFederatedPrivateObjectGrantBindingBytes(
		binding,
	)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(canonical) != fixture.CanonicalBytesHex {
		t.Fatalf("canonical bytes = %x", canonical)
	}
	digest, err := FederatedPrivateObjectGrantBindingSHA256(
		binding,
	)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(digest[:]) != fixture.SHA256Hex {
		t.Fatalf("binding SHA-256 = %x", digest)
	}
}

func TestFederatedPrivateObjectProtoReservations(t *testing.T) {
	descriptor := (&privatecontentpb.ReadFederatedPrivateObjectRequest{}).
		ProtoReflect().
		Descriptor()
	for _, number := range []protoreflect.FieldNumber{6, 7} {
		if descriptor.Fields().ByNumber(number) != nil ||
			!descriptor.ReservedRanges().Has(number) {
			t.Fatalf("field %d is not reserved", number)
		}
	}
	for _, name := range []protoreflect.Name{
		"range_start",
		"range_end_exclusive",
	} {
		if !descriptor.ReservedNames().Has(name) {
			t.Fatalf("field name %q is not reserved", name)
		}
	}
	if descriptor.Fields().ByNumber(8).Name() != "imported_grant_sha256" ||
		descriptor.Fields().ByNumber(9).Name() != "range" {
		t.Fatal("request field numbers do not match CSS-D11")
	}
}

func TestFederatedPrivateObjectRequestRejectsNonCanonicalWire(t *testing.T) {
	request := validFederatedPrivateObjectRequest()
	canonical, err := CanonicalFederatedPrivateObjectReadRequestBytes(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := DecodeCanonicalFederatedPrivateObjectReadRequest(
		canonical,
	); err != nil {
		t.Fatalf("canonical request was rejected: %v", err)
	}
	aliases := [][]byte{
		append(append([]byte(nil), canonical...), 0x08, 0x01),
		append(append([]byte(nil), canonical...), 0x50, 0x01),
		append(
			[]byte{0x08, 0x81, 0x00},
			canonical[2:]...,
		),
		append(
			append([]byte(nil), canonical[2:]...),
			canonical[:2]...,
		),
	}
	rangeField := []byte{0x4a, 0x02, 0x10, 0x10}
	if index := bytes.LastIndex(canonical, rangeField); index >= 0 {
		explicitDefault := append([]byte(nil), canonical[:index]...)
		explicitDefault = append(
			explicitDefault,
			0x4a, 0x04, 0x08, 0x00, 0x10, 0x10,
		)
		explicitDefault = append(
			explicitDefault,
			canonical[index+len(rangeField):]...,
		)
		aliases = append(aliases, explicitDefault)
	} else {
		t.Fatal("canonical request range field was not found")
	}
	for _, alias := range aliases {
		if _, _, err := DecodeCanonicalFederatedPrivateObjectReadRequest(
			alias,
		); err == nil {
			t.Fatalf("non-canonical request was accepted: %x", alias)
		}
	}
}

func TestFederatedPrivateObjectMetadataHeaderCanonicalBounds(t *testing.T) {
	response := &privatecontentpb.ReadFederatedPrivateObjectResponse{
		DescriptorSha256: bytes.Repeat([]byte{0xff}, 32),
		Range: &privatecontentpb.FederatedPrivateObjectRange{
			Start:        math.MaxUint64 - 2,
			EndExclusive: math.MaxUint64 - 1,
		},
		TotalCiphertextSize: math.MaxUint64,
	}
	canonical, err := CanonicalFederatedPrivateObjectResponseBytes(response)
	if err != nil {
		t.Fatal(err)
	}
	header, err := EncodeFederatedPrivateObjectMetadataHeader(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) != FederatedPrivateObjectMetadataLimit ||
		len(header) != FederatedPrivateObjectMetadataHeaderLimit {
		t.Fatalf(
			"metadata bounds = decoded %d encoded %d",
			len(canonical),
			len(header),
		)
	}
	decoded, err := DecodeFederatedPrivateObjectMetadataHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(decoded, response) {
		t.Fatalf("metadata round trip = %v", decoded)
	}
}

func TestFederatedPrivateObjectMetadataHeaderRejectsNonCanonicalBase64URL(
	t *testing.T,
) {
	response := &privatecontentpb.ReadFederatedPrivateObjectResponse{
		DescriptorSha256: bytes.Repeat([]byte{0x22}, 32),
		Range: &privatecontentpb.FederatedPrivateObjectRange{
			EndExclusive: 10,
		},
		TotalCiphertextSize: 10,
	}
	canonical, err := CanonicalFederatedPrivateObjectResponseBytes(response)
	if err != nil {
		t.Fatal(err)
	}
	padded := base64.URLEncoding.EncodeToString(canonical)
	if _, err := DecodeFederatedPrivateObjectMetadataHeader(padded); err == nil {
		t.Fatal("padded base64url metadata was accepted")
	}
	raw := base64.RawURLEncoding.EncodeToString(canonical)
	if len(raw)%4 == 2 || len(raw)%4 == 3 {
		alphabet := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
		index := bytes.IndexByte([]byte(alphabet), raw[len(raw)-1])
		alias := raw[:len(raw)-1] + string(alphabet[index+1])
		if _, err := DecodeFederatedPrivateObjectMetadataHeader(alias); err == nil {
			t.Fatal("base64url metadata with non-zero trailing bits was accepted")
		}
	}
	withUnknown := append(append([]byte(nil), canonical...), 0x20, 0x01)
	if _, err := DecodeFederatedPrivateObjectMetadataHeader(
		base64.RawURLEncoding.EncodeToString(withUnknown),
	); err == nil {
		t.Fatal("metadata with unknown protobuf fields was accepted")
	}
}

func validFederatedPrivateObjectRequest() *privatecontentpb.ReadFederatedPrivateObjectRequest {
	return &privatecontentpb.ReadFederatedPrivateObjectRequest{
		FormatVersion: 1,
		FederationId:  "federation:test",
		Viewer: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "device-bob",
		},
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   "01ARZ3NDEKTSV4RRFFQ69G5FAV",
			Generation:  7,
		},
		ObjectId:            "object-01",
		ImportedGrantSha256: bytes.Repeat([]byte{0x11}, 32),
		Range: &privatecontentpb.FederatedPrivateObjectRange{
			EndExclusive: 16,
		},
	}
}

func readFederatedPrivateObjectFixture(
	t *testing.T,
) federatedPrivateObjectFixture {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	path := filepath.Clean(filepath.Join(
		filepath.Dir(currentFile),
		"../../../../../../tooling/acceptance/fixtures/social/federated-private-object-grant-binding-v1.json",
	))
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture federatedPrivateObjectFixture
	if err := json.Unmarshal(body, &fixture); err != nil {
		t.Fatal(err)
	}

	return fixture
}
