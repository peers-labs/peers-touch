package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type PackageCatalogHandlers struct{}

func NewPackageCatalogHandlers() *PackageCatalogHandlers {
	return &PackageCatalogHandlers{}
}

func (*PackageCatalogHandlers) HandleOfficial(
	context.Context,
	*model.GetOfficialPackageCatalogRequest,
) (*model.GetOfficialPackageCatalogResponse, error) {
	return &model.GetOfficialPackageCatalogResponse{
		EnvelopeJson:   catalog.OfficialPackageCatalogEnvelope(),
		MediaType:      catalog.OfficialPackageCatalogMediaType,
		DistributionId: catalog.OfficialPackageCatalogDistributionID,
		EnvelopeSha256: catalog.OfficialPackageCatalogEnvelopeSHA256,
	}, nil
}
