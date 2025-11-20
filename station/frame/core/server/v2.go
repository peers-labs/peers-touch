package server

import (
	"context"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

type MethodV2 string

const (
	GETV2     MethodV2 = "GET"
	POSTV2    MethodV2 = "POST"
	PUTV2     MethodV2 = "PUT"
	DELETEV2  MethodV2 = "DELETE"
	PATCHV2   MethodV2 = "PATCH"
	HEADV2    MethodV2 = "HEAD"
	OPTIONSV2 MethodV2 = "OPTIONS"
	ANYV2     MethodV2 = "ANY"
)

type HandlerTypeV2 int

const (
	HandlerTypeHTTP HandlerTypeV2 = iota
	HandlerTypePS
)

type RequestV2 interface {
	Context() context.Context
	Header() map[string]string
	Method() MethodV2
	Path() string
	Body() []byte
}

type ResponseV2 interface {
	Header() map[string]string
	Write([]byte) (int, error)
	WriteHeader(int)
	Status() int
}

type EndpointHandlerV2 func(ctx context.Context, req RequestV2, resp ResponseV2) error

type WrapperV2 func(EndpointHandlerV2) EndpointHandlerV2

type HandlerV2 interface {
	Name() string
	Path() string
	Method() MethodV2
	Handler() EndpointHandlerV2
	Wrappers() []WrapperV2
	Type() HandlerTypeV2
}

type handlerV2 struct {
	name     string
	method   MethodV2
	path     string
	h        EndpointHandlerV2
	wrappers []WrapperV2
	t        HandlerTypeV2
}

func (h *handlerV2) Name() string               { return h.name }
func (h *handlerV2) Path() string               { return h.path }
func (h *handlerV2) Method() MethodV2           { return h.method }
func (h *handlerV2) Handler() EndpointHandlerV2 { return h.h }
func (h *handlerV2) Wrappers() []WrapperV2      { return h.wrappers }
func (h *handlerV2) Type() HandlerTypeV2        { return h.t }

func NewHandlerV2(name, path string, method MethodV2, typ HandlerTypeV2, handler EndpointHandlerV2, wrappers ...WrapperV2) HandlerV2 {
	return &handlerV2{name: name, path: path, method: method, t: typ, h: handler, wrappers: wrappers}
}

type StreamEndpointV2 func(ctx context.Context, s transport.Socket) error

type StreamWrapperV2 func(StreamEndpointV2) StreamEndpointV2

type StreamHandler interface {
	Name() string
	Path() string
	Method() MethodV2
	Handler() StreamEndpointV2
	Wrappers() []StreamWrapperV2
	Type() HandlerTypeV2
}

type streamHandler struct {
	name     string
	method   MethodV2
	path     string
	h        StreamEndpointV2
	wrappers []StreamWrapperV2
	t        HandlerTypeV2
}

func (h *streamHandler) Name() string                { return h.name }
func (h *streamHandler) Path() string                { return h.path }
func (h *streamHandler) Method() MethodV2            { return h.method }
func (h *streamHandler) Handler() StreamEndpointV2   { return h.h }
func (h *streamHandler) Wrappers() []StreamWrapperV2 { return h.wrappers }
func (h *streamHandler) Type() HandlerTypeV2         { return h.t }

func NewStreamHandlerV2(name, path string, method MethodV2, typ HandlerTypeV2, handler StreamEndpointV2, wrappers ...StreamWrapperV2) StreamHandler {
	return &streamHandler{name: name, path: path, method: method, t: typ, h: handler, wrappers: wrappers}
}
