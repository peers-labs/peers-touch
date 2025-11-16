// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'kv_database.dart';

// ignore_for_file: type=lint
class $KeyValueItemsTable extends KeyValueItems
    with TableInfo<$KeyValueItemsTable, KeyValueItem> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $KeyValueItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
      'key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
      'value', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'key_value_items';
  @override
  VerificationContext validateIntegrity(Insertable<KeyValueItem> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
          _keyMeta, key.isAcceptableOrUnknown(data['key']!, _keyMeta));
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
          _valueMeta, value.isAcceptableOrUnknown(data['value']!, _valueMeta));
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  KeyValueItem map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return KeyValueItem(
      key: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}key'])!,
      value: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}value'])!,
    );
  }

  @override
  $KeyValueItemsTable createAlias(String alias) {
    return $KeyValueItemsTable(attachedDatabase, alias);
  }
}

class KeyValueItem extends DataClass implements Insertable<KeyValueItem> {
  /// The key for the stored value.
  final String key;

  /// The stored value, as a string.
  final String value;
  const KeyValueItem({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  KeyValueItemsCompanion toCompanion(bool nullToAbsent) {
    return KeyValueItemsCompanion(
      key: Value(key),
      value: Value(value),
    );
  }

  factory KeyValueItem.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return KeyValueItem(
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

  KeyValueItem copyWith({String? key, String? value}) => KeyValueItem(
        key: key ?? this.key,
        value: value ?? this.value,
      );
  KeyValueItem copyWithCompanion(KeyValueItemsCompanion data) {
    return KeyValueItem(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('KeyValueItem(')
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
      (other is KeyValueItem &&
          other.key == this.key &&
          other.value == this.value);
}

class KeyValueItemsCompanion extends UpdateCompanion<KeyValueItem> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const KeyValueItemsCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  KeyValueItemsCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  })  : key = Value(key),
        value = Value(value);
  static Insertable<KeyValueItem> custom({
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

  KeyValueItemsCompanion copyWith(
      {Value<String>? key, Value<String>? value, Value<int>? rowid}) {
    return KeyValueItemsCompanion(
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
    return (StringBuffer('KeyValueItemsCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$KvDatabase extends GeneratedDatabase {
  _$KvDatabase(QueryExecutor e) : super(e);
  $KvDatabaseManager get managers => $KvDatabaseManager(this);
  late final $KeyValueItemsTable keyValueItems = $KeyValueItemsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [keyValueItems];
}

typedef $$KeyValueItemsTableCreateCompanionBuilder = KeyValueItemsCompanion
    Function({
  required String key,
  required String value,
  Value<int> rowid,
});
typedef $$KeyValueItemsTableUpdateCompanionBuilder = KeyValueItemsCompanion
    Function({
  Value<String> key,
  Value<String> value,
  Value<int> rowid,
});

class $$KeyValueItemsTableFilterComposer
    extends Composer<_$KvDatabase, $KeyValueItemsTable> {
  $$KeyValueItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
      column: $table.key, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get value => $composableBuilder(
      column: $table.value, builder: (column) => ColumnFilters(column));
}

class $$KeyValueItemsTableOrderingComposer
    extends Composer<_$KvDatabase, $KeyValueItemsTable> {
  $$KeyValueItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
      column: $table.key, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get value => $composableBuilder(
      column: $table.value, builder: (column) => ColumnOrderings(column));
}

class $$KeyValueItemsTableAnnotationComposer
    extends Composer<_$KvDatabase, $KeyValueItemsTable> {
  $$KeyValueItemsTableAnnotationComposer({
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

class $$KeyValueItemsTableTableManager extends RootTableManager<
    _$KvDatabase,
    $KeyValueItemsTable,
    KeyValueItem,
    $$KeyValueItemsTableFilterComposer,
    $$KeyValueItemsTableOrderingComposer,
    $$KeyValueItemsTableAnnotationComposer,
    $$KeyValueItemsTableCreateCompanionBuilder,
    $$KeyValueItemsTableUpdateCompanionBuilder,
    (
      KeyValueItem,
      BaseReferences<_$KvDatabase, $KeyValueItemsTable, KeyValueItem>
    ),
    KeyValueItem,
    PrefetchHooks Function()> {
  $$KeyValueItemsTableTableManager(_$KvDatabase db, $KeyValueItemsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$KeyValueItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$KeyValueItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$KeyValueItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> key = const Value.absent(),
            Value<String> value = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              KeyValueItemsCompanion(
            key: key,
            value: value,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String key,
            required String value,
            Value<int> rowid = const Value.absent(),
          }) =>
              KeyValueItemsCompanion.insert(
            key: key,
            value: value,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$KeyValueItemsTableProcessedTableManager = ProcessedTableManager<
    _$KvDatabase,
    $KeyValueItemsTable,
    KeyValueItem,
    $$KeyValueItemsTableFilterComposer,
    $$KeyValueItemsTableOrderingComposer,
    $$KeyValueItemsTableAnnotationComposer,
    $$KeyValueItemsTableCreateCompanionBuilder,
    $$KeyValueItemsTableUpdateCompanionBuilder,
    (
      KeyValueItem,
      BaseReferences<_$KvDatabase, $KeyValueItemsTable, KeyValueItem>
    ),
    KeyValueItem,
    PrefetchHooks Function()>;

class $KvDatabaseManager {
  final _$KvDatabase _db;
  $KvDatabaseManager(this._db);
  $$KeyValueItemsTableTableManager get keyValueItems =>
      $$KeyValueItemsTableTableManager(_db, _db.keyValueItems);
}
