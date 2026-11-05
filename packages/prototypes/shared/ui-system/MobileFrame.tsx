/**
 * MobileFrame — 手机原型 tab.
 *
 * Two views of the same platform surface:
 *  - 产品面 (default): the clean MobileApp — real Chinese product screens
 *    built on the latest @peers-touch/ui grammar.
 *  - 取证台: MobilePrototype — scenario injection and controlled failure
 *    states for acceptance evidence (engineering harness, not the product
 *    look). It already consumes peers-ui; the antd era is retired.
 */
import { Suspense, lazy, useState } from 'react';
import { Button } from '@peers-touch/ui';

const MobilePrototype = lazy(async () => import('@peers-touch/prototype-mobile-chat'));
const MobileApp = lazy(async () => import('@peers-touch/prototype-mobile-chat/app'));

type MobileView = 'product' | 'evidence';

export function MobileFrame() {
  const [view, setView] = useState<MobileView>('product');
  return (
    <div className="nb-shell" data-nb="mobile">
      <header className="nb-head">
        <div>
          <span className="nb-overline">PEERS / MOBILE</span>
          <h1>手机原型</h1>
          <p>
            真实手机产品面：消息、邻里动态、联系人、我的。产品面与桌面北极星共用同一套
            @peers-touch/ui（方圆头像、墨色气泡、扁平发丝列表、36×20 开关、ghost 选择）；
            取证台保留受控失败态与场景注入，供验收使用。
          </p>
        </div>
      </header>
      <div className="nb-phone-wrap">
        <div className="nb-phone" data-phone-frame>
          <div className="nb-phone-screen">
            <div className="nb-phone-body" data-phone-body>
              <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: '#7e8d85' }}>载入手机原型…</div>}>
                {view === 'product' ? <MobileApp /> : <MobilePrototype />}
              </Suspense>
            </div>
          </div>
        </div>
        <aside className="nb-phone-side">
          <section className="nb-section">
            <header className="nb-section-head"><h2>视图</h2></header>
            <div className="nb-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div role="group" aria-label="手机视图切换" style={{ display: 'inline-flex', background: 'var(--pt-subtle)', border: '1px solid var(--pt-border)', borderRadius: 999, padding: 3, width: 'fit-content' }}>
                <Button actionId="mobile.view.product" emphasis={view === 'product' ? 'secondary' : 'quiet'}
                  aria-pressed={view === 'product'} onActivate={() => setView('product')}>产品面</Button>
                <Button actionId="mobile.view.evidence" emphasis={view === 'evidence' ? 'secondary' : 'quiet'}
                  aria-pressed={view === 'evidence'} onActivate={() => setView('evidence')}>取证台</Button>
              </div>
              <p className="nb-card-note" style={{ margin: 0 }}>
                {view === 'product'
                  ? '干净的中文产品形态：只组合库原语，页面不重涂 .pt-*；形状、密度、动效与桌面一致。'
                  : '受控场景与失败态注入，用于验收取证；呈现层同样走 peers-ui，不直引第三方组件库。'}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
