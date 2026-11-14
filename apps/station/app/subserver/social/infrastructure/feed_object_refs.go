package infrastructure

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// feedObjectRefs projects portable object identity from the signed-log owner.
// Local IDs remain local read anchors; they must never enter a signed payload.
func feedObjectRefs(ctx context.Context, database *gorm.DB, kind string, ids []uint64) (map[uint64]string, error) {
	refs := make(map[uint64]string)
	if len(ids) == 0 {
		return refs, nil
	}
	var objects []FeedObjectRecord
	if err := database.WithContext(ctx).Where("object_kind = ? AND local_id IN ?", kind, ids).Find(&objects).Error; err != nil {
		return nil, err
	}
	for _, object := range objects {
		refs[object.LocalID] = fmt.Sprintf("oss://%s/%s/%s", object.HomeStation, kind, object.ObjectID)
	}
	return refs, nil
}
