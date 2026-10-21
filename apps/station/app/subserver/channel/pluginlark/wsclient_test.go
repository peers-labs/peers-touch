package pluginlark_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginlark"
)

// newWSClient uses the package constructor through the exported test hook.
// The package exposes a thin test constructor to avoid duplicating config.
func runClient(t *testing.T, baseURL string, onEvent pluginlark.EventHandler, onState pluginlark.StateObserver) (stop func()) {
	t.Helper()
	client := pluginlark.NewWSClientForTest(pluginlark.WSConfigForTest{
		AppID:     "cli_test",
		AppSecret: "secret",
		BaseURL:   baseURL,
		OnEvent:   onEvent,
		OnState:   onState,
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = client.RunForTest(ctx)
		close(done)
	}()
	return func() {
		cancel()
		client.StopForTest()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("ws client did not stop")
		}
	}
}

func eventFrame(t *testing.T, payload []byte) []byte {
	t.Helper()
	frame := &larkws.Frame{
		SeqID:   1,
		LogID:   1,
		Service: 1,
		Method:  int32(larkws.FrameTypeData),
		Headers: []larkws.Header{
			{Key: larkws.HeaderType, Value: string(larkws.MessageTypeEvent)},
			{Key: larkws.HeaderMessageID, Value: "om_1"},
			{Key: larkws.HeaderSum, Value: "1"},
			{Key: larkws.HeaderSeq, Value: "0"},
		},
		Payload: payload,
	}
	body, err := frame.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestWSClientConnectAndAck200(t *testing.T) {
	payload := []byte(`{"hello":"event"}`)
	srv := newFakeLarkServer(t, eventFrame(t, payload))

	var got []byte
	var once sync.Once
	stop := runClient(t, srv.baseURL(),
		func(_ context.Context, body []byte) (any, error) {
			once.Do(func() { got = body })
			return nil, nil
		}, nil)
	defer stop()

	waitFor(t, 3*time.Second, func() bool {
		_, _, replies, _ := srv.snapshot()
		return len(replies) == 1
	})
	if string(got) != string(payload) {
		t.Fatalf("handler payload mismatch: %s", got)
	}
	_, _, replies, _ := srv.snapshot()
	var ack larkws.Response
	if err := json.Unmarshal(replies[0].Payload, &ack); err != nil {
		t.Fatal(err)
	}
	if ack.StatusCode != http.StatusOK {
		t.Fatalf("want 200 ack, got %d", ack.StatusCode)
	}
}

func TestWSClientAck500OnHandlerError(t *testing.T) {
	srv := newFakeLarkServer(t, eventFrame(t, []byte(`{"x":1}`)))
	stop := runClient(t, srv.baseURL(),
		func(_ context.Context, _ []byte) (any, error) { return nil, fmt.Errorf("not admitted") }, nil)
	defer stop()

	waitFor(t, 3*time.Second, func() bool {
		_, _, replies, _ := srv.snapshot()
		return len(replies) == 1
	})
	_, _, replies, _ := srv.snapshot()
	var ack larkws.Response
	if err := json.Unmarshal(replies[0].Payload, &ack); err != nil {
		t.Fatal(err)
	}
	if ack.StatusCode != http.StatusInternalServerError {
		t.Fatalf("want 500 ack, got %d", ack.StatusCode)
	}
}

func TestWSClientReconnectAfterDrop(t *testing.T) {
	srv := newFakeLarkServer(t, nil) // do not push; server still accepts pings
	stop := runClient(t, srv.baseURL(), nil, nil)
	defer stop()

	waitFor(t, 3*time.Second, func() bool {
		conns, _, _, _ := srv.snapshot()
		return conns >= 1
	})
	srv.closeAllConns()
	waitFor(t, 5*time.Second, func() bool {
		conns, _, _, _ := srv.snapshot()
		return conns >= 2
	})
}

func TestWSClientTerminalEndpointError(t *testing.T) {
	// Endpoint returns a non-retryable business code.
	mux := http.NewServeMux()
	mux.HandleFunc("/callback/ws/endpoint", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 403, "msg": "forbidden"})
	})
	httpSrv := httptest.NewServer(mux)
	defer httpSrv.Close()

	client := pluginlark.NewWSClientForTest(pluginlark.WSConfigForTest{
		AppID: "cli_test", AppSecret: "s", BaseURL: httpSrv.URL,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := client.RunForTest(ctx)
	if err == nil {
		t.Fatal("expected terminal error")
	}
	var terminal *pluginlark.TerminalErrorForTest
	if !errors.As(err, &terminal) {
		t.Fatalf("want TerminalError, got %T: %v", err, err)
	}
}
