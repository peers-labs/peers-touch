package envelope

import (
	"context"
	"testing"

	"github.com/google/uuid"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newStationURLResolverTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		CREATE TABLE federation_station_membership (
			federation_id TEXT NOT NULL,
			station_peer_id TEXT NOT NULL,
			station_url TEXT NOT NULL,
			status TEXT NOT NULL
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestGORMStationURLResolverUsesActiveDurableMembership(t *testing.T) {
	db := newStationURLResolverTestDB(t)
	if err := db.Exec(`
		INSERT INTO federation_station_membership
			(federation_id, station_peer_id, station_url, status)
		VALUES
			('fed-1', 'station-b', 'http://station-b:18080/', 'active'),
			('fed-old', 'station-b', 'http://retired:18080', 'removed')
	`).Error; err != nil {
		t.Fatal(err)
	}

	url, err := NewGORMStationURLResolver(db).
		ResolveActiveStationURL(context.Background(), "station-b")
	if err != nil {
		t.Fatal(err)
	}
	if url != "http://station-b:18080" {
		t.Fatalf("url = %q", url)
	}
}

func TestGORMStationURLResolverRejectsConflictingDurableURLs(t *testing.T) {
	db := newStationURLResolverTestDB(t)
	if err := db.Exec(`
		INSERT INTO federation_station_membership
			(federation_id, station_peer_id, station_url, status)
		VALUES
			('fed-1', 'station-b', 'http://station-b:18080', 'active'),
			('fed-2', 'station-b', 'http://other:18080', 'active')
	`).Error; err != nil {
		t.Fatal(err)
	}

	_, err := NewGORMStationURLResolver(db).
		ResolveActiveStationURL(context.Background(), "station-b")
	if err == nil {
		t.Fatal("expected conflicting durable Station URLs to fail closed")
	}
}

func TestMarshalFederationDeliveryUsesCanonicalProtoJSON(t *testing.T) {
	body, err := marshalFederationDelivery(&chat.StationEnvelope{
		EnvelopeId:      "envelope-1",
		PayloadType:     chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY,
		PayloadBytes:    []byte{0, 1, 2, 255},
		MembershipEpoch: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded chat.FederationDeliverEnvelopeRequest
	if err := protojson.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Envelope == nil ||
		decoded.Envelope.EnvelopeId != "envelope-1" ||
		decoded.Envelope.PayloadType !=
			chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY ||
		len(decoded.Envelope.PayloadBytes) != 4 {
		t.Fatalf("unexpected decoded envelope: %+v", decoded.Envelope)
	}
}

func TestFederationResponseFailedRejectsApplicationErrorOnHTTP200(t *testing.T) {
	if !federationResponseFailed([]byte(`{"code":400,"error":"bad protobuf"}`)) {
		t.Fatal("application error response must fail delivery")
	}
	if federationResponseFailed([]byte(`{"code":0,"data":{}}`)) {
		t.Fatal("success response must not fail delivery")
	}
}
