package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestStationAccessKeyringSharesJWTAuthorityAcrossNodes(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	const secret = "station-access-shared-secret-0123456789"

	nodeA, err := OpenStationAccessKeyring(
		context.Background(),
		database,
		secret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	nodeB, err := OpenStationAccessKeyring(
		context.Background(),
		database,
		secret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}

	keyA, err := nodeA.Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	keyB, err := nodeB.Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if keyA.ID == "" || keyA.ID != keyB.ID {
		t.Fatalf("shared key ids differ: A=%q B=%q", keyA.ID, keyB.ID)
	}

	issuer := NewJWTProvider(
		"ignored-local-a",
		time.Hour,
		WithStationAccessKeyring(nodeA),
	)
	_, token, err := issuer.Authenticate(
		context.Background(),
		Credentials{
			SubjectID: "ptid:v1:actor:peers:p:alice:fingerprint",
			SessionID: "session-shared",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	unverified, _, err := jwt.NewParser().ParseUnverified(
		token.Value,
		&jwtClaims{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if unverified.Header["kid"] != keyA.ID {
		t.Fatalf(
			"JWT key id = %v, want %s",
			unverified.Header["kid"],
			keyA.ID,
		)
	}

	validator := NewJWTProvider(
		"ignored-local-b",
		time.Hour,
		WithStationAccessKeyring(nodeB),
	)
	subject, err := validator.Validate(context.Background(), token.Value)
	if err != nil {
		t.Fatal(err)
	}
	if subject.SessionID != "session-shared" {
		t.Fatalf("validated session = %q", subject.SessionID)
	}
}

func TestStationAccessKeyringRejectsSecretAndSchemaMismatch(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	ctx := context.Background()
	const secret = "station-access-shared-secret-0123456789"

	if _, err := OpenStationAccessKeyring(
		ctx,
		database,
		secret,
		"",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStationAccessKeyring(
		ctx,
		database,
		"different-station-secret-0123456789",
		"",
	); !errors.Is(err, ErrStationAccessKeyringMismatch) {
		t.Fatalf("secret mismatch returned %v", err)
	}

	if err := database.Model(&StationAccessKeyRow{}).
		Where("slot = ?", stationAccessKeySlotCurrent).
		Update("schema_revision", stationAccessKeySchemaRevision+1).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStationAccessKeyring(
		ctx,
		database,
		secret,
		"",
	); !errors.Is(err, ErrStationAccessKeyringMismatch) {
		t.Fatalf("schema mismatch returned %v", err)
	}
}

func TestJWTValidationAcceptsPreKeyIDTokenThroughSharedKeyring(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	const secret = "station-access-shared-secret-0123456789"
	keyring, err := OpenStationAccessKeyring(
		context.Background(),
		database,
		secret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	legacy := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		SubjectPTID: "ptid:v1:actor:peers:p:alice:fingerprint",
		SessionID:   "legacy-session",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	})
	encoded, err := legacy.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	provider := NewJWTProvider(
		"ignored-local",
		time.Hour,
		WithStationAccessKeyring(keyring),
	)
	subject, err := provider.Validate(context.Background(), encoded)
	if err != nil {
		t.Fatal(err)
	}
	if subject.SessionID != "legacy-session" {
		t.Fatalf("legacy session = %q", subject.SessionID)
	}
}

func TestCustomJWTProviderDoesNotInheritStationAccessKeyring(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	const stationSecret = "station-access-shared-secret-0123456789"
	keyring, err := OpenStationAccessKeyring(
		context.Background(),
		database,
		stationSecret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	previousConfig := cfg
	previousKeyring := getStationAccessKeyring()
	Init(Config{Secret: stationSecret, AccessTTL: time.Hour})
	SetStationAccessKeyring(keyring)
	t.Cleanup(func() {
		SetStationAccessKeyring(previousKeyring)
		Init(previousConfig)
	})

	const customSecret = "dashboard-specific-secret"
	provider := NewJWTProvider(customSecret, time.Hour)
	_, token, err := provider.Authenticate(
		context.Background(),
		Credentials{SubjectID: "dashboard-admin"},
	)
	if err != nil {
		t.Fatal(err)
	}
	expectedKeyID := stationAccessKeyID([]byte(customSecret))
	unverified, _, err := jwt.NewParser().ParseUnverified(
		token.Value,
		&jwtClaims{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if unverified.Header["kid"] != expectedKeyID {
		t.Fatalf(
			"custom provider key id = %v, want %s",
			unverified.Header["kid"],
			expectedKeyID,
		)
	}
	if _, err := provider.Validate(
		context.Background(),
		token.Value,
	); err != nil {
		t.Fatal(err)
	}
}

func openStationAccessKeyringTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "file:" + uuid.NewString() + "?mode=memory&cache=shared"
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})
	return database
}
