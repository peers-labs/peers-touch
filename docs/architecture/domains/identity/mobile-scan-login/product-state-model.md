# Mobile Scan Login — Visible States

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

## Desktop

- `preparing`：准备可达连接材料；可关闭，不能展示占位假码。
- `waiting_for_scan`：展示有效码及目标身份；可关闭/刷新。
- `review_device`：设备列表与核对码；可选择/批准/拒绝，不能自动批准。
- `waiting_for_phone`：已批准，等手机保存并完成Station准入；可取消未提交事务。
- `completed`：Station已提交且Mobile读回；可查看设备、添加另一台设备或关闭。
  新增设备生成新offer，已完成授权及已有设备保持有效。
- `expired/cancelled/unavailable`：原区域显示明确原因和恢复操作。

## Mobile

- `camera_permission`：请求权限；拒绝可进系统设置或返回原登录，不循环弹权限。
- `scanning`：本地识别；可关闭，不生成后台重复申请。
- `checking_station`：校验当前连接和root；可取消，不能显示“已连接”缓存状态。
- `waiting_for_desktop`：显示目标身份与核对码；可取消，不可进入Shell。
- `access_action_required`：在原Gate Host完成Station要求；可返回/取消。
- `securing_account`：安全保存与确认；失败可重试，不可假成功。
- `completed`：现行session/device已激活，原runtime就绪，进入Shell。
- `expired/rejected/offline/storage_failed/identity_conflict`：本地可理解文案、
  原scope恢复动作；不得退回无上下文的空白登录页。
- `switch_account`：明确本机账号切换影响；取消保留当前账号/会话。
- `device_session_conflict/device_limit`：本设备Session或明确设备策略阻断；
  可重新认证/管理设备，其他手机登录本身不构成冲突。

Desktop批准、Mobile存储完成、线路连通都不是独立终态成功。
后台/断网保留受限恢复材料但不保留“在线”状态；恢复重新校验与读取。
所有UI状态来自runtime投影，Station事务revision排除旧事件覆盖新状态。
