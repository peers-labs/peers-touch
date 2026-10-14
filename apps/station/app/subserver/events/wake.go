package events

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/gorm"
)

const (
	defaultReconcileInterval = time.Second
	wakeReconnectDelay       = 250 * time.Millisecond
	wakeStartTimeout         = 5 * time.Second
)

type durableWakeHint struct {
	ActorPTID string `json:"actor_ptid"`
	Sequence  uint64 `json:"sequence"`
}

type durableWakeEmitter interface {
	Emit(durableWakeHint)
}

type durableWakeReceiver interface {
	Run(context.Context, func(durableWakeHint)) error
}

type readyDurableWakeReceiver interface {
	WaitReady(context.Context) error
}

type postgresWakeReceiver struct {
	database  *sql.DB
	ready     chan struct{}
	readyOnce sync.Once
}

func newPostgresWakeReceiver(
	database *gorm.DB,
) (durableWakeReceiver, error) {
	if database == nil || database.Dialector.Name() != "postgres" {
		return nil, nil
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		return nil, fmt.Errorf(
			"events: resolve PostgreSQL wake connection pool: %w",
			err,
		)
	}
	return &postgresWakeReceiver{
		database: sqlDatabase,
		ready:    make(chan struct{}),
	}, nil
}

func (r *postgresWakeReceiver) Run(
	ctx context.Context,
	consume func(durableWakeHint),
) error {
	if r == nil || r.database == nil || consume == nil {
		return fmt.Errorf("events: wake receiver dependencies are incomplete")
	}
	connection, err := r.database.Conn(ctx)
	if err != nil {
		return fmt.Errorf("events: acquire wake listener connection: %w", err)
	}
	defer connection.Close()

	if _, err := connection.ExecContext(
		ctx,
		"LISTEN "+realtimeEventWakeChannel,
	); err != nil {
		return fmt.Errorf("events: listen for durable wakes: %w", err)
	}
	r.readyOnce.Do(func() {
		close(r.ready)
	})

	return connection.Raw(func(driverConnection any) error {
		pgxConnection, ok := driverConnection.(*stdlib.Conn)
		if !ok {
			return fmt.Errorf(
				"events: PostgreSQL wake listener uses unsupported driver %T",
				driverConnection,
			)
		}
		for {
			notification, err := pgxConnection.Conn().WaitForNotification(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) ||
					errors.Is(err, context.DeadlineExceeded) {
					return ctx.Err()
				}
				return fmt.Errorf(
					"events: wait for durable wake notification: %w",
					err,
				)
			}
			var hint durableWakeHint
			if err := json.Unmarshal(
				[]byte(notification.Payload),
				&hint,
			); err != nil {
				continue
			}
			if hint.ActorPTID == "" || hint.Sequence == 0 {
				continue
			}
			consume(hint)
		}
	})
}

func (r *postgresWakeReceiver) WaitReady(ctx context.Context) error {
	if r == nil || r.ready == nil {
		return fmt.Errorf("events: wake receiver readiness is unavailable")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-r.ready:
		return nil
	}
}
