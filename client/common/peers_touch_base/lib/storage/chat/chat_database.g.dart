// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_database.dart';

// ignore_for_file: type=lint
class $SessionsTable extends Sessions with TableInfo<$SessionsTable, Session> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SessionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<int> type = GeneratedColumn<int>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _targetIdMeta = const VerificationMeta(
    'targetId',
  );
  @override
  late final GeneratedColumn<String> targetId = GeneratedColumn<String>(
    'target_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _topicMeta = const VerificationMeta('topic');
  @override
  late final GeneratedColumn<String> topic = GeneratedColumn<String>(
    'topic',
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
  static const VerificationMeta _lastMessageIdMeta = const VerificationMeta(
    'lastMessageId',
  );
  @override
  late final GeneratedColumn<String> lastMessageId = GeneratedColumn<String>(
    'last_message_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastMessageAtMeta = const VerificationMeta(
    'lastMessageAt',
  );
  @override
  late final GeneratedColumn<int> lastMessageAt = GeneratedColumn<int>(
    'last_message_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastMessageSnippetMeta =
      const VerificationMeta('lastMessageSnippet');
  @override
  late final GeneratedColumn<String> lastMessageSnippet =
      GeneratedColumn<String>(
        'last_message_snippet',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _lastMessageTypeMeta = const VerificationMeta(
    'lastMessageType',
  );
  @override
  late final GeneratedColumn<int> lastMessageType = GeneratedColumn<int>(
    'last_message_type',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _unreadCountMeta = const VerificationMeta(
    'unreadCount',
  );
  @override
  late final GeneratedColumn<int> unreadCount = GeneratedColumn<int>(
    'unread_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _isPinnedMeta = const VerificationMeta(
    'isPinned',
  );
  @override
  late final GeneratedColumn<bool> isPinned = GeneratedColumn<bool>(
    'is_pinned',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_pinned" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _isMutedMeta = const VerificationMeta(
    'isMuted',
  );
  @override
  late final GeneratedColumn<bool> isMuted = GeneratedColumn<bool>(
    'is_muted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_muted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<int> createdAt = GeneratedColumn<int>(
    'created_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<int> updatedAt = GeneratedColumn<int>(
    'updated_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    type,
    targetId,
    topic,
    avatarUrl,
    lastMessageId,
    lastMessageAt,
    lastMessageSnippet,
    lastMessageType,
    unreadCount,
    isPinned,
    isMuted,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sessions';
  @override
  VerificationContext validateIntegrity(
    Insertable<Session> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('target_id')) {
      context.handle(
        _targetIdMeta,
        targetId.isAcceptableOrUnknown(data['target_id']!, _targetIdMeta),
      );
    } else if (isInserting) {
      context.missing(_targetIdMeta);
    }
    if (data.containsKey('topic')) {
      context.handle(
        _topicMeta,
        topic.isAcceptableOrUnknown(data['topic']!, _topicMeta),
      );
    }
    if (data.containsKey('avatar_url')) {
      context.handle(
        _avatarUrlMeta,
        avatarUrl.isAcceptableOrUnknown(data['avatar_url']!, _avatarUrlMeta),
      );
    }
    if (data.containsKey('last_message_id')) {
      context.handle(
        _lastMessageIdMeta,
        lastMessageId.isAcceptableOrUnknown(
          data['last_message_id']!,
          _lastMessageIdMeta,
        ),
      );
    }
    if (data.containsKey('last_message_at')) {
      context.handle(
        _lastMessageAtMeta,
        lastMessageAt.isAcceptableOrUnknown(
          data['last_message_at']!,
          _lastMessageAtMeta,
        ),
      );
    }
    if (data.containsKey('last_message_snippet')) {
      context.handle(
        _lastMessageSnippetMeta,
        lastMessageSnippet.isAcceptableOrUnknown(
          data['last_message_snippet']!,
          _lastMessageSnippetMeta,
        ),
      );
    }
    if (data.containsKey('last_message_type')) {
      context.handle(
        _lastMessageTypeMeta,
        lastMessageType.isAcceptableOrUnknown(
          data['last_message_type']!,
          _lastMessageTypeMeta,
        ),
      );
    }
    if (data.containsKey('unread_count')) {
      context.handle(
        _unreadCountMeta,
        unreadCount.isAcceptableOrUnknown(
          data['unread_count']!,
          _unreadCountMeta,
        ),
      );
    }
    if (data.containsKey('is_pinned')) {
      context.handle(
        _isPinnedMeta,
        isPinned.isAcceptableOrUnknown(data['is_pinned']!, _isPinnedMeta),
      );
    }
    if (data.containsKey('is_muted')) {
      context.handle(
        _isMutedMeta,
        isMuted.isAcceptableOrUnknown(data['is_muted']!, _isMutedMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Session map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Session(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}type'],
      )!,
      targetId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}target_id'],
      )!,
      topic: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}topic'],
      ),
      avatarUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}avatar_url'],
      ),
      lastMessageId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_message_id'],
      ),
      lastMessageAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_message_at'],
      ),
      lastMessageSnippet: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_message_snippet'],
      ),
      lastMessageType: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_message_type'],
      ),
      unreadCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}unread_count'],
      )!,
      isPinned: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_pinned'],
      )!,
      isMuted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_muted'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at'],
      ),
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}updated_at'],
      ),
    );
  }

  @override
  $SessionsTable createAlias(String alias) {
    return $SessionsTable(attachedDatabase, alias);
  }
}

class Session extends DataClass implements Insertable<Session> {
  /// 会话ID (ULID)
  final String id;

  /// 会话类型: 1=friend, 2=group
  final int type;

  /// 目标ID (好友ID 或 群ID)
  final String targetId;

  /// 会话标题/名称
  final String? topic;

  /// 头像URL
  final String? avatarUrl;

  /// 最后一条消息ID
  final String? lastMessageId;

  /// 最后一条消息时间 (Unix timestamp ms)
  final int? lastMessageAt;

  /// 最后一条消息预览
  final String? lastMessageSnippet;

  /// 最后一条消息类型
  final int? lastMessageType;

  /// 未读消息数
  final int unreadCount;

  /// 是否置顶
  final bool isPinned;

  /// 是否静音
  final bool isMuted;

  /// 创建时间
  final int? createdAt;

  /// 更新时间
  final int? updatedAt;
  const Session({
    required this.id,
    required this.type,
    required this.targetId,
    this.topic,
    this.avatarUrl,
    this.lastMessageId,
    this.lastMessageAt,
    this.lastMessageSnippet,
    this.lastMessageType,
    required this.unreadCount,
    required this.isPinned,
    required this.isMuted,
    this.createdAt,
    this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['type'] = Variable<int>(type);
    map['target_id'] = Variable<String>(targetId);
    if (!nullToAbsent || topic != null) {
      map['topic'] = Variable<String>(topic);
    }
    if (!nullToAbsent || avatarUrl != null) {
      map['avatar_url'] = Variable<String>(avatarUrl);
    }
    if (!nullToAbsent || lastMessageId != null) {
      map['last_message_id'] = Variable<String>(lastMessageId);
    }
    if (!nullToAbsent || lastMessageAt != null) {
      map['last_message_at'] = Variable<int>(lastMessageAt);
    }
    if (!nullToAbsent || lastMessageSnippet != null) {
      map['last_message_snippet'] = Variable<String>(lastMessageSnippet);
    }
    if (!nullToAbsent || lastMessageType != null) {
      map['last_message_type'] = Variable<int>(lastMessageType);
    }
    map['unread_count'] = Variable<int>(unreadCount);
    map['is_pinned'] = Variable<bool>(isPinned);
    map['is_muted'] = Variable<bool>(isMuted);
    if (!nullToAbsent || createdAt != null) {
      map['created_at'] = Variable<int>(createdAt);
    }
    if (!nullToAbsent || updatedAt != null) {
      map['updated_at'] = Variable<int>(updatedAt);
    }
    return map;
  }

  SessionsCompanion toCompanion(bool nullToAbsent) {
    return SessionsCompanion(
      id: Value(id),
      type: Value(type),
      targetId: Value(targetId),
      topic: topic == null && nullToAbsent
          ? const Value.absent()
          : Value(topic),
      avatarUrl: avatarUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(avatarUrl),
      lastMessageId: lastMessageId == null && nullToAbsent
          ? const Value.absent()
          : Value(lastMessageId),
      lastMessageAt: lastMessageAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastMessageAt),
      lastMessageSnippet: lastMessageSnippet == null && nullToAbsent
          ? const Value.absent()
          : Value(lastMessageSnippet),
      lastMessageType: lastMessageType == null && nullToAbsent
          ? const Value.absent()
          : Value(lastMessageType),
      unreadCount: Value(unreadCount),
      isPinned: Value(isPinned),
      isMuted: Value(isMuted),
      createdAt: createdAt == null && nullToAbsent
          ? const Value.absent()
          : Value(createdAt),
      updatedAt: updatedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(updatedAt),
    );
  }

  factory Session.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Session(
      id: serializer.fromJson<String>(json['id']),
      type: serializer.fromJson<int>(json['type']),
      targetId: serializer.fromJson<String>(json['targetId']),
      topic: serializer.fromJson<String?>(json['topic']),
      avatarUrl: serializer.fromJson<String?>(json['avatarUrl']),
      lastMessageId: serializer.fromJson<String?>(json['lastMessageId']),
      lastMessageAt: serializer.fromJson<int?>(json['lastMessageAt']),
      lastMessageSnippet: serializer.fromJson<String?>(
        json['lastMessageSnippet'],
      ),
      lastMessageType: serializer.fromJson<int?>(json['lastMessageType']),
      unreadCount: serializer.fromJson<int>(json['unreadCount']),
      isPinned: serializer.fromJson<bool>(json['isPinned']),
      isMuted: serializer.fromJson<bool>(json['isMuted']),
      createdAt: serializer.fromJson<int?>(json['createdAt']),
      updatedAt: serializer.fromJson<int?>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'type': serializer.toJson<int>(type),
      'targetId': serializer.toJson<String>(targetId),
      'topic': serializer.toJson<String?>(topic),
      'avatarUrl': serializer.toJson<String?>(avatarUrl),
      'lastMessageId': serializer.toJson<String?>(lastMessageId),
      'lastMessageAt': serializer.toJson<int?>(lastMessageAt),
      'lastMessageSnippet': serializer.toJson<String?>(lastMessageSnippet),
      'lastMessageType': serializer.toJson<int?>(lastMessageType),
      'unreadCount': serializer.toJson<int>(unreadCount),
      'isPinned': serializer.toJson<bool>(isPinned),
      'isMuted': serializer.toJson<bool>(isMuted),
      'createdAt': serializer.toJson<int?>(createdAt),
      'updatedAt': serializer.toJson<int?>(updatedAt),
    };
  }

  Session copyWith({
    String? id,
    int? type,
    String? targetId,
    Value<String?> topic = const Value.absent(),
    Value<String?> avatarUrl = const Value.absent(),
    Value<String?> lastMessageId = const Value.absent(),
    Value<int?> lastMessageAt = const Value.absent(),
    Value<String?> lastMessageSnippet = const Value.absent(),
    Value<int?> lastMessageType = const Value.absent(),
    int? unreadCount,
    bool? isPinned,
    bool? isMuted,
    Value<int?> createdAt = const Value.absent(),
    Value<int?> updatedAt = const Value.absent(),
  }) => Session(
    id: id ?? this.id,
    type: type ?? this.type,
    targetId: targetId ?? this.targetId,
    topic: topic.present ? topic.value : this.topic,
    avatarUrl: avatarUrl.present ? avatarUrl.value : this.avatarUrl,
    lastMessageId: lastMessageId.present
        ? lastMessageId.value
        : this.lastMessageId,
    lastMessageAt: lastMessageAt.present
        ? lastMessageAt.value
        : this.lastMessageAt,
    lastMessageSnippet: lastMessageSnippet.present
        ? lastMessageSnippet.value
        : this.lastMessageSnippet,
    lastMessageType: lastMessageType.present
        ? lastMessageType.value
        : this.lastMessageType,
    unreadCount: unreadCount ?? this.unreadCount,
    isPinned: isPinned ?? this.isPinned,
    isMuted: isMuted ?? this.isMuted,
    createdAt: createdAt.present ? createdAt.value : this.createdAt,
    updatedAt: updatedAt.present ? updatedAt.value : this.updatedAt,
  );
  Session copyWithCompanion(SessionsCompanion data) {
    return Session(
      id: data.id.present ? data.id.value : this.id,
      type: data.type.present ? data.type.value : this.type,
      targetId: data.targetId.present ? data.targetId.value : this.targetId,
      topic: data.topic.present ? data.topic.value : this.topic,
      avatarUrl: data.avatarUrl.present ? data.avatarUrl.value : this.avatarUrl,
      lastMessageId: data.lastMessageId.present
          ? data.lastMessageId.value
          : this.lastMessageId,
      lastMessageAt: data.lastMessageAt.present
          ? data.lastMessageAt.value
          : this.lastMessageAt,
      lastMessageSnippet: data.lastMessageSnippet.present
          ? data.lastMessageSnippet.value
          : this.lastMessageSnippet,
      lastMessageType: data.lastMessageType.present
          ? data.lastMessageType.value
          : this.lastMessageType,
      unreadCount: data.unreadCount.present
          ? data.unreadCount.value
          : this.unreadCount,
      isPinned: data.isPinned.present ? data.isPinned.value : this.isPinned,
      isMuted: data.isMuted.present ? data.isMuted.value : this.isMuted,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Session(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('targetId: $targetId, ')
          ..write('topic: $topic, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('lastMessageId: $lastMessageId, ')
          ..write('lastMessageAt: $lastMessageAt, ')
          ..write('lastMessageSnippet: $lastMessageSnippet, ')
          ..write('lastMessageType: $lastMessageType, ')
          ..write('unreadCount: $unreadCount, ')
          ..write('isPinned: $isPinned, ')
          ..write('isMuted: $isMuted, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    type,
    targetId,
    topic,
    avatarUrl,
    lastMessageId,
    lastMessageAt,
    lastMessageSnippet,
    lastMessageType,
    unreadCount,
    isPinned,
    isMuted,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Session &&
          other.id == this.id &&
          other.type == this.type &&
          other.targetId == this.targetId &&
          other.topic == this.topic &&
          other.avatarUrl == this.avatarUrl &&
          other.lastMessageId == this.lastMessageId &&
          other.lastMessageAt == this.lastMessageAt &&
          other.lastMessageSnippet == this.lastMessageSnippet &&
          other.lastMessageType == this.lastMessageType &&
          other.unreadCount == this.unreadCount &&
          other.isPinned == this.isPinned &&
          other.isMuted == this.isMuted &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class SessionsCompanion extends UpdateCompanion<Session> {
  final Value<String> id;
  final Value<int> type;
  final Value<String> targetId;
  final Value<String?> topic;
  final Value<String?> avatarUrl;
  final Value<String?> lastMessageId;
  final Value<int?> lastMessageAt;
  final Value<String?> lastMessageSnippet;
  final Value<int?> lastMessageType;
  final Value<int> unreadCount;
  final Value<bool> isPinned;
  final Value<bool> isMuted;
  final Value<int?> createdAt;
  final Value<int?> updatedAt;
  final Value<int> rowid;
  const SessionsCompanion({
    this.id = const Value.absent(),
    this.type = const Value.absent(),
    this.targetId = const Value.absent(),
    this.topic = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.lastMessageId = const Value.absent(),
    this.lastMessageAt = const Value.absent(),
    this.lastMessageSnippet = const Value.absent(),
    this.lastMessageType = const Value.absent(),
    this.unreadCount = const Value.absent(),
    this.isPinned = const Value.absent(),
    this.isMuted = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SessionsCompanion.insert({
    required String id,
    required int type,
    required String targetId,
    this.topic = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.lastMessageId = const Value.absent(),
    this.lastMessageAt = const Value.absent(),
    this.lastMessageSnippet = const Value.absent(),
    this.lastMessageType = const Value.absent(),
    this.unreadCount = const Value.absent(),
    this.isPinned = const Value.absent(),
    this.isMuted = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       type = Value(type),
       targetId = Value(targetId);
  static Insertable<Session> custom({
    Expression<String>? id,
    Expression<int>? type,
    Expression<String>? targetId,
    Expression<String>? topic,
    Expression<String>? avatarUrl,
    Expression<String>? lastMessageId,
    Expression<int>? lastMessageAt,
    Expression<String>? lastMessageSnippet,
    Expression<int>? lastMessageType,
    Expression<int>? unreadCount,
    Expression<bool>? isPinned,
    Expression<bool>? isMuted,
    Expression<int>? createdAt,
    Expression<int>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (type != null) 'type': type,
      if (targetId != null) 'target_id': targetId,
      if (topic != null) 'topic': topic,
      if (avatarUrl != null) 'avatar_url': avatarUrl,
      if (lastMessageId != null) 'last_message_id': lastMessageId,
      if (lastMessageAt != null) 'last_message_at': lastMessageAt,
      if (lastMessageSnippet != null)
        'last_message_snippet': lastMessageSnippet,
      if (lastMessageType != null) 'last_message_type': lastMessageType,
      if (unreadCount != null) 'unread_count': unreadCount,
      if (isPinned != null) 'is_pinned': isPinned,
      if (isMuted != null) 'is_muted': isMuted,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SessionsCompanion copyWith({
    Value<String>? id,
    Value<int>? type,
    Value<String>? targetId,
    Value<String?>? topic,
    Value<String?>? avatarUrl,
    Value<String?>? lastMessageId,
    Value<int?>? lastMessageAt,
    Value<String?>? lastMessageSnippet,
    Value<int?>? lastMessageType,
    Value<int>? unreadCount,
    Value<bool>? isPinned,
    Value<bool>? isMuted,
    Value<int?>? createdAt,
    Value<int?>? updatedAt,
    Value<int>? rowid,
  }) {
    return SessionsCompanion(
      id: id ?? this.id,
      type: type ?? this.type,
      targetId: targetId ?? this.targetId,
      topic: topic ?? this.topic,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      lastMessageId: lastMessageId ?? this.lastMessageId,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
      lastMessageSnippet: lastMessageSnippet ?? this.lastMessageSnippet,
      lastMessageType: lastMessageType ?? this.lastMessageType,
      unreadCount: unreadCount ?? this.unreadCount,
      isPinned: isPinned ?? this.isPinned,
      isMuted: isMuted ?? this.isMuted,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (type.present) {
      map['type'] = Variable<int>(type.value);
    }
    if (targetId.present) {
      map['target_id'] = Variable<String>(targetId.value);
    }
    if (topic.present) {
      map['topic'] = Variable<String>(topic.value);
    }
    if (avatarUrl.present) {
      map['avatar_url'] = Variable<String>(avatarUrl.value);
    }
    if (lastMessageId.present) {
      map['last_message_id'] = Variable<String>(lastMessageId.value);
    }
    if (lastMessageAt.present) {
      map['last_message_at'] = Variable<int>(lastMessageAt.value);
    }
    if (lastMessageSnippet.present) {
      map['last_message_snippet'] = Variable<String>(lastMessageSnippet.value);
    }
    if (lastMessageType.present) {
      map['last_message_type'] = Variable<int>(lastMessageType.value);
    }
    if (unreadCount.present) {
      map['unread_count'] = Variable<int>(unreadCount.value);
    }
    if (isPinned.present) {
      map['is_pinned'] = Variable<bool>(isPinned.value);
    }
    if (isMuted.present) {
      map['is_muted'] = Variable<bool>(isMuted.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<int>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<int>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SessionsCompanion(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('targetId: $targetId, ')
          ..write('topic: $topic, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('lastMessageId: $lastMessageId, ')
          ..write('lastMessageAt: $lastMessageAt, ')
          ..write('lastMessageSnippet: $lastMessageSnippet, ')
          ..write('lastMessageType: $lastMessageType, ')
          ..write('unreadCount: $unreadCount, ')
          ..write('isPinned: $isPinned, ')
          ..write('isMuted: $isMuted, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MessagesTable extends Messages with TableInfo<$MessagesTable, Message> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MessagesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sessionIdMeta = const VerificationMeta(
    'sessionId',
  );
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
    'session_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _senderIdMeta = const VerificationMeta(
    'senderId',
  );
  @override
  late final GeneratedColumn<String> senderId = GeneratedColumn<String>(
    'sender_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<int> type = GeneratedColumn<int>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _contentMeta = const VerificationMeta(
    'content',
  );
  @override
  late final GeneratedColumn<String> content = GeneratedColumn<String>(
    'content',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _encryptedContentMeta = const VerificationMeta(
    'encryptedContent',
  );
  @override
  late final GeneratedColumn<String> encryptedContent = GeneratedColumn<String>(
    'encrypted_content',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _attachmentsMeta = const VerificationMeta(
    'attachments',
  );
  @override
  late final GeneratedColumn<String> attachments = GeneratedColumn<String>(
    'attachments',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _metadataMeta = const VerificationMeta(
    'metadata',
  );
  @override
  late final GeneratedColumn<String> metadata = GeneratedColumn<String>(
    'metadata',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _replyToIdMeta = const VerificationMeta(
    'replyToId',
  );
  @override
  late final GeneratedColumn<String> replyToId = GeneratedColumn<String>(
    'reply_to_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mentionedIdsMeta = const VerificationMeta(
    'mentionedIds',
  );
  @override
  late final GeneratedColumn<String> mentionedIds = GeneratedColumn<String>(
    'mentioned_ids',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mentionAllMeta = const VerificationMeta(
    'mentionAll',
  );
  @override
  late final GeneratedColumn<bool> mentionAll = GeneratedColumn<bool>(
    'mention_all',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("mention_all" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<int> status = GeneratedColumn<int>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _isDeletedMeta = const VerificationMeta(
    'isDeleted',
  );
  @override
  late final GeneratedColumn<bool> isDeleted = GeneratedColumn<bool>(
    'is_deleted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_deleted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _deletedAtMeta = const VerificationMeta(
    'deletedAt',
  );
  @override
  late final GeneratedColumn<int> deletedAt = GeneratedColumn<int>(
    'deleted_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _sentAtMeta = const VerificationMeta('sentAt');
  @override
  late final GeneratedColumn<int> sentAt = GeneratedColumn<int>(
    'sent_at',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<int> createdAt = GeneratedColumn<int>(
    'created_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    sessionId,
    senderId,
    type,
    content,
    encryptedContent,
    attachments,
    metadata,
    replyToId,
    mentionedIds,
    mentionAll,
    status,
    isDeleted,
    deletedAt,
    sentAt,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'messages';
  @override
  VerificationContext validateIntegrity(
    Insertable<Message> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('session_id')) {
      context.handle(
        _sessionIdMeta,
        sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta),
      );
    } else if (isInserting) {
      context.missing(_sessionIdMeta);
    }
    if (data.containsKey('sender_id')) {
      context.handle(
        _senderIdMeta,
        senderId.isAcceptableOrUnknown(data['sender_id']!, _senderIdMeta),
      );
    } else if (isInserting) {
      context.missing(_senderIdMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('content')) {
      context.handle(
        _contentMeta,
        content.isAcceptableOrUnknown(data['content']!, _contentMeta),
      );
    }
    if (data.containsKey('encrypted_content')) {
      context.handle(
        _encryptedContentMeta,
        encryptedContent.isAcceptableOrUnknown(
          data['encrypted_content']!,
          _encryptedContentMeta,
        ),
      );
    }
    if (data.containsKey('attachments')) {
      context.handle(
        _attachmentsMeta,
        attachments.isAcceptableOrUnknown(
          data['attachments']!,
          _attachmentsMeta,
        ),
      );
    }
    if (data.containsKey('metadata')) {
      context.handle(
        _metadataMeta,
        metadata.isAcceptableOrUnknown(data['metadata']!, _metadataMeta),
      );
    }
    if (data.containsKey('reply_to_id')) {
      context.handle(
        _replyToIdMeta,
        replyToId.isAcceptableOrUnknown(data['reply_to_id']!, _replyToIdMeta),
      );
    }
    if (data.containsKey('mentioned_ids')) {
      context.handle(
        _mentionedIdsMeta,
        mentionedIds.isAcceptableOrUnknown(
          data['mentioned_ids']!,
          _mentionedIdsMeta,
        ),
      );
    }
    if (data.containsKey('mention_all')) {
      context.handle(
        _mentionAllMeta,
        mentionAll.isAcceptableOrUnknown(data['mention_all']!, _mentionAllMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('is_deleted')) {
      context.handle(
        _isDeletedMeta,
        isDeleted.isAcceptableOrUnknown(data['is_deleted']!, _isDeletedMeta),
      );
    }
    if (data.containsKey('deleted_at')) {
      context.handle(
        _deletedAtMeta,
        deletedAt.isAcceptableOrUnknown(data['deleted_at']!, _deletedAtMeta),
      );
    }
    if (data.containsKey('sent_at')) {
      context.handle(
        _sentAtMeta,
        sentAt.isAcceptableOrUnknown(data['sent_at']!, _sentAtMeta),
      );
    } else if (isInserting) {
      context.missing(_sentAtMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Message map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Message(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      sessionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}session_id'],
      )!,
      senderId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sender_id'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}type'],
      )!,
      content: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}content'],
      ),
      encryptedContent: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}encrypted_content'],
      ),
      attachments: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}attachments'],
      ),
      metadata: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}metadata'],
      ),
      replyToId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reply_to_id'],
      ),
      mentionedIds: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mentioned_ids'],
      ),
      mentionAll: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}mention_all'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}status'],
      )!,
      isDeleted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_deleted'],
      )!,
      deletedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}deleted_at'],
      ),
      sentAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sent_at'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at'],
      ),
    );
  }

  @override
  $MessagesTable createAlias(String alias) {
    return $MessagesTable(attachedDatabase, alias);
  }
}

class Message extends DataClass implements Insertable<Message> {
  /// 消息ID (ULID)
  final String id;

  /// 所属会话ID
  final String sessionId;

  /// 发送者ID
  final String senderId;

  /// 消息类型: 1=text, 2=image, 3=file, 4=location, 5=system, 6=sticker, 7=audio, 8=video
  final int type;

  /// 消息内容
  final String? content;

  /// 加密内容
  final String? encryptedContent;

  /// 附件 (JSON array)
  final String? attachments;

  /// 元数据 (JSON object)
  final String? metadata;

  /// 回复的消息ID (Thread回复)
  final String? replyToId;

  /// @的用户ID列表 (JSON array)
  final String? mentionedIds;

  /// 是否@所有人
  final bool mentionAll;

  /// 消息状态: 0=unknown, 1=sending, 2=sent, 3=delivered, 4=failed
  final int status;

  /// 是否已删除
  final bool isDeleted;

  /// 删除时间
  final int? deletedAt;

  /// 发送时间 (Unix timestamp ms)
  final int sentAt;

  /// 本地创建时间
  final int? createdAt;
  const Message({
    required this.id,
    required this.sessionId,
    required this.senderId,
    required this.type,
    this.content,
    this.encryptedContent,
    this.attachments,
    this.metadata,
    this.replyToId,
    this.mentionedIds,
    required this.mentionAll,
    required this.status,
    required this.isDeleted,
    this.deletedAt,
    required this.sentAt,
    this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['session_id'] = Variable<String>(sessionId);
    map['sender_id'] = Variable<String>(senderId);
    map['type'] = Variable<int>(type);
    if (!nullToAbsent || content != null) {
      map['content'] = Variable<String>(content);
    }
    if (!nullToAbsent || encryptedContent != null) {
      map['encrypted_content'] = Variable<String>(encryptedContent);
    }
    if (!nullToAbsent || attachments != null) {
      map['attachments'] = Variable<String>(attachments);
    }
    if (!nullToAbsent || metadata != null) {
      map['metadata'] = Variable<String>(metadata);
    }
    if (!nullToAbsent || replyToId != null) {
      map['reply_to_id'] = Variable<String>(replyToId);
    }
    if (!nullToAbsent || mentionedIds != null) {
      map['mentioned_ids'] = Variable<String>(mentionedIds);
    }
    map['mention_all'] = Variable<bool>(mentionAll);
    map['status'] = Variable<int>(status);
    map['is_deleted'] = Variable<bool>(isDeleted);
    if (!nullToAbsent || deletedAt != null) {
      map['deleted_at'] = Variable<int>(deletedAt);
    }
    map['sent_at'] = Variable<int>(sentAt);
    if (!nullToAbsent || createdAt != null) {
      map['created_at'] = Variable<int>(createdAt);
    }
    return map;
  }

  MessagesCompanion toCompanion(bool nullToAbsent) {
    return MessagesCompanion(
      id: Value(id),
      sessionId: Value(sessionId),
      senderId: Value(senderId),
      type: Value(type),
      content: content == null && nullToAbsent
          ? const Value.absent()
          : Value(content),
      encryptedContent: encryptedContent == null && nullToAbsent
          ? const Value.absent()
          : Value(encryptedContent),
      attachments: attachments == null && nullToAbsent
          ? const Value.absent()
          : Value(attachments),
      metadata: metadata == null && nullToAbsent
          ? const Value.absent()
          : Value(metadata),
      replyToId: replyToId == null && nullToAbsent
          ? const Value.absent()
          : Value(replyToId),
      mentionedIds: mentionedIds == null && nullToAbsent
          ? const Value.absent()
          : Value(mentionedIds),
      mentionAll: Value(mentionAll),
      status: Value(status),
      isDeleted: Value(isDeleted),
      deletedAt: deletedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(deletedAt),
      sentAt: Value(sentAt),
      createdAt: createdAt == null && nullToAbsent
          ? const Value.absent()
          : Value(createdAt),
    );
  }

  factory Message.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Message(
      id: serializer.fromJson<String>(json['id']),
      sessionId: serializer.fromJson<String>(json['sessionId']),
      senderId: serializer.fromJson<String>(json['senderId']),
      type: serializer.fromJson<int>(json['type']),
      content: serializer.fromJson<String?>(json['content']),
      encryptedContent: serializer.fromJson<String?>(json['encryptedContent']),
      attachments: serializer.fromJson<String?>(json['attachments']),
      metadata: serializer.fromJson<String?>(json['metadata']),
      replyToId: serializer.fromJson<String?>(json['replyToId']),
      mentionedIds: serializer.fromJson<String?>(json['mentionedIds']),
      mentionAll: serializer.fromJson<bool>(json['mentionAll']),
      status: serializer.fromJson<int>(json['status']),
      isDeleted: serializer.fromJson<bool>(json['isDeleted']),
      deletedAt: serializer.fromJson<int?>(json['deletedAt']),
      sentAt: serializer.fromJson<int>(json['sentAt']),
      createdAt: serializer.fromJson<int?>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'sessionId': serializer.toJson<String>(sessionId),
      'senderId': serializer.toJson<String>(senderId),
      'type': serializer.toJson<int>(type),
      'content': serializer.toJson<String?>(content),
      'encryptedContent': serializer.toJson<String?>(encryptedContent),
      'attachments': serializer.toJson<String?>(attachments),
      'metadata': serializer.toJson<String?>(metadata),
      'replyToId': serializer.toJson<String?>(replyToId),
      'mentionedIds': serializer.toJson<String?>(mentionedIds),
      'mentionAll': serializer.toJson<bool>(mentionAll),
      'status': serializer.toJson<int>(status),
      'isDeleted': serializer.toJson<bool>(isDeleted),
      'deletedAt': serializer.toJson<int?>(deletedAt),
      'sentAt': serializer.toJson<int>(sentAt),
      'createdAt': serializer.toJson<int?>(createdAt),
    };
  }

  Message copyWith({
    String? id,
    String? sessionId,
    String? senderId,
    int? type,
    Value<String?> content = const Value.absent(),
    Value<String?> encryptedContent = const Value.absent(),
    Value<String?> attachments = const Value.absent(),
    Value<String?> metadata = const Value.absent(),
    Value<String?> replyToId = const Value.absent(),
    Value<String?> mentionedIds = const Value.absent(),
    bool? mentionAll,
    int? status,
    bool? isDeleted,
    Value<int?> deletedAt = const Value.absent(),
    int? sentAt,
    Value<int?> createdAt = const Value.absent(),
  }) => Message(
    id: id ?? this.id,
    sessionId: sessionId ?? this.sessionId,
    senderId: senderId ?? this.senderId,
    type: type ?? this.type,
    content: content.present ? content.value : this.content,
    encryptedContent: encryptedContent.present
        ? encryptedContent.value
        : this.encryptedContent,
    attachments: attachments.present ? attachments.value : this.attachments,
    metadata: metadata.present ? metadata.value : this.metadata,
    replyToId: replyToId.present ? replyToId.value : this.replyToId,
    mentionedIds: mentionedIds.present ? mentionedIds.value : this.mentionedIds,
    mentionAll: mentionAll ?? this.mentionAll,
    status: status ?? this.status,
    isDeleted: isDeleted ?? this.isDeleted,
    deletedAt: deletedAt.present ? deletedAt.value : this.deletedAt,
    sentAt: sentAt ?? this.sentAt,
    createdAt: createdAt.present ? createdAt.value : this.createdAt,
  );
  Message copyWithCompanion(MessagesCompanion data) {
    return Message(
      id: data.id.present ? data.id.value : this.id,
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      senderId: data.senderId.present ? data.senderId.value : this.senderId,
      type: data.type.present ? data.type.value : this.type,
      content: data.content.present ? data.content.value : this.content,
      encryptedContent: data.encryptedContent.present
          ? data.encryptedContent.value
          : this.encryptedContent,
      attachments: data.attachments.present
          ? data.attachments.value
          : this.attachments,
      metadata: data.metadata.present ? data.metadata.value : this.metadata,
      replyToId: data.replyToId.present ? data.replyToId.value : this.replyToId,
      mentionedIds: data.mentionedIds.present
          ? data.mentionedIds.value
          : this.mentionedIds,
      mentionAll: data.mentionAll.present
          ? data.mentionAll.value
          : this.mentionAll,
      status: data.status.present ? data.status.value : this.status,
      isDeleted: data.isDeleted.present ? data.isDeleted.value : this.isDeleted,
      deletedAt: data.deletedAt.present ? data.deletedAt.value : this.deletedAt,
      sentAt: data.sentAt.present ? data.sentAt.value : this.sentAt,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Message(')
          ..write('id: $id, ')
          ..write('sessionId: $sessionId, ')
          ..write('senderId: $senderId, ')
          ..write('type: $type, ')
          ..write('content: $content, ')
          ..write('encryptedContent: $encryptedContent, ')
          ..write('attachments: $attachments, ')
          ..write('metadata: $metadata, ')
          ..write('replyToId: $replyToId, ')
          ..write('mentionedIds: $mentionedIds, ')
          ..write('mentionAll: $mentionAll, ')
          ..write('status: $status, ')
          ..write('isDeleted: $isDeleted, ')
          ..write('deletedAt: $deletedAt, ')
          ..write('sentAt: $sentAt, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    sessionId,
    senderId,
    type,
    content,
    encryptedContent,
    attachments,
    metadata,
    replyToId,
    mentionedIds,
    mentionAll,
    status,
    isDeleted,
    deletedAt,
    sentAt,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Message &&
          other.id == this.id &&
          other.sessionId == this.sessionId &&
          other.senderId == this.senderId &&
          other.type == this.type &&
          other.content == this.content &&
          other.encryptedContent == this.encryptedContent &&
          other.attachments == this.attachments &&
          other.metadata == this.metadata &&
          other.replyToId == this.replyToId &&
          other.mentionedIds == this.mentionedIds &&
          other.mentionAll == this.mentionAll &&
          other.status == this.status &&
          other.isDeleted == this.isDeleted &&
          other.deletedAt == this.deletedAt &&
          other.sentAt == this.sentAt &&
          other.createdAt == this.createdAt);
}

class MessagesCompanion extends UpdateCompanion<Message> {
  final Value<String> id;
  final Value<String> sessionId;
  final Value<String> senderId;
  final Value<int> type;
  final Value<String?> content;
  final Value<String?> encryptedContent;
  final Value<String?> attachments;
  final Value<String?> metadata;
  final Value<String?> replyToId;
  final Value<String?> mentionedIds;
  final Value<bool> mentionAll;
  final Value<int> status;
  final Value<bool> isDeleted;
  final Value<int?> deletedAt;
  final Value<int> sentAt;
  final Value<int?> createdAt;
  final Value<int> rowid;
  const MessagesCompanion({
    this.id = const Value.absent(),
    this.sessionId = const Value.absent(),
    this.senderId = const Value.absent(),
    this.type = const Value.absent(),
    this.content = const Value.absent(),
    this.encryptedContent = const Value.absent(),
    this.attachments = const Value.absent(),
    this.metadata = const Value.absent(),
    this.replyToId = const Value.absent(),
    this.mentionedIds = const Value.absent(),
    this.mentionAll = const Value.absent(),
    this.status = const Value.absent(),
    this.isDeleted = const Value.absent(),
    this.deletedAt = const Value.absent(),
    this.sentAt = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MessagesCompanion.insert({
    required String id,
    required String sessionId,
    required String senderId,
    required int type,
    this.content = const Value.absent(),
    this.encryptedContent = const Value.absent(),
    this.attachments = const Value.absent(),
    this.metadata = const Value.absent(),
    this.replyToId = const Value.absent(),
    this.mentionedIds = const Value.absent(),
    this.mentionAll = const Value.absent(),
    this.status = const Value.absent(),
    this.isDeleted = const Value.absent(),
    this.deletedAt = const Value.absent(),
    required int sentAt,
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       sessionId = Value(sessionId),
       senderId = Value(senderId),
       type = Value(type),
       sentAt = Value(sentAt);
  static Insertable<Message> custom({
    Expression<String>? id,
    Expression<String>? sessionId,
    Expression<String>? senderId,
    Expression<int>? type,
    Expression<String>? content,
    Expression<String>? encryptedContent,
    Expression<String>? attachments,
    Expression<String>? metadata,
    Expression<String>? replyToId,
    Expression<String>? mentionedIds,
    Expression<bool>? mentionAll,
    Expression<int>? status,
    Expression<bool>? isDeleted,
    Expression<int>? deletedAt,
    Expression<int>? sentAt,
    Expression<int>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (sessionId != null) 'session_id': sessionId,
      if (senderId != null) 'sender_id': senderId,
      if (type != null) 'type': type,
      if (content != null) 'content': content,
      if (encryptedContent != null) 'encrypted_content': encryptedContent,
      if (attachments != null) 'attachments': attachments,
      if (metadata != null) 'metadata': metadata,
      if (replyToId != null) 'reply_to_id': replyToId,
      if (mentionedIds != null) 'mentioned_ids': mentionedIds,
      if (mentionAll != null) 'mention_all': mentionAll,
      if (status != null) 'status': status,
      if (isDeleted != null) 'is_deleted': isDeleted,
      if (deletedAt != null) 'deleted_at': deletedAt,
      if (sentAt != null) 'sent_at': sentAt,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MessagesCompanion copyWith({
    Value<String>? id,
    Value<String>? sessionId,
    Value<String>? senderId,
    Value<int>? type,
    Value<String?>? content,
    Value<String?>? encryptedContent,
    Value<String?>? attachments,
    Value<String?>? metadata,
    Value<String?>? replyToId,
    Value<String?>? mentionedIds,
    Value<bool>? mentionAll,
    Value<int>? status,
    Value<bool>? isDeleted,
    Value<int?>? deletedAt,
    Value<int>? sentAt,
    Value<int?>? createdAt,
    Value<int>? rowid,
  }) {
    return MessagesCompanion(
      id: id ?? this.id,
      sessionId: sessionId ?? this.sessionId,
      senderId: senderId ?? this.senderId,
      type: type ?? this.type,
      content: content ?? this.content,
      encryptedContent: encryptedContent ?? this.encryptedContent,
      attachments: attachments ?? this.attachments,
      metadata: metadata ?? this.metadata,
      replyToId: replyToId ?? this.replyToId,
      mentionedIds: mentionedIds ?? this.mentionedIds,
      mentionAll: mentionAll ?? this.mentionAll,
      status: status ?? this.status,
      isDeleted: isDeleted ?? this.isDeleted,
      deletedAt: deletedAt ?? this.deletedAt,
      sentAt: sentAt ?? this.sentAt,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (senderId.present) {
      map['sender_id'] = Variable<String>(senderId.value);
    }
    if (type.present) {
      map['type'] = Variable<int>(type.value);
    }
    if (content.present) {
      map['content'] = Variable<String>(content.value);
    }
    if (encryptedContent.present) {
      map['encrypted_content'] = Variable<String>(encryptedContent.value);
    }
    if (attachments.present) {
      map['attachments'] = Variable<String>(attachments.value);
    }
    if (metadata.present) {
      map['metadata'] = Variable<String>(metadata.value);
    }
    if (replyToId.present) {
      map['reply_to_id'] = Variable<String>(replyToId.value);
    }
    if (mentionedIds.present) {
      map['mentioned_ids'] = Variable<String>(mentionedIds.value);
    }
    if (mentionAll.present) {
      map['mention_all'] = Variable<bool>(mentionAll.value);
    }
    if (status.present) {
      map['status'] = Variable<int>(status.value);
    }
    if (isDeleted.present) {
      map['is_deleted'] = Variable<bool>(isDeleted.value);
    }
    if (deletedAt.present) {
      map['deleted_at'] = Variable<int>(deletedAt.value);
    }
    if (sentAt.present) {
      map['sent_at'] = Variable<int>(sentAt.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<int>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MessagesCompanion(')
          ..write('id: $id, ')
          ..write('sessionId: $sessionId, ')
          ..write('senderId: $senderId, ')
          ..write('type: $type, ')
          ..write('content: $content, ')
          ..write('encryptedContent: $encryptedContent, ')
          ..write('attachments: $attachments, ')
          ..write('metadata: $metadata, ')
          ..write('replyToId: $replyToId, ')
          ..write('mentionedIds: $mentionedIds, ')
          ..write('mentionAll: $mentionAll, ')
          ..write('status: $status, ')
          ..write('isDeleted: $isDeleted, ')
          ..write('deletedAt: $deletedAt, ')
          ..write('sentAt: $sentAt, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncMetaTable extends SyncMeta
    with TableInfo<$SyncMetaTable, SyncMetaData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncMetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _resourceTypeMeta = const VerificationMeta(
    'resourceType',
  );
  @override
  late final GeneratedColumn<String> resourceType = GeneratedColumn<String>(
    'resource_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _resourceIdMeta = const VerificationMeta(
    'resourceId',
  );
  @override
  late final GeneratedColumn<String> resourceId = GeneratedColumn<String>(
    'resource_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastSyncAtMeta = const VerificationMeta(
    'lastSyncAt',
  );
  @override
  late final GeneratedColumn<int> lastSyncAt = GeneratedColumn<int>(
    'last_sync_at',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _syncCursorMeta = const VerificationMeta(
    'syncCursor',
  );
  @override
  late final GeneratedColumn<String> syncCursor = GeneratedColumn<String>(
    'sync_cursor',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _extraMeta = const VerificationMeta('extra');
  @override
  late final GeneratedColumn<String> extra = GeneratedColumn<String>(
    'extra',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    resourceType,
    resourceId,
    lastSyncAt,
    syncCursor,
    extra,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncMetaData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('resource_type')) {
      context.handle(
        _resourceTypeMeta,
        resourceType.isAcceptableOrUnknown(
          data['resource_type']!,
          _resourceTypeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_resourceTypeMeta);
    }
    if (data.containsKey('resource_id')) {
      context.handle(
        _resourceIdMeta,
        resourceId.isAcceptableOrUnknown(data['resource_id']!, _resourceIdMeta),
      );
    } else if (isInserting) {
      context.missing(_resourceIdMeta);
    }
    if (data.containsKey('last_sync_at')) {
      context.handle(
        _lastSyncAtMeta,
        lastSyncAt.isAcceptableOrUnknown(
          data['last_sync_at']!,
          _lastSyncAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastSyncAtMeta);
    }
    if (data.containsKey('sync_cursor')) {
      context.handle(
        _syncCursorMeta,
        syncCursor.isAcceptableOrUnknown(data['sync_cursor']!, _syncCursorMeta),
      );
    }
    if (data.containsKey('extra')) {
      context.handle(
        _extraMeta,
        extra.isAcceptableOrUnknown(data['extra']!, _extraMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {resourceType, resourceId};
  @override
  SyncMetaData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncMetaData(
      resourceType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}resource_type'],
      )!,
      resourceId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}resource_id'],
      )!,
      lastSyncAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_sync_at'],
      )!,
      syncCursor: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sync_cursor'],
      ),
      extra: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}extra'],
      ),
    );
  }

  @override
  $SyncMetaTable createAlias(String alias) {
    return $SyncMetaTable(attachedDatabase, alias);
  }
}

class SyncMetaData extends DataClass implements Insertable<SyncMetaData> {
  /// 资源类型: 'session', 'message', 'member', 'announcement', 'sticker'
  final String resourceType;

  /// 资源ID: session_id, group_id, 或 '*' 表示全局
  final String resourceId;

  /// 最后同步时间 (Unix timestamp ms)
  final int lastSyncAt;

  /// 同步游标 (服务端分页用)
  final String? syncCursor;

  /// 扩展字段 (JSON)
  final String? extra;
  const SyncMetaData({
    required this.resourceType,
    required this.resourceId,
    required this.lastSyncAt,
    this.syncCursor,
    this.extra,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['resource_type'] = Variable<String>(resourceType);
    map['resource_id'] = Variable<String>(resourceId);
    map['last_sync_at'] = Variable<int>(lastSyncAt);
    if (!nullToAbsent || syncCursor != null) {
      map['sync_cursor'] = Variable<String>(syncCursor);
    }
    if (!nullToAbsent || extra != null) {
      map['extra'] = Variable<String>(extra);
    }
    return map;
  }

  SyncMetaCompanion toCompanion(bool nullToAbsent) {
    return SyncMetaCompanion(
      resourceType: Value(resourceType),
      resourceId: Value(resourceId),
      lastSyncAt: Value(lastSyncAt),
      syncCursor: syncCursor == null && nullToAbsent
          ? const Value.absent()
          : Value(syncCursor),
      extra: extra == null && nullToAbsent
          ? const Value.absent()
          : Value(extra),
    );
  }

  factory SyncMetaData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncMetaData(
      resourceType: serializer.fromJson<String>(json['resourceType']),
      resourceId: serializer.fromJson<String>(json['resourceId']),
      lastSyncAt: serializer.fromJson<int>(json['lastSyncAt']),
      syncCursor: serializer.fromJson<String?>(json['syncCursor']),
      extra: serializer.fromJson<String?>(json['extra']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'resourceType': serializer.toJson<String>(resourceType),
      'resourceId': serializer.toJson<String>(resourceId),
      'lastSyncAt': serializer.toJson<int>(lastSyncAt),
      'syncCursor': serializer.toJson<String?>(syncCursor),
      'extra': serializer.toJson<String?>(extra),
    };
  }

  SyncMetaData copyWith({
    String? resourceType,
    String? resourceId,
    int? lastSyncAt,
    Value<String?> syncCursor = const Value.absent(),
    Value<String?> extra = const Value.absent(),
  }) => SyncMetaData(
    resourceType: resourceType ?? this.resourceType,
    resourceId: resourceId ?? this.resourceId,
    lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    syncCursor: syncCursor.present ? syncCursor.value : this.syncCursor,
    extra: extra.present ? extra.value : this.extra,
  );
  SyncMetaData copyWithCompanion(SyncMetaCompanion data) {
    return SyncMetaData(
      resourceType: data.resourceType.present
          ? data.resourceType.value
          : this.resourceType,
      resourceId: data.resourceId.present
          ? data.resourceId.value
          : this.resourceId,
      lastSyncAt: data.lastSyncAt.present
          ? data.lastSyncAt.value
          : this.lastSyncAt,
      syncCursor: data.syncCursor.present
          ? data.syncCursor.value
          : this.syncCursor,
      extra: data.extra.present ? data.extra.value : this.extra,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetaData(')
          ..write('resourceType: $resourceType, ')
          ..write('resourceId: $resourceId, ')
          ..write('lastSyncAt: $lastSyncAt, ')
          ..write('syncCursor: $syncCursor, ')
          ..write('extra: $extra')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(resourceType, resourceId, lastSyncAt, syncCursor, extra);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncMetaData &&
          other.resourceType == this.resourceType &&
          other.resourceId == this.resourceId &&
          other.lastSyncAt == this.lastSyncAt &&
          other.syncCursor == this.syncCursor &&
          other.extra == this.extra);
}

class SyncMetaCompanion extends UpdateCompanion<SyncMetaData> {
  final Value<String> resourceType;
  final Value<String> resourceId;
  final Value<int> lastSyncAt;
  final Value<String?> syncCursor;
  final Value<String?> extra;
  final Value<int> rowid;
  const SyncMetaCompanion({
    this.resourceType = const Value.absent(),
    this.resourceId = const Value.absent(),
    this.lastSyncAt = const Value.absent(),
    this.syncCursor = const Value.absent(),
    this.extra = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncMetaCompanion.insert({
    required String resourceType,
    required String resourceId,
    required int lastSyncAt,
    this.syncCursor = const Value.absent(),
    this.extra = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : resourceType = Value(resourceType),
       resourceId = Value(resourceId),
       lastSyncAt = Value(lastSyncAt);
  static Insertable<SyncMetaData> custom({
    Expression<String>? resourceType,
    Expression<String>? resourceId,
    Expression<int>? lastSyncAt,
    Expression<String>? syncCursor,
    Expression<String>? extra,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (resourceType != null) 'resource_type': resourceType,
      if (resourceId != null) 'resource_id': resourceId,
      if (lastSyncAt != null) 'last_sync_at': lastSyncAt,
      if (syncCursor != null) 'sync_cursor': syncCursor,
      if (extra != null) 'extra': extra,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncMetaCompanion copyWith({
    Value<String>? resourceType,
    Value<String>? resourceId,
    Value<int>? lastSyncAt,
    Value<String?>? syncCursor,
    Value<String?>? extra,
    Value<int>? rowid,
  }) {
    return SyncMetaCompanion(
      resourceType: resourceType ?? this.resourceType,
      resourceId: resourceId ?? this.resourceId,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      syncCursor: syncCursor ?? this.syncCursor,
      extra: extra ?? this.extra,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (resourceType.present) {
      map['resource_type'] = Variable<String>(resourceType.value);
    }
    if (resourceId.present) {
      map['resource_id'] = Variable<String>(resourceId.value);
    }
    if (lastSyncAt.present) {
      map['last_sync_at'] = Variable<int>(lastSyncAt.value);
    }
    if (syncCursor.present) {
      map['sync_cursor'] = Variable<String>(syncCursor.value);
    }
    if (extra.present) {
      map['extra'] = Variable<String>(extra.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetaCompanion(')
          ..write('resourceType: $resourceType, ')
          ..write('resourceId: $resourceId, ')
          ..write('lastSyncAt: $lastSyncAt, ')
          ..write('syncCursor: $syncCursor, ')
          ..write('extra: $extra, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $GroupMembersTable extends GroupMembers
    with TableInfo<$GroupMembersTable, GroupMember> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $GroupMembersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _groupIdMeta = const VerificationMeta(
    'groupId',
  );
  @override
  late final GeneratedColumn<String> groupId = GeneratedColumn<String>(
    'group_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _actorIdMeta = const VerificationMeta(
    'actorId',
  );
  @override
  late final GeneratedColumn<String> actorId = GeneratedColumn<String>(
    'actor_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _roleMeta = const VerificationMeta('role');
  @override
  late final GeneratedColumn<int> role = GeneratedColumn<int>(
    'role',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nicknameMeta = const VerificationMeta(
    'nickname',
  );
  @override
  late final GeneratedColumn<String> nickname = GeneratedColumn<String>(
    'nickname',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isMutedMeta = const VerificationMeta(
    'isMuted',
  );
  @override
  late final GeneratedColumn<bool> isMuted = GeneratedColumn<bool>(
    'is_muted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_muted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _mutedUntilMeta = const VerificationMeta(
    'mutedUntil',
  );
  @override
  late final GeneratedColumn<int> mutedUntil = GeneratedColumn<int>(
    'muted_until',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _joinedAtMeta = const VerificationMeta(
    'joinedAt',
  );
  @override
  late final GeneratedColumn<int> joinedAt = GeneratedColumn<int>(
    'joined_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
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
  static const VerificationMeta _displayNameMeta = const VerificationMeta(
    'displayName',
  );
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
    'display_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    groupId,
    actorId,
    role,
    nickname,
    isMuted,
    mutedUntil,
    joinedAt,
    avatarUrl,
    displayName,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'group_members';
  @override
  VerificationContext validateIntegrity(
    Insertable<GroupMember> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('group_id')) {
      context.handle(
        _groupIdMeta,
        groupId.isAcceptableOrUnknown(data['group_id']!, _groupIdMeta),
      );
    } else if (isInserting) {
      context.missing(_groupIdMeta);
    }
    if (data.containsKey('actor_id')) {
      context.handle(
        _actorIdMeta,
        actorId.isAcceptableOrUnknown(data['actor_id']!, _actorIdMeta),
      );
    } else if (isInserting) {
      context.missing(_actorIdMeta);
    }
    if (data.containsKey('role')) {
      context.handle(
        _roleMeta,
        role.isAcceptableOrUnknown(data['role']!, _roleMeta),
      );
    } else if (isInserting) {
      context.missing(_roleMeta);
    }
    if (data.containsKey('nickname')) {
      context.handle(
        _nicknameMeta,
        nickname.isAcceptableOrUnknown(data['nickname']!, _nicknameMeta),
      );
    }
    if (data.containsKey('is_muted')) {
      context.handle(
        _isMutedMeta,
        isMuted.isAcceptableOrUnknown(data['is_muted']!, _isMutedMeta),
      );
    }
    if (data.containsKey('muted_until')) {
      context.handle(
        _mutedUntilMeta,
        mutedUntil.isAcceptableOrUnknown(data['muted_until']!, _mutedUntilMeta),
      );
    }
    if (data.containsKey('joined_at')) {
      context.handle(
        _joinedAtMeta,
        joinedAt.isAcceptableOrUnknown(data['joined_at']!, _joinedAtMeta),
      );
    }
    if (data.containsKey('avatar_url')) {
      context.handle(
        _avatarUrlMeta,
        avatarUrl.isAcceptableOrUnknown(data['avatar_url']!, _avatarUrlMeta),
      );
    }
    if (data.containsKey('display_name')) {
      context.handle(
        _displayNameMeta,
        displayName.isAcceptableOrUnknown(
          data['display_name']!,
          _displayNameMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {groupId, actorId};
  @override
  GroupMember map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return GroupMember(
      groupId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}group_id'],
      )!,
      actorId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}actor_id'],
      )!,
      role: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}role'],
      )!,
      nickname: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}nickname'],
      ),
      isMuted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_muted'],
      )!,
      mutedUntil: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}muted_until'],
      ),
      joinedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}joined_at'],
      ),
      avatarUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}avatar_url'],
      ),
      displayName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}display_name'],
      ),
    );
  }

  @override
  $GroupMembersTable createAlias(String alias) {
    return $GroupMembersTable(attachedDatabase, alias);
  }
}

class GroupMember extends DataClass implements Insertable<GroupMember> {
  /// 群组ID
  final String groupId;

  /// 成员ID (actor DID)
  final String actorId;

  /// 角色: 1=member, 2=admin, 3=owner
  final int role;

  /// 群内昵称
  final String? nickname;

  /// 是否被禁言
  final bool isMuted;

  /// 禁言截止时间 (Unix timestamp ms)
  final int? mutedUntil;

  /// 加入时间
  final int? joinedAt;

  /// 头像URL (缓存)
  final String? avatarUrl;

  /// 显示名称 (缓存)
  final String? displayName;
  const GroupMember({
    required this.groupId,
    required this.actorId,
    required this.role,
    this.nickname,
    required this.isMuted,
    this.mutedUntil,
    this.joinedAt,
    this.avatarUrl,
    this.displayName,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['group_id'] = Variable<String>(groupId);
    map['actor_id'] = Variable<String>(actorId);
    map['role'] = Variable<int>(role);
    if (!nullToAbsent || nickname != null) {
      map['nickname'] = Variable<String>(nickname);
    }
    map['is_muted'] = Variable<bool>(isMuted);
    if (!nullToAbsent || mutedUntil != null) {
      map['muted_until'] = Variable<int>(mutedUntil);
    }
    if (!nullToAbsent || joinedAt != null) {
      map['joined_at'] = Variable<int>(joinedAt);
    }
    if (!nullToAbsent || avatarUrl != null) {
      map['avatar_url'] = Variable<String>(avatarUrl);
    }
    if (!nullToAbsent || displayName != null) {
      map['display_name'] = Variable<String>(displayName);
    }
    return map;
  }

  GroupMembersCompanion toCompanion(bool nullToAbsent) {
    return GroupMembersCompanion(
      groupId: Value(groupId),
      actorId: Value(actorId),
      role: Value(role),
      nickname: nickname == null && nullToAbsent
          ? const Value.absent()
          : Value(nickname),
      isMuted: Value(isMuted),
      mutedUntil: mutedUntil == null && nullToAbsent
          ? const Value.absent()
          : Value(mutedUntil),
      joinedAt: joinedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(joinedAt),
      avatarUrl: avatarUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(avatarUrl),
      displayName: displayName == null && nullToAbsent
          ? const Value.absent()
          : Value(displayName),
    );
  }

  factory GroupMember.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return GroupMember(
      groupId: serializer.fromJson<String>(json['groupId']),
      actorId: serializer.fromJson<String>(json['actorId']),
      role: serializer.fromJson<int>(json['role']),
      nickname: serializer.fromJson<String?>(json['nickname']),
      isMuted: serializer.fromJson<bool>(json['isMuted']),
      mutedUntil: serializer.fromJson<int?>(json['mutedUntil']),
      joinedAt: serializer.fromJson<int?>(json['joinedAt']),
      avatarUrl: serializer.fromJson<String?>(json['avatarUrl']),
      displayName: serializer.fromJson<String?>(json['displayName']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'groupId': serializer.toJson<String>(groupId),
      'actorId': serializer.toJson<String>(actorId),
      'role': serializer.toJson<int>(role),
      'nickname': serializer.toJson<String?>(nickname),
      'isMuted': serializer.toJson<bool>(isMuted),
      'mutedUntil': serializer.toJson<int?>(mutedUntil),
      'joinedAt': serializer.toJson<int?>(joinedAt),
      'avatarUrl': serializer.toJson<String?>(avatarUrl),
      'displayName': serializer.toJson<String?>(displayName),
    };
  }

  GroupMember copyWith({
    String? groupId,
    String? actorId,
    int? role,
    Value<String?> nickname = const Value.absent(),
    bool? isMuted,
    Value<int?> mutedUntil = const Value.absent(),
    Value<int?> joinedAt = const Value.absent(),
    Value<String?> avatarUrl = const Value.absent(),
    Value<String?> displayName = const Value.absent(),
  }) => GroupMember(
    groupId: groupId ?? this.groupId,
    actorId: actorId ?? this.actorId,
    role: role ?? this.role,
    nickname: nickname.present ? nickname.value : this.nickname,
    isMuted: isMuted ?? this.isMuted,
    mutedUntil: mutedUntil.present ? mutedUntil.value : this.mutedUntil,
    joinedAt: joinedAt.present ? joinedAt.value : this.joinedAt,
    avatarUrl: avatarUrl.present ? avatarUrl.value : this.avatarUrl,
    displayName: displayName.present ? displayName.value : this.displayName,
  );
  GroupMember copyWithCompanion(GroupMembersCompanion data) {
    return GroupMember(
      groupId: data.groupId.present ? data.groupId.value : this.groupId,
      actorId: data.actorId.present ? data.actorId.value : this.actorId,
      role: data.role.present ? data.role.value : this.role,
      nickname: data.nickname.present ? data.nickname.value : this.nickname,
      isMuted: data.isMuted.present ? data.isMuted.value : this.isMuted,
      mutedUntil: data.mutedUntil.present
          ? data.mutedUntil.value
          : this.mutedUntil,
      joinedAt: data.joinedAt.present ? data.joinedAt.value : this.joinedAt,
      avatarUrl: data.avatarUrl.present ? data.avatarUrl.value : this.avatarUrl,
      displayName: data.displayName.present
          ? data.displayName.value
          : this.displayName,
    );
  }

  @override
  String toString() {
    return (StringBuffer('GroupMember(')
          ..write('groupId: $groupId, ')
          ..write('actorId: $actorId, ')
          ..write('role: $role, ')
          ..write('nickname: $nickname, ')
          ..write('isMuted: $isMuted, ')
          ..write('mutedUntil: $mutedUntil, ')
          ..write('joinedAt: $joinedAt, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('displayName: $displayName')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    groupId,
    actorId,
    role,
    nickname,
    isMuted,
    mutedUntil,
    joinedAt,
    avatarUrl,
    displayName,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GroupMember &&
          other.groupId == this.groupId &&
          other.actorId == this.actorId &&
          other.role == this.role &&
          other.nickname == this.nickname &&
          other.isMuted == this.isMuted &&
          other.mutedUntil == this.mutedUntil &&
          other.joinedAt == this.joinedAt &&
          other.avatarUrl == this.avatarUrl &&
          other.displayName == this.displayName);
}

class GroupMembersCompanion extends UpdateCompanion<GroupMember> {
  final Value<String> groupId;
  final Value<String> actorId;
  final Value<int> role;
  final Value<String?> nickname;
  final Value<bool> isMuted;
  final Value<int?> mutedUntil;
  final Value<int?> joinedAt;
  final Value<String?> avatarUrl;
  final Value<String?> displayName;
  final Value<int> rowid;
  const GroupMembersCompanion({
    this.groupId = const Value.absent(),
    this.actorId = const Value.absent(),
    this.role = const Value.absent(),
    this.nickname = const Value.absent(),
    this.isMuted = const Value.absent(),
    this.mutedUntil = const Value.absent(),
    this.joinedAt = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.displayName = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  GroupMembersCompanion.insert({
    required String groupId,
    required String actorId,
    required int role,
    this.nickname = const Value.absent(),
    this.isMuted = const Value.absent(),
    this.mutedUntil = const Value.absent(),
    this.joinedAt = const Value.absent(),
    this.avatarUrl = const Value.absent(),
    this.displayName = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : groupId = Value(groupId),
       actorId = Value(actorId),
       role = Value(role);
  static Insertable<GroupMember> custom({
    Expression<String>? groupId,
    Expression<String>? actorId,
    Expression<int>? role,
    Expression<String>? nickname,
    Expression<bool>? isMuted,
    Expression<int>? mutedUntil,
    Expression<int>? joinedAt,
    Expression<String>? avatarUrl,
    Expression<String>? displayName,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (groupId != null) 'group_id': groupId,
      if (actorId != null) 'actor_id': actorId,
      if (role != null) 'role': role,
      if (nickname != null) 'nickname': nickname,
      if (isMuted != null) 'is_muted': isMuted,
      if (mutedUntil != null) 'muted_until': mutedUntil,
      if (joinedAt != null) 'joined_at': joinedAt,
      if (avatarUrl != null) 'avatar_url': avatarUrl,
      if (displayName != null) 'display_name': displayName,
      if (rowid != null) 'rowid': rowid,
    });
  }

  GroupMembersCompanion copyWith({
    Value<String>? groupId,
    Value<String>? actorId,
    Value<int>? role,
    Value<String?>? nickname,
    Value<bool>? isMuted,
    Value<int?>? mutedUntil,
    Value<int?>? joinedAt,
    Value<String?>? avatarUrl,
    Value<String?>? displayName,
    Value<int>? rowid,
  }) {
    return GroupMembersCompanion(
      groupId: groupId ?? this.groupId,
      actorId: actorId ?? this.actorId,
      role: role ?? this.role,
      nickname: nickname ?? this.nickname,
      isMuted: isMuted ?? this.isMuted,
      mutedUntil: mutedUntil ?? this.mutedUntil,
      joinedAt: joinedAt ?? this.joinedAt,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      displayName: displayName ?? this.displayName,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (groupId.present) {
      map['group_id'] = Variable<String>(groupId.value);
    }
    if (actorId.present) {
      map['actor_id'] = Variable<String>(actorId.value);
    }
    if (role.present) {
      map['role'] = Variable<int>(role.value);
    }
    if (nickname.present) {
      map['nickname'] = Variable<String>(nickname.value);
    }
    if (isMuted.present) {
      map['is_muted'] = Variable<bool>(isMuted.value);
    }
    if (mutedUntil.present) {
      map['muted_until'] = Variable<int>(mutedUntil.value);
    }
    if (joinedAt.present) {
      map['joined_at'] = Variable<int>(joinedAt.value);
    }
    if (avatarUrl.present) {
      map['avatar_url'] = Variable<String>(avatarUrl.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('GroupMembersCompanion(')
          ..write('groupId: $groupId, ')
          ..write('actorId: $actorId, ')
          ..write('role: $role, ')
          ..write('nickname: $nickname, ')
          ..write('isMuted: $isMuted, ')
          ..write('mutedUntil: $mutedUntil, ')
          ..write('joinedAt: $joinedAt, ')
          ..write('avatarUrl: $avatarUrl, ')
          ..write('displayName: $displayName, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $AnnouncementsTable extends Announcements
    with TableInfo<$AnnouncementsTable, Announcement> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AnnouncementsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _ulidMeta = const VerificationMeta('ulid');
  @override
  late final GeneratedColumn<String> ulid = GeneratedColumn<String>(
    'ulid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _groupUlidMeta = const VerificationMeta(
    'groupUlid',
  );
  @override
  late final GeneratedColumn<String> groupUlid = GeneratedColumn<String>(
    'group_ulid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _authorDidMeta = const VerificationMeta(
    'authorDid',
  );
  @override
  late final GeneratedColumn<String> authorDid = GeneratedColumn<String>(
    'author_did',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
    'title',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _contentMeta = const VerificationMeta(
    'content',
  );
  @override
  late final GeneratedColumn<String> content = GeneratedColumn<String>(
    'content',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isPinnedMeta = const VerificationMeta(
    'isPinned',
  );
  @override
  late final GeneratedColumn<bool> isPinned = GeneratedColumn<bool>(
    'is_pinned',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_pinned" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _readCountMeta = const VerificationMeta(
    'readCount',
  );
  @override
  late final GeneratedColumn<int> readCount = GeneratedColumn<int>(
    'read_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<int> createdAt = GeneratedColumn<int>(
    'created_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<int> updatedAt = GeneratedColumn<int>(
    'updated_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isDeletedMeta = const VerificationMeta(
    'isDeleted',
  );
  @override
  late final GeneratedColumn<bool> isDeleted = GeneratedColumn<bool>(
    'is_deleted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_deleted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _isReadMeta = const VerificationMeta('isRead');
  @override
  late final GeneratedColumn<bool> isRead = GeneratedColumn<bool>(
    'is_read',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_read" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    ulid,
    groupUlid,
    authorDid,
    title,
    content,
    isPinned,
    readCount,
    createdAt,
    updatedAt,
    isDeleted,
    isRead,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'announcements';
  @override
  VerificationContext validateIntegrity(
    Insertable<Announcement> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('ulid')) {
      context.handle(
        _ulidMeta,
        ulid.isAcceptableOrUnknown(data['ulid']!, _ulidMeta),
      );
    } else if (isInserting) {
      context.missing(_ulidMeta);
    }
    if (data.containsKey('group_ulid')) {
      context.handle(
        _groupUlidMeta,
        groupUlid.isAcceptableOrUnknown(data['group_ulid']!, _groupUlidMeta),
      );
    } else if (isInserting) {
      context.missing(_groupUlidMeta);
    }
    if (data.containsKey('author_did')) {
      context.handle(
        _authorDidMeta,
        authorDid.isAcceptableOrUnknown(data['author_did']!, _authorDidMeta),
      );
    } else if (isInserting) {
      context.missing(_authorDidMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
        _titleMeta,
        title.isAcceptableOrUnknown(data['title']!, _titleMeta),
      );
    }
    if (data.containsKey('content')) {
      context.handle(
        _contentMeta,
        content.isAcceptableOrUnknown(data['content']!, _contentMeta),
      );
    }
    if (data.containsKey('is_pinned')) {
      context.handle(
        _isPinnedMeta,
        isPinned.isAcceptableOrUnknown(data['is_pinned']!, _isPinnedMeta),
      );
    }
    if (data.containsKey('read_count')) {
      context.handle(
        _readCountMeta,
        readCount.isAcceptableOrUnknown(data['read_count']!, _readCountMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    }
    if (data.containsKey('is_deleted')) {
      context.handle(
        _isDeletedMeta,
        isDeleted.isAcceptableOrUnknown(data['is_deleted']!, _isDeletedMeta),
      );
    }
    if (data.containsKey('is_read')) {
      context.handle(
        _isReadMeta,
        isRead.isAcceptableOrUnknown(data['is_read']!, _isReadMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {ulid};
  @override
  Announcement map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Announcement(
      ulid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ulid'],
      )!,
      groupUlid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}group_ulid'],
      )!,
      authorDid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}author_did'],
      )!,
      title: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}title'],
      ),
      content: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}content'],
      ),
      isPinned: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_pinned'],
      )!,
      readCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}read_count'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at'],
      ),
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}updated_at'],
      ),
      isDeleted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_deleted'],
      )!,
      isRead: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_read'],
      )!,
    );
  }

  @override
  $AnnouncementsTable createAlias(String alias) {
    return $AnnouncementsTable(attachedDatabase, alias);
  }
}

class Announcement extends DataClass implements Insertable<Announcement> {
  /// 公告ID (ULID)
  final String ulid;

  /// 群组ID
  final String groupUlid;

  /// 作者DID
  final String authorDid;

  /// 标题
  final String? title;

  /// 内容
  final String? content;

  /// 是否置顶
  final bool isPinned;

  /// 已读人数
  final int readCount;

  /// 创建时间
  final int? createdAt;

  /// 更新时间
  final int? updatedAt;

  /// 是否已删除
  final bool isDeleted;

  /// 当前用户是否已读
  final bool isRead;
  const Announcement({
    required this.ulid,
    required this.groupUlid,
    required this.authorDid,
    this.title,
    this.content,
    required this.isPinned,
    required this.readCount,
    this.createdAt,
    this.updatedAt,
    required this.isDeleted,
    required this.isRead,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['ulid'] = Variable<String>(ulid);
    map['group_ulid'] = Variable<String>(groupUlid);
    map['author_did'] = Variable<String>(authorDid);
    if (!nullToAbsent || title != null) {
      map['title'] = Variable<String>(title);
    }
    if (!nullToAbsent || content != null) {
      map['content'] = Variable<String>(content);
    }
    map['is_pinned'] = Variable<bool>(isPinned);
    map['read_count'] = Variable<int>(readCount);
    if (!nullToAbsent || createdAt != null) {
      map['created_at'] = Variable<int>(createdAt);
    }
    if (!nullToAbsent || updatedAt != null) {
      map['updated_at'] = Variable<int>(updatedAt);
    }
    map['is_deleted'] = Variable<bool>(isDeleted);
    map['is_read'] = Variable<bool>(isRead);
    return map;
  }

  AnnouncementsCompanion toCompanion(bool nullToAbsent) {
    return AnnouncementsCompanion(
      ulid: Value(ulid),
      groupUlid: Value(groupUlid),
      authorDid: Value(authorDid),
      title: title == null && nullToAbsent
          ? const Value.absent()
          : Value(title),
      content: content == null && nullToAbsent
          ? const Value.absent()
          : Value(content),
      isPinned: Value(isPinned),
      readCount: Value(readCount),
      createdAt: createdAt == null && nullToAbsent
          ? const Value.absent()
          : Value(createdAt),
      updatedAt: updatedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(updatedAt),
      isDeleted: Value(isDeleted),
      isRead: Value(isRead),
    );
  }

  factory Announcement.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Announcement(
      ulid: serializer.fromJson<String>(json['ulid']),
      groupUlid: serializer.fromJson<String>(json['groupUlid']),
      authorDid: serializer.fromJson<String>(json['authorDid']),
      title: serializer.fromJson<String?>(json['title']),
      content: serializer.fromJson<String?>(json['content']),
      isPinned: serializer.fromJson<bool>(json['isPinned']),
      readCount: serializer.fromJson<int>(json['readCount']),
      createdAt: serializer.fromJson<int?>(json['createdAt']),
      updatedAt: serializer.fromJson<int?>(json['updatedAt']),
      isDeleted: serializer.fromJson<bool>(json['isDeleted']),
      isRead: serializer.fromJson<bool>(json['isRead']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'ulid': serializer.toJson<String>(ulid),
      'groupUlid': serializer.toJson<String>(groupUlid),
      'authorDid': serializer.toJson<String>(authorDid),
      'title': serializer.toJson<String?>(title),
      'content': serializer.toJson<String?>(content),
      'isPinned': serializer.toJson<bool>(isPinned),
      'readCount': serializer.toJson<int>(readCount),
      'createdAt': serializer.toJson<int?>(createdAt),
      'updatedAt': serializer.toJson<int?>(updatedAt),
      'isDeleted': serializer.toJson<bool>(isDeleted),
      'isRead': serializer.toJson<bool>(isRead),
    };
  }

  Announcement copyWith({
    String? ulid,
    String? groupUlid,
    String? authorDid,
    Value<String?> title = const Value.absent(),
    Value<String?> content = const Value.absent(),
    bool? isPinned,
    int? readCount,
    Value<int?> createdAt = const Value.absent(),
    Value<int?> updatedAt = const Value.absent(),
    bool? isDeleted,
    bool? isRead,
  }) => Announcement(
    ulid: ulid ?? this.ulid,
    groupUlid: groupUlid ?? this.groupUlid,
    authorDid: authorDid ?? this.authorDid,
    title: title.present ? title.value : this.title,
    content: content.present ? content.value : this.content,
    isPinned: isPinned ?? this.isPinned,
    readCount: readCount ?? this.readCount,
    createdAt: createdAt.present ? createdAt.value : this.createdAt,
    updatedAt: updatedAt.present ? updatedAt.value : this.updatedAt,
    isDeleted: isDeleted ?? this.isDeleted,
    isRead: isRead ?? this.isRead,
  );
  Announcement copyWithCompanion(AnnouncementsCompanion data) {
    return Announcement(
      ulid: data.ulid.present ? data.ulid.value : this.ulid,
      groupUlid: data.groupUlid.present ? data.groupUlid.value : this.groupUlid,
      authorDid: data.authorDid.present ? data.authorDid.value : this.authorDid,
      title: data.title.present ? data.title.value : this.title,
      content: data.content.present ? data.content.value : this.content,
      isPinned: data.isPinned.present ? data.isPinned.value : this.isPinned,
      readCount: data.readCount.present ? data.readCount.value : this.readCount,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      isDeleted: data.isDeleted.present ? data.isDeleted.value : this.isDeleted,
      isRead: data.isRead.present ? data.isRead.value : this.isRead,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Announcement(')
          ..write('ulid: $ulid, ')
          ..write('groupUlid: $groupUlid, ')
          ..write('authorDid: $authorDid, ')
          ..write('title: $title, ')
          ..write('content: $content, ')
          ..write('isPinned: $isPinned, ')
          ..write('readCount: $readCount, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('isDeleted: $isDeleted, ')
          ..write('isRead: $isRead')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    ulid,
    groupUlid,
    authorDid,
    title,
    content,
    isPinned,
    readCount,
    createdAt,
    updatedAt,
    isDeleted,
    isRead,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Announcement &&
          other.ulid == this.ulid &&
          other.groupUlid == this.groupUlid &&
          other.authorDid == this.authorDid &&
          other.title == this.title &&
          other.content == this.content &&
          other.isPinned == this.isPinned &&
          other.readCount == this.readCount &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt &&
          other.isDeleted == this.isDeleted &&
          other.isRead == this.isRead);
}

class AnnouncementsCompanion extends UpdateCompanion<Announcement> {
  final Value<String> ulid;
  final Value<String> groupUlid;
  final Value<String> authorDid;
  final Value<String?> title;
  final Value<String?> content;
  final Value<bool> isPinned;
  final Value<int> readCount;
  final Value<int?> createdAt;
  final Value<int?> updatedAt;
  final Value<bool> isDeleted;
  final Value<bool> isRead;
  final Value<int> rowid;
  const AnnouncementsCompanion({
    this.ulid = const Value.absent(),
    this.groupUlid = const Value.absent(),
    this.authorDid = const Value.absent(),
    this.title = const Value.absent(),
    this.content = const Value.absent(),
    this.isPinned = const Value.absent(),
    this.readCount = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.isDeleted = const Value.absent(),
    this.isRead = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  AnnouncementsCompanion.insert({
    required String ulid,
    required String groupUlid,
    required String authorDid,
    this.title = const Value.absent(),
    this.content = const Value.absent(),
    this.isPinned = const Value.absent(),
    this.readCount = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.isDeleted = const Value.absent(),
    this.isRead = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : ulid = Value(ulid),
       groupUlid = Value(groupUlid),
       authorDid = Value(authorDid);
  static Insertable<Announcement> custom({
    Expression<String>? ulid,
    Expression<String>? groupUlid,
    Expression<String>? authorDid,
    Expression<String>? title,
    Expression<String>? content,
    Expression<bool>? isPinned,
    Expression<int>? readCount,
    Expression<int>? createdAt,
    Expression<int>? updatedAt,
    Expression<bool>? isDeleted,
    Expression<bool>? isRead,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (ulid != null) 'ulid': ulid,
      if (groupUlid != null) 'group_ulid': groupUlid,
      if (authorDid != null) 'author_did': authorDid,
      if (title != null) 'title': title,
      if (content != null) 'content': content,
      if (isPinned != null) 'is_pinned': isPinned,
      if (readCount != null) 'read_count': readCount,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (isDeleted != null) 'is_deleted': isDeleted,
      if (isRead != null) 'is_read': isRead,
      if (rowid != null) 'rowid': rowid,
    });
  }

  AnnouncementsCompanion copyWith({
    Value<String>? ulid,
    Value<String>? groupUlid,
    Value<String>? authorDid,
    Value<String?>? title,
    Value<String?>? content,
    Value<bool>? isPinned,
    Value<int>? readCount,
    Value<int?>? createdAt,
    Value<int?>? updatedAt,
    Value<bool>? isDeleted,
    Value<bool>? isRead,
    Value<int>? rowid,
  }) {
    return AnnouncementsCompanion(
      ulid: ulid ?? this.ulid,
      groupUlid: groupUlid ?? this.groupUlid,
      authorDid: authorDid ?? this.authorDid,
      title: title ?? this.title,
      content: content ?? this.content,
      isPinned: isPinned ?? this.isPinned,
      readCount: readCount ?? this.readCount,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isDeleted: isDeleted ?? this.isDeleted,
      isRead: isRead ?? this.isRead,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (ulid.present) {
      map['ulid'] = Variable<String>(ulid.value);
    }
    if (groupUlid.present) {
      map['group_ulid'] = Variable<String>(groupUlid.value);
    }
    if (authorDid.present) {
      map['author_did'] = Variable<String>(authorDid.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (content.present) {
      map['content'] = Variable<String>(content.value);
    }
    if (isPinned.present) {
      map['is_pinned'] = Variable<bool>(isPinned.value);
    }
    if (readCount.present) {
      map['read_count'] = Variable<int>(readCount.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<int>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<int>(updatedAt.value);
    }
    if (isDeleted.present) {
      map['is_deleted'] = Variable<bool>(isDeleted.value);
    }
    if (isRead.present) {
      map['is_read'] = Variable<bool>(isRead.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AnnouncementsCompanion(')
          ..write('ulid: $ulid, ')
          ..write('groupUlid: $groupUlid, ')
          ..write('authorDid: $authorDid, ')
          ..write('title: $title, ')
          ..write('content: $content, ')
          ..write('isPinned: $isPinned, ')
          ..write('readCount: $readCount, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('isDeleted: $isDeleted, ')
          ..write('isRead: $isRead, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $StickerPacksTable extends StickerPacks
    with TableInfo<$StickerPacksTable, StickerPack> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $StickerPacksTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _ulidMeta = const VerificationMeta('ulid');
  @override
  late final GeneratedColumn<String> ulid = GeneratedColumn<String>(
    'ulid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _authorMeta = const VerificationMeta('author');
  @override
  late final GeneratedColumn<String> author = GeneratedColumn<String>(
    'author',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _descriptionMeta = const VerificationMeta(
    'description',
  );
  @override
  late final GeneratedColumn<String> description = GeneratedColumn<String>(
    'description',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _coverUrlMeta = const VerificationMeta(
    'coverUrl',
  );
  @override
  late final GeneratedColumn<String> coverUrl = GeneratedColumn<String>(
    'cover_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isOfficialMeta = const VerificationMeta(
    'isOfficial',
  );
  @override
  late final GeneratedColumn<bool> isOfficial = GeneratedColumn<bool>(
    'is_official',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_official" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _isAnimatedMeta = const VerificationMeta(
    'isAnimated',
  );
  @override
  late final GeneratedColumn<bool> isAnimated = GeneratedColumn<bool>(
    'is_animated',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_animated" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _isCollectedMeta = const VerificationMeta(
    'isCollected',
  );
  @override
  late final GeneratedColumn<bool> isCollected = GeneratedColumn<bool>(
    'is_collected',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_collected" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _sortOrderMeta = const VerificationMeta(
    'sortOrder',
  );
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
    'sort_order',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _stickerCountMeta = const VerificationMeta(
    'stickerCount',
  );
  @override
  late final GeneratedColumn<int> stickerCount = GeneratedColumn<int>(
    'sticker_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<int> createdAt = GeneratedColumn<int>(
    'created_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    ulid,
    name,
    author,
    description,
    coverUrl,
    isOfficial,
    isAnimated,
    isCollected,
    sortOrder,
    stickerCount,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sticker_packs';
  @override
  VerificationContext validateIntegrity(
    Insertable<StickerPack> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('ulid')) {
      context.handle(
        _ulidMeta,
        ulid.isAcceptableOrUnknown(data['ulid']!, _ulidMeta),
      );
    } else if (isInserting) {
      context.missing(_ulidMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('author')) {
      context.handle(
        _authorMeta,
        author.isAcceptableOrUnknown(data['author']!, _authorMeta),
      );
    }
    if (data.containsKey('description')) {
      context.handle(
        _descriptionMeta,
        description.isAcceptableOrUnknown(
          data['description']!,
          _descriptionMeta,
        ),
      );
    }
    if (data.containsKey('cover_url')) {
      context.handle(
        _coverUrlMeta,
        coverUrl.isAcceptableOrUnknown(data['cover_url']!, _coverUrlMeta),
      );
    }
    if (data.containsKey('is_official')) {
      context.handle(
        _isOfficialMeta,
        isOfficial.isAcceptableOrUnknown(data['is_official']!, _isOfficialMeta),
      );
    }
    if (data.containsKey('is_animated')) {
      context.handle(
        _isAnimatedMeta,
        isAnimated.isAcceptableOrUnknown(data['is_animated']!, _isAnimatedMeta),
      );
    }
    if (data.containsKey('is_collected')) {
      context.handle(
        _isCollectedMeta,
        isCollected.isAcceptableOrUnknown(
          data['is_collected']!,
          _isCollectedMeta,
        ),
      );
    }
    if (data.containsKey('sort_order')) {
      context.handle(
        _sortOrderMeta,
        sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta),
      );
    }
    if (data.containsKey('sticker_count')) {
      context.handle(
        _stickerCountMeta,
        stickerCount.isAcceptableOrUnknown(
          data['sticker_count']!,
          _stickerCountMeta,
        ),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {ulid};
  @override
  StickerPack map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return StickerPack(
      ulid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ulid'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      author: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}author'],
      ),
      description: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}description'],
      ),
      coverUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}cover_url'],
      ),
      isOfficial: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_official'],
      )!,
      isAnimated: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_animated'],
      )!,
      isCollected: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_collected'],
      )!,
      sortOrder: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sort_order'],
      )!,
      stickerCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sticker_count'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at'],
      ),
    );
  }

  @override
  $StickerPacksTable createAlias(String alias) {
    return $StickerPacksTable(attachedDatabase, alias);
  }
}

class StickerPack extends DataClass implements Insertable<StickerPack> {
  /// 贴纸包ID (ULID)
  final String ulid;

  /// 名称
  final String name;

  /// 作者
  final String? author;

  /// 描述
  final String? description;

  /// 封面URL
  final String? coverUrl;

  /// 是否官方包
  final bool isOfficial;

  /// 是否动态贴纸
  final bool isAnimated;

  /// 是否已收藏
  final bool isCollected;

  /// 排序顺序
  final int sortOrder;

  /// 贴纸数量
  final int stickerCount;

  /// 创建时间
  final int? createdAt;
  const StickerPack({
    required this.ulid,
    required this.name,
    this.author,
    this.description,
    this.coverUrl,
    required this.isOfficial,
    required this.isAnimated,
    required this.isCollected,
    required this.sortOrder,
    required this.stickerCount,
    this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['ulid'] = Variable<String>(ulid);
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || author != null) {
      map['author'] = Variable<String>(author);
    }
    if (!nullToAbsent || description != null) {
      map['description'] = Variable<String>(description);
    }
    if (!nullToAbsent || coverUrl != null) {
      map['cover_url'] = Variable<String>(coverUrl);
    }
    map['is_official'] = Variable<bool>(isOfficial);
    map['is_animated'] = Variable<bool>(isAnimated);
    map['is_collected'] = Variable<bool>(isCollected);
    map['sort_order'] = Variable<int>(sortOrder);
    map['sticker_count'] = Variable<int>(stickerCount);
    if (!nullToAbsent || createdAt != null) {
      map['created_at'] = Variable<int>(createdAt);
    }
    return map;
  }

  StickerPacksCompanion toCompanion(bool nullToAbsent) {
    return StickerPacksCompanion(
      ulid: Value(ulid),
      name: Value(name),
      author: author == null && nullToAbsent
          ? const Value.absent()
          : Value(author),
      description: description == null && nullToAbsent
          ? const Value.absent()
          : Value(description),
      coverUrl: coverUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(coverUrl),
      isOfficial: Value(isOfficial),
      isAnimated: Value(isAnimated),
      isCollected: Value(isCollected),
      sortOrder: Value(sortOrder),
      stickerCount: Value(stickerCount),
      createdAt: createdAt == null && nullToAbsent
          ? const Value.absent()
          : Value(createdAt),
    );
  }

  factory StickerPack.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return StickerPack(
      ulid: serializer.fromJson<String>(json['ulid']),
      name: serializer.fromJson<String>(json['name']),
      author: serializer.fromJson<String?>(json['author']),
      description: serializer.fromJson<String?>(json['description']),
      coverUrl: serializer.fromJson<String?>(json['coverUrl']),
      isOfficial: serializer.fromJson<bool>(json['isOfficial']),
      isAnimated: serializer.fromJson<bool>(json['isAnimated']),
      isCollected: serializer.fromJson<bool>(json['isCollected']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
      stickerCount: serializer.fromJson<int>(json['stickerCount']),
      createdAt: serializer.fromJson<int?>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'ulid': serializer.toJson<String>(ulid),
      'name': serializer.toJson<String>(name),
      'author': serializer.toJson<String?>(author),
      'description': serializer.toJson<String?>(description),
      'coverUrl': serializer.toJson<String?>(coverUrl),
      'isOfficial': serializer.toJson<bool>(isOfficial),
      'isAnimated': serializer.toJson<bool>(isAnimated),
      'isCollected': serializer.toJson<bool>(isCollected),
      'sortOrder': serializer.toJson<int>(sortOrder),
      'stickerCount': serializer.toJson<int>(stickerCount),
      'createdAt': serializer.toJson<int?>(createdAt),
    };
  }

  StickerPack copyWith({
    String? ulid,
    String? name,
    Value<String?> author = const Value.absent(),
    Value<String?> description = const Value.absent(),
    Value<String?> coverUrl = const Value.absent(),
    bool? isOfficial,
    bool? isAnimated,
    bool? isCollected,
    int? sortOrder,
    int? stickerCount,
    Value<int?> createdAt = const Value.absent(),
  }) => StickerPack(
    ulid: ulid ?? this.ulid,
    name: name ?? this.name,
    author: author.present ? author.value : this.author,
    description: description.present ? description.value : this.description,
    coverUrl: coverUrl.present ? coverUrl.value : this.coverUrl,
    isOfficial: isOfficial ?? this.isOfficial,
    isAnimated: isAnimated ?? this.isAnimated,
    isCollected: isCollected ?? this.isCollected,
    sortOrder: sortOrder ?? this.sortOrder,
    stickerCount: stickerCount ?? this.stickerCount,
    createdAt: createdAt.present ? createdAt.value : this.createdAt,
  );
  StickerPack copyWithCompanion(StickerPacksCompanion data) {
    return StickerPack(
      ulid: data.ulid.present ? data.ulid.value : this.ulid,
      name: data.name.present ? data.name.value : this.name,
      author: data.author.present ? data.author.value : this.author,
      description: data.description.present
          ? data.description.value
          : this.description,
      coverUrl: data.coverUrl.present ? data.coverUrl.value : this.coverUrl,
      isOfficial: data.isOfficial.present
          ? data.isOfficial.value
          : this.isOfficial,
      isAnimated: data.isAnimated.present
          ? data.isAnimated.value
          : this.isAnimated,
      isCollected: data.isCollected.present
          ? data.isCollected.value
          : this.isCollected,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
      stickerCount: data.stickerCount.present
          ? data.stickerCount.value
          : this.stickerCount,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('StickerPack(')
          ..write('ulid: $ulid, ')
          ..write('name: $name, ')
          ..write('author: $author, ')
          ..write('description: $description, ')
          ..write('coverUrl: $coverUrl, ')
          ..write('isOfficial: $isOfficial, ')
          ..write('isAnimated: $isAnimated, ')
          ..write('isCollected: $isCollected, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('stickerCount: $stickerCount, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    ulid,
    name,
    author,
    description,
    coverUrl,
    isOfficial,
    isAnimated,
    isCollected,
    sortOrder,
    stickerCount,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is StickerPack &&
          other.ulid == this.ulid &&
          other.name == this.name &&
          other.author == this.author &&
          other.description == this.description &&
          other.coverUrl == this.coverUrl &&
          other.isOfficial == this.isOfficial &&
          other.isAnimated == this.isAnimated &&
          other.isCollected == this.isCollected &&
          other.sortOrder == this.sortOrder &&
          other.stickerCount == this.stickerCount &&
          other.createdAt == this.createdAt);
}

class StickerPacksCompanion extends UpdateCompanion<StickerPack> {
  final Value<String> ulid;
  final Value<String> name;
  final Value<String?> author;
  final Value<String?> description;
  final Value<String?> coverUrl;
  final Value<bool> isOfficial;
  final Value<bool> isAnimated;
  final Value<bool> isCollected;
  final Value<int> sortOrder;
  final Value<int> stickerCount;
  final Value<int?> createdAt;
  final Value<int> rowid;
  const StickerPacksCompanion({
    this.ulid = const Value.absent(),
    this.name = const Value.absent(),
    this.author = const Value.absent(),
    this.description = const Value.absent(),
    this.coverUrl = const Value.absent(),
    this.isOfficial = const Value.absent(),
    this.isAnimated = const Value.absent(),
    this.isCollected = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.stickerCount = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  StickerPacksCompanion.insert({
    required String ulid,
    required String name,
    this.author = const Value.absent(),
    this.description = const Value.absent(),
    this.coverUrl = const Value.absent(),
    this.isOfficial = const Value.absent(),
    this.isAnimated = const Value.absent(),
    this.isCollected = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.stickerCount = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : ulid = Value(ulid),
       name = Value(name);
  static Insertable<StickerPack> custom({
    Expression<String>? ulid,
    Expression<String>? name,
    Expression<String>? author,
    Expression<String>? description,
    Expression<String>? coverUrl,
    Expression<bool>? isOfficial,
    Expression<bool>? isAnimated,
    Expression<bool>? isCollected,
    Expression<int>? sortOrder,
    Expression<int>? stickerCount,
    Expression<int>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (ulid != null) 'ulid': ulid,
      if (name != null) 'name': name,
      if (author != null) 'author': author,
      if (description != null) 'description': description,
      if (coverUrl != null) 'cover_url': coverUrl,
      if (isOfficial != null) 'is_official': isOfficial,
      if (isAnimated != null) 'is_animated': isAnimated,
      if (isCollected != null) 'is_collected': isCollected,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (stickerCount != null) 'sticker_count': stickerCount,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  StickerPacksCompanion copyWith({
    Value<String>? ulid,
    Value<String>? name,
    Value<String?>? author,
    Value<String?>? description,
    Value<String?>? coverUrl,
    Value<bool>? isOfficial,
    Value<bool>? isAnimated,
    Value<bool>? isCollected,
    Value<int>? sortOrder,
    Value<int>? stickerCount,
    Value<int?>? createdAt,
    Value<int>? rowid,
  }) {
    return StickerPacksCompanion(
      ulid: ulid ?? this.ulid,
      name: name ?? this.name,
      author: author ?? this.author,
      description: description ?? this.description,
      coverUrl: coverUrl ?? this.coverUrl,
      isOfficial: isOfficial ?? this.isOfficial,
      isAnimated: isAnimated ?? this.isAnimated,
      isCollected: isCollected ?? this.isCollected,
      sortOrder: sortOrder ?? this.sortOrder,
      stickerCount: stickerCount ?? this.stickerCount,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (ulid.present) {
      map['ulid'] = Variable<String>(ulid.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (author.present) {
      map['author'] = Variable<String>(author.value);
    }
    if (description.present) {
      map['description'] = Variable<String>(description.value);
    }
    if (coverUrl.present) {
      map['cover_url'] = Variable<String>(coverUrl.value);
    }
    if (isOfficial.present) {
      map['is_official'] = Variable<bool>(isOfficial.value);
    }
    if (isAnimated.present) {
      map['is_animated'] = Variable<bool>(isAnimated.value);
    }
    if (isCollected.present) {
      map['is_collected'] = Variable<bool>(isCollected.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (stickerCount.present) {
      map['sticker_count'] = Variable<int>(stickerCount.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<int>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('StickerPacksCompanion(')
          ..write('ulid: $ulid, ')
          ..write('name: $name, ')
          ..write('author: $author, ')
          ..write('description: $description, ')
          ..write('coverUrl: $coverUrl, ')
          ..write('isOfficial: $isOfficial, ')
          ..write('isAnimated: $isAnimated, ')
          ..write('isCollected: $isCollected, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('stickerCount: $stickerCount, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $StickersTable extends Stickers with TableInfo<$StickersTable, Sticker> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $StickersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _ulidMeta = const VerificationMeta('ulid');
  @override
  late final GeneratedColumn<String> ulid = GeneratedColumn<String>(
    'ulid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _packUlidMeta = const VerificationMeta(
    'packUlid',
  );
  @override
  late final GeneratedColumn<String> packUlid = GeneratedColumn<String>(
    'pack_ulid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _emojiMeta = const VerificationMeta('emoji');
  @override
  late final GeneratedColumn<String> emoji = GeneratedColumn<String>(
    'emoji',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _urlMeta = const VerificationMeta('url');
  @override
  late final GeneratedColumn<String> url = GeneratedColumn<String>(
    'url',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _thumbnailUrlMeta = const VerificationMeta(
    'thumbnailUrl',
  );
  @override
  late final GeneratedColumn<String> thumbnailUrl = GeneratedColumn<String>(
    'thumbnail_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _widthMeta = const VerificationMeta('width');
  @override
  late final GeneratedColumn<int> width = GeneratedColumn<int>(
    'width',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _heightMeta = const VerificationMeta('height');
  @override
  late final GeneratedColumn<int> height = GeneratedColumn<int>(
    'height',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _fileTypeMeta = const VerificationMeta(
    'fileType',
  );
  @override
  late final GeneratedColumn<String> fileType = GeneratedColumn<String>(
    'file_type',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _fileSizeMeta = const VerificationMeta(
    'fileSize',
  );
  @override
  late final GeneratedColumn<int> fileSize = GeneratedColumn<int>(
    'file_size',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastUsedAtMeta = const VerificationMeta(
    'lastUsedAt',
  );
  @override
  late final GeneratedColumn<int> lastUsedAt = GeneratedColumn<int>(
    'last_used_at',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _useCountMeta = const VerificationMeta(
    'useCount',
  );
  @override
  late final GeneratedColumn<int> useCount = GeneratedColumn<int>(
    'use_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _localPathMeta = const VerificationMeta(
    'localPath',
  );
  @override
  late final GeneratedColumn<String> localPath = GeneratedColumn<String>(
    'local_path',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    ulid,
    packUlid,
    emoji,
    url,
    thumbnailUrl,
    width,
    height,
    fileType,
    fileSize,
    lastUsedAt,
    useCount,
    localPath,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'stickers';
  @override
  VerificationContext validateIntegrity(
    Insertable<Sticker> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('ulid')) {
      context.handle(
        _ulidMeta,
        ulid.isAcceptableOrUnknown(data['ulid']!, _ulidMeta),
      );
    } else if (isInserting) {
      context.missing(_ulidMeta);
    }
    if (data.containsKey('pack_ulid')) {
      context.handle(
        _packUlidMeta,
        packUlid.isAcceptableOrUnknown(data['pack_ulid']!, _packUlidMeta),
      );
    } else if (isInserting) {
      context.missing(_packUlidMeta);
    }
    if (data.containsKey('emoji')) {
      context.handle(
        _emojiMeta,
        emoji.isAcceptableOrUnknown(data['emoji']!, _emojiMeta),
      );
    }
    if (data.containsKey('url')) {
      context.handle(
        _urlMeta,
        url.isAcceptableOrUnknown(data['url']!, _urlMeta),
      );
    } else if (isInserting) {
      context.missing(_urlMeta);
    }
    if (data.containsKey('thumbnail_url')) {
      context.handle(
        _thumbnailUrlMeta,
        thumbnailUrl.isAcceptableOrUnknown(
          data['thumbnail_url']!,
          _thumbnailUrlMeta,
        ),
      );
    }
    if (data.containsKey('width')) {
      context.handle(
        _widthMeta,
        width.isAcceptableOrUnknown(data['width']!, _widthMeta),
      );
    }
    if (data.containsKey('height')) {
      context.handle(
        _heightMeta,
        height.isAcceptableOrUnknown(data['height']!, _heightMeta),
      );
    }
    if (data.containsKey('file_type')) {
      context.handle(
        _fileTypeMeta,
        fileType.isAcceptableOrUnknown(data['file_type']!, _fileTypeMeta),
      );
    }
    if (data.containsKey('file_size')) {
      context.handle(
        _fileSizeMeta,
        fileSize.isAcceptableOrUnknown(data['file_size']!, _fileSizeMeta),
      );
    }
    if (data.containsKey('last_used_at')) {
      context.handle(
        _lastUsedAtMeta,
        lastUsedAt.isAcceptableOrUnknown(
          data['last_used_at']!,
          _lastUsedAtMeta,
        ),
      );
    }
    if (data.containsKey('use_count')) {
      context.handle(
        _useCountMeta,
        useCount.isAcceptableOrUnknown(data['use_count']!, _useCountMeta),
      );
    }
    if (data.containsKey('local_path')) {
      context.handle(
        _localPathMeta,
        localPath.isAcceptableOrUnknown(data['local_path']!, _localPathMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {ulid};
  @override
  Sticker map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Sticker(
      ulid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ulid'],
      )!,
      packUlid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pack_ulid'],
      )!,
      emoji: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}emoji'],
      ),
      url: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}url'],
      )!,
      thumbnailUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}thumbnail_url'],
      ),
      width: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}width'],
      ),
      height: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}height'],
      ),
      fileType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}file_type'],
      ),
      fileSize: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}file_size'],
      ),
      lastUsedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_used_at'],
      ),
      useCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}use_count'],
      )!,
      localPath: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}local_path'],
      ),
    );
  }

  @override
  $StickersTable createAlias(String alias) {
    return $StickersTable(attachedDatabase, alias);
  }
}

class Sticker extends DataClass implements Insertable<Sticker> {
  /// 贴纸ID (ULID)
  final String ulid;

  /// 所属贴纸包ID
  final String packUlid;

  /// 对应的emoji (用于搜索)
  final String? emoji;

  /// 贴纸图片URL
  final String url;

  /// 缩略图URL
  final String? thumbnailUrl;

  /// 宽度
  final int? width;

  /// 高度
  final int? height;

  /// 文件类型 (png, gif, webp, lottie)
  final String? fileType;

  /// 文件大小
  final int? fileSize;

  /// 最近使用时间
  final int? lastUsedAt;

  /// 使用次数
  final int useCount;

  /// 本地缓存路径
  final String? localPath;
  const Sticker({
    required this.ulid,
    required this.packUlid,
    this.emoji,
    required this.url,
    this.thumbnailUrl,
    this.width,
    this.height,
    this.fileType,
    this.fileSize,
    this.lastUsedAt,
    required this.useCount,
    this.localPath,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['ulid'] = Variable<String>(ulid);
    map['pack_ulid'] = Variable<String>(packUlid);
    if (!nullToAbsent || emoji != null) {
      map['emoji'] = Variable<String>(emoji);
    }
    map['url'] = Variable<String>(url);
    if (!nullToAbsent || thumbnailUrl != null) {
      map['thumbnail_url'] = Variable<String>(thumbnailUrl);
    }
    if (!nullToAbsent || width != null) {
      map['width'] = Variable<int>(width);
    }
    if (!nullToAbsent || height != null) {
      map['height'] = Variable<int>(height);
    }
    if (!nullToAbsent || fileType != null) {
      map['file_type'] = Variable<String>(fileType);
    }
    if (!nullToAbsent || fileSize != null) {
      map['file_size'] = Variable<int>(fileSize);
    }
    if (!nullToAbsent || lastUsedAt != null) {
      map['last_used_at'] = Variable<int>(lastUsedAt);
    }
    map['use_count'] = Variable<int>(useCount);
    if (!nullToAbsent || localPath != null) {
      map['local_path'] = Variable<String>(localPath);
    }
    return map;
  }

  StickersCompanion toCompanion(bool nullToAbsent) {
    return StickersCompanion(
      ulid: Value(ulid),
      packUlid: Value(packUlid),
      emoji: emoji == null && nullToAbsent
          ? const Value.absent()
          : Value(emoji),
      url: Value(url),
      thumbnailUrl: thumbnailUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(thumbnailUrl),
      width: width == null && nullToAbsent
          ? const Value.absent()
          : Value(width),
      height: height == null && nullToAbsent
          ? const Value.absent()
          : Value(height),
      fileType: fileType == null && nullToAbsent
          ? const Value.absent()
          : Value(fileType),
      fileSize: fileSize == null && nullToAbsent
          ? const Value.absent()
          : Value(fileSize),
      lastUsedAt: lastUsedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastUsedAt),
      useCount: Value(useCount),
      localPath: localPath == null && nullToAbsent
          ? const Value.absent()
          : Value(localPath),
    );
  }

  factory Sticker.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Sticker(
      ulid: serializer.fromJson<String>(json['ulid']),
      packUlid: serializer.fromJson<String>(json['packUlid']),
      emoji: serializer.fromJson<String?>(json['emoji']),
      url: serializer.fromJson<String>(json['url']),
      thumbnailUrl: serializer.fromJson<String?>(json['thumbnailUrl']),
      width: serializer.fromJson<int?>(json['width']),
      height: serializer.fromJson<int?>(json['height']),
      fileType: serializer.fromJson<String?>(json['fileType']),
      fileSize: serializer.fromJson<int?>(json['fileSize']),
      lastUsedAt: serializer.fromJson<int?>(json['lastUsedAt']),
      useCount: serializer.fromJson<int>(json['useCount']),
      localPath: serializer.fromJson<String?>(json['localPath']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'ulid': serializer.toJson<String>(ulid),
      'packUlid': serializer.toJson<String>(packUlid),
      'emoji': serializer.toJson<String?>(emoji),
      'url': serializer.toJson<String>(url),
      'thumbnailUrl': serializer.toJson<String?>(thumbnailUrl),
      'width': serializer.toJson<int?>(width),
      'height': serializer.toJson<int?>(height),
      'fileType': serializer.toJson<String?>(fileType),
      'fileSize': serializer.toJson<int?>(fileSize),
      'lastUsedAt': serializer.toJson<int?>(lastUsedAt),
      'useCount': serializer.toJson<int>(useCount),
      'localPath': serializer.toJson<String?>(localPath),
    };
  }

  Sticker copyWith({
    String? ulid,
    String? packUlid,
    Value<String?> emoji = const Value.absent(),
    String? url,
    Value<String?> thumbnailUrl = const Value.absent(),
    Value<int?> width = const Value.absent(),
    Value<int?> height = const Value.absent(),
    Value<String?> fileType = const Value.absent(),
    Value<int?> fileSize = const Value.absent(),
    Value<int?> lastUsedAt = const Value.absent(),
    int? useCount,
    Value<String?> localPath = const Value.absent(),
  }) => Sticker(
    ulid: ulid ?? this.ulid,
    packUlid: packUlid ?? this.packUlid,
    emoji: emoji.present ? emoji.value : this.emoji,
    url: url ?? this.url,
    thumbnailUrl: thumbnailUrl.present ? thumbnailUrl.value : this.thumbnailUrl,
    width: width.present ? width.value : this.width,
    height: height.present ? height.value : this.height,
    fileType: fileType.present ? fileType.value : this.fileType,
    fileSize: fileSize.present ? fileSize.value : this.fileSize,
    lastUsedAt: lastUsedAt.present ? lastUsedAt.value : this.lastUsedAt,
    useCount: useCount ?? this.useCount,
    localPath: localPath.present ? localPath.value : this.localPath,
  );
  Sticker copyWithCompanion(StickersCompanion data) {
    return Sticker(
      ulid: data.ulid.present ? data.ulid.value : this.ulid,
      packUlid: data.packUlid.present ? data.packUlid.value : this.packUlid,
      emoji: data.emoji.present ? data.emoji.value : this.emoji,
      url: data.url.present ? data.url.value : this.url,
      thumbnailUrl: data.thumbnailUrl.present
          ? data.thumbnailUrl.value
          : this.thumbnailUrl,
      width: data.width.present ? data.width.value : this.width,
      height: data.height.present ? data.height.value : this.height,
      fileType: data.fileType.present ? data.fileType.value : this.fileType,
      fileSize: data.fileSize.present ? data.fileSize.value : this.fileSize,
      lastUsedAt: data.lastUsedAt.present
          ? data.lastUsedAt.value
          : this.lastUsedAt,
      useCount: data.useCount.present ? data.useCount.value : this.useCount,
      localPath: data.localPath.present ? data.localPath.value : this.localPath,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Sticker(')
          ..write('ulid: $ulid, ')
          ..write('packUlid: $packUlid, ')
          ..write('emoji: $emoji, ')
          ..write('url: $url, ')
          ..write('thumbnailUrl: $thumbnailUrl, ')
          ..write('width: $width, ')
          ..write('height: $height, ')
          ..write('fileType: $fileType, ')
          ..write('fileSize: $fileSize, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('useCount: $useCount, ')
          ..write('localPath: $localPath')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    ulid,
    packUlid,
    emoji,
    url,
    thumbnailUrl,
    width,
    height,
    fileType,
    fileSize,
    lastUsedAt,
    useCount,
    localPath,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Sticker &&
          other.ulid == this.ulid &&
          other.packUlid == this.packUlid &&
          other.emoji == this.emoji &&
          other.url == this.url &&
          other.thumbnailUrl == this.thumbnailUrl &&
          other.width == this.width &&
          other.height == this.height &&
          other.fileType == this.fileType &&
          other.fileSize == this.fileSize &&
          other.lastUsedAt == this.lastUsedAt &&
          other.useCount == this.useCount &&
          other.localPath == this.localPath);
}

class StickersCompanion extends UpdateCompanion<Sticker> {
  final Value<String> ulid;
  final Value<String> packUlid;
  final Value<String?> emoji;
  final Value<String> url;
  final Value<String?> thumbnailUrl;
  final Value<int?> width;
  final Value<int?> height;
  final Value<String?> fileType;
  final Value<int?> fileSize;
  final Value<int?> lastUsedAt;
  final Value<int> useCount;
  final Value<String?> localPath;
  final Value<int> rowid;
  const StickersCompanion({
    this.ulid = const Value.absent(),
    this.packUlid = const Value.absent(),
    this.emoji = const Value.absent(),
    this.url = const Value.absent(),
    this.thumbnailUrl = const Value.absent(),
    this.width = const Value.absent(),
    this.height = const Value.absent(),
    this.fileType = const Value.absent(),
    this.fileSize = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.useCount = const Value.absent(),
    this.localPath = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  StickersCompanion.insert({
    required String ulid,
    required String packUlid,
    this.emoji = const Value.absent(),
    required String url,
    this.thumbnailUrl = const Value.absent(),
    this.width = const Value.absent(),
    this.height = const Value.absent(),
    this.fileType = const Value.absent(),
    this.fileSize = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.useCount = const Value.absent(),
    this.localPath = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : ulid = Value(ulid),
       packUlid = Value(packUlid),
       url = Value(url);
  static Insertable<Sticker> custom({
    Expression<String>? ulid,
    Expression<String>? packUlid,
    Expression<String>? emoji,
    Expression<String>? url,
    Expression<String>? thumbnailUrl,
    Expression<int>? width,
    Expression<int>? height,
    Expression<String>? fileType,
    Expression<int>? fileSize,
    Expression<int>? lastUsedAt,
    Expression<int>? useCount,
    Expression<String>? localPath,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (ulid != null) 'ulid': ulid,
      if (packUlid != null) 'pack_ulid': packUlid,
      if (emoji != null) 'emoji': emoji,
      if (url != null) 'url': url,
      if (thumbnailUrl != null) 'thumbnail_url': thumbnailUrl,
      if (width != null) 'width': width,
      if (height != null) 'height': height,
      if (fileType != null) 'file_type': fileType,
      if (fileSize != null) 'file_size': fileSize,
      if (lastUsedAt != null) 'last_used_at': lastUsedAt,
      if (useCount != null) 'use_count': useCount,
      if (localPath != null) 'local_path': localPath,
      if (rowid != null) 'rowid': rowid,
    });
  }

  StickersCompanion copyWith({
    Value<String>? ulid,
    Value<String>? packUlid,
    Value<String?>? emoji,
    Value<String>? url,
    Value<String?>? thumbnailUrl,
    Value<int?>? width,
    Value<int?>? height,
    Value<String?>? fileType,
    Value<int?>? fileSize,
    Value<int?>? lastUsedAt,
    Value<int>? useCount,
    Value<String?>? localPath,
    Value<int>? rowid,
  }) {
    return StickersCompanion(
      ulid: ulid ?? this.ulid,
      packUlid: packUlid ?? this.packUlid,
      emoji: emoji ?? this.emoji,
      url: url ?? this.url,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      width: width ?? this.width,
      height: height ?? this.height,
      fileType: fileType ?? this.fileType,
      fileSize: fileSize ?? this.fileSize,
      lastUsedAt: lastUsedAt ?? this.lastUsedAt,
      useCount: useCount ?? this.useCount,
      localPath: localPath ?? this.localPath,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (ulid.present) {
      map['ulid'] = Variable<String>(ulid.value);
    }
    if (packUlid.present) {
      map['pack_ulid'] = Variable<String>(packUlid.value);
    }
    if (emoji.present) {
      map['emoji'] = Variable<String>(emoji.value);
    }
    if (url.present) {
      map['url'] = Variable<String>(url.value);
    }
    if (thumbnailUrl.present) {
      map['thumbnail_url'] = Variable<String>(thumbnailUrl.value);
    }
    if (width.present) {
      map['width'] = Variable<int>(width.value);
    }
    if (height.present) {
      map['height'] = Variable<int>(height.value);
    }
    if (fileType.present) {
      map['file_type'] = Variable<String>(fileType.value);
    }
    if (fileSize.present) {
      map['file_size'] = Variable<int>(fileSize.value);
    }
    if (lastUsedAt.present) {
      map['last_used_at'] = Variable<int>(lastUsedAt.value);
    }
    if (useCount.present) {
      map['use_count'] = Variable<int>(useCount.value);
    }
    if (localPath.present) {
      map['local_path'] = Variable<String>(localPath.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('StickersCompanion(')
          ..write('ulid: $ulid, ')
          ..write('packUlid: $packUlid, ')
          ..write('emoji: $emoji, ')
          ..write('url: $url, ')
          ..write('thumbnailUrl: $thumbnailUrl, ')
          ..write('width: $width, ')
          ..write('height: $height, ')
          ..write('fileType: $fileType, ')
          ..write('fileSize: $fileSize, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('useCount: $useCount, ')
          ..write('localPath: $localPath, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$ChatDatabase extends GeneratedDatabase {
  _$ChatDatabase(QueryExecutor e) : super(e);
  $ChatDatabaseManager get managers => $ChatDatabaseManager(this);
  late final $SessionsTable sessions = $SessionsTable(this);
  late final $MessagesTable messages = $MessagesTable(this);
  late final $SyncMetaTable syncMeta = $SyncMetaTable(this);
  late final $GroupMembersTable groupMembers = $GroupMembersTable(this);
  late final $AnnouncementsTable announcements = $AnnouncementsTable(this);
  late final $StickerPacksTable stickerPacks = $StickerPacksTable(this);
  late final $StickersTable stickers = $StickersTable(this);
  late final SessionDao sessionDao = SessionDao(this as ChatDatabase);
  late final MessageDao messageDao = MessageDao(this as ChatDatabase);
  late final SyncMetaDao syncMetaDao = SyncMetaDao(this as ChatDatabase);
  late final GroupMemberDao groupMemberDao = GroupMemberDao(
    this as ChatDatabase,
  );
  late final AnnouncementDao announcementDao = AnnouncementDao(
    this as ChatDatabase,
  );
  late final StickerDao stickerDao = StickerDao(this as ChatDatabase);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    sessions,
    messages,
    syncMeta,
    groupMembers,
    announcements,
    stickerPacks,
    stickers,
  ];
}

typedef $$SessionsTableCreateCompanionBuilder =
    SessionsCompanion Function({
      required String id,
      required int type,
      required String targetId,
      Value<String?> topic,
      Value<String?> avatarUrl,
      Value<String?> lastMessageId,
      Value<int?> lastMessageAt,
      Value<String?> lastMessageSnippet,
      Value<int?> lastMessageType,
      Value<int> unreadCount,
      Value<bool> isPinned,
      Value<bool> isMuted,
      Value<int?> createdAt,
      Value<int?> updatedAt,
      Value<int> rowid,
    });
typedef $$SessionsTableUpdateCompanionBuilder =
    SessionsCompanion Function({
      Value<String> id,
      Value<int> type,
      Value<String> targetId,
      Value<String?> topic,
      Value<String?> avatarUrl,
      Value<String?> lastMessageId,
      Value<int?> lastMessageAt,
      Value<String?> lastMessageSnippet,
      Value<int?> lastMessageType,
      Value<int> unreadCount,
      Value<bool> isPinned,
      Value<bool> isMuted,
      Value<int?> createdAt,
      Value<int?> updatedAt,
      Value<int> rowid,
    });

class $$SessionsTableFilterComposer
    extends Composer<_$ChatDatabase, $SessionsTable> {
  $$SessionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get targetId => $composableBuilder(
    column: $table.targetId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get topic => $composableBuilder(
    column: $table.topic,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastMessageAt => $composableBuilder(
    column: $table.lastMessageAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastMessageSnippet => $composableBuilder(
    column: $table.lastMessageSnippet,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastMessageType => $composableBuilder(
    column: $table.lastMessageType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get unreadCount => $composableBuilder(
    column: $table.unreadCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isPinned => $composableBuilder(
    column: $table.isPinned,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isMuted => $composableBuilder(
    column: $table.isMuted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SessionsTableOrderingComposer
    extends Composer<_$ChatDatabase, $SessionsTable> {
  $$SessionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get targetId => $composableBuilder(
    column: $table.targetId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get topic => $composableBuilder(
    column: $table.topic,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastMessageAt => $composableBuilder(
    column: $table.lastMessageAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastMessageSnippet => $composableBuilder(
    column: $table.lastMessageSnippet,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastMessageType => $composableBuilder(
    column: $table.lastMessageType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get unreadCount => $composableBuilder(
    column: $table.unreadCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isPinned => $composableBuilder(
    column: $table.isPinned,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isMuted => $composableBuilder(
    column: $table.isMuted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SessionsTableAnnotationComposer
    extends Composer<_$ChatDatabase, $SessionsTable> {
  $$SessionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get targetId =>
      $composableBuilder(column: $table.targetId, builder: (column) => column);

  GeneratedColumn<String> get topic =>
      $composableBuilder(column: $table.topic, builder: (column) => column);

  GeneratedColumn<String> get avatarUrl =>
      $composableBuilder(column: $table.avatarUrl, builder: (column) => column);

  GeneratedColumn<String> get lastMessageId => $composableBuilder(
    column: $table.lastMessageId,
    builder: (column) => column,
  );

  GeneratedColumn<int> get lastMessageAt => $composableBuilder(
    column: $table.lastMessageAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastMessageSnippet => $composableBuilder(
    column: $table.lastMessageSnippet,
    builder: (column) => column,
  );

  GeneratedColumn<int> get lastMessageType => $composableBuilder(
    column: $table.lastMessageType,
    builder: (column) => column,
  );

  GeneratedColumn<int> get unreadCount => $composableBuilder(
    column: $table.unreadCount,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isPinned =>
      $composableBuilder(column: $table.isPinned, builder: (column) => column);

  GeneratedColumn<bool> get isMuted =>
      $composableBuilder(column: $table.isMuted, builder: (column) => column);

  GeneratedColumn<int> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$SessionsTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $SessionsTable,
          Session,
          $$SessionsTableFilterComposer,
          $$SessionsTableOrderingComposer,
          $$SessionsTableAnnotationComposer,
          $$SessionsTableCreateCompanionBuilder,
          $$SessionsTableUpdateCompanionBuilder,
          (Session, BaseReferences<_$ChatDatabase, $SessionsTable, Session>),
          Session,
          PrefetchHooks Function()
        > {
  $$SessionsTableTableManager(_$ChatDatabase db, $SessionsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SessionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SessionsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SessionsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<int> type = const Value.absent(),
                Value<String> targetId = const Value.absent(),
                Value<String?> topic = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> lastMessageId = const Value.absent(),
                Value<int?> lastMessageAt = const Value.absent(),
                Value<String?> lastMessageSnippet = const Value.absent(),
                Value<int?> lastMessageType = const Value.absent(),
                Value<int> unreadCount = const Value.absent(),
                Value<bool> isPinned = const Value.absent(),
                Value<bool> isMuted = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int?> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SessionsCompanion(
                id: id,
                type: type,
                targetId: targetId,
                topic: topic,
                avatarUrl: avatarUrl,
                lastMessageId: lastMessageId,
                lastMessageAt: lastMessageAt,
                lastMessageSnippet: lastMessageSnippet,
                lastMessageType: lastMessageType,
                unreadCount: unreadCount,
                isPinned: isPinned,
                isMuted: isMuted,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required int type,
                required String targetId,
                Value<String?> topic = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> lastMessageId = const Value.absent(),
                Value<int?> lastMessageAt = const Value.absent(),
                Value<String?> lastMessageSnippet = const Value.absent(),
                Value<int?> lastMessageType = const Value.absent(),
                Value<int> unreadCount = const Value.absent(),
                Value<bool> isPinned = const Value.absent(),
                Value<bool> isMuted = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int?> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SessionsCompanion.insert(
                id: id,
                type: type,
                targetId: targetId,
                topic: topic,
                avatarUrl: avatarUrl,
                lastMessageId: lastMessageId,
                lastMessageAt: lastMessageAt,
                lastMessageSnippet: lastMessageSnippet,
                lastMessageType: lastMessageType,
                unreadCount: unreadCount,
                isPinned: isPinned,
                isMuted: isMuted,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SessionsTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $SessionsTable,
      Session,
      $$SessionsTableFilterComposer,
      $$SessionsTableOrderingComposer,
      $$SessionsTableAnnotationComposer,
      $$SessionsTableCreateCompanionBuilder,
      $$SessionsTableUpdateCompanionBuilder,
      (Session, BaseReferences<_$ChatDatabase, $SessionsTable, Session>),
      Session,
      PrefetchHooks Function()
    >;
typedef $$MessagesTableCreateCompanionBuilder =
    MessagesCompanion Function({
      required String id,
      required String sessionId,
      required String senderId,
      required int type,
      Value<String?> content,
      Value<String?> encryptedContent,
      Value<String?> attachments,
      Value<String?> metadata,
      Value<String?> replyToId,
      Value<String?> mentionedIds,
      Value<bool> mentionAll,
      Value<int> status,
      Value<bool> isDeleted,
      Value<int?> deletedAt,
      required int sentAt,
      Value<int?> createdAt,
      Value<int> rowid,
    });
typedef $$MessagesTableUpdateCompanionBuilder =
    MessagesCompanion Function({
      Value<String> id,
      Value<String> sessionId,
      Value<String> senderId,
      Value<int> type,
      Value<String?> content,
      Value<String?> encryptedContent,
      Value<String?> attachments,
      Value<String?> metadata,
      Value<String?> replyToId,
      Value<String?> mentionedIds,
      Value<bool> mentionAll,
      Value<int> status,
      Value<bool> isDeleted,
      Value<int?> deletedAt,
      Value<int> sentAt,
      Value<int?> createdAt,
      Value<int> rowid,
    });

class $$MessagesTableFilterComposer
    extends Composer<_$ChatDatabase, $MessagesTable> {
  $$MessagesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get senderId => $composableBuilder(
    column: $table.senderId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get content => $composableBuilder(
    column: $table.content,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get encryptedContent => $composableBuilder(
    column: $table.encryptedContent,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get attachments => $composableBuilder(
    column: $table.attachments,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get metadata => $composableBuilder(
    column: $table.metadata,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get replyToId => $composableBuilder(
    column: $table.replyToId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mentionedIds => $composableBuilder(
    column: $table.mentionedIds,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get mentionAll => $composableBuilder(
    column: $table.mentionAll,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isDeleted => $composableBuilder(
    column: $table.isDeleted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deletedAt => $composableBuilder(
    column: $table.deletedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sentAt => $composableBuilder(
    column: $table.sentAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MessagesTableOrderingComposer
    extends Composer<_$ChatDatabase, $MessagesTable> {
  $$MessagesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get senderId => $composableBuilder(
    column: $table.senderId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get content => $composableBuilder(
    column: $table.content,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get encryptedContent => $composableBuilder(
    column: $table.encryptedContent,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get attachments => $composableBuilder(
    column: $table.attachments,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get metadata => $composableBuilder(
    column: $table.metadata,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get replyToId => $composableBuilder(
    column: $table.replyToId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mentionedIds => $composableBuilder(
    column: $table.mentionedIds,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get mentionAll => $composableBuilder(
    column: $table.mentionAll,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isDeleted => $composableBuilder(
    column: $table.isDeleted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deletedAt => $composableBuilder(
    column: $table.deletedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sentAt => $composableBuilder(
    column: $table.sentAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MessagesTableAnnotationComposer
    extends Composer<_$ChatDatabase, $MessagesTable> {
  $$MessagesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<String> get senderId =>
      $composableBuilder(column: $table.senderId, builder: (column) => column);

  GeneratedColumn<int> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get content =>
      $composableBuilder(column: $table.content, builder: (column) => column);

  GeneratedColumn<String> get encryptedContent => $composableBuilder(
    column: $table.encryptedContent,
    builder: (column) => column,
  );

  GeneratedColumn<String> get attachments => $composableBuilder(
    column: $table.attachments,
    builder: (column) => column,
  );

  GeneratedColumn<String> get metadata =>
      $composableBuilder(column: $table.metadata, builder: (column) => column);

  GeneratedColumn<String> get replyToId =>
      $composableBuilder(column: $table.replyToId, builder: (column) => column);

  GeneratedColumn<String> get mentionedIds => $composableBuilder(
    column: $table.mentionedIds,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get mentionAll => $composableBuilder(
    column: $table.mentionAll,
    builder: (column) => column,
  );

  GeneratedColumn<int> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<bool> get isDeleted =>
      $composableBuilder(column: $table.isDeleted, builder: (column) => column);

  GeneratedColumn<int> get deletedAt =>
      $composableBuilder(column: $table.deletedAt, builder: (column) => column);

  GeneratedColumn<int> get sentAt =>
      $composableBuilder(column: $table.sentAt, builder: (column) => column);

  GeneratedColumn<int> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$MessagesTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $MessagesTable,
          Message,
          $$MessagesTableFilterComposer,
          $$MessagesTableOrderingComposer,
          $$MessagesTableAnnotationComposer,
          $$MessagesTableCreateCompanionBuilder,
          $$MessagesTableUpdateCompanionBuilder,
          (Message, BaseReferences<_$ChatDatabase, $MessagesTable, Message>),
          Message,
          PrefetchHooks Function()
        > {
  $$MessagesTableTableManager(_$ChatDatabase db, $MessagesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MessagesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MessagesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MessagesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> sessionId = const Value.absent(),
                Value<String> senderId = const Value.absent(),
                Value<int> type = const Value.absent(),
                Value<String?> content = const Value.absent(),
                Value<String?> encryptedContent = const Value.absent(),
                Value<String?> attachments = const Value.absent(),
                Value<String?> metadata = const Value.absent(),
                Value<String?> replyToId = const Value.absent(),
                Value<String?> mentionedIds = const Value.absent(),
                Value<bool> mentionAll = const Value.absent(),
                Value<int> status = const Value.absent(),
                Value<bool> isDeleted = const Value.absent(),
                Value<int?> deletedAt = const Value.absent(),
                Value<int> sentAt = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MessagesCompanion(
                id: id,
                sessionId: sessionId,
                senderId: senderId,
                type: type,
                content: content,
                encryptedContent: encryptedContent,
                attachments: attachments,
                metadata: metadata,
                replyToId: replyToId,
                mentionedIds: mentionedIds,
                mentionAll: mentionAll,
                status: status,
                isDeleted: isDeleted,
                deletedAt: deletedAt,
                sentAt: sentAt,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String sessionId,
                required String senderId,
                required int type,
                Value<String?> content = const Value.absent(),
                Value<String?> encryptedContent = const Value.absent(),
                Value<String?> attachments = const Value.absent(),
                Value<String?> metadata = const Value.absent(),
                Value<String?> replyToId = const Value.absent(),
                Value<String?> mentionedIds = const Value.absent(),
                Value<bool> mentionAll = const Value.absent(),
                Value<int> status = const Value.absent(),
                Value<bool> isDeleted = const Value.absent(),
                Value<int?> deletedAt = const Value.absent(),
                required int sentAt,
                Value<int?> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MessagesCompanion.insert(
                id: id,
                sessionId: sessionId,
                senderId: senderId,
                type: type,
                content: content,
                encryptedContent: encryptedContent,
                attachments: attachments,
                metadata: metadata,
                replyToId: replyToId,
                mentionedIds: mentionedIds,
                mentionAll: mentionAll,
                status: status,
                isDeleted: isDeleted,
                deletedAt: deletedAt,
                sentAt: sentAt,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MessagesTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $MessagesTable,
      Message,
      $$MessagesTableFilterComposer,
      $$MessagesTableOrderingComposer,
      $$MessagesTableAnnotationComposer,
      $$MessagesTableCreateCompanionBuilder,
      $$MessagesTableUpdateCompanionBuilder,
      (Message, BaseReferences<_$ChatDatabase, $MessagesTable, Message>),
      Message,
      PrefetchHooks Function()
    >;
typedef $$SyncMetaTableCreateCompanionBuilder =
    SyncMetaCompanion Function({
      required String resourceType,
      required String resourceId,
      required int lastSyncAt,
      Value<String?> syncCursor,
      Value<String?> extra,
      Value<int> rowid,
    });
typedef $$SyncMetaTableUpdateCompanionBuilder =
    SyncMetaCompanion Function({
      Value<String> resourceType,
      Value<String> resourceId,
      Value<int> lastSyncAt,
      Value<String?> syncCursor,
      Value<String?> extra,
      Value<int> rowid,
    });

class $$SyncMetaTableFilterComposer
    extends Composer<_$ChatDatabase, $SyncMetaTable> {
  $$SyncMetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get resourceType => $composableBuilder(
    column: $table.resourceType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get resourceId => $composableBuilder(
    column: $table.resourceId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastSyncAt => $composableBuilder(
    column: $table.lastSyncAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get syncCursor => $composableBuilder(
    column: $table.syncCursor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get extra => $composableBuilder(
    column: $table.extra,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncMetaTableOrderingComposer
    extends Composer<_$ChatDatabase, $SyncMetaTable> {
  $$SyncMetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get resourceType => $composableBuilder(
    column: $table.resourceType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get resourceId => $composableBuilder(
    column: $table.resourceId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastSyncAt => $composableBuilder(
    column: $table.lastSyncAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get syncCursor => $composableBuilder(
    column: $table.syncCursor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get extra => $composableBuilder(
    column: $table.extra,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncMetaTableAnnotationComposer
    extends Composer<_$ChatDatabase, $SyncMetaTable> {
  $$SyncMetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get resourceType => $composableBuilder(
    column: $table.resourceType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get resourceId => $composableBuilder(
    column: $table.resourceId,
    builder: (column) => column,
  );

  GeneratedColumn<int> get lastSyncAt => $composableBuilder(
    column: $table.lastSyncAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get syncCursor => $composableBuilder(
    column: $table.syncCursor,
    builder: (column) => column,
  );

  GeneratedColumn<String> get extra =>
      $composableBuilder(column: $table.extra, builder: (column) => column);
}

class $$SyncMetaTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $SyncMetaTable,
          SyncMetaData,
          $$SyncMetaTableFilterComposer,
          $$SyncMetaTableOrderingComposer,
          $$SyncMetaTableAnnotationComposer,
          $$SyncMetaTableCreateCompanionBuilder,
          $$SyncMetaTableUpdateCompanionBuilder,
          (
            SyncMetaData,
            BaseReferences<_$ChatDatabase, $SyncMetaTable, SyncMetaData>,
          ),
          SyncMetaData,
          PrefetchHooks Function()
        > {
  $$SyncMetaTableTableManager(_$ChatDatabase db, $SyncMetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncMetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncMetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncMetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> resourceType = const Value.absent(),
                Value<String> resourceId = const Value.absent(),
                Value<int> lastSyncAt = const Value.absent(),
                Value<String?> syncCursor = const Value.absent(),
                Value<String?> extra = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncMetaCompanion(
                resourceType: resourceType,
                resourceId: resourceId,
                lastSyncAt: lastSyncAt,
                syncCursor: syncCursor,
                extra: extra,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String resourceType,
                required String resourceId,
                required int lastSyncAt,
                Value<String?> syncCursor = const Value.absent(),
                Value<String?> extra = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncMetaCompanion.insert(
                resourceType: resourceType,
                resourceId: resourceId,
                lastSyncAt: lastSyncAt,
                syncCursor: syncCursor,
                extra: extra,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncMetaTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $SyncMetaTable,
      SyncMetaData,
      $$SyncMetaTableFilterComposer,
      $$SyncMetaTableOrderingComposer,
      $$SyncMetaTableAnnotationComposer,
      $$SyncMetaTableCreateCompanionBuilder,
      $$SyncMetaTableUpdateCompanionBuilder,
      (
        SyncMetaData,
        BaseReferences<_$ChatDatabase, $SyncMetaTable, SyncMetaData>,
      ),
      SyncMetaData,
      PrefetchHooks Function()
    >;
typedef $$GroupMembersTableCreateCompanionBuilder =
    GroupMembersCompanion Function({
      required String groupId,
      required String actorId,
      required int role,
      Value<String?> nickname,
      Value<bool> isMuted,
      Value<int?> mutedUntil,
      Value<int?> joinedAt,
      Value<String?> avatarUrl,
      Value<String?> displayName,
      Value<int> rowid,
    });
typedef $$GroupMembersTableUpdateCompanionBuilder =
    GroupMembersCompanion Function({
      Value<String> groupId,
      Value<String> actorId,
      Value<int> role,
      Value<String?> nickname,
      Value<bool> isMuted,
      Value<int?> mutedUntil,
      Value<int?> joinedAt,
      Value<String?> avatarUrl,
      Value<String?> displayName,
      Value<int> rowid,
    });

class $$GroupMembersTableFilterComposer
    extends Composer<_$ChatDatabase, $GroupMembersTable> {
  $$GroupMembersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get groupId => $composableBuilder(
    column: $table.groupId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get actorId => $composableBuilder(
    column: $table.actorId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get role => $composableBuilder(
    column: $table.role,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get nickname => $composableBuilder(
    column: $table.nickname,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isMuted => $composableBuilder(
    column: $table.isMuted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get mutedUntil => $composableBuilder(
    column: $table.mutedUntil,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get joinedAt => $composableBuilder(
    column: $table.joinedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnFilters(column),
  );
}

class $$GroupMembersTableOrderingComposer
    extends Composer<_$ChatDatabase, $GroupMembersTable> {
  $$GroupMembersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get groupId => $composableBuilder(
    column: $table.groupId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get actorId => $composableBuilder(
    column: $table.actorId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get role => $composableBuilder(
    column: $table.role,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get nickname => $composableBuilder(
    column: $table.nickname,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isMuted => $composableBuilder(
    column: $table.isMuted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get mutedUntil => $composableBuilder(
    column: $table.mutedUntil,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get joinedAt => $composableBuilder(
    column: $table.joinedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get avatarUrl => $composableBuilder(
    column: $table.avatarUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$GroupMembersTableAnnotationComposer
    extends Composer<_$ChatDatabase, $GroupMembersTable> {
  $$GroupMembersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get groupId =>
      $composableBuilder(column: $table.groupId, builder: (column) => column);

  GeneratedColumn<String> get actorId =>
      $composableBuilder(column: $table.actorId, builder: (column) => column);

  GeneratedColumn<int> get role =>
      $composableBuilder(column: $table.role, builder: (column) => column);

  GeneratedColumn<String> get nickname =>
      $composableBuilder(column: $table.nickname, builder: (column) => column);

  GeneratedColumn<bool> get isMuted =>
      $composableBuilder(column: $table.isMuted, builder: (column) => column);

  GeneratedColumn<int> get mutedUntil => $composableBuilder(
    column: $table.mutedUntil,
    builder: (column) => column,
  );

  GeneratedColumn<int> get joinedAt =>
      $composableBuilder(column: $table.joinedAt, builder: (column) => column);

  GeneratedColumn<String> get avatarUrl =>
      $composableBuilder(column: $table.avatarUrl, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => column,
  );
}

class $$GroupMembersTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $GroupMembersTable,
          GroupMember,
          $$GroupMembersTableFilterComposer,
          $$GroupMembersTableOrderingComposer,
          $$GroupMembersTableAnnotationComposer,
          $$GroupMembersTableCreateCompanionBuilder,
          $$GroupMembersTableUpdateCompanionBuilder,
          (
            GroupMember,
            BaseReferences<_$ChatDatabase, $GroupMembersTable, GroupMember>,
          ),
          GroupMember,
          PrefetchHooks Function()
        > {
  $$GroupMembersTableTableManager(_$ChatDatabase db, $GroupMembersTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$GroupMembersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$GroupMembersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$GroupMembersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> groupId = const Value.absent(),
                Value<String> actorId = const Value.absent(),
                Value<int> role = const Value.absent(),
                Value<String?> nickname = const Value.absent(),
                Value<bool> isMuted = const Value.absent(),
                Value<int?> mutedUntil = const Value.absent(),
                Value<int?> joinedAt = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> displayName = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => GroupMembersCompanion(
                groupId: groupId,
                actorId: actorId,
                role: role,
                nickname: nickname,
                isMuted: isMuted,
                mutedUntil: mutedUntil,
                joinedAt: joinedAt,
                avatarUrl: avatarUrl,
                displayName: displayName,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String groupId,
                required String actorId,
                required int role,
                Value<String?> nickname = const Value.absent(),
                Value<bool> isMuted = const Value.absent(),
                Value<int?> mutedUntil = const Value.absent(),
                Value<int?> joinedAt = const Value.absent(),
                Value<String?> avatarUrl = const Value.absent(),
                Value<String?> displayName = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => GroupMembersCompanion.insert(
                groupId: groupId,
                actorId: actorId,
                role: role,
                nickname: nickname,
                isMuted: isMuted,
                mutedUntil: mutedUntil,
                joinedAt: joinedAt,
                avatarUrl: avatarUrl,
                displayName: displayName,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$GroupMembersTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $GroupMembersTable,
      GroupMember,
      $$GroupMembersTableFilterComposer,
      $$GroupMembersTableOrderingComposer,
      $$GroupMembersTableAnnotationComposer,
      $$GroupMembersTableCreateCompanionBuilder,
      $$GroupMembersTableUpdateCompanionBuilder,
      (
        GroupMember,
        BaseReferences<_$ChatDatabase, $GroupMembersTable, GroupMember>,
      ),
      GroupMember,
      PrefetchHooks Function()
    >;
typedef $$AnnouncementsTableCreateCompanionBuilder =
    AnnouncementsCompanion Function({
      required String ulid,
      required String groupUlid,
      required String authorDid,
      Value<String?> title,
      Value<String?> content,
      Value<bool> isPinned,
      Value<int> readCount,
      Value<int?> createdAt,
      Value<int?> updatedAt,
      Value<bool> isDeleted,
      Value<bool> isRead,
      Value<int> rowid,
    });
typedef $$AnnouncementsTableUpdateCompanionBuilder =
    AnnouncementsCompanion Function({
      Value<String> ulid,
      Value<String> groupUlid,
      Value<String> authorDid,
      Value<String?> title,
      Value<String?> content,
      Value<bool> isPinned,
      Value<int> readCount,
      Value<int?> createdAt,
      Value<int?> updatedAt,
      Value<bool> isDeleted,
      Value<bool> isRead,
      Value<int> rowid,
    });

class $$AnnouncementsTableFilterComposer
    extends Composer<_$ChatDatabase, $AnnouncementsTable> {
  $$AnnouncementsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get groupUlid => $composableBuilder(
    column: $table.groupUlid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get authorDid => $composableBuilder(
    column: $table.authorDid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get content => $composableBuilder(
    column: $table.content,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isPinned => $composableBuilder(
    column: $table.isPinned,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get readCount => $composableBuilder(
    column: $table.readCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isDeleted => $composableBuilder(
    column: $table.isDeleted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isRead => $composableBuilder(
    column: $table.isRead,
    builder: (column) => ColumnFilters(column),
  );
}

class $$AnnouncementsTableOrderingComposer
    extends Composer<_$ChatDatabase, $AnnouncementsTable> {
  $$AnnouncementsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get groupUlid => $composableBuilder(
    column: $table.groupUlid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get authorDid => $composableBuilder(
    column: $table.authorDid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get content => $composableBuilder(
    column: $table.content,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isPinned => $composableBuilder(
    column: $table.isPinned,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get readCount => $composableBuilder(
    column: $table.readCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isDeleted => $composableBuilder(
    column: $table.isDeleted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isRead => $composableBuilder(
    column: $table.isRead,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$AnnouncementsTableAnnotationComposer
    extends Composer<_$ChatDatabase, $AnnouncementsTable> {
  $$AnnouncementsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get ulid =>
      $composableBuilder(column: $table.ulid, builder: (column) => column);

  GeneratedColumn<String> get groupUlid =>
      $composableBuilder(column: $table.groupUlid, builder: (column) => column);

  GeneratedColumn<String> get authorDid =>
      $composableBuilder(column: $table.authorDid, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get content =>
      $composableBuilder(column: $table.content, builder: (column) => column);

  GeneratedColumn<bool> get isPinned =>
      $composableBuilder(column: $table.isPinned, builder: (column) => column);

  GeneratedColumn<int> get readCount =>
      $composableBuilder(column: $table.readCount, builder: (column) => column);

  GeneratedColumn<int> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  GeneratedColumn<bool> get isDeleted =>
      $composableBuilder(column: $table.isDeleted, builder: (column) => column);

  GeneratedColumn<bool> get isRead =>
      $composableBuilder(column: $table.isRead, builder: (column) => column);
}

class $$AnnouncementsTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $AnnouncementsTable,
          Announcement,
          $$AnnouncementsTableFilterComposer,
          $$AnnouncementsTableOrderingComposer,
          $$AnnouncementsTableAnnotationComposer,
          $$AnnouncementsTableCreateCompanionBuilder,
          $$AnnouncementsTableUpdateCompanionBuilder,
          (
            Announcement,
            BaseReferences<_$ChatDatabase, $AnnouncementsTable, Announcement>,
          ),
          Announcement,
          PrefetchHooks Function()
        > {
  $$AnnouncementsTableTableManager(_$ChatDatabase db, $AnnouncementsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AnnouncementsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AnnouncementsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AnnouncementsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> ulid = const Value.absent(),
                Value<String> groupUlid = const Value.absent(),
                Value<String> authorDid = const Value.absent(),
                Value<String?> title = const Value.absent(),
                Value<String?> content = const Value.absent(),
                Value<bool> isPinned = const Value.absent(),
                Value<int> readCount = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int?> updatedAt = const Value.absent(),
                Value<bool> isDeleted = const Value.absent(),
                Value<bool> isRead = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => AnnouncementsCompanion(
                ulid: ulid,
                groupUlid: groupUlid,
                authorDid: authorDid,
                title: title,
                content: content,
                isPinned: isPinned,
                readCount: readCount,
                createdAt: createdAt,
                updatedAt: updatedAt,
                isDeleted: isDeleted,
                isRead: isRead,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String ulid,
                required String groupUlid,
                required String authorDid,
                Value<String?> title = const Value.absent(),
                Value<String?> content = const Value.absent(),
                Value<bool> isPinned = const Value.absent(),
                Value<int> readCount = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int?> updatedAt = const Value.absent(),
                Value<bool> isDeleted = const Value.absent(),
                Value<bool> isRead = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => AnnouncementsCompanion.insert(
                ulid: ulid,
                groupUlid: groupUlid,
                authorDid: authorDid,
                title: title,
                content: content,
                isPinned: isPinned,
                readCount: readCount,
                createdAt: createdAt,
                updatedAt: updatedAt,
                isDeleted: isDeleted,
                isRead: isRead,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$AnnouncementsTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $AnnouncementsTable,
      Announcement,
      $$AnnouncementsTableFilterComposer,
      $$AnnouncementsTableOrderingComposer,
      $$AnnouncementsTableAnnotationComposer,
      $$AnnouncementsTableCreateCompanionBuilder,
      $$AnnouncementsTableUpdateCompanionBuilder,
      (
        Announcement,
        BaseReferences<_$ChatDatabase, $AnnouncementsTable, Announcement>,
      ),
      Announcement,
      PrefetchHooks Function()
    >;
typedef $$StickerPacksTableCreateCompanionBuilder =
    StickerPacksCompanion Function({
      required String ulid,
      required String name,
      Value<String?> author,
      Value<String?> description,
      Value<String?> coverUrl,
      Value<bool> isOfficial,
      Value<bool> isAnimated,
      Value<bool> isCollected,
      Value<int> sortOrder,
      Value<int> stickerCount,
      Value<int?> createdAt,
      Value<int> rowid,
    });
typedef $$StickerPacksTableUpdateCompanionBuilder =
    StickerPacksCompanion Function({
      Value<String> ulid,
      Value<String> name,
      Value<String?> author,
      Value<String?> description,
      Value<String?> coverUrl,
      Value<bool> isOfficial,
      Value<bool> isAnimated,
      Value<bool> isCollected,
      Value<int> sortOrder,
      Value<int> stickerCount,
      Value<int?> createdAt,
      Value<int> rowid,
    });

class $$StickerPacksTableFilterComposer
    extends Composer<_$ChatDatabase, $StickerPacksTable> {
  $$StickerPacksTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get author => $composableBuilder(
    column: $table.author,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get coverUrl => $composableBuilder(
    column: $table.coverUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isOfficial => $composableBuilder(
    column: $table.isOfficial,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isAnimated => $composableBuilder(
    column: $table.isAnimated,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isCollected => $composableBuilder(
    column: $table.isCollected,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get stickerCount => $composableBuilder(
    column: $table.stickerCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$StickerPacksTableOrderingComposer
    extends Composer<_$ChatDatabase, $StickerPacksTable> {
  $$StickerPacksTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get author => $composableBuilder(
    column: $table.author,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get coverUrl => $composableBuilder(
    column: $table.coverUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isOfficial => $composableBuilder(
    column: $table.isOfficial,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isAnimated => $composableBuilder(
    column: $table.isAnimated,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isCollected => $composableBuilder(
    column: $table.isCollected,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get stickerCount => $composableBuilder(
    column: $table.stickerCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$StickerPacksTableAnnotationComposer
    extends Composer<_$ChatDatabase, $StickerPacksTable> {
  $$StickerPacksTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get ulid =>
      $composableBuilder(column: $table.ulid, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get author =>
      $composableBuilder(column: $table.author, builder: (column) => column);

  GeneratedColumn<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => column,
  );

  GeneratedColumn<String> get coverUrl =>
      $composableBuilder(column: $table.coverUrl, builder: (column) => column);

  GeneratedColumn<bool> get isOfficial => $composableBuilder(
    column: $table.isOfficial,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isAnimated => $composableBuilder(
    column: $table.isAnimated,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isCollected => $composableBuilder(
    column: $table.isCollected,
    builder: (column) => column,
  );

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);

  GeneratedColumn<int> get stickerCount => $composableBuilder(
    column: $table.stickerCount,
    builder: (column) => column,
  );

  GeneratedColumn<int> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$StickerPacksTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $StickerPacksTable,
          StickerPack,
          $$StickerPacksTableFilterComposer,
          $$StickerPacksTableOrderingComposer,
          $$StickerPacksTableAnnotationComposer,
          $$StickerPacksTableCreateCompanionBuilder,
          $$StickerPacksTableUpdateCompanionBuilder,
          (
            StickerPack,
            BaseReferences<_$ChatDatabase, $StickerPacksTable, StickerPack>,
          ),
          StickerPack,
          PrefetchHooks Function()
        > {
  $$StickerPacksTableTableManager(_$ChatDatabase db, $StickerPacksTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$StickerPacksTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$StickerPacksTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$StickerPacksTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> ulid = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String?> author = const Value.absent(),
                Value<String?> description = const Value.absent(),
                Value<String?> coverUrl = const Value.absent(),
                Value<bool> isOfficial = const Value.absent(),
                Value<bool> isAnimated = const Value.absent(),
                Value<bool> isCollected = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> stickerCount = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StickerPacksCompanion(
                ulid: ulid,
                name: name,
                author: author,
                description: description,
                coverUrl: coverUrl,
                isOfficial: isOfficial,
                isAnimated: isAnimated,
                isCollected: isCollected,
                sortOrder: sortOrder,
                stickerCount: stickerCount,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String ulid,
                required String name,
                Value<String?> author = const Value.absent(),
                Value<String?> description = const Value.absent(),
                Value<String?> coverUrl = const Value.absent(),
                Value<bool> isOfficial = const Value.absent(),
                Value<bool> isAnimated = const Value.absent(),
                Value<bool> isCollected = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> stickerCount = const Value.absent(),
                Value<int?> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StickerPacksCompanion.insert(
                ulid: ulid,
                name: name,
                author: author,
                description: description,
                coverUrl: coverUrl,
                isOfficial: isOfficial,
                isAnimated: isAnimated,
                isCollected: isCollected,
                sortOrder: sortOrder,
                stickerCount: stickerCount,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$StickerPacksTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $StickerPacksTable,
      StickerPack,
      $$StickerPacksTableFilterComposer,
      $$StickerPacksTableOrderingComposer,
      $$StickerPacksTableAnnotationComposer,
      $$StickerPacksTableCreateCompanionBuilder,
      $$StickerPacksTableUpdateCompanionBuilder,
      (
        StickerPack,
        BaseReferences<_$ChatDatabase, $StickerPacksTable, StickerPack>,
      ),
      StickerPack,
      PrefetchHooks Function()
    >;
typedef $$StickersTableCreateCompanionBuilder =
    StickersCompanion Function({
      required String ulid,
      required String packUlid,
      Value<String?> emoji,
      required String url,
      Value<String?> thumbnailUrl,
      Value<int?> width,
      Value<int?> height,
      Value<String?> fileType,
      Value<int?> fileSize,
      Value<int?> lastUsedAt,
      Value<int> useCount,
      Value<String?> localPath,
      Value<int> rowid,
    });
typedef $$StickersTableUpdateCompanionBuilder =
    StickersCompanion Function({
      Value<String> ulid,
      Value<String> packUlid,
      Value<String?> emoji,
      Value<String> url,
      Value<String?> thumbnailUrl,
      Value<int?> width,
      Value<int?> height,
      Value<String?> fileType,
      Value<int?> fileSize,
      Value<int?> lastUsedAt,
      Value<int> useCount,
      Value<String?> localPath,
      Value<int> rowid,
    });

class $$StickersTableFilterComposer
    extends Composer<_$ChatDatabase, $StickersTable> {
  $$StickersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get packUlid => $composableBuilder(
    column: $table.packUlid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get emoji => $composableBuilder(
    column: $table.emoji,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get url => $composableBuilder(
    column: $table.url,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get thumbnailUrl => $composableBuilder(
    column: $table.thumbnailUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get width => $composableBuilder(
    column: $table.width,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get height => $composableBuilder(
    column: $table.height,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get fileType => $composableBuilder(
    column: $table.fileType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get fileSize => $composableBuilder(
    column: $table.fileSize,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastUsedAt => $composableBuilder(
    column: $table.lastUsedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get useCount => $composableBuilder(
    column: $table.useCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get localPath => $composableBuilder(
    column: $table.localPath,
    builder: (column) => ColumnFilters(column),
  );
}

class $$StickersTableOrderingComposer
    extends Composer<_$ChatDatabase, $StickersTable> {
  $$StickersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get ulid => $composableBuilder(
    column: $table.ulid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get packUlid => $composableBuilder(
    column: $table.packUlid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get emoji => $composableBuilder(
    column: $table.emoji,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get url => $composableBuilder(
    column: $table.url,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get thumbnailUrl => $composableBuilder(
    column: $table.thumbnailUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get width => $composableBuilder(
    column: $table.width,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get height => $composableBuilder(
    column: $table.height,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get fileType => $composableBuilder(
    column: $table.fileType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get fileSize => $composableBuilder(
    column: $table.fileSize,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastUsedAt => $composableBuilder(
    column: $table.lastUsedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get useCount => $composableBuilder(
    column: $table.useCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get localPath => $composableBuilder(
    column: $table.localPath,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$StickersTableAnnotationComposer
    extends Composer<_$ChatDatabase, $StickersTable> {
  $$StickersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get ulid =>
      $composableBuilder(column: $table.ulid, builder: (column) => column);

  GeneratedColumn<String> get packUlid =>
      $composableBuilder(column: $table.packUlid, builder: (column) => column);

  GeneratedColumn<String> get emoji =>
      $composableBuilder(column: $table.emoji, builder: (column) => column);

  GeneratedColumn<String> get url =>
      $composableBuilder(column: $table.url, builder: (column) => column);

  GeneratedColumn<String> get thumbnailUrl => $composableBuilder(
    column: $table.thumbnailUrl,
    builder: (column) => column,
  );

  GeneratedColumn<int> get width =>
      $composableBuilder(column: $table.width, builder: (column) => column);

  GeneratedColumn<int> get height =>
      $composableBuilder(column: $table.height, builder: (column) => column);

  GeneratedColumn<String> get fileType =>
      $composableBuilder(column: $table.fileType, builder: (column) => column);

  GeneratedColumn<int> get fileSize =>
      $composableBuilder(column: $table.fileSize, builder: (column) => column);

  GeneratedColumn<int> get lastUsedAt => $composableBuilder(
    column: $table.lastUsedAt,
    builder: (column) => column,
  );

  GeneratedColumn<int> get useCount =>
      $composableBuilder(column: $table.useCount, builder: (column) => column);

  GeneratedColumn<String> get localPath =>
      $composableBuilder(column: $table.localPath, builder: (column) => column);
}

class $$StickersTableTableManager
    extends
        RootTableManager<
          _$ChatDatabase,
          $StickersTable,
          Sticker,
          $$StickersTableFilterComposer,
          $$StickersTableOrderingComposer,
          $$StickersTableAnnotationComposer,
          $$StickersTableCreateCompanionBuilder,
          $$StickersTableUpdateCompanionBuilder,
          (Sticker, BaseReferences<_$ChatDatabase, $StickersTable, Sticker>),
          Sticker,
          PrefetchHooks Function()
        > {
  $$StickersTableTableManager(_$ChatDatabase db, $StickersTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$StickersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$StickersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$StickersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> ulid = const Value.absent(),
                Value<String> packUlid = const Value.absent(),
                Value<String?> emoji = const Value.absent(),
                Value<String> url = const Value.absent(),
                Value<String?> thumbnailUrl = const Value.absent(),
                Value<int?> width = const Value.absent(),
                Value<int?> height = const Value.absent(),
                Value<String?> fileType = const Value.absent(),
                Value<int?> fileSize = const Value.absent(),
                Value<int?> lastUsedAt = const Value.absent(),
                Value<int> useCount = const Value.absent(),
                Value<String?> localPath = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StickersCompanion(
                ulid: ulid,
                packUlid: packUlid,
                emoji: emoji,
                url: url,
                thumbnailUrl: thumbnailUrl,
                width: width,
                height: height,
                fileType: fileType,
                fileSize: fileSize,
                lastUsedAt: lastUsedAt,
                useCount: useCount,
                localPath: localPath,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String ulid,
                required String packUlid,
                Value<String?> emoji = const Value.absent(),
                required String url,
                Value<String?> thumbnailUrl = const Value.absent(),
                Value<int?> width = const Value.absent(),
                Value<int?> height = const Value.absent(),
                Value<String?> fileType = const Value.absent(),
                Value<int?> fileSize = const Value.absent(),
                Value<int?> lastUsedAt = const Value.absent(),
                Value<int> useCount = const Value.absent(),
                Value<String?> localPath = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StickersCompanion.insert(
                ulid: ulid,
                packUlid: packUlid,
                emoji: emoji,
                url: url,
                thumbnailUrl: thumbnailUrl,
                width: width,
                height: height,
                fileType: fileType,
                fileSize: fileSize,
                lastUsedAt: lastUsedAt,
                useCount: useCount,
                localPath: localPath,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$StickersTableProcessedTableManager =
    ProcessedTableManager<
      _$ChatDatabase,
      $StickersTable,
      Sticker,
      $$StickersTableFilterComposer,
      $$StickersTableOrderingComposer,
      $$StickersTableAnnotationComposer,
      $$StickersTableCreateCompanionBuilder,
      $$StickersTableUpdateCompanionBuilder,
      (Sticker, BaseReferences<_$ChatDatabase, $StickersTable, Sticker>),
      Sticker,
      PrefetchHooks Function()
    >;

class $ChatDatabaseManager {
  final _$ChatDatabase _db;
  $ChatDatabaseManager(this._db);
  $$SessionsTableTableManager get sessions =>
      $$SessionsTableTableManager(_db, _db.sessions);
  $$MessagesTableTableManager get messages =>
      $$MessagesTableTableManager(_db, _db.messages);
  $$SyncMetaTableTableManager get syncMeta =>
      $$SyncMetaTableTableManager(_db, _db.syncMeta);
  $$GroupMembersTableTableManager get groupMembers =>
      $$GroupMembersTableTableManager(_db, _db.groupMembers);
  $$AnnouncementsTableTableManager get announcements =>
      $$AnnouncementsTableTableManager(_db, _db.announcements);
  $$StickerPacksTableTableManager get stickerPacks =>
      $$StickerPacksTableTableManager(_db, _db.stickerPacks);
  $$StickersTableTableManager get stickers =>
      $$StickersTableTableManager(_db, _db.stickers);
}
