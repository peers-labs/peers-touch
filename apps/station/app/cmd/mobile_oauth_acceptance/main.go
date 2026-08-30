package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/oauth"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	databaseDSNEnvironment = "PT_MOBILE_OAUTH_ACCEPTANCE_DSN"
	deploymentEnvironment  = "PT_MOBILE_OAUTH_ACCEPTANCE_DEPLOYMENT"
	hmacFDEnvironment      = "PT_MOBILE_OAUTH_ACCEPTANCE_HMAC_FD"
	maximumInputBytes      = 1 << 20
	maximumHMACBytes       = 4096
)

type heartbeatRequest struct {
	Lease       oauth.AcceptanceLeaseIdentity `json:"lease"`
	HeartbeatAt time.Time                     `json:"heartbeatAt"`
	RenewBefore time.Time                     `json:"renewBefore"`
	ExpiresAt   time.Time                     `json:"expiresAt"`
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdin, os.Stdout); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, input io.Reader, output io.Writer) error {
	flags := flag.NewFlagSet("mobile_oauth_acceptance", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	operation := flags.String("operation", "", "allowlisted deployment operation")
	if err := flags.Parse(args); err != nil {
		return fmt.Errorf("parse mobile OAuth Acceptance command: %w", err)
	}
	if flags.NArg() != 0 || strings.TrimSpace(*operation) == "" {
		return errors.New("mobile OAuth Acceptance command requires exactly one --operation")
	}

	deployment, err := deploymentFromEnvironment()
	if err != nil {
		return err
	}
	database, err := databaseFromEnvironment()
	if err != nil {
		return err
	}
	adapter, err := oauth.NewAcceptanceAdapter(database, deployment)
	if err != nil {
		return fmt.Errorf("construct mobile OAuth Acceptance adapter: %w", err)
	}

	switch *operation {
	case "bootstrap":
		if err := requireEmptyInput(input); err != nil {
			return err
		}
		if err := adapter.Bootstrap(ctx); err != nil {
			return err
		}
		return encodeOutput(output, map[string]any{"operation": "bootstrap", "status": "DONE"})
	case "teardown":
		if err := requireEmptyInput(input); err != nil {
			return err
		}
		if err := adapter.Teardown(ctx); err != nil {
			return err
		}
		return encodeOutput(output, map[string]any{"operation": "teardown", "status": "DONE"})
	case "acquire_lease":
		var request oauth.AcceptanceLeaseRequest
		if err := decodeInput(input, &request); err != nil {
			return err
		}
		lease, err := adapter.AcquireLease(ctx, request)
		if err != nil {
			return err
		}
		return encodeOutput(output, lease)
	case "heartbeat_lease":
		var request heartbeatRequest
		if err := decodeInput(input, &request); err != nil {
			return err
		}
		lease, err := adapter.HeartbeatLease(
			ctx,
			request.Lease,
			request.HeartbeatAt,
			request.RenewBefore,
			request.ExpiresAt,
		)
		if err != nil {
			return err
		}
		return encodeOutput(output, lease)
	case oauth.AcceptanceOperationPrepareFollowingGate,
		oauth.AcceptanceOperationExpireAwaitingAttempt,
		oauth.AcceptanceOperationCleanupRun:
		var request oauth.AcceptanceOperationRequest
		if err := decodeInput(input, &request); err != nil {
			return err
		}
		if request.Operation != *operation {
			return fmt.Errorf(
				"mobile OAuth Acceptance operation mismatch: command=%s input=%s",
				*operation,
				request.Operation,
			)
		}
		receipt, err := adapter.Execute(ctx, request)
		if err != nil {
			return err
		}
		return encodeOutput(output, receipt)
	case oauth.AcceptanceOperationReadProofSnapshot:
		var request oauth.StationOAuthProofRequest
		if err := decodeInput(input, &request); err != nil {
			return err
		}
		key, err := readCorrelationKey()
		if err != nil {
			return err
		}
		defer zeroBytes(key)
		request.ProviderCorrelationKey = key
		snapshot, err := adapter.ReadProofSnapshot(ctx, request)
		if err != nil {
			return err
		}
		return encodeOutput(output, snapshot)
	default:
		return fmt.Errorf("mobile OAuth Acceptance operation %q is not allowlisted", *operation)
	}
}

func deploymentFromEnvironment() (oauth.AcceptanceDeployment, error) {
	raw := strings.TrimSpace(os.Getenv(deploymentEnvironment))
	if raw == "" {
		return oauth.AcceptanceDeployment{}, fmt.Errorf(
			"required deployment identity environment %s is missing",
			deploymentEnvironment,
		)
	}
	var deployment oauth.AcceptanceDeployment
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&deployment); err != nil {
		return oauth.AcceptanceDeployment{}, fmt.Errorf(
			"decode deployment identity from %s: %w",
			deploymentEnvironment,
			err,
		)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return oauth.AcceptanceDeployment{}, err
	}
	return deployment, nil
}

func databaseFromEnvironment() (*gorm.DB, error) {
	dsn := strings.TrimSpace(os.Getenv(databaseDSNEnvironment))
	if dsn == "" {
		return nil, fmt.Errorf(
			"required database environment %s is missing",
			databaseDSNEnvironment,
		)
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("open deployment-owned Station database: %w", err)
	}
	return database, nil
}

func decodeInput(input io.Reader, value any) error {
	decoder := json.NewDecoder(io.LimitReader(input, maximumInputBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("decode mobile OAuth Acceptance input: %w", err)
	}
	return requireJSONEOF(decoder)
}

func requireEmptyInput(input io.Reader) error {
	raw, err := io.ReadAll(io.LimitReader(input, 2))
	if err != nil {
		return fmt.Errorf("read mobile OAuth Acceptance input: %w", err)
	}
	if strings.TrimSpace(string(raw)) != "" {
		return errors.New("bootstrap and teardown do not accept an input payload")
	}
	return nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("mobile OAuth Acceptance input contains multiple JSON values")
		}
		return fmt.Errorf("decode trailing mobile OAuth Acceptance input: %w", err)
	}
	return nil
}

func encodeOutput(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return fmt.Errorf("encode mobile OAuth Acceptance output: %w", err)
	}
	return nil
}

func readCorrelationKey() ([]byte, error) {
	rawFD := strings.TrimSpace(os.Getenv(hmacFDEnvironment))
	if rawFD == "" {
		return nil, fmt.Errorf(
			"required anonymous-pipe descriptor environment %s is missing",
			hmacFDEnvironment,
		)
	}
	fd, err := strconv.ParseUint(rawFD, 10, 32)
	if err != nil || fd < 3 {
		return nil, fmt.Errorf("invalid anonymous-pipe descriptor in %s", hmacFDEnvironment)
	}
	file := os.NewFile(uintptr(fd), "mobile-oauth-provider-correlation")
	if file == nil {
		return nil, fmt.Errorf("open anonymous-pipe descriptor from %s", hmacFDEnvironment)
	}
	defer file.Close()
	key, err := io.ReadAll(io.LimitReader(file, maximumHMACBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read provider-correlation key from anonymous pipe: %w", err)
	}
	if len(key) > maximumHMACBytes {
		zeroBytes(key)
		return nil, errors.New("provider-correlation key exceeds bounded input")
	}
	if len(key) < 32 {
		zeroBytes(key)
		return nil, errors.New("provider-correlation key is too short")
	}
	return key, nil
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
