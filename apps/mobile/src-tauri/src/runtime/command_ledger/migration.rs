use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::entry::SCHEMA_REVISION;
use super::error::{LedgerError, LedgerErrorCode, LedgerResult};

const MANIFEST_MAGIC: &[u8; 8] = b"PTLQ2\0\0\0";
const MANIFEST_INCOMPLETE: u8 = 0;
const MANIFEST_COMPLETE: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyLedgerPaths {
    pub database_path: PathBuf,
    pub quarantine_directory: PathBuf,
    pub manifest_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct QuarantineMove {
    source: PathBuf,
    destination: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct QuarantineManifest {
    complete: bool,
    moves: Vec<QuarantineMove>,
}

pub fn quarantine_legacy_if_present(paths: &LegacyLedgerPaths) -> LedgerResult<()> {
    if paths.manifest_path.exists() {
        finish_quarantine(paths)?;
        return Err(LedgerError::new(
            LedgerErrorCode::LegacyArchiveRetained,
            "open command ledger",
            "opaque v1 archive is retained; admission remains closed",
        ));
    }

    let existing = legacy_companions(&paths.database_path)
        .into_iter()
        .filter(|path| path.exists())
        .collect::<Vec<_>>();
    if existing.is_empty() {
        if directory_has_entries(&paths.quarantine_directory)? {
            return Err(LedgerError::new(
                LedgerErrorCode::LegacyQuarantineIncomplete,
                "inspect legacy quarantine",
                "quarantine directory contains data without a manifest",
            ));
        }
        return Ok(());
    }

    fs::create_dir_all(&paths.quarantine_directory)
        .map_err(|error| LedgerError::io("create legacy quarantine directory", error))?;
    let moves = existing
        .into_iter()
        .map(|source| {
            let file_name = source.file_name().ok_or_else(|| {
                LedgerError::new(
                    LedgerErrorCode::InvalidConfiguration,
                    "plan legacy quarantine",
                    "legacy database path has no file name",
                )
            })?;
            Ok(QuarantineMove {
                destination: paths.quarantine_directory.join(file_name),
                source,
            })
        })
        .collect::<LedgerResult<Vec<_>>>()?;
    write_manifest(
        &paths.manifest_path,
        &QuarantineManifest {
            complete: false,
            moves,
        },
    )?;
    finish_quarantine(paths)?;
    Err(LedgerError::new(
        LedgerErrorCode::LegacyArchiveRetained,
        "open command ledger",
        "opaque v1 archive was retained; explicit discard or reset is required",
    ))
}

pub fn discard_legacy_archive(paths: &LegacyLedgerPaths) -> LedgerResult<()> {
    if !paths.manifest_path.exists() {
        if directory_has_entries(&paths.quarantine_directory)? {
            return Err(LedgerError::new(
                LedgerErrorCode::LegacyQuarantineIncomplete,
                "discard legacy quarantine",
                "quarantine directory contains data without a manifest",
            ));
        }
        return Ok(());
    }
    finish_quarantine(paths)?;
    let manifest = read_manifest(&paths.manifest_path)?;
    if !manifest.complete {
        return Err(LedgerError::new(
            LedgerErrorCode::LegacyQuarantineIncomplete,
            "discard legacy quarantine",
            "quarantine manifest is not complete",
        ));
    }
    for planned_move in manifest.moves {
        if planned_move.source.exists() {
            return Err(LedgerError::new(
                LedgerErrorCode::LegacyQuarantineIncomplete,
                "discard legacy quarantine",
                "legacy source reappeared after quarantine",
            ));
        }
        remove_file_if_present(&planned_move.destination)?;
    }
    sync_directory(&paths.quarantine_directory)?;
    remove_file_if_present(&paths.manifest_path)?;
    sync_parent(&paths.manifest_path)?;
    if paths.quarantine_directory.exists() && !directory_has_entries(&paths.quarantine_directory)? {
        fs::remove_dir(&paths.quarantine_directory)
            .map_err(|error| LedgerError::io("remove empty quarantine directory", error))?;
        sync_parent(&paths.quarantine_directory)?;
    }
    Ok(())
}

pub fn remove_database_files(database_path: &Path) -> LedgerResult<()> {
    for path in legacy_companions(database_path) {
        remove_file_if_present(&path)?;
    }
    sync_parent(database_path)
}

pub fn has_user_tables(connection: &Connection) -> LedgerResult<bool> {
    let count: u64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| LedgerError::storage("inspect command ledger schema", error))?;
    Ok(count > 0)
}

pub fn has_scope_metadata(connection: &Connection) -> LedgerResult<bool> {
    let count: u64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name = 'command_scope_metadata'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| LedgerError::storage("inspect scope metadata schema", error))?;
    Ok(count == 1)
}

pub fn create_v2_schema(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch(
            "
            CREATE TABLE command_scope_metadata (
                singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
                schema_revision INTEGER NOT NULL,
                station_peer_id TEXT NOT NULL,
                actor_ptid      TEXT NOT NULL,
                kek_id          TEXT NOT NULL,
                install_epoch   BLOB NOT NULL,
                command_key_id  TEXT NOT NULL,
                auth_nonce      BLOB NOT NULL,
                auth_tag        BLOB NOT NULL
            );

            CREATE TABLE command_entries (
                command_id             TEXT PRIMARY KEY NOT NULL,
                ordering_key           TEXT NOT NULL,
                state                  INTEGER NOT NULL,
                attempt_count          INTEGER NOT NULL,
                payload_sha256         BLOB NOT NULL,
                payload_size           INTEGER NOT NULL,
                created_at_ms          INTEGER NOT NULL,
                updated_at_ms          INTEGER NOT NULL,
                expires_at_ms          INTEGER NOT NULL,
                dispatch_started_at_ms INTEGER,
                next_attempt_at_ms     INTEGER,
                envelope_nonce         BLOB NOT NULL,
                envelope_ciphertext    BLOB NOT NULL
            );

            CREATE TABLE projection_checkpoints (
                command_id          TEXT PRIMARY KEY NOT NULL,
                payload_sha256      BLOB NOT NULL,
                created_at_ms       INTEGER NOT NULL,
                lookup_nonce        BLOB NOT NULL,
                lookup_ciphertext   BLOB NOT NULL
            );

            CREATE INDEX command_entries_dispatch
                ON command_entries(state, next_attempt_at_ms, created_at_ms);
            CREATE INDEX command_entries_ordering
                ON command_entries(ordering_key, created_at_ms, command_id);
            CREATE INDEX projection_checkpoints_created
                ON projection_checkpoints(created_at_ms, command_id);
            ",
        )
        .map_err(|error| LedgerError::storage("create command ledger v2 schema", error))?;
    connection
        .pragma_update(None, "user_version", SCHEMA_REVISION)
        .map_err(|error| LedgerError::storage("set command ledger schema revision", error))
}

fn finish_quarantine(paths: &LegacyLedgerPaths) -> LedgerResult<()> {
    let mut manifest = read_manifest(&paths.manifest_path)?;
    if manifest.complete {
        verify_complete_manifest(&manifest)?;
        return Ok(());
    }
    fs::create_dir_all(&paths.quarantine_directory)
        .map_err(|error| LedgerError::io("create legacy quarantine directory", error))?;
    for planned_move in &manifest.moves {
        match (
            planned_move.source.exists(),
            planned_move.destination.exists(),
        ) {
            (true, false) => {
                fs::rename(&planned_move.source, &planned_move.destination).map_err(|error| {
                    LedgerError::io("move legacy database to quarantine", error)
                })?;
                sync_parent(&planned_move.source)?;
                sync_parent(&planned_move.destination)?;
            }
            (false, true) => {}
            (true, true) => {
                return Err(LedgerError::new(
                    LedgerErrorCode::LegacyQuarantineIncomplete,
                    "recover legacy quarantine",
                    "both source and destination exist for a planned move",
                ));
            }
            (false, false) => {
                return Err(LedgerError::new(
                    LedgerErrorCode::LegacyQuarantineIncomplete,
                    "recover legacy quarantine",
                    "neither source nor destination exists for a planned move",
                ));
            }
        }
    }
    manifest.complete = true;
    write_manifest(&paths.manifest_path, &manifest)?;
    verify_complete_manifest(&manifest)
}

fn verify_complete_manifest(manifest: &QuarantineManifest) -> LedgerResult<()> {
    for planned_move in &manifest.moves {
        if planned_move.source.exists() || !planned_move.destination.exists() {
            return Err(LedgerError::new(
                LedgerErrorCode::LegacyQuarantineIncomplete,
                "verify legacy quarantine",
                "complete manifest does not match filesystem state",
            ));
        }
    }
    Ok(())
}

fn write_manifest(path: &Path, manifest: &QuarantineManifest) -> LedgerResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| LedgerError::io("create quarantine manifest directory", error))?;
    }
    let temporary_path = path.with_extension("tmp");
    let mut bytes = Vec::new();
    bytes.extend_from_slice(MANIFEST_MAGIC);
    bytes.push(if manifest.complete {
        MANIFEST_COMPLETE
    } else {
        MANIFEST_INCOMPLETE
    });
    write_u32(
        &mut bytes,
        u32::try_from(manifest.moves.len()).map_err(|_| {
            LedgerError::new(
                LedgerErrorCode::InvalidConfiguration,
                "encode quarantine manifest",
                "too many quarantine moves",
            )
        })?,
    );
    for planned_move in &manifest.moves {
        write_path(&mut bytes, &planned_move.source)?;
        write_path(&mut bytes, &planned_move.destination)?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary_path)
        .map_err(|error| LedgerError::io("open quarantine manifest", error))?;
    file.write_all(&bytes)
        .map_err(|error| LedgerError::io("write quarantine manifest", error))?;
    file.sync_all()
        .map_err(|error| LedgerError::io("sync quarantine manifest", error))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| LedgerError::io("publish quarantine manifest", error))?;
    sync_parent(path)
}

fn read_manifest(path: &Path) -> LedgerResult<QuarantineManifest> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| LedgerError::io("open quarantine manifest", error))?
        .read_to_end(&mut bytes)
        .map_err(|error| LedgerError::io("read quarantine manifest", error))?;
    let mut cursor = bytes.as_slice();
    if take(&mut cursor, MANIFEST_MAGIC.len())? != MANIFEST_MAGIC {
        return Err(invalid_manifest("manifest magic is invalid"));
    }
    let complete = match take(&mut cursor, 1)?[0] {
        MANIFEST_INCOMPLETE => false,
        MANIFEST_COMPLETE => true,
        _ => return Err(invalid_manifest("manifest completion marker is invalid")),
    };
    let count = read_u32(&mut cursor)? as usize;
    let mut moves = Vec::with_capacity(count);
    for _ in 0..count {
        moves.push(QuarantineMove {
            source: read_path(&mut cursor)?,
            destination: read_path(&mut cursor)?,
        });
    }
    if !cursor.is_empty() || moves.is_empty() {
        return Err(invalid_manifest("manifest framing is invalid"));
    }
    Ok(QuarantineManifest { complete, moves })
}

fn legacy_companions(database_path: &Path) -> [PathBuf; 3] {
    [
        database_path.to_path_buf(),
        append_suffix(database_path, "-wal"),
        append_suffix(database_path, "-shm"),
    ]
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn directory_has_entries(path: &Path) -> LedgerResult<bool> {
    if !path.exists() {
        return Ok(false);
    }
    Ok(fs::read_dir(path)
        .map_err(|error| LedgerError::io("inspect quarantine directory", error))?
        .next()
        .is_some())
}

fn remove_file_if_present(path: &Path) -> LedgerResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(LedgerError::io("remove reliability data file", error)),
    }
}

fn sync_parent(path: &Path) -> LedgerResult<()> {
    match path.parent() {
        Some(parent) => sync_directory(parent),
        None => Ok(()),
    }
}

fn sync_directory(path: &Path) -> LedgerResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| LedgerError::io("sync reliability data directory", error))
}

fn write_path(bytes: &mut Vec<u8>, path: &Path) -> LedgerResult<()> {
    let encoded = path.to_str().ok_or_else(|| {
        LedgerError::new(
            LedgerErrorCode::InvalidConfiguration,
            "encode quarantine manifest",
            "reliability paths must be valid UTF-8",
        )
    })?;
    let length = u32::try_from(encoded.len()).map_err(|_| {
        LedgerError::new(
            LedgerErrorCode::InvalidConfiguration,
            "encode quarantine manifest",
            "reliability path is too long",
        )
    })?;
    write_u32(bytes, length);
    bytes.extend_from_slice(encoded.as_bytes());
    Ok(())
}

fn read_path(cursor: &mut &[u8]) -> LedgerResult<PathBuf> {
    let length = read_u32(cursor)? as usize;
    let encoded = std::str::from_utf8(take(cursor, length)?)
        .map_err(|_| invalid_manifest("manifest path is not UTF-8"))?;
    Ok(PathBuf::from(encoded))
}

fn write_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn read_u32(cursor: &mut &[u8]) -> LedgerResult<u32> {
    let bytes: [u8; 4] = take(cursor, 4)?
        .try_into()
        .map_err(|_| invalid_manifest("manifest integer is truncated"))?;
    Ok(u32::from_be_bytes(bytes))
}

fn take<'a>(cursor: &mut &'a [u8], length: usize) -> LedgerResult<&'a [u8]> {
    if cursor.len() < length {
        return Err(invalid_manifest("manifest is truncated"));
    }
    let (head, tail) = cursor.split_at(length);
    *cursor = tail;
    Ok(head)
}

fn invalid_manifest(detail: impl Into<String>) -> LedgerError {
    LedgerError::new(
        LedgerErrorCode::LegacyQuarantineIncomplete,
        "decode quarantine manifest",
        detail,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let mut suffix = [0_u8; 8];
            rand::rngs::OsRng.fill_bytes(&mut suffix);
            let path = std::env::temp_dir().join(format!(
                "peers-command-ledger-migration-{}",
                u64::from_be_bytes(suffix)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn paths(directory: &Path) -> LegacyLedgerPaths {
        LegacyLedgerPaths {
            database_path: directory.join("command_ledger.db"),
            quarantine_directory: directory.join("opaque-v1"),
            manifest_path: directory.join("command_ledger.quarantine"),
        }
    }

    #[test]
    fn quarantine_moves_main_wal_and_shm_without_reading_them() {
        let directory = TestDirectory::new();
        let paths = paths(&directory.0);
        for path in legacy_companions(&paths.database_path) {
            fs::write(path, b"opaque-v1").unwrap();
        }

        let error = quarantine_legacy_if_present(&paths).unwrap_err();
        assert_eq!(error.code, LedgerErrorCode::LegacyArchiveRetained);
        let manifest = read_manifest(&paths.manifest_path).unwrap();
        assert!(manifest.complete);
        assert_eq!(manifest.moves.len(), 3);
        assert!(manifest
            .moves
            .iter()
            .all(|entry| !entry.source.exists() && entry.destination.exists()));

        discard_legacy_archive(&paths).unwrap();
        assert!(!paths.manifest_path.exists());
        assert!(!paths.quarantine_directory.exists());
    }

    #[test]
    fn partial_quarantine_recovers_idempotently() {
        let directory = TestDirectory::new();
        let paths = paths(&directory.0);
        fs::create_dir_all(&paths.quarantine_directory).unwrap();
        fs::write(&paths.database_path, b"main").unwrap();
        let wal = append_suffix(&paths.database_path, "-wal");
        fs::write(&wal, b"wal").unwrap();
        let moves = legacy_companions(&paths.database_path)
            .into_iter()
            .filter(|path| path.exists())
            .map(|source| QuarantineMove {
                destination: paths.quarantine_directory.join(source.file_name().unwrap()),
                source,
            })
            .collect::<Vec<_>>();
        write_manifest(
            &paths.manifest_path,
            &QuarantineManifest {
                complete: false,
                moves: moves.clone(),
            },
        )
        .unwrap();
        fs::rename(&moves[0].source, &moves[0].destination).unwrap();

        let error = quarantine_legacy_if_present(&paths).unwrap_err();
        assert_eq!(error.code, LedgerErrorCode::LegacyArchiveRetained);
        assert!(read_manifest(&paths.manifest_path).unwrap().complete);
        assert!(moves
            .iter()
            .all(|entry| !entry.source.exists() && entry.destination.exists()));
    }

    #[test]
    fn ambiguous_partial_quarantine_fails_closed() {
        let directory = TestDirectory::new();
        let paths = paths(&directory.0);
        fs::create_dir_all(&paths.quarantine_directory).unwrap();
        fs::write(&paths.database_path, b"source").unwrap();
        let destination = paths.quarantine_directory.join("command_ledger.db");
        fs::write(&destination, b"destination").unwrap();
        write_manifest(
            &paths.manifest_path,
            &QuarantineManifest {
                complete: false,
                moves: vec![QuarantineMove {
                    source: paths.database_path.clone(),
                    destination,
                }],
            },
        )
        .unwrap();

        let error = quarantine_legacy_if_present(&paths).unwrap_err();
        assert_eq!(error.code, LedgerErrorCode::LegacyQuarantineIncomplete);
    }
}
