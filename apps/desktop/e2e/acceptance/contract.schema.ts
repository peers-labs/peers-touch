/**
 * Acceptance Module Injection Protocol
 *
 * ═══════════════════════════════════════════════════════════════
 * Driver: Tauri official `tauri-driver` (WebDriver protocol)
 *         + WebdriverIO as the client library
 * ═══════════════════════════════════════════════════════════════
 *
 * 每个模块的 acceptance 由两个文件组成：
 *
 *   <module>.contract.ts  — 声明式：告诉 agent 这个模块测什么、依赖什么、怎么准备
 *   <module>.spec.ts      — 可执行：WebdriverIO 测试代码
 *
 * Contract 是文档，spec 是代码。Contract 指导 agent 理解模块；
 * spec 通过统一的 runner 结构注入模块特定逻辑。
 *
 * ═══════════════════════════════════════════════════════════════
 * Infrastructure:
 *
 *   tauri-driver          — 启动 WebDriver server (port 4444)
 *   WebdriverIO           — 连接 WebDriver, 操作 WebView DOM
 *   Gateway HTTP API      — 后端操作 (login, send message, etc.)
 *
 * WebdriverIO 用于 UI 层验证 (DOM selector, navigation, visible state)
 * Gateway 用于后端操作 (auth, messaging commands)
 * 两者配合完成完整 E2E。
 * ═══════════════════════════════════════════════════════════════
 *
 * Agent 新增模块时的注入清单：
 *
 * 1. 创建 <module>.contract.ts
 *    - 填写 ModuleContract 类型（声明式，不可执行）
 *    - 描述 depends、setup steps (human-readable)、matrix
 *
 * 2. 创建 <module>.spec.ts
 *    - import helpers from './helpers'
 *    - beforeAll: run depends + module-specific setup
 *    - each matrix point = one test case
 *
 * 3. 如果新模块需要新的 gateway command 包装，更新 helpers.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * Spec 统一结构（注入模板）：
 * ═══════════════════════════════════════════════════════════════
 *
 * ```ts
 * import { browser, $ } from '@wdio/globals';
 * import { gateway } from './helpers';
 * import { MODULE_CONTRACT } from './<module>.contract';
 *
 * describe(MODULE_CONTRACT.module, () => {
 *   before(async () => {
 *     // 1. ensure dependencies (login etc.)
 *     // 2. module-specific data setup
 *   });
 *
 *   it(MODULE_CONTRACT.matrix[0].name, async () => {
 *     // action + passCondition as WebdriverIO code
 *   });
 * });
 * ```
 *
 * ═══════════════════════════════════════════════════════════════
 * Helpers (共享工具)：
 *   - gateway(cmd, args)          — 调本地 gateway
 *   - peerGateway(cmd, args)      — 调对端 gateway
 *   - login(account)              — 自适应 login (restore or fresh)
 *   - waitForAuth()               — $('[data-pt-primary-nav]').waitForExist()
 *   - ensureEnrolled(account)     — messaging_debug check
 *   - sendMessage / drain / etc.  — messaging helpers
 * ═══════════════════════════════════════════════════════════════
 */

export type ClientMode = 'single' | 'dual';

export interface VerificationPoint {
  id: string;
  name: string;
  clientMode: ClientMode;
  action: string;
  passCondition: string;
}

export interface ModuleContract {
  module: string;
  description: string;
  depends: string[];

  runtime: {
    clientMode: ClientMode;
    accounts?: Record<string, { account: string; role: string }>;
  };

  /**
   * Human-readable setup description.
   * Agent reads this to understand what the spec's beforeAll does.
   * NOT executable — the spec implements it.
   */
  setup: string[];

  entryRoute: string;
  readySelector: string;

  matrix: VerificationPoint[];
}
