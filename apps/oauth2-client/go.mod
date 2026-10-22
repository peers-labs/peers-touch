module github.com/peers-labs/peers-touch/oauth2-client

go 1.24.6

require (
	github.com/peers-labs/peers-touch/github-repository v0.0.0
	google.golang.org/protobuf v1.36.12
)

replace github.com/peers-labs/peers-touch/github-repository => ../../packages/github-repository
