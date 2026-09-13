package reconciliation_test

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/reconciliation"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type readerStub struct {
	resolve func(reconciliation.Reference) (reconciliation.Resolution, error)
	calls   int
}

func (r *readerStub) Resolve(
	_ context.Context,
	_ valueobject.Endpoint,
	reference reconciliation.Reference,
) (reconciliation.Resolution, error) {
	r.calls++
	return r.resolve(reference)
}

func TestServiceResolvesBoundedBatchInRequestOrder(t *testing.T) {
	reader := &readerStub{
		resolve: func(reference reconciliation.Reference) (reconciliation.Resolution, error) {
			return reconciliation.Resolution{
				Reference: reference,
				State:     reconciliation.StateNotFound,
			}, nil
		},
	}
	service, err := reconciliation.NewService(reader)
	if err != nil {
		t.Fatal(err)
	}
	references := make([]reconciliation.Reference, 0, reconciliation.MaxBatchSize)
	for index := 0; index < reconciliation.MaxBatchSize; index++ {
		references = append(references, reference(
			valueobject.CommandID("command-"+string(rune('A'+index))),
		))
	}
	results, err := service.Resolve(
		context.Background(),
		valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"},
		references,
	)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if len(results) != reconciliation.MaxBatchSize ||
		reader.calls != reconciliation.MaxBatchSize {
		t.Fatalf("Resolve() returned %d results after %d reads", len(results), reader.calls)
	}
	for index := range results {
		if results[index].CommandID != references[index].CommandID ||
			results[index].State != reconciliation.StateNotFound {
			t.Fatalf("result[%d] = %+v", index, results[index])
		}
	}
}

func TestServiceRejectsOversizedBatchBeforeReading(t *testing.T) {
	reader := &readerStub{
		resolve: func(reference reconciliation.Reference) (reconciliation.Resolution, error) {
			return reconciliation.Resolution{
				Reference: reference,
				State:     reconciliation.StateNotFound,
			}, nil
		},
	}
	service, err := reconciliation.NewService(reader)
	if err != nil {
		t.Fatal(err)
	}
	references := make([]reconciliation.Reference, reconciliation.MaxBatchSize+1)
	for index := range references {
		references[index] = reference(valueobject.CommandID("command"))
	}
	_, err = service.Resolve(
		context.Background(),
		valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"},
		references,
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInvalidArgument) {
		t.Fatalf("Resolve() error = %v, want invalid argument", err)
	}
	if reader.calls != 0 {
		t.Fatalf("reader calls = %d, want 0", reader.calls)
	}
}

func TestServiceFailsClosedOnReaderIdentityDrift(t *testing.T) {
	reader := &readerStub{
		resolve: func(reference reconciliation.Reference) (reconciliation.Resolution, error) {
			reference.CommandID = "different-command"
			return reconciliation.Resolution{
				Reference: reference,
				State:     reconciliation.StateNotFound,
			}, nil
		},
	}
	service, err := reconciliation.NewService(reader)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Resolve(
		context.Background(),
		valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"},
		[]reconciliation.Reference{reference("command-1")},
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("Resolve() error = %v, want integrity failure", err)
	}
}

func reference(commandID valueobject.CommandID) reconciliation.Reference {
	return reconciliation.Reference{
		ConversationID: "conversation-1",
		CommandID:      commandID,
		CommandHash:    valueobject.HashBytes([]byte(commandID)),
	}
}
