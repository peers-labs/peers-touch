package relay

import (
	"crypto/ed25519"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/libp2p/go-libp2p/core/peer"
	"gorm.io/gorm"
)

// The old Relay-only primary key cannot isolate Nodes sharing a database.
// Rebuild transactionally on SQLite/PostgreSQL instead of relying on AutoMigrate
// to remove an existing primary key. Unknown owners remain unowned and inert;
// migration never assigns somebody else's credential to the booting Node.
func migrateAttachmentScope(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext('station_relay_attachment_scope'))").Error; err != nil {
				return err
			}
		}
		if !tx.Migrator().HasTable(&relayAttachmentPO{}) {
			return tx.AutoMigrate(&relayAttachmentPO{})
		}
		columns, err := tx.Migrator().ColumnTypes(&relayAttachmentPO{})
		if err != nil {
			return err
		}
		primary := make(map[string]bool)
		for _, column := range columns {
			value, known := column.PrimaryKey()
			if known && value {
				primary[column.Name()] = true
			}
		}
		if len(primary) == 3 && primary["station_peer_id"] && primary["node_peer_id"] && primary["relay_peer_id"] {
			return tx.AutoMigrate(&relayAttachmentPO{})
		}
		if tx.Dialector.Name() != "postgres" && tx.Dialector.Name() != "sqlite" {
			return fmt.Errorf("attachment scope migration requires SQLite or PostgreSQL")
		}
		if tx.Dialector.Name() == "postgres" {
			// Fence legacy DML through the snapshot and atomic table swap.
			if err := tx.Exec("LOCK TABLE station_relay_attachment IN ACCESS EXCLUSIVE MODE").Error; err != nil {
				return err
			}
		}
		var rows []relayAttachmentPO
		if err := tx.Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			if rows[index].StationPeerID != "" && rows[index].NodePeerID != "" {
				continue
			}
			station, node, err := attachmentCredentialOwner(rows[index])
			if err == nil {
				rows[index].StationPeerID, rows[index].NodePeerID = station, node
			} else {
				rows[index].StationPeerID, rows[index].NodePeerID = "", ""
				rows[index].LastError = "legacy attachment ownership could not be verified"
			}
		}
		const replacement = "station_relay_attachment_scoped"
		if err := tx.Table(replacement).Migrator().CreateTable(&relayAttachmentPO{}); err != nil {
			return err
		}
		if len(rows) > 0 {
			if err := tx.Table(replacement).Create(&rows).Error; err != nil {
				return err
			}
		}
		if err := tx.Migrator().DropTable(&relayAttachmentPO{}); err != nil {
			return err
		}
		return tx.Migrator().RenameTable(replacement, (&relayAttachmentPO{}).TableName())
	})
}

type attachmentOwnerClaims struct {
	StationPeerID string `json:"station_peer_id"`
	NodePeerID    string `json:"node_peer_id"`
	Type          string `json:"type"`
	jwt.RegisteredClaims
}

// Persisted enrollment credentials may expire while the Station is stopped.
// Ownership migration verifies their signature; it grants no runtime access.
func (*attachmentOwnerClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	return nil, nil
}

func attachmentCredentialOwner(row relayAttachmentPO) (string, string, error) {
	credential, err := loadRelayCredential(row.CredentialFile)
	if err != nil {
		return "", "", err
	}
	relayID, err := peer.Decode(row.RelayPeerID)
	if err != nil {
		return "", "", err
	}
	publicKey, err := relayID.ExtractPublicKey()
	if err != nil {
		return "", "", err
	}
	rawKey, err := publicKey.Raw()
	if err != nil || len(rawKey) != ed25519.PublicKeySize {
		return "", "", fmt.Errorf("Relay credential signing key is invalid")
	}
	claims := &attachmentOwnerClaims{}
	token, err := jwt.ParseWithClaims(credential.Token, claims, func(*jwt.Token) (any, error) {
		return ed25519.PublicKey(rawKey), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(row.RelayPeerID), jwt.WithAudience("peers-touch-relay-enrollment"),
		jwt.WithIssuedAt(), jwt.WithTimeFunc(func() time.Time { return time.Now().UTC() }))
	if err != nil || token == nil || !token.Valid || claims.Type != "relay_enrollment" ||
		claims.ExpiresAt == nil || claims.IssuedAt == nil ||
		!claims.ExpiresAt.After(claims.IssuedAt.Time) ||
		claims.Subject != "relay-access:"+claims.StationPeerID+":"+claims.NodePeerID {
		return "", "", fmt.Errorf("Relay credential ownership is invalid")
	}
	if _, err := peer.Decode(claims.StationPeerID); err != nil {
		return "", "", err
	}
	if _, err := peer.Decode(claims.NodePeerID); err != nil {
		return "", "", err
	}
	return claims.StationPeerID, claims.NodePeerID, nil
}
