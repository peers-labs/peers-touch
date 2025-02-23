package client

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

type Client client.Client

type nativeClient struct {
	client client.Client
}

func (n *nativeClient) Init(option ...client.Option) error {
	return n.client.Init(option...)
}

func (n *nativeClient) Call(ctx context.Context, req client.Request, rsp interface{}, opts ...client.CallOption) error {
	return n.client.Call(ctx, req, rsp, opts...)
}

func (n *nativeClient) Name() string {
	return n.client.Name()
}

func FromService(s service.Service) Client {
	return &nativeClient{
		client: s.Client(),
	}
}
