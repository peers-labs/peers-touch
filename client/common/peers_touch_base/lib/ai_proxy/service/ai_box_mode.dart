/// AI Box 服务模式枚举
enum AiBoxMode {
  /// 本地模式，所有数据存储在本地，不与服务器同步
  local,

  /// 远程模式，数据与服务器同步，并具备本地回退能力
  remote,
}
