module github.com/dirty-bro-tech/peers-touch-go/core/plugin/native

go 1.23.6

replace github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/native => ../../../core/plugin/store/native

require (
	github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/native v0.0.0
	github.com/gin-gonic/gin v1.9.1
	github.com/gorilla/websocket v1.5.3
)
