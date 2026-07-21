// Changelog:
// 2026-07-21 — Initial implementation: verify-cli endpoint to check CLI binary
//   availability on this Station before routing turns through CLI execution.

package handler

import (
	"context"
	"encoding/json"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct{}

func NewProviderHandlers() *ProviderHandlers {
	return &ProviderHandlers{}
}

// HandleVerifyCli checks whether the specified CLI binary is available on this
// Station. Clients call this before configuring CLI-backed agent turns to verify
// that the runtime dependency is installed and in PATH.
func (h *ProviderHandlers) HandleVerifyCli(_ context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")

	var input struct {
		CliCommand string `json:"cli_command"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"available":false,"error":"invalid request body"}`))
		return nil
	}
	if input.CliCommand == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"available":false,"error":"cli_command is required"}`))
		return nil
	}

	result := cli.VerifyCliBinary(input.CliCommand)
	data, _ := json.Marshal(result)
	_, _ = resp.Write(data)
	return nil
}
