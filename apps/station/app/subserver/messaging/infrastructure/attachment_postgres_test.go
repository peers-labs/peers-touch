package infrastructure_test

import "testing"

func TestPostgresCompetingAttachmentPartFinalizeAndGrant(t *testing.T) {
	database := openIsolatedPostgres(t)
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(8)

	exerciseCompetingAttachmentTransactions(t, database)
}
