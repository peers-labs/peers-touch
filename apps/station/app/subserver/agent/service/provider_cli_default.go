package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *ProviderConfigService) cliProfileDefaults(ctx context.Context, owner ProviderOwner, records []persistence.AgentProvider) ([]*model.CLIProfileDefault, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.CLIProfileDefault
	if err := owner.Query(db.WithContext(ctx)).Order("cli_adapter_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	names := make(map[string]string, len(records))
	for _, record := range records {
		names[record.ID] = record.Name
	}
	result := make([]*model.CLIProfileDefault, 0, len(rows))
	for _, row := range rows {
		result = append(result, &model.CLIProfileDefault{CliAdapterId: row.CLIAdapterID,
			ProviderId: names[row.DefaultProviderRecordID], Revision: row.Revision})
	}
	return result, nil
}

func (s *ProviderManagementService) SetCLIProfileDefault(ctx context.Context, owner ProviderOwner, req *model.SetCLIProfileDefaultRequest) (*model.SetCLIProfileDefaultResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	db, err := s.providers.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conflict := func() error {
		return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "default CLI profile changed; reload before saving", nil)
	}
	var result *model.CLIProfileDefault
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Same lock order as deletion: profile first, preference second.
		var profile persistence.AgentProvider
		if err := owner.Query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", req.GetProviderId()).First(&profile).Error; err != nil {
			return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "CLI profile not found", nil)
		}
		if profile.RuntimeKind != providerRuntimeCLI || profile.CLIAdapterID != req.GetCliAdapterId() {
			return invalidCLIProfile("default profile must belong to the selected CLI")
		}
		var row persistence.CLIProfileDefault
		err := owner.Query(tx).Where("cli_adapter_id = ?", profile.CLIAdapterID).First(&row).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if req.GetExpectedRevision() != 0 {
				return conflict()
			}
			row = persistence.CLIProfileDefault{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
				CLIAdapterID: profile.CLIAdapterID, DefaultProviderRecordID: profile.ID, Revision: 1, UpdatedAt: time.Now().UTC()}
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return conflict()
			}
		case err != nil:
			return err
		default:
			if row.Revision != req.GetExpectedRevision() {
				return conflict()
			}
			if row.DefaultProviderRecordID != profile.ID {
				updated := owner.Query(tx.Model(&persistence.CLIProfileDefault{})).
					Where("cli_adapter_id = ? AND revision = ?", profile.CLIAdapterID, row.Revision).
					Updates(map[string]any{"default_provider_record_id": profile.ID, "revision": row.Revision + 1, "updated_at": time.Now().UTC()})
				if updated.Error != nil {
					return updated.Error
				}
				if updated.RowsAffected != 1 {
					return conflict()
				}
				row.Revision++
			}
		}
		result = &model.CLIProfileDefault{CliAdapterId: profile.CLIAdapterID, ProviderId: profile.Name, Revision: row.Revision}
		return nil
	})
	return &model.SetCLIProfileDefaultResponse{ProfileDefault: result}, err
}
