package events

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPostgresCrossNodeWakeOrderingAndRollback(t *testing.T) {
	first, second, _ := openEventsPostgresPair(t)
	publisher, err := NewDurableEventBus(
		first,
		withReconcileInterval(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	subscriber, err := NewDurableEventBus(
		second,
		withReconcileInterval(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer publisher.Close()
	defer subscriber.Close()

	startContext, cancelStart := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)
	defer cancelStart()
	if err := subscriber.Start(startContext); err != nil {
		t.Fatal(err)
	}

	target, cancelTarget, err := subscriber.Subscribe(
		context.Background(),
		"alice",
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelTarget()
	sibling, cancelSibling, err := subscriber.Subscribe(
		context.Background(),
		"alice",
		"alice-desktop",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSibling()

	if _, err := publisher.PublishToDevice(
		"alice",
		"alice-phone",
		msg("device-only"),
	); err != nil {
		t.Fatal(err)
	}
	targeted := drainN(t, target, 1, time.Second)
	if len(targeted) != 1 ||
		targeted[0].GetMessage().GetUlid() != "device-only" {
		t.Fatalf("PostgreSQL target delivery = %#v", targeted)
	}
	assertNoEventWithin(t, sibling, 50*time.Millisecond)

	if _, err := publisher.Publish("alice", msg("broadcast")); err != nil {
		t.Fatal(err)
	}
	targetBroadcast := drainN(t, target, 1, time.Second)
	siblingBroadcast := drainN(t, sibling, 1, time.Second)
	if len(targetBroadcast) != 1 ||
		targetBroadcast[0].GetMessage().GetUlid() != "broadcast" ||
		len(siblingBroadcast) != 1 ||
		siblingBroadcast[0].GetMessage().GetUlid() != "broadcast" {
		t.Fatalf(
			"PostgreSQL broadcast target=%#v sibling=%#v",
			targetBroadcast,
			siblingBroadcast,
		)
	}

	firstStore := newGormEventStore(first)
	secondStore := newGormEventStore(second)
	const eventCount = 24
	var wait sync.WaitGroup
	failures := make(chan error, eventCount)
	for index := range eventCount {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			store := firstStore
			if index%2 == 1 {
				store = secondStore
			}
			_, err := store.Persist(
				"sequence-actor",
				"",
				msg(fmt.Sprintf("event-%02d", index)),
			)
			failures <- err
		}(index)
	}
	wait.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatalf("concurrent PostgreSQL event persist: %v", err)
		}
	}
	records, err := firstStore.ReplayRange(
		"sequence-actor",
		0,
		eventCount,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !contiguousDurableRange(records, 1, eventCount) {
		t.Fatalf("PostgreSQL actor sequence is not contiguous: %+v", records)
	}

	rollback := errors.New("rollback")
	err = first.Transaction(func(transaction *gorm.DB) error {
		if _, err := firstStore.PersistInTransaction(
			context.Background(),
			transaction,
			"rollback-actor",
			"rollback-device",
			msg("rolled-back"),
		); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("PostgreSQL rollback error = %v", err)
	}
	if head, ok, err := secondStore.Head("rollback-actor"); err != nil || ok {
		t.Fatalf(
			"PostgreSQL rolled-back head = %+v ok=%v err=%v",
			head,
			ok,
			err,
		)
	}
	afterRollback, err := secondStore.Persist(
		"rollback-actor",
		"",
		msg("after-rollback"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if afterRollback.Sequence != 1 {
		t.Fatalf(
			"PostgreSQL post-rollback sequence = %d, want 1",
			afterRollback.Sequence,
		)
	}
}

func TestPostgresCrossProcessDurableEvents(t *testing.T) {
	first, _, dsn := openEventsPostgresPair(t)

	firstSubscriber := startEventSubscriberProcess(
		t,
		dsn,
		"",
		"wake",
		map[string]int{
			"alice-phone":   2,
			"alice-desktop": 1,
		},
	)
	initial := runEventPublisherProcess(
		t,
		dsn,
		[]helperPublishedEvent{
			{TargetDeviceID: "alice-phone", Message: "device-only"},
			{Message: "broadcast"},
		},
	)
	firstEvents := firstSubscriber.wait(t)
	assertHelperMessages(
		t,
		firstEvents,
		"alice-phone",
		[]string{"device-only", "broadcast"},
	)
	assertHelperMessages(
		t,
		firstEvents,
		"alice-desktop",
		[]string{"broadcast"},
	)
	if len(initial.EventIDs) != 2 {
		t.Fatalf("initial publisher ids = %+v", initial.EventIDs)
	}

	offline := runEventPublisherProcess(
		t,
		dsn,
		[]helperPublishedEvent{
			{TargetDeviceID: "alice-desktop", Message: "offline-device"},
			{Message: "offline-broadcast"},
		},
	)
	if len(offline.EventIDs) != 2 {
		t.Fatalf("offline publisher ids = %+v", offline.EventIDs)
	}
	replayed := startEventSubscriberProcess(
		t,
		dsn,
		initial.EventIDs[1],
		"wake",
		map[string]int{
			"alice-phone":   1,
			"alice-desktop": 2,
		},
	).wait(t)
	assertHelperMessages(
		t,
		replayed,
		"alice-phone",
		[]string{"offline-broadcast"},
	)
	assertHelperMessages(
		t,
		replayed,
		"alice-desktop",
		[]string{"offline-device", "offline-broadcast"},
	)

	reconciler := startEventSubscriberProcess(
		t,
		dsn,
		"",
		"reconcile-only",
		map[string]int{
			"alice-phone":   1,
			"alice-desktop": 1,
		},
	)
	wakeLoss := runEventPublisherProcess(
		t,
		dsn,
		[]helperPublishedEvent{{Message: "wake-loss"}},
	)
	if len(wakeLoss.EventIDs) != 1 {
		t.Fatalf("wake-loss publisher ids = %+v", wakeLoss.EventIDs)
	}
	reconciled := reconciler.wait(t)
	assertHelperMessages(
		t,
		reconciled,
		"alice-phone",
		[]string{"wake-loss"},
	)
	assertHelperMessages(
		t,
		reconciled,
		"alice-desktop",
		[]string{"wake-loss"},
	)

	store := newGormEventStore(first)
	rollback := errors.New("rollback")
	err := first.Transaction(func(transaction *gorm.DB) error {
		if _, err := store.PersistInTransaction(
			context.Background(),
			transaction,
			"rollback-process-actor",
			"alice-phone",
			msg("rolled-back"),
		); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("cross-process rollback error = %v", err)
	}
	if _, ok, err := store.Head("rollback-process-actor"); err != nil || ok {
		t.Fatalf("cross-process rollback head ok=%v err=%v", ok, err)
	}

	if path := os.Getenv("NCP_EVENTS_RESULT_PATH"); path != "" {
		report := map[string]any{
			"artifactKind": "ncp-durable-events-process-result",
			"status":       "passed",
			"scenarios": map[string]any{
				"NCP-G04-ORDER": map[string]any{
					"publisherExited": true,
					"eventIds":        append(initial.EventIDs, offline.EventIDs...),
					"events":          append(firstEvents, replayed...),
				},
				"NCP-G04-DEVICE": map[string]any{
					"events": append(firstEvents, replayed...),
				},
				"NCP-G04-WAKE-LOSS": map[string]any{
					"eventIds": wakeLoss.EventIDs,
					"events":   reconciled,
				},
			},
			"rollbackExcluded": true,
		}
		encoded, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, '\n')
		if err := os.WriteFile(path, encoded, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPostgresEventProcessHelper(t *testing.T) {
	role := os.Getenv("NCP_EVENTS_HELPER_ROLE")
	if role == "" {
		t.Skip("not an events helper process")
	}
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Fatal("helper PostgreSQL DSN is missing")
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDatabase.Close()

	switch role {
	case "publisher":
		var publications []helperPublishedEvent
		if err := json.Unmarshal(
			[]byte(os.Getenv("NCP_EVENTS_PUBLICATIONS")),
			&publications,
		); err != nil {
			t.Fatal(err)
		}
		bus, err := NewDurableEventBus(database)
		if err != nil {
			t.Fatal(err)
		}
		defer bus.Close()
		result := helperPublisherResult{
			EventIDs: make([]string, 0, len(publications)),
		}
		for _, publication := range publications {
			var eventID string
			if publication.TargetDeviceID == "" {
				eventID, err = bus.Publish(
					"alice",
					msg(publication.Message),
				)
			} else {
				eventID, err = bus.PublishToDevice(
					"alice",
					publication.TargetDeviceID,
					msg(publication.Message),
				)
			}
			if err != nil {
				t.Fatal(err)
			}
			result.EventIDs = append(result.EventIDs, eventID)
		}
		printEventHelperResult(result)
	case "subscriber":
		runEventSubscriberHelper(t, database)
	default:
		t.Fatalf("unknown helper role %q", role)
	}
}

type helperPublishedEvent struct {
	TargetDeviceID string `json:"targetDeviceId,omitempty"`
	Message        string `json:"message"`
}

type helperPublisherResult struct {
	EventIDs []string `json:"eventIds"`
}

type helperDeliveredEvent struct {
	DeviceID string `json:"deviceId"`
	EventID  string `json:"eventId"`
	Message  string `json:"message"`
}

type helperSubscriberResult struct {
	Events []helperDeliveredEvent `json:"events"`
}

func runEventSubscriberHelper(t *testing.T, database *gorm.DB) {
	t.Helper()
	store := newGormEventStore(database)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	mode := os.Getenv("NCP_EVENTS_SUBSCRIBER_MODE")
	var bus EventBus
	switch mode {
	case "wake":
		receiver, err := newPostgresWakeReceiver(database)
		if err != nil {
			t.Fatal(err)
		}
		bus = newTestBus(
			t,
			WithDurableStore(store),
			withWakeReceiver(receiver),
			withReconcileInterval(time.Hour),
		)
	case "reconcile-only":
		bus = newTestBus(
			t,
			WithDurableStore(store),
			withReconcileInterval(20*time.Millisecond),
		)
	default:
		t.Fatalf("unknown subscriber mode %q", mode)
	}
	defer bus.Close()
	startContext, cancelStart := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)
	defer cancelStart()
	if err := bus.Start(startContext); err != nil {
		t.Fatal(err)
	}

	cursor := os.Getenv("NCP_EVENTS_CURSOR")
	phone, cancelPhone, err := bus.Subscribe(
		context.Background(),
		"alice",
		"alice-phone",
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelPhone()
	desktop, cancelDesktop, err := bus.Subscribe(
		context.Background(),
		"alice",
		"alice-desktop",
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelDesktop()

	var expected map[string]int
	if err := json.Unmarshal(
		[]byte(os.Getenv("NCP_EVENTS_EXPECTED")),
		&expected,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintln(os.Stdout, "NCP_EVENT_READY"); err != nil {
		t.Fatal(err)
	}
	result := helperSubscriberResult{}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for !helperDeliveryComplete(result.Events, expected) {
		select {
		case event, ok := <-phone.Events:
			if !ok {
				t.Fatal("phone subscription closed")
			}
			result.Events = append(
				result.Events,
				helperDeliveredFrom("alice-phone", event),
			)
		case event, ok := <-desktop.Events:
			if !ok {
				t.Fatal("desktop subscription closed")
			}
			result.Events = append(
				result.Events,
				helperDeliveredFrom("alice-desktop", event),
			)
		case <-deadline.C:
			t.Fatalf(
				"subscriber timed out events=%+v expected=%+v",
				result.Events,
				expected,
			)
		}
	}
	printEventHelperResult(result)
}

func helperDeliveredFrom(
	deviceID string,
	event *realtime.StreamEvent,
) helperDeliveredEvent {
	return helperDeliveredEvent{
		DeviceID: deviceID,
		EventID:  event.GetEventId(),
		Message:  event.GetMessage().GetUlid(),
	}
}

func helperDeliveryComplete(
	events []helperDeliveredEvent,
	expected map[string]int,
) bool {
	counts := make(map[string]int, len(expected))
	for _, event := range events {
		counts[event.DeviceID]++
	}
	for deviceID, count := range expected {
		if counts[deviceID] < count {
			return false
		}
	}
	return true
}

func printEventHelperResult(result any) {
	encoded, err := json.Marshal(result)
	if err != nil {
		panic(err)
	}
	fmt.Printf("NCP_EVENT_RESULT %s\n", encoded)
}

type eventSubscriberProcess struct {
	command *exec.Cmd
	ready   <-chan struct{}
	result  <-chan helperSubscriberResult
	output  *strings.Builder
}

func startEventSubscriberProcess(
	t *testing.T,
	dsn string,
	cursor string,
	mode string,
	expected map[string]int,
) *eventSubscriberProcess {
	t.Helper()
	encodedExpected, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestPostgresEventProcessHelper$",
		"-test.count=1",
	)
	command.Env = append(
		os.Environ(),
		"NCP_EVENTS_HELPER_ROLE=subscriber",
		"MESSAGING_TEST_POSTGRES_DSN="+dsn,
		"NCP_EVENTS_CURSOR="+cursor,
		"NCP_EVENTS_SUBSCRIBER_MODE="+mode,
		"NCP_EVENTS_EXPECTED="+string(encodedExpected),
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	ready := make(chan struct{}, 1)
	result := make(chan helperSubscriberResult, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			output.WriteString(line)
			output.WriteByte('\n')
			switch {
			case line == "NCP_EVENT_READY":
				ready <- struct{}{}
			case strings.HasPrefix(line, "NCP_EVENT_RESULT "):
				var parsed helperSubscriberResult
				if json.Unmarshal(
					[]byte(strings.TrimPrefix(
						line,
						"NCP_EVENT_RESULT ",
					)),
					&parsed,
				) == nil {
					result <- parsed
				}
			}
		}
	}()
	process := &eventSubscriberProcess{
		command: command,
		ready:   ready,
		result:  result,
		output:  &output,
	}
	select {
	case <-ready:
		return process
	case <-time.After(5 * time.Second):
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("subscriber did not become ready:\n%s", output.String())
		return nil
	}
}

func (p *eventSubscriberProcess) wait(
	t *testing.T,
) []helperDeliveredEvent {
	t.Helper()
	var result helperSubscriberResult
	select {
	case result = <-p.result:
	case <-time.After(6 * time.Second):
		_ = p.command.Process.Kill()
		_ = p.command.Wait()
		t.Fatalf("subscriber did not finish:\n%s", p.output.String())
	}
	if err := p.command.Wait(); err != nil {
		t.Fatalf("subscriber failed: %v\n%s", err, p.output.String())
	}
	return result.Events
}

func runEventPublisherProcess(
	t *testing.T,
	dsn string,
	publications []helperPublishedEvent,
) helperPublisherResult {
	t.Helper()
	encoded, err := json.Marshal(publications)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestPostgresEventProcessHelper$",
		"-test.count=1",
	)
	command.Env = append(
		os.Environ(),
		"NCP_EVENTS_HELPER_ROLE=publisher",
		"MESSAGING_TEST_POSTGRES_DSN="+dsn,
		"NCP_EVENTS_PUBLICATIONS="+string(encoded),
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("publisher failed: %v\n%s", err, output)
	}
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.HasPrefix(line, "NCP_EVENT_RESULT ") {
			continue
		}
		var result helperPublisherResult
		if err := json.Unmarshal(
			[]byte(strings.TrimPrefix(line, "NCP_EVENT_RESULT ")),
			&result,
		); err != nil {
			t.Fatal(err)
		}
		return result
	}
	t.Fatalf("publisher emitted no result:\n%s", output)
	return helperPublisherResult{}
}

func assertHelperMessages(
	t *testing.T,
	events []helperDeliveredEvent,
	deviceID string,
	expected []string,
) {
	t.Helper()
	actual := make([]string, 0, len(expected))
	for _, event := range events {
		if event.DeviceID == deviceID {
			actual = append(actual, event.Message)
		}
	}
	if strings.Join(actual, "\x00") != strings.Join(expected, "\x00") {
		t.Fatalf(
			"device %s messages = %v, want %v",
			deviceID,
			actual,
			expected,
		)
	}
}

func openEventsPostgresPair(
	t *testing.T,
) (*gorm.DB, *gorm.DB, string) {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}

	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = adminSQL.Close()
	})

	schema := "events_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create events test schema: %v", err)
	}
	t.Cleanup(func() {
		if err := admin.Exec(
			`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`,
		).Error; err != nil {
			t.Errorf("drop events test schema: %v", err)
		}
	})

	isolatedDSN := eventsPostgresDSNWithSearchPath(t, dsn, schema)
	open := func() *gorm.DB {
		database, err := gorm.Open(
			postgres.Open(isolatedDSN),
			&gorm.Config{},
		)
		if err != nil {
			t.Fatalf("open isolated events database: %v", err)
		}
		sqlDatabase, err := database.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = sqlDatabase.Close()
		})
		return database
	}
	return open(), open(), isolatedDSN
}

func eventsPostgresDSNWithSearchPath(
	t *testing.T,
	dsn string,
	schema string,
) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatalf("parse PostgreSQL DSN: %v", err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}
