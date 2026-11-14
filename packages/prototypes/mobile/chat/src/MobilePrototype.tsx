/**
 * MobilePrototype — evidence host for the ONE mobile product surface.
 *
 * There is no second phone UI here: this host only mounts the real product
 * (`MobileApp`) inside a device frame and injects a scenario as its initial
 * AppState. Controlled evidence is a matter of STATE, never a parallel skin
 * (the historical antd-era MobileShell / pages / English demo seeds are
 * deleted). Scenario controls live outside the device.
 *
 * URL contract is preserved: `?scenario=<id>` deep-links a scenario for the
 * acceptance scripts.
 */
import { useEffect, useState } from 'react';
import { northStarVariables, Select, UIProvider } from '@peers-touch/ui';
import { MobileApp } from './MobileApp';
import type { ProductScenario } from './app/model';
import './mobilePrototype.css';

interface ScenarioOption { value: ProductScenario; label: string; scene: string }

const SCENARIOS: ScenarioOption[] = [
  { value: 'default', label: '产品默认（消息）', scene: 'Shell / Chats' },
  { value: 'journey', label: '首启 · 站点选择 / 门禁登录', scene: 'Launch' },
  { value: 'station-offline', label: '首启 · 站点离线', scene: 'Launch / Offline' },
  { value: 'gate-login', label: '门禁 · 邮箱+OAuth 登录', scene: 'Gate / Login' },
  { value: 'gate-login-email', label: '门禁 · 仅邮箱登录', scene: 'Gate / Email' },
  { value: 'gate-login-oauth', label: '门禁 · 仅 OAuth 登录', scene: 'Gate / OAuth' },
  { value: 'gate-invite', label: '门禁 · 邀请码 → 登录链', scene: 'Gate / Invite' },
  { value: 'gate-terms', label: '门禁 · 条款确认表单', scene: 'Gate / Schema' },
  { value: 'gate-custom', label: '门禁 · 自定义 Station 表单', scene: 'Gate / Custom' },
  { value: 'gate-unavailable', label: '门禁 · 不支持的设备审批', scene: 'Gate / Unavailable' },
  { value: 'gate-blocked', label: '门禁 · 禁止进入', scene: 'Gate / Blocked' },
  { value: 'gate-failed', label: '门禁 · 门禁失败', scene: 'Gate / Failed' },
  { value: 'gate-pending', label: '门禁 · 评估中', scene: 'Gate / Pending' },
  { value: 'gate-session-expired', label: '门禁 · 会话过期重登', scene: 'Gate / Re-auth' },
  { value: 'gate-login-failed', label: '门禁 · 登录错误态', scene: 'Gate / Login error' },
  { value: 'gate-oauth-progress', label: '门禁 · OAuth 进行中', scene: 'Gate / OAuth progress' },
  { value: 'gate-oauth-failed', label: '门禁 · OAuth 失败恢复', scene: 'Gate / OAuth failed' },
  { value: 'long-content', label: '长消息 · 标题省略 / 不溢出', scene: 'Shell / Thread' },
  { value: 'long-lists', label: '长列表 · 240 会话/联系人 · 480 消息', scene: 'Shell / Long lists' },
];

function resolveScenario(): ProductScenario {
  const requested = new URLSearchParams(window.location.search).get('scenario');
  // Legacy harness scenario ids map onto product state scenarios; unknown
  // ids fall back to the normal product surface rather than a second skin.
  const legacy: Record<string, ProductScenario> = {
    journey: 'journey',
    'station-removal': 'journey',
    'session-revoked': 'journey',
    'station-offline': 'station-offline',
    'long-lists': 'long-lists',
    'search-controlled': 'long-lists',
    'long-content': 'long-content',
  };
  const known = SCENARIOS.some(s => s.value === requested);
  if (known) return requested as ProductScenario;
  if (requested && legacy[requested]) return legacy[requested];
  return 'default';
}

export function MobilePrototype() {
  const [scenario, setScenario] = useState<ProductScenario>(resolveScenario);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', scenario);
    window.history.replaceState(null, '', url);
  }, [scenario]);

  const meta = SCENARIOS.find(s => s.value === scenario) ?? SCENARIOS[0];

  return (
    <UIProvider theme="light" style={northStarVariables('light')}>
      <div className="mp-workbench">
        <div className="mp-evidence-toolbar">
          <span>Scenario</span>
          <Select
            aria-label="Evidence scenario"
            value={scenario}
            options={SCENARIOS.map(s => ({ value: s.value, label: s.label }))}
            onValueChange={value => setScenario((Array.isArray(value) ? value[0] : value) as ProductScenario)}
          />
        </div>
        <div className="mp-scene-label">
          <span>1. {meta.scene}</span>
        </div>

        <div className="mp-device" role="region" aria-label="Mobile device preview">
          <div className="mp-device-screen">
            {/* key remounts the product per scenario so injected state resets. */}
            <MobileApp key={scenario} scenario={scenario} />
          </div>
        </div>
      </div>
    </UIProvider>
  );
}

export default MobilePrototype;
