package service_test

import (
	"encoding/hex"
	"reflect"
	"testing"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestValidateExactDeliverySet(t *testing.T) {
	alice := deliveryEndpoint(t, "ptid:alice", "alice-device")
	bob := deliveryEndpoint(t, "ptid:bob", "bob-device")
	charlie := deliveryEndpoint(t, "ptid:charlie", "charlie-device")
	required := []valueobject.Endpoint{alice, bob}

	t.Run("accepts exactly one delivery per required endpoint", func(t *testing.T) {
		deliveries := []valueobject.PreparedDelivery{
			preparedDelivery(t, bob, "bob-payload"),
			preparedDelivery(t, alice, "alice-payload"),
		}

		if err := domainservice.ValidateExactDeliverySet(required, deliveries); err != nil {
			t.Fatalf("ValidateExactDeliverySet() error = %v", err)
		}
	})

	tests := []struct {
		name       string
		required   []valueobject.Endpoint
		deliveries func() []valueobject.PreparedDelivery
	}{
		{
			name:     "missing endpoint",
			required: required,
			deliveries: func() []valueobject.PreparedDelivery {
				return []valueobject.PreparedDelivery{
					preparedDelivery(t, alice, "alice-payload"),
				}
			},
		},
		{
			name:     "unexpected endpoint",
			required: required,
			deliveries: func() []valueobject.PreparedDelivery {
				return []valueobject.PreparedDelivery{
					preparedDelivery(t, alice, "alice-payload"),
					preparedDelivery(t, charlie, "charlie-payload"),
				}
			},
		},
		{
			name:     "duplicate delivery",
			required: required,
			deliveries: func() []valueobject.PreparedDelivery {
				return []valueobject.PreparedDelivery{
					preparedDelivery(t, alice, "alice-payload"),
					preparedDelivery(t, alice, "alice-payload-again"),
					preparedDelivery(t, bob, "bob-payload"),
				}
			},
		},
		{
			name:     "tampered payload hash",
			required: required,
			deliveries: func() []valueobject.PreparedDelivery {
				aliceDelivery := preparedDelivery(t, alice, "alice-payload")
				aliceDelivery.Opaque[0] ^= 0xff

				return []valueobject.PreparedDelivery{
					aliceDelivery,
					preparedDelivery(t, bob, "bob-payload"),
				}
			},
		},
		{
			name:     "duplicate required endpoint",
			required: []valueobject.Endpoint{alice, alice},
			deliveries: func() []valueobject.PreparedDelivery {
				return []valueobject.PreparedDelivery{
					preparedDelivery(t, alice, "alice-payload"),
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := domainservice.ValidateExactDeliverySet(test.required, test.deliveries())
			if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
				t.Fatalf(
					"error = %v (code %q), want %q",
					err,
					conversationdomain.CodeOf(err),
					conversationdomain.ErrorCodeDeliverySetMismatch,
				)
			}
		})
	}
}

func TestBuildDeliveryCommitments(t *testing.T) {
	alice := deliveryEndpoint(t, "ptid:alice", "alice-device")
	bob := deliveryEndpoint(t, "ptid:bob", "bob-device")
	aliceDelivery := preparedDelivery(t, alice, "alice-payload")
	bobDelivery := preparedDelivery(t, bob, "bob-payload")

	forward, err := domainservice.BuildDeliveryCommitments(
		valueobject.ConversationID("conversation-1"),
		valueobject.EventID("event-1"),
		[]valueobject.PreparedDelivery{aliceDelivery, bobDelivery},
	)
	if err != nil {
		t.Fatalf("BuildDeliveryCommitments(forward) error = %v", err)
	}
	reverse, err := domainservice.BuildDeliveryCommitments(
		valueobject.ConversationID("conversation-1"),
		valueobject.EventID("event-1"),
		[]valueobject.PreparedDelivery{bobDelivery, aliceDelivery},
	)
	if err != nil {
		t.Fatalf("BuildDeliveryCommitments(reverse) error = %v", err)
	}

	if !reflect.DeepEqual(forward, reverse) {
		t.Fatalf("commitments depend on delivery order:\nforward=%+v\nreverse=%+v", forward, reverse)
	}
	if len(forward) != 2 || forward[0].Hash.IsZero() || forward[1].Hash.IsZero() {
		t.Fatalf("commitments = %+v, want two non-zero hashes", forward)
	}
	const aliceWireVector = "9ff29ab47b5982bf2686af788bc86f7579084e06cc8bd8864d8e7b2d24f74ab5"
	expectedAlice, err := hex.DecodeString(aliceWireVector)
	if err != nil {
		t.Fatal(err)
	}
	for _, commitment := range forward {
		if commitment.Recipient == alice &&
			!reflect.DeepEqual(commitment.Hash.Bytes(), expectedAlice) {
			t.Fatalf(
				"alice commitment = %x, want frozen cross-language vector %s",
				commitment.Hash,
				aliceWireVector,
			)
		}
	}
}

func deliveryEndpoint(t *testing.T, actor string, device string) valueobject.Endpoint {
	t.Helper()

	endpoint, err := valueobject.NewEndpoint(actor, device)
	if err != nil {
		t.Fatalf("NewEndpoint(%q, %q) error = %v", actor, device, err)
	}

	return endpoint
}

func preparedDelivery(
	t *testing.T,
	recipient valueobject.Endpoint,
	payload string,
) valueobject.PreparedDelivery {
	t.Helper()

	delivery, err := valueobject.NewPreparedDelivery(
		recipient,
		valueobject.StationID("station-a"),
		valueobject.DeliveryKindConversation,
		[]byte(payload),
	)
	if err != nil {
		t.Fatalf("NewPreparedDelivery(%+v) error = %v", recipient, err)
	}

	return delivery
}
