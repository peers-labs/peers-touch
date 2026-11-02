/**
 * MobileFrame — 手机原型 tab.
 *
 * Embeds the real MobilePrototype (packages/prototypes/mobile/chat) inside a
 * device frame, so Frontend Eles owns both platform training grounds. The
 * mobile surface still consumes antd directly: that is registered framework
 * debt (see 设计理念), not permission for new prototypes to skip peers-ui.
 */
import { Suspense, lazy } from 'react';

const MobilePrototype = lazy(async () => import('@peers-touch/prototype-mobile-chat'));

export function MobileFrame() {
  return (
    <div className="nb-shell" data-nb="mobile">
      <header className="nb-head">
        <div>
          <span className="nb-overline">PEERS / MOBILE PROTOTYPE</span>
          <h1>手机原型</h1>
          <p>
            真实手机产品面：启动站选择、准入链、会话/动态/联系人/我的。当前直接使用 antd，
            <strong>属于已登记债务</strong>：后续按自训练宪章逐面回迁 peers-ui，新控件一律先入库。
          </p>
        </div>
      </header>
      <div className="nb-phone-wrap">
        <div className="nb-phone" data-phone-frame>
          <div className="nb-phone-screen">
            <div className="nb-phone-body" data-phone-body>
              <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: '#7e8d85' }}>载入手机原型…</div>}>
                <MobilePrototype />
              </Suspense>
            </div>
          </div>
        </div>
        <aside className="nb-phone-side">
          <section className="nb-section">
            <header className="nb-section-head"><h2>回迁状态</h2></header>
            <div className="nb-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="nb-status" data-status="ok">pine 语法 · peers-ui</span>
              <p className="nb-card-note" style={{ margin: 0 }}>
                与桌面北极星共用同一套 @peers-touch/ui 与 northStarVariables；
                呈现层禁止 antd/lucide 直引，手机组合件（底部动作面板、全屏线程、64px 列表密度）由 scripts/check-layout.mjs 机器门守护。
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
