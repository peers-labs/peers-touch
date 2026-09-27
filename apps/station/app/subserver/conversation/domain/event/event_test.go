package event_test

import (
	"testing"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestNewRecord(t *testing.T) {
	genesis := mustRecord(t, domainevent.RecordInput{
		ID:               valueobject.EventID("event-1"),
		ConversationID:   valueobject.ConversationID("conversation-1"),
		Sequence:         1,
		CommandID:        valueobject.CommandID("command-1"),
		Actor:            eventEndpoint(t, "ptid:alice", "alice-device"),
		CommittedAt:      time.Date(2026, time.September, 6, 11, 0, 0, 0, time.UTC),
		MembershipEpoch:  1,
		MLSEpoch:         1,
		AuthorityStation: valueobject.StationID("station-a"),
		Fact:             domainevent.NewConversationCreatedFact([]byte("created")),
	})
	next := mustRecord(t, domainevent.RecordInput{
		ID:               valueobject.EventID("event-2"),
		ConversationID:   genesis.ConversationID,
		Sequence:         genesis.Sequence.Next(),
		CommandID:        valueobject.CommandID("command-2"),
		Actor:            genesis.Actor,
		PreviousHash:     genesis.Hash,
		CommittedAt:      genesis.CommittedAt.Add(time.Minute),
		MembershipEpoch:  genesis.MembershipEpoch,
		MLSEpoch:         genesis.MLSEpoch,
		AuthorityStation: genesis.AuthorityStation,
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			valueobject.MessageID("message-1"),
			[]byte("ciphertext"),
		),
	})

	if genesis.Hash.IsZero() || next.Hash.IsZero() {
		t.Fatal("event hashes must be non-zero")
	}
	if next.PreviousHash != genesis.Hash {
		t.Fatalf("next.PreviousHash = %s, want %s", next.PreviousHash, genesis.Hash)
	}
	if next.Hash == genesis.Hash {
		t.Fatal("distinct events have identical hashes")
	}

	t.Run("normalizes committed time to durable database precision", func(t *testing.T) {
		committedAt := time.Date(
			2026,
			time.September,
			6,
			11,
			0,
			0,
			123456789,
			time.UTC,
		)
		record := mustRecord(t, domainevent.RecordInput{
			ID:               "precision-event",
			ConversationID:   genesis.ConversationID,
			Sequence:         1,
			CommandID:        "precision-command",
			Actor:            genesis.Actor,
			CommittedAt:      committedAt,
			MembershipEpoch:  1,
			MLSEpoch:         1,
			AuthorityStation: genesis.AuthorityStation,
			Fact:             domainevent.NewConversationCreatedFact([]byte("created")),
		})
		if !record.CommittedAt.Equal(committedAt.Truncate(time.Microsecond)) {
			t.Fatalf(
				"CommittedAt = %s, want %s",
				record.CommittedAt,
				committedAt.Truncate(time.Microsecond),
			)
		}
		if _, err := domainevent.Rehydrate(record); err != nil {
			t.Fatalf("Rehydrate(normalized timestamp) error = %v", err)
		}
	})

	t.Run("non-genesis requires previous hash", func(t *testing.T) {
		_, err := domainevent.NewRecord(domainevent.RecordInput{
			ID:               valueobject.EventID("event-3"),
			ConversationID:   genesis.ConversationID,
			Sequence:         2,
			CommandID:        valueobject.CommandID("command-3"),
			Actor:            genesis.Actor,
			CommittedAt:      genesis.CommittedAt.Add(2 * time.Minute),
			MembershipEpoch:  1,
			MLSEpoch:         1,
			AuthorityStation: genesis.AuthorityStation,
			Fact: domainevent.NewCommandCommittedFact(
				domainevent.KindMessageCommitted,
				valueobject.MessageID("message-2"),
				[]byte("ciphertext"),
			),
		})
		assertEventErrorCode(t, err, conversationdomain.ErrorCodeHashChainInvalid)
	})

	t.Run("genesis rejects previous hash", func(t *testing.T) {
		_, err := domainevent.NewRecord(domainevent.RecordInput{
			ID:               valueobject.EventID("other-genesis"),
			ConversationID:   genesis.ConversationID,
			Sequence:         1,
			CommandID:        valueobject.CommandID("other-command"),
			Actor:            genesis.Actor,
			PreviousHash:     genesis.Hash,
			CommittedAt:      genesis.CommittedAt,
			MembershipEpoch:  1,
			MLSEpoch:         1,
			AuthorityStation: genesis.AuthorityStation,
			Fact:             domainevent.NewConversationCreatedFact([]byte("created")),
		})
		assertEventErrorCode(t, err, conversationdomain.ErrorCodeHashChainInvalid)
	})
}

func TestRehydrate(t *testing.T) {
	original := mustRecord(t, domainevent.RecordInput{
		ID:               valueobject.EventID("event-1"),
		ConversationID:   valueobject.ConversationID("conversation-1"),
		Sequence:         1,
		CommandID:        valueobject.CommandID("command-1"),
		Actor:            eventEndpoint(t, "ptid:alice", "alice-device"),
		CommittedAt:      time.Date(2026, time.September, 6, 11, 0, 0, 0, time.FixedZone("test", 3600)),
		MembershipEpoch:  1,
		MLSEpoch:         1,
		AuthorityStation: valueobject.StationID("station-a"),
		DeliveryCommitments: []valueobject.Hash{
			valueobject.HashBytes([]byte("delivery-b")),
			valueobject.HashBytes([]byte("delivery-a")),
		},
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			valueobject.MessageID("message-1"),
			[]byte("ciphertext"),
		),
	})

	rehydrated, err := domainevent.Rehydrate(original.Clone())
	if err != nil {
		t.Fatalf("Rehydrate(valid) error = %v", err)
	}
	if rehydrated.Hash != original.Hash {
		t.Fatalf("rehydrated hash = %s, want %s", rehydrated.Hash, original.Hash)
	}
	if rehydrated.CommittedAt.Location() != time.UTC {
		t.Fatalf("rehydrated time location = %v, want UTC", rehydrated.CommittedAt.Location())
	}

	tests := []struct {
		name   string
		mutate func(*domainevent.Record)
	}{
		{
			name: "payload",
			mutate: func(record *domainevent.Record) {
				record.Fact.Payload[0] ^= 0xff
			},
		},
		{
			name: "actor",
			mutate: func(record *domainevent.Record) {
				record.Actor.Actor = valueobject.PTID("ptid:mallory")
			},
		},
		{
			name: "sequence",
			mutate: func(record *domainevent.Record) {
				record.Sequence++
			},
		},
		{
			name: "delivery commitment",
			mutate: func(record *domainevent.Record) {
				record.DeliveryCommitments[0] = valueobject.HashBytes([]byte("tampered"))
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tampered := original.Clone()
			test.mutate(&tampered)

			_, err := domainevent.Rehydrate(tampered)
			assertEventErrorCode(t, err, conversationdomain.ErrorCodeHashChainInvalid)
		})
	}
}

func TestSettingsPatchCanonicalHashBindsOptionalFieldPresence(t *testing.T) {
	empty := ""
	tests := []struct {
		name  string
		patch valueobject.SettingsPatch
	}{
		{name: "name", patch: valueobject.SettingsPatch{Name: &empty}},
		{name: "description", patch: valueobject.SettingsPatch{Description: &empty}},
		{name: "avatar object", patch: valueobject.SettingsPatch{AvatarObjectID: &empty}},
	}

	absent := mustRecord(t, domainevent.RecordInput{
		ID:               "settings-event",
		ConversationID:   "conversation-1",
		Sequence:         1,
		CommandID:        "settings-command",
		Actor:            eventEndpoint(t, "ptid:alice", "alice-device"),
		CommittedAt:      time.Date(2026, time.September, 6, 11, 0, 0, 0, time.UTC),
		MembershipEpoch:  1,
		MLSEpoch:         1,
		AuthorityStation: "station-a",
		Fact:             domainevent.NewSettingsChangedFact(valueobject.SettingsPatch{}, nil),
	})

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			explicit := mustRecord(t, domainevent.RecordInput{
				ID:               absent.ID,
				ConversationID:   absent.ConversationID,
				Sequence:         absent.Sequence,
				CommandID:        absent.CommandID,
				Actor:            absent.Actor,
				CommittedAt:      absent.CommittedAt,
				MembershipEpoch:  absent.MembershipEpoch,
				MLSEpoch:         absent.MLSEpoch,
				AuthorityStation: absent.AuthorityStation,
				Fact:             domainevent.NewSettingsChangedFact(test.patch, nil),
			})
			if explicit.Hash == absent.Hash {
				t.Fatal("explicit zero value has the same hash as an absent optional field")
			}
		})
	}
}

func mustRecord(t *testing.T, input domainevent.RecordInput) domainevent.Record {
	t.Helper()

	record, err := domainevent.NewRecord(input)
	if err != nil {
		t.Fatalf("NewRecord() error = %v", err)
	}

	return record
}

func eventEndpoint(t *testing.T, actor string, device string) valueobject.Endpoint {
	t.Helper()

	endpoint, err := valueobject.NewEndpoint(actor, device)
	if err != nil {
		t.Fatalf("NewEndpoint(%q, %q) error = %v", actor, device, err)
	}

	return endpoint
}

func assertEventErrorCode(t *testing.T, err error, want conversationdomain.ErrorCode) {
	t.Helper()

	if !conversationdomain.IsCode(err, want) {
		t.Fatalf("error = %v (code %q), want code %q", err, conversationdomain.CodeOf(err), want)
	}
}
