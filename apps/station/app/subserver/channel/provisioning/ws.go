package provisioning

import (
	"context"
	"reflect"
	"time"
	"unsafe"

	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

// sdkWSEstablisher opens a short-lived official-SDK long connection so the
// developer console accepts switching the app to WebSocket callback mode.
// The console requires a live connection at the moment of the switch; after
// the mode is set the temporary connection is torn down and the Station
// plugin owns the real connection.
func sdkWSEstablisher(
	readyWait time.Duration,
	domain string,
) func(ctx context.Context, appID, appSecret string) (func(), error) {
	if readyWait <= 0 {
		readyWait = 3 * time.Second
	}
	return func(parent context.Context, appID, appSecret string) (func(), error) {
		ctx, cancel := context.WithCancel(parent)
		// A non-nil handler prevents a nil-handler panic if a frame arrives
		// during the brief placeholder connection.
		handler := dispatcher.NewEventDispatcher("", "")
		handler.InitConfig(larkevent.WithLogger(nil))
		options := []larkws.ClientOption{
			larkws.WithEventHandler(handler),
			larkws.WithAutoReconnect(false),
		}
		if domain != "" {
			options = append(options, larkws.WithDomain(domain))
		}
		client := larkws.NewClient(appID, appSecret, options...)
		go func() { _ = client.Start(ctx) }()

		// The SDK connects synchronously inside Start; give it time to register.
		timer := time.NewTimer(readyWait)
		defer timer.Stop()
		select {
		case <-parent.Done():
			cancel()
			forceCloseWSClient(client)
			return nil, parent.Err()
		case <-timer.C:
		}
		return func() {
			cancel()
			forceCloseWSClient(client)
		}, nil
	}
}

// forceCloseWSClient closes the underlying WebSocket connection of a
// larkws.Client. The SDK exports no Stop/Close method and context cancel does
// not promptly stop the ping/receive goroutines, so the unexported conn field
// is closed via reflect+unsafe. Ported from the reference product's proven
// websimulate flow.
func forceCloseWSClient(client *larkws.Client) {
	if client == nil {
		return
	}
	v := reflect.ValueOf(client).Elem()
	connField := v.FieldByName("conn")
	if !connField.IsValid() || connField.IsNil() {
		return
	}
	type hasClose interface{ Close() error }
	connIface := reflect.NewAt(connField.Type(), unsafe.Pointer(connField.UnsafeAddr())).Elem()
	if closer, ok := connIface.Interface().(hasClose); ok {
		_ = closer.Close()
	}
}
