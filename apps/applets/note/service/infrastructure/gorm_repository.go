package infrastructure

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/domain"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/infrastructure/schema"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type NoteRecord struct {
	ID        uint       `gorm:"column:id;primaryKey"`
	NoteID    string     `gorm:"column:note_id;size:64;uniqueIndex"`
	OwnerPTID string     `gorm:"column:owner_ptid;size:255;index:idx_note_owner_updated"`
	Title     string     `gorm:"column:title;size:512"`
	Content   string     `gorm:"column:content;type:text"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at;index:idx_note_owner_updated"`
	DeletedAt *time.Time `gorm:"column:deleted_at;index"`
}

func (*NoteRecord) TableName() string {
	return "official_applet_notes"
}

type GormRepository struct {
	db *gorm.DB
}

func NewGormRepository(db *gorm.DB) *GormRepository {
	return &GormRepository{db: db}
}

func (r *GormRepository) AutoMigrate(ctx context.Context) error {
	if err := schema.MigrateOwnerPTIDColumn(r.db.WithContext(ctx)); err != nil {
		return err
	}
	return r.db.WithContext(ctx).AutoMigrate(&NoteRecord{})
}

func (r *GormRepository) Create(ctx context.Context, note *model.Note) (*model.Note, error) {
	record := toRecord(note)
	if err := r.db.WithContext(ctx).Create(&record).Error; err != nil {
		return nil, err
	}
	return toProto(record), nil
}

func (r *GormRepository) Get(ctx context.Context, ownerPtid string, noteID string, includeDeleted bool) (*model.Note, error) {
	var record NoteRecord
	query := r.ownerQuery(ctx, ownerPtid).Where("note_id = ?", noteID)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	if err := query.First(&record).Error; err != nil {
		return nil, mapGormLookupError(err)
	}
	return toProto(record), nil
}

func (r *GormRepository) List(ctx context.Context, query domain.ListQuery) (domain.Page, error) {
	pageSize := normalizePageSize(query.PageSize)
	offset, err := parsePageToken(query.PageToken)
	if err != nil {
		return domain.Page{}, err
	}
	orderBy, err := normalizeOrder(query.OrderBy)
	if err != nil {
		return domain.Page{}, err
	}
	dbQuery := r.ownerQuery(ctx, query.OwnerPTID)
	if !query.IncludeDeleted {
		dbQuery = dbQuery.Where("deleted_at IS NULL")
	}
	var records []NoteRecord
	if err := dbQuery.Order(orderBy).Limit(int(pageSize) + 1).Offset(offset).Find(&records).Error; err != nil {
		return domain.Page{}, err
	}
	return buildPage(records, pageSize, offset), nil
}

func (r *GormRepository) Update(ctx context.Context, ownerPtid string, noteID string, patch domain.UpdatePatch) (*model.Note, error) {
	var record NoteRecord
	if err := r.ownerQuery(ctx, ownerPtid).Where("note_id = ? AND deleted_at IS NULL", noteID).First(&record).Error; err != nil {
		return nil, mapGormLookupError(err)
	}
	if patch.Title != nil {
		record.Title = *patch.Title
	}
	if patch.Content != nil {
		record.Content = *patch.Content
	}
	if strings.TrimSpace(record.Title) == "" && strings.TrimSpace(record.Content) == "" {
		return nil, domain.ErrEmptyContent
	}
	record.UpdatedAt = time.Now().UTC()
	if err := r.db.WithContext(ctx).Save(&record).Error; err != nil {
		return nil, err
	}
	return toProto(record), nil
}

func (r *GormRepository) Delete(ctx context.Context, ownerPtid string, noteID string) (bool, error) {
	var record NoteRecord
	if err := r.ownerQuery(ctx, ownerPtid).Where("note_id = ? AND deleted_at IS NULL", noteID).First(&record).Error; err != nil {
		return false, mapGormLookupError(err)
	}
	now := time.Now().UTC()
	record.DeletedAt = &now
	record.UpdatedAt = now
	if err := r.db.WithContext(ctx).Save(&record).Error; err != nil {
		return false, err
	}
	return true, nil
}

func (r *GormRepository) Restore(ctx context.Context, ownerPtid string, noteID string) (*model.Note, error) {
	var record NoteRecord
	if err := r.ownerQuery(ctx, ownerPtid).Where("note_id = ?", noteID).First(&record).Error; err != nil {
		return nil, mapGormLookupError(err)
	}
	record.DeletedAt = nil
	record.UpdatedAt = time.Now().UTC()
	if err := r.db.WithContext(ctx).Save(&record).Error; err != nil {
		return nil, err
	}
	return toProto(record), nil
}

func (r *GormRepository) Search(ctx context.Context, query domain.SearchQuery) (domain.Page, error) {
	pageSize := normalizePageSize(query.PageSize)
	offset, err := parsePageToken(query.PageToken)
	if err != nil {
		return domain.Page{}, err
	}
	orderBy, err := normalizeOrder(query.OrderBy)
	if err != nil {
		return domain.Page{}, err
	}
	searchTerm := "%" + strings.ToLower(strings.TrimSpace(query.Query)) + "%"
	var records []NoteRecord
	err = r.ownerQuery(ctx, query.OwnerPTID).
		Where("deleted_at IS NULL").
		Where("LOWER(title) LIKE ? OR LOWER(content) LIKE ?", searchTerm, searchTerm).
		Order(orderBy).
		Limit(int(pageSize) + 1).
		Offset(offset).
		Find(&records).Error
	if err != nil {
		return domain.Page{}, err
	}
	return buildPage(records, pageSize, offset), nil
}

func (r *GormRepository) ownerQuery(ctx context.Context, ownerPtid string) *gorm.DB {
	return r.db.WithContext(ctx).Where("owner_ptid = ?", ownerPtid)
}

func normalizePageSize(pageSize int32) int32 {
	if pageSize <= 0 {
		return domain.DefaultPageSize
	}
	if pageSize > domain.MaxPageSize {
		return domain.MaxPageSize
	}
	return pageSize
}

func parsePageToken(pageToken string) (int, error) {
	if strings.TrimSpace(pageToken) == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(pageToken)
	if err != nil || offset < 0 {
		return 0, domain.ErrInvalidPageToken
	}
	return offset, nil
}

func normalizeOrder(orderBy string) (string, error) {
	switch strings.TrimSpace(orderBy) {
	case "", "updated_at desc":
		return "updated_at DESC, note_id DESC", nil
	case "updated_at asc":
		return "updated_at ASC, note_id ASC", nil
	case "created_at desc":
		return "created_at DESC, note_id DESC", nil
	case "created_at asc":
		return "created_at ASC, note_id ASC", nil
	case "title asc":
		return "title ASC, note_id ASC", nil
	default:
		return "", domain.ErrUnsupportedOrder
	}
}

func buildPage(records []NoteRecord, pageSize int32, offset int) domain.Page {
	nextPageToken := ""
	if len(records) > int(pageSize) {
		records = records[:pageSize]
		nextPageToken = strconv.Itoa(offset + int(pageSize))
	}
	items := make([]*model.Note, 0, len(records))
	for _, record := range records {
		items = append(items, toProto(record))
	}
	return domain.Page{Items: items, NextPageToken: nextPageToken}
}

func mapGormLookupError(err error) error {
	if err == gorm.ErrRecordNotFound {
		return domain.ErrNoteNotFound
	}
	return err
}

func toRecord(note *model.Note) NoteRecord {
	record := NoteRecord{
		NoteID:    note.GetNoteId(),
		OwnerPTID: note.GetOwnerPtid(),
		Title:     note.GetTitle(),
		Content:   note.GetContent(),
		CreatedAt: timestampToTime(note.GetCreatedAt()),
		UpdatedAt: timestampToTime(note.GetUpdatedAt()),
	}
	if note.GetDeletedAt() != nil {
		deletedAt := timestampToTime(note.GetDeletedAt())
		record.DeletedAt = &deletedAt
	}
	return record
}

func toProto(record NoteRecord) *model.Note {
	note := &model.Note{
		NoteId:    record.NoteID,
		OwnerPtid: record.OwnerPTID,
		Title:     record.Title,
		Content:   record.Content,
		CreatedAt: timestamppb.New(record.CreatedAt),
		UpdatedAt: timestamppb.New(record.UpdatedAt),
	}
	if record.DeletedAt != nil {
		note.DeletedAt = timestamppb.New(*record.DeletedAt)
	}
	return note
}

func timestampToTime(value *timestamppb.Timestamp) time.Time {
	if value == nil {
		return time.Now().UTC()
	}
	return value.AsTime().UTC()
}
