// Suite-owned fixture. Credentials, signing keys and frame bodies stay here.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type scope struct {
	Operation      string `json:"operation"`
	Mutation       string `json:"mutation"`
	SourceStation  string `json:"sourceStation"`
	TargetStation  string `json:"targetStation"`
	TargetActor    string `json:"targetActor"`
	OutsiderActor  string `json:"outsiderActor"`
	PostID         string `json:"postId"`
	ReceiverOrigin string `json:"receiverOrigin"`
	SourceCommit   string `json:"sourceCommit"`
	RunID          string `json:"runId"`
}

func digest(value []byte) string {
	hash := sha256.Sum256(value)
	return hex.EncodeToString(hash[:])
}

func privateID(kind string, values ...string) string {
	hash := sha256.New()
	hash.Write([]byte("peers-touch:social-private:" + kind + ":v1\x00"))
	for _, value := range values {
		hash.Write([]byte(strconv.Itoa(len(value))))
		hash.Write([]byte{0})
		hash.Write([]byte(value))
	}
	return kind + "-" + hex.EncodeToString(hash.Sum(nil)[:16])
}

type signer struct{ key *authfed.LocalKey }

func (s signer) KeyID() string { return s.key.Kid }
func (s signer) Sign(_ context.Context, wire []byte) ([]byte, error) {
	return ed25519.Sign(s.key.Priv, wire), nil
}

// The original KeyCache may load keys, but this fixture cannot create any.
type readonlyKeys struct{ authfed.KeyStore }

func (readonlyKeys) PutCurrent(context.Context, *authfed.LocalKey) error {
	return errors.New("fixture cannot create a Station key")
}
func (readonlyKeys) Rotate(context.Context, string, *authfed.LocalKey) (*authfed.RotateResult, error) {
	return nil, errors.New("fixture cannot rotate a Station key")
}
func (readonlyKeys) ClearPrev(context.Context, string, time.Time) (bool, error) {
	return false, errors.New("fixture cannot retire a Station key")
}

type fixedRoute string

func (r fixedRoute) ResolveActiveStationURL(context.Context, string) (string, error) {
	return string(r), nil
}

func openDB(ctx context.Context) (*gorm.DB, error) {
	user, database := os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_DB")
	if user == "" || database == "" {
		return nil, errors.New("missing owned database binding")
	}
	connection := url.URL{Scheme: "postgres", Host: "127.0.0.1:5432", Path: "/" + database,
		User: url.UserPassword(user, os.Getenv("POSTGRES_PASSWORD"))}
	query := connection.Query()
	query.Set("sslmode", "disable")
	query.Set("connect_timeout", "5")
	connection.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(connection.String()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, errors.New("owned database unavailable")
	}
	return db.WithContext(ctx), nil
}

func postFrame(db *gorm.DB, s scope) (*delivery.Frame, delivery.OutboxRecord, error) {
	var rows []delivery.OutboxRecord
	err := db.Where("source_station_peer_id = ? AND target_station_peer_id = ? AND payload_kind = ?",
		s.SourceStation, s.TargetStation, int32(delivery.PayloadKindSocialPrivateResource)).
		Order("frame_id").Find(&rows).Error
	if err != nil {
		return nil, delivery.OutboxRecord{}, err
	}
	var selected *delivery.Frame
	var record delivery.OutboxRecord
	for _, row := range rows {
		frame := &delivery.Frame{}
		if err := proto.Unmarshal(row.FrameBytes, frame); err != nil {
			return nil, record, err
		}
		value := &privatepb.FederatedPrivateResourceDelivery{}
		if err := proto.Unmarshal(frame.OpaquePayload, value); err != nil {
			return nil, record, err
		}
		if value.GetResource().GetContentId() != s.PostID ||
			value.GetTargetActor().GetPtid() != s.TargetActor ||
			value.GetResourceKind() != privatepb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST {
			continue
		}
		if selected != nil || frame.GetSourceStationPeerId() != s.SourceStation ||
			frame.GetTargetStationPeerId() != s.TargetStation {
			return nil, record, errors.New("original Post frame is duplicated or misbound")
		}
		selected, record = frame, row
	}
	if selected == nil {
		return nil, record, errors.New("original Post frame not found")
	}
	return selected, record, nil
}

func snapshot(db *gorm.DB, s scope) (map[string]any, error) {
	result := map[string]any{}
	for _, table := range []string{
		"social_remote_private_resources", "social_remote_private_envelopes", "social_remote_private_tombstones",
	} {
		var rows []struct{ Wire string }
		sql := "SELECT to_jsonb(r)::text AS wire FROM " + table +
			" r WHERE source_station_peer_id = ? AND content_id = ? ORDER BY to_jsonb(r)::text"
		if err := db.Raw(sql, s.SourceStation, s.PostID).Scan(&rows).Error; err != nil {
			return nil, errors.New("owned projection snapshot failed")
		}
		encoded, err := json.Marshal(rows)
		if err != nil {
			return nil, err
		}
		result[table] = map[string]any{"rows": len(rows), "sha256": digest(encoded)}
	}
	return result, nil
}

func mutate(frame *delivery.Frame, s scope) (string, error) {
	issuer := s.SourceStation
	switch s.Mutation {
	case "duplicate":
	case "expired":
		frame.IssuedAt = timestamppb.New(time.Now().Add(-2 * time.Hour))
		frame.ExpiresAt = timestamppb.New(time.Now().Add(-time.Hour))
	case "hash-conflict":
		frame.OpaquePayload = append(frame.OpaquePayload, 0xa0, 0x06, 0x01)
	case "reordered":
		// A late transport attempt carries the original domain delivery after
		// its genuine invalidation; the receiver tombstone must suppress it.
		frame.FrameId += ":late"
		frame.IdempotencyKey += ":late"
	case "untrusted-station":
		issuer = s.SourceStation + ":untrusted-fixture"
		frame.SourceStationPeerId = issuer
	case "wrong-station":
		frame.TargetStationPeerId = s.TargetStation + ":wrong-fixture"
	case "wrong-actor":
		if !strings.HasPrefix(s.OutsiderActor, "ptid:") || s.OutsiderActor == s.TargetActor {
			return "", errors.New("outsider fixture identity missing")
		}
		payload := &privatepb.FederatedPrivateResourceDelivery{}
		if err := proto.Unmarshal(frame.OpaquePayload, payload); err != nil {
			return "", err
		}
		payload.TargetActor.Ptid = s.OutsiderActor
		payload.DeliveryId = privateID("federated-resource", s.PostID, s.OutsiderActor)
		frame.PayloadId = payload.DeliveryId
		frame.OrderingKey = "social-private-resource:" + s.PostID + ":" + s.OutsiderActor
		frame.FrameId += ":wrong-actor"
		frame.IdempotencyKey += ":wrong-actor"
		wire, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
		if err != nil {
			return "", err
		}
		frame.OpaquePayload = wire
	default:
		return "", errors.New("unknown frame mutation")
	}
	return issuer, nil
}

func run(s scope) (map[string]any, error) {
	if len(s.SourceCommit) != 40 || s.RunID == "" || s.PostID == "" ||
		!strings.HasPrefix(s.TargetActor, "ptid:") || s.SourceStation == s.TargetStation {
		return nil, errors.New("invalid fixture scope")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db, err := openDB(ctx)
	if err != nil {
		return nil, err
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	defer pool.Close()
	result := map[string]any{"sourceCommit": s.SourceCommit, "runId": s.RunID,
		"postIdSha256": digest([]byte(s.PostID)), "operation": s.Operation}
	if s.Operation == "snapshot" {
		rows, err := snapshot(db, s)
		result["projections"] = rows
		return result, err
	}
	frame, record, err := postFrame(db, s)
	if err != nil {
		return nil, err
	}
	result["originalFrameSha256"], result["outboxRows"] = digest(record.FrameBytes), 1
	result["outboxState"], result["attemptCount"] = record.State, record.AttemptCount
	if s.Operation == "outbox" {
		return result, nil
	}
	if s.Operation != "replay" {
		return nil, errors.New("unknown fixture operation")
	}
	origin, err := url.Parse(s.ReceiverOrigin)
	if err != nil || origin.User != nil || origin.Host == "" ||
		(origin.Scheme != "http" && origin.Scheme != "https") ||
		(origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" {
		return nil, errors.New("invalid reviewed receiver origin")
	}
	store := readonlyKeys{authfed.NewKeyStoreGORMWithDB(db)}
	key, err := store.Load(ctx, authfed.SlotCurrent)
	if err != nil || key == nil || len(key.Priv) != ed25519.PrivateKeySize {
		return nil, errors.New("existing Station key unavailable")
	}
	defer clear(key.Priv)
	changed := proto.Clone(frame).(*delivery.Frame)
	issuer, err := mutate(changed, s)
	if err != nil {
		return nil, err
	}
	if s.Mutation != "duplicate" {
		if err := delivery.SignFrame(ctx, changed, delivery.DefaultFramePolicy(s.TargetStation), signer{key}); err != nil {
			return nil, errors.New("fixture frame signing failed")
		}
	}
	client := &http.Client{Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	transport, err := federation.NewHTTPTransport(client, authfed.NewKeyCache(store),
		issuer, fixedRoute(s.ReceiverOrigin), nil)
	if err != nil {
		return nil, err
	}
	disposition, err := transport.Deliver(ctx, changed)
	if err != nil {
		return nil, errors.New("real Federation ingress unavailable")
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(changed)
	if err != nil {
		return nil, err
	}
	result["mutation"], result["sentFrameSha256"] = s.Mutation, digest(encoded)
	result["disposition"], result["errorCode"] = int32(disposition.Disposition), int32(disposition.ErrorCode)
	return result, nil
}

func main() {
	var s scope
	reader := json.NewDecoder(io.LimitReader(os.Stdin, 8193))
	reader.DisallowUnknownFields()
	if reader.Decode(&s) != nil {
		os.Exit(2)
	}
	result, err := run(s)
	if err != nil {
		fmt.Fprintln(os.Stderr, "source-bound private delivery fixture failed")
		os.Exit(3)
	}
	if json.NewEncoder(os.Stdout).Encode(result) != nil {
		os.Exit(4)
	}
}
