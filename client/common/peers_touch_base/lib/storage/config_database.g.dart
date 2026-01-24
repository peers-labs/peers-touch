// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'config_database.dart';

// ignore_for_file: type=lint
class $ConfigItemsTable extends ConfigItems
    with TableInfo<$ConfigItemsTable, ConfigItem> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ConfigItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'config_items';
  @override
  VerificationContext validateIntegrity(
    Insertable<ConfigItem> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  ConfigItem map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ConfigItem(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $ConfigItemsTable createAlias(String alias) {
    return $ConfigItemsTable(attachedDatabase, alias);
  }
}

class ConfigItem extends DataClass implements Insertable<ConfigItem> {
  final String key;
  final String value;
  const ConfigItem({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  ConfigItemsCompanion toCompanion(bool nullToAbsent) {
    return ConfigItemsCompanion(key: Value(key), value: Value(value));
  }

  factory ConfigItem.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ConfigItem(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  ConfigItem copyWith({String? key, String? value}) =>
      ConfigItem(key: key ?? this.key, value: value ?? this.value);
  ConfigItem copyWithCompanion(ConfigItemsCompanion data) {
    return ConfigItem(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ConfigItem(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ConfigItem &&
          other.key == this.key &&
          other.value == this.value);
}

class ConfigItemsCompanion extends UpdateCompanion<ConfigItem> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const ConfigItemsCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ConfigItemsCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<ConfigItem> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ConfigItemsCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return ConfigItemsCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ConfigItemsCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$ConfigDatabase extends GeneratedDatabase {
  _$ConfigDatabase(QueryExecutor e) : super(e);
  $ConfigDatabaseManager get managers => $ConfigDatabaseManager(this);
  late final $ConfigItemsTable configItems = $ConfigItemsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [configItems];
}

typedef $$ConfigItemsTableCreateCompanionBuilder =
    ConfigItemsCompanion Function({
      required String key,
      required String value,
      Value<int> rowid,
    });
typedef $$ConfigItemsTableUpdateCompanionBuilder =
    ConfigItemsCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<int> rowid,
    });

class $$ConfigItemsTableFilterComposer
    extends Composer<_$ConfigDatabase, $ConfigItemsTable> {
  $$ConfigItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$ConfigItemsTableOrderingComposer
    extends Composer<_$ConfigDatabase, $ConfigItemsTable> {
  $$ConfigItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$ConfigItemsTableAnnotationComposer
    extends Composer<_$ConfigDatabase, $ConfigItemsTable> {
  $$ConfigItemsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$ConfigItemsTableTableManager
    extends
        RootTableManager<
          _$ConfigDatabase,
          $ConfigItemsTable,
          ConfigItem,
          $$ConfigItemsTableFilterComposer,
          $$ConfigItemsTableOrderingComposer,
          $$ConfigItemsTableAnnotationComposer,
          $$ConfigItemsTableCreateCompanionBuilder,
          $$ConfigItemsTableUpdateCompanionBuilder,
          (
            ConfigItem,
            BaseReferences<_$ConfigDatabase, $ConfigItemsTable, ConfigItem>,
          ),
          ConfigItem,
          PrefetchHooks Function()
        > {
  $$ConfigItemsTableTableManager(_$ConfigDatabase db, $ConfigItemsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ConfigItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ConfigItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ConfigItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ConfigItemsCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                Value<int> rowid = const Value.absent(),
              }) => ConfigItemsCompanion.insert(
                key: key,
                value: value,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$ConfigItemsTableProcessedTableManager =
    ProcessedTableManager<
      _$ConfigDatabase,
      $ConfigItemsTable,
      ConfigItem,
      $$ConfigItemsTableFilterComposer,
      $$ConfigItemsTableOrderingComposer,
      $$ConfigItemsTableAnnotationComposer,
      $$ConfigItemsTableCreateCompanionBuilder,
      $$ConfigItemsTableUpdateCompanionBuilder,
      (
        ConfigItem,
        BaseReferences<_$ConfigDatabase, $ConfigItemsTable, ConfigItem>,
      ),
      ConfigItem,
      PrefetchHooks Function()
    >;

class $ConfigDatabaseManager {
  final _$ConfigDatabase _db;
  $ConfigDatabaseManager(this._db);
  $$ConfigItemsTableTableManager get configItems =>
      $$ConfigItemsTableTableManager(_db, _db.configItems);
}
