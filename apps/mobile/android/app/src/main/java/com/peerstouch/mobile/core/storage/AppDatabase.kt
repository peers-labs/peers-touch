package com.peerstouch.mobile.core.storage

import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.RoomDatabase

@Entity(tableName = "app_metadata")
data class AppMetadataEntity(
    @PrimaryKey val key: String,
    val value: String?
)

@Database(entities = [AppMetadataEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase()
