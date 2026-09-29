package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	githubstore "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/github"
)

const maxRotationPasses = 10_000

func main() {
	limit := flag.Int("limit", 100, "maximum records rewritten per commit")
	flag.Parse()

	if *limit <= 0 {
		exitError(errors.New("rotation_limit_must_be_positive"))
	}
	config, err := bootstrap.LoadStorageConfig()
	if err != nil {
		exitError(err)
	}
	_, maintenance, err := bootstrap.BuildOAuthStore(
		config,
		githubstore.NewDefaultHTTPClient(),
	)
	if err != nil {
		exitError(err)
	}
	if maintenance == nil {
		exitError(errors.New("rotation_requires_durable_storage"))
	}
	result, err := runRotation(context.Background(), maintenance, *limit)
	if encodeErr := json.NewEncoder(os.Stdout).Encode(result); encodeErr != nil {
		exitError(errors.New("rotation_result_write_failed"))
	}
	if err != nil {
		exitError(err)
	}
}

func runRotation(ctx context.Context, store repository.OAuthMaintenanceStore, limit int) (entity.RotationResult, error) {
	if store == nil || limit <= 0 {
		return entity.RotationResult{}, errors.New("invalid_rotation_configuration")
	}
	var total entity.RotationResult
	for pass := 0; pass < maxRotationPasses; pass++ {
		result, err := store.RotateEncryption(ctx, limit)
		total.Scanned = result.Scanned
		total.Rotated += result.Rotated
		total.Unchanged = result.Unchanged
		total.Failed += result.Failed
		if err != nil {
			return total, err
		}
		if result.Rotated < limit {
			return total, nil
		}
	}
	return total, errors.New("rotation_pass_limit_exceeded")
}

func exitError(err error) {
	_, _ = fmt.Fprintln(os.Stderr, "oauth record rotation failed:", err)
	os.Exit(1)
}
