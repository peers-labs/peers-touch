// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'global_users_storage.dart';

// ignore_for_file: type=lint
class $GlobalUserItemsTable extends GlobalUserItems
    with TableInfo<$GlobalUserItemsTable, GlobalUserItem> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $GlobalUserItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _handleMeta = const VerificationMeta('handle');
  @override
  late final GeneratedColumn<String> handle = GeneratedColumn<String>(
    'handle',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _emailMeta = const VerificationMeta('email');
  @override
  late final GeneratedColumn<String> email = GeneratedColumn<String>(
    'email',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _avatarUrlMeta = const VerificationMeta(
    'avatarUrl',
  );
  @override
  late final GeneratedColumn<String> avatarUrl = GeneratedColumn<String>(
    'avatar_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverUrlMeta = const VerificationMeta(
    'serverUrl',
  );
  @override
  late final GeneratedColumn<String> serverUrl = GeneratedColumn<String>(
    'server_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastLoginAtMeta = const VerificationMeta(
    'lastLoginAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastLoginAt = GeneratedColumn<DateTime>(
    'last_login_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    handle,
    email,
    avatarUrl,
    serverUrl,
    lastLoginAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'global_user_items';
  @override
  VerificationContext validateIntegrity(
    Insertable<GlobalUserItem> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('handle')) {
      context.handle(
        _handleMeta,
        handle.isAcceptableOrUnknown(data['handle']!, _handleMeta),
      );
    } else if (isInserting) {
      context.missing(_handleMeta);
    }
    if (data.containsKey('email')) {
      context.handle(
        _emailMeta,
        email.isAcceptableOrUnknown(data['email']!, _emailMeta),
      );
    }
    if (data.containsKey('avatar_url')) {
      context.handle(
        _avatarUrlMeta,
        avatarUrl.isAcceptableOrUnknown(data['avatar_url']!, _avatarUrlMeta),
      );
    }
    if (data.containsKey('server_url')) {
      context.handle(
        _serverUrlMeta,
        serverUrl.isAcceptableOrUnknown(data['server_url']!, _serverUrlMeta),
      );
    }
    if (data.containsKey('last_login_at')) {
      context.handle(
        _lastLoginAtMeta,
        lastLoginAt.isAcceptableOrUnknown(
          data['last_login_at']!,
          _lastLoginAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastLoginAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {handle};
  @override
  GlobalUserItem map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return GlobalUserItem(
      handle: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}handle'],
      )!,
      email: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}email'],
      ),
      avatarUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}avatar_url'],
      ),
      serverUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_url'],
      ),
      lastLoginAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_login_at'],
      )!,
    );
  }

  @override
  $GlobalUserItemsTable createAlias(String alias) {
    return $GlobalUserItemsTable(attachedDatabase, alias);
  }
}

class GlobalUserItem extends DataClass implements Insertable<GlobalUserItem> {
  final String handle;
  final String? email;
  final String? avatarUrl;
  final String? serverUrl;
  final DateTime lastLoginAt;
  const GlobalUserItem({
    required this.handle,
    this.email,
    this.avatarUrl,
    this.serverUrl,
    required this.lastLoginAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['handle'] = Variable<String>(handle);
    if (!nullToAbsent || email != null) {
      map['email'] = Variable<String>(email);
    }
    if (!nullToAbsent || avatarUrl != null) {
      map['avatar_url'] = Variable<String>(avatarUrl);
    }
    if (!nullToAbsent || serverUrl != null) {
      map['server_url'] = Variable<String>(serverUrl);
    }
    map['last_login_at'] = Variable<DateTime>(lastLoginAt);
    return map;
  }

  GlobalUserItemsCompanion toCompanion(bool nullToAbsent) {
    return GlobalUserItemsCompanion(
      handle: Value(handle),
      email: email == null && nullToAbsent
          ? const Value.absent()
          : Value(email),
      avatarUrl: avatarUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(avatarUrl),
      serverUrl: serverUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(serverUrl),
      lastLoginAt: Value(lastLoginAt),
    );
  }

  factory GlobalUserItem.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return GlobalUserItem(
      handle: serializer.fromJson<String>(json['handle']),
      email: serializer.fromJson<String?>(json['email']),
      avatarUrl: serializer.fromJson<String?>(json['avatarUrl']),
      serverUrl: serializer.fromJson<String?>(json['serverUrl']),
      lastLoginAt: serializer.fromJson<DateTime>(json['lastLoginAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'handle': serializer.toJson<String>(handle),
      'email': serializer.toJson<String?>(email),
      'avatarUrl': serializer.toJson<String?>(avatarUrl),
      'serverUrl': serializer.toJson<String?>(serverUrl),
      'lastLoginAt': serializer.toJson<DateTime>(lastLoginAt),
    };
  }

  GlobalUserItem copyWith({
    String? handle,
    Value<String?> email = const Value.absent(),
    Value<String?> avatarUrl = const Value.absent(),
    Value<String?> serverUrl = const Value.absent(),
    DateTime? lastLoginAt,
  }) => GlobalUserItem(
    handle: handle ?? this.handle,
    email: email.present ? email.value : this.email,
    avatarUrl: avatarUrl.present ? avatarUrl.value : this.avatarUrl,
    serverUrl: serverUrl.present ? serverUrl.value : this.serverUrl,
    lastLoginAt: lastLoginAt ?? this.lastLoginAt,
  );
  GlobalUserItem copyWithCompanion(GlobalUserItemsCompanion data) {
    return GlobalUserItem(
      handle: data.handle.present ? data.handle.value : this.handle,
      email: data.email.present ? data.email.value : this.email,
      avatarUrl: data.avatarUrl.present ? data.avatarUrl.value : this.avatarUrl,
      serverUrl: data.serverUrl.present ? data.serverUrl.value : this.serverUrl,
      lastLoginAt: data.lastLoginAt.present
          ? data.lastLoginAt.value
          : this.lastLoginAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('GlobalUserItem(')
          ..write('handle: $handle, ')
          ..write('email: $email, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('serverUrl: $serverUrl, ')
          ..write('lastLoginAt: $lastLoginAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(handle, email, avatarUrl, serverUrl, lastLoginAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GlobalUserItem &&
          other.handle == this.handle &&
          other.email == this.email &&
          other.avatarUrl == this.avatarUrl &&
          other.serverUrl == this.serverUrl &&
          other.lastLoginAt == this.lastLoginAt);
}

class GlobalUserItemsCompanion extends UpdateCompanion<GlobalUserItem> {
  final Value<String> handle;
  final Value<String?> email;
  final Value<String?> avatarUrl;
  final Value<String?> serverUrl;
  final Value<DateTime> lastLoginAt;
  final Value<int> rowid;
  const GlobalUserItemsCompanion({
    this.handle = const Value.absent(),
    this.email = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.serverUrl = const Value.absent(),
    this.lastLoginAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  GlobalUserItemsCompanion.insert({
    required String handle,
    this.email = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.serverUrl = const Value.absent(),
    required DateTime lastLoginAt,
    this.rowid = const Value.absent(),
  }) : handle = Value(handle),
       lastLoginAt = Value(lastLoginAt);
  static Insertable<GlobalUserItem> custom({
    Expression<String>? handle,
    Expression<String>? email,
    Expression<String>? avatarUrl,
    Expression<String>? serverUrl,
    Expression<DateTime>? lastLoginAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (handle != null) 'handle': handle,
      if (email != null) 'email': email,
      if (avatarUrl != null) 'avatar_url': avatarUrl,
      if (serverUrl != null) 'server_url': serverUrl,
      if (lastLoginAt != null) 'last_login_at': lastLoginAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  GlobalUserItemsCompanion copyWith({
    Value<String>? handle,
    Value<String?>? email,
    Value<String?>? avatarUrl,
    Value<String?>? serverUrl,
    Value<DateTime>? lastLoginAt,
    Value<int>? rowid,
  }) {
    return GlobalUserItemsCompanion(
      handle: handle ?? this.handle,
      email: email ?? this.email,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      serverUrl: serverUrl ?? this.serverUrl,
      lastLoginAt: lastLoginAt ?? this.lastLoginAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (handle.present) {
      map['handle'] = Variable<String>(handle.value);
    }
    if (email.present) {
      map['email'] = Variable<String>(email.value);
    }
    if (avatarUrl.present) {
      map['avatar_url'] = Variable<String>(avatarUrl.value);
    }
    if (serverUrl.present) {
      map['server_url'] = Variable<String>(serverUrl.value);
    }
    if (lastLoginAt.present) {
      map['last_login_at'] = Variable<DateTime>(lastLoginAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('GlobalUserItemsCompanion(')
          ..write('handle: $handle, ')
          ..write('email: $email, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('serverUrl: $serverUrl, ')
          ..write('lastLoginAt: $lastLoginAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$GlobalUsersDatabase extends GeneratedDatabase {
  _$GlobalUsersDatabase(QueryExecutor e) : super(e);
  $GlobalUsersDatabaseManager get managers => $GlobalUsersDatabaseManager(this);
  late final $GlobalUserItemsTable globalUserItems = $GlobalUserItemsTable(
    this,
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [globalUserItems];
}

typedef $$GlobalUserItemsTableCreateCompanionBuilder =
    GlobalUserItemsCompanion Function({
      required String handle,
      Value<String?> email,
      Value<String?> avatarUrl,
      Value<String?> serverUrl,
      required DateTime lastLoginAt,
      Value<int> rowid,
    });
typedef $$GlobalUserItemsTableUpdateCompanionBuilder =
    GlobalUserItemsCompanion Function({
      Value<String> handle,
      Value<String?> email,
      Value<String?> avatarUrl,
      Value<String?> serverUrl,
      Value<DateTime> lastLoginAt,
      Value<int> rowid,
    });

class $$GlobalUserItemsTableFilterComposer
    extends Composer<_$GlobalUsersDatabase, $GlobalUserItemsTable> {
  $$GlobalUserItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get handle => $composableBuilder(
    column: $table.handle,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get email => $composableBuilder(
    column: $table.email,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverUrl => $composableBuilder(
    column: $table.serverUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastLoginAt => $composableBuilder(
    column: $table.lastLoginAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$GlobalUserItemsTableOrderingComposer
    extends Composer<_$GlobalUsersDatabase, $GlobalUserItemsTable> {
  $$GlobalUserItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get handle => $composableBuilder(
    column: $table.handle,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get email => $composableBuilder(
    column: $table.email,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverUrl => $composableBuilder(
    column: $table.serverUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastLoginAt => $composableBuilder(
    column: $table.lastLoginAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$GlobalUserItemsTableAnnotationComposer
    extends Composer<_$GlobalUsersDatabase, $GlobalUserItemsTable> {
  $$GlobalUserItemsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get handle =>
      $composableBuilder(column: $table.handle, builder: (column) => column);

  GeneratedColumn<String> get email =>
      $composableBuilder(column: $table.email, builder: (column) => column);

  GeneratedColumn<String> get avatarUrl =>
      $composableBuilder(column: $table.avatarUrl, builder: (column) => column);

  GeneratedColumn<String> get serverUrl =>
      $composableBuilder(column: $table.serverUrl, builder: (column) => column);

  GeneratedColumn<DateTime> get lastLoginAt => $composableBuilder(
    column: $table.lastLoginAt,
    builder: (column) => column,
  );
}

class $$GlobalUserItemsTableTableManager
    extends
        RootTableManager<
          _$GlobalUsersDatabase,
          $GlobalUserItemsTable,
          GlobalUserItem,
          $$GlobalUserItemsTableFilterComposer,
          $$GlobalUserItemsTableOrderingComposer,
          $$GlobalUserItemsTableAnnotationComposer,
          $$GlobalUserItemsTableCreateCompanionBuilder,
          $$GlobalUserItemsTableUpdateCompanionBuilder,
          (
            GlobalUserItem,
            BaseReferences<
              _$GlobalUsersDatabase,
              $GlobalUserItemsTable,
              GlobalUserItem
            >,
          ),
          GlobalUserItem,
          PrefetchHooks Function()
        > {
  $$GlobalUserItemsTableTableManager(
    _$GlobalUsersDatabase db,
    $GlobalUserItemsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$GlobalUserItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$GlobalUserItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$GlobalUserItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> handle = const Value.absent(),
                Value<String?> email = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> serverUrl = const Value.absent(),
                Value<DateTime> lastLoginAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => GlobalUserItemsCompanion(
                handle: handle,
                email: email,
                avatarUrl: avatarUrl,
                serverUrl: serverUrl,
                lastLoginAt: lastLoginAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String handle,
                Value<String?> email = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> serverUrl = const Value.absent(),
                required DateTime lastLoginAt,
                Value<int> rowid = const Value.absent(),
              }) => GlobalUserItemsCompanion.insert(
                handle: handle,
                email: email,
                avatarUrl: avatarUrl,
                serverUrl: serverUrl,
                lastLoginAt: lastLoginAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$GlobalUserItemsTableProcessedTableManager =
    ProcessedTableManager<
      _$GlobalUsersDatabase,
      $GlobalUserItemsTable,
      GlobalUserItem,
      $$GlobalUserItemsTableFilterComposer,
      $$GlobalUserItemsTableOrderingComposer,
      $$GlobalUserItemsTableAnnotationComposer,
      $$GlobalUserItemsTableCreateCompanionBuilder,
      $$GlobalUserItemsTableUpdateCompanionBuilder,
      (
        GlobalUserItem,
        BaseReferences<
          _$GlobalUsersDatabase,
          $GlobalUserItemsTable,
          GlobalUserItem
        >,
      ),
      GlobalUserItem,
      PrefetchHooks Function()
    >;

class $GlobalUsersDatabaseManager {
  final _$GlobalUsersDatabase _db;
  $GlobalUsersDatabaseManager(this._db);
  $$GlobalUserItemsTableTableManager get globalUserItems =>
      $$GlobalUserItemsTableTableManager(_db, _db.globalUserItems);
}
