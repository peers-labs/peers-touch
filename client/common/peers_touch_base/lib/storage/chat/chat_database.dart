import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/daos/announcement_dao.dart';
import 'package:peers_touch_base/storage/chat/daos/group_member_dao.dart';
import 'package:peers_touch_base/storage/chat/daos/message_dao.dart';
import 'package:peers_touch_base/storage/chat/daos/session_dao.dart';
import 'package:peers_touch_base/storage/chat/daos/sticker_dao.dart';
import 'package:peers_touch_base/storage/chat/daos/sync_meta_dao.dart';
import 'package:peers_touch_base/storage/chat/tables/announcements_table.dart';
import 'package:peers_touch_base/storage/chat/tables/group_members_table.dart';
import 'package:peers_touch_base/storage/chat/tables/messages_table.dart';
import 'package:peers_touch_base/storage/chat/tables/sessions_table.dart';
import 'package:peers_touch_base/storage/chat/tables/sticker_packs_table.dart';
import 'package:peers_touch_base/storage/chat/tables/sync_meta_table.dart';
import 'package:peers_touch_base/storage/connection/connection.dart';

part 'chat_database.g.dart';

/// 聊天数据库
///
/// 存储会话、消息、群成员、公告、贴纸等数据。
/// 每个用户有独立的数据库实例。
@DriftDatabase(
  tables: [
    Sessions,
    Messages,
    SyncMeta,
    GroupMembers,
    Announcements,
    StickerPacks,
    Stickers,
  ],
  daos: [
    SessionDao,
    MessageDao,
    SyncMetaDao,
    GroupMemberDao,
    AnnouncementDao,
    StickerDao,
  ],
)
class ChatDatabase extends _$ChatDatabase {
  ChatDatabase._(super.e);

  /// 创建用户专属的聊天数据库实例
  factory ChatDatabase.forUser(String userHandle) {
    return ChatDatabase._(openConnection('chat.db', userHandle: userHandle));
  }

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration {
    return MigrationStrategy(
      onCreate: (Migrator m) async {
        await m.createAll();
        // 创建索引
        await customStatement('''
          CREATE INDEX IF NOT EXISTS idx_messages_session 
          ON messages(session_id, sent_at DESC)
        ''');
        await customStatement('''
          CREATE INDEX IF NOT EXISTS idx_messages_reply 
          ON messages(reply_to_id)
        ''');
        await customStatement('''
          CREATE INDEX IF NOT EXISTS idx_sessions_last_msg 
          ON sessions(is_pinned DESC, last_message_at DESC)
        ''');
        await customStatement('''
          CREATE INDEX IF NOT EXISTS idx_stickers_recent 
          ON stickers(last_used_at DESC)
        ''');
        await customStatement('''
          CREATE INDEX IF NOT EXISTS idx_announcements_group 
          ON announcements(group_ulid, created_at DESC)
        ''');
      },
      onUpgrade: (Migrator m, int from, int to) async {
        // 后续版本升级在这里处理
      },
    );
  }

  /// 清空所有数据（用于登出）
  Future<void> clearAllData() async {
    await transaction(() async {
      await delete(stickers).go();
      await delete(stickerPacks).go();
      await delete(announcements).go();
      await delete(groupMembers).go();
      await delete(messages).go();
      await delete(sessions).go();
      await delete(syncMeta).go();
    });
  }
}
