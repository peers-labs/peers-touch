/**
 * MobileFrame — 手机原型 tab.
 *
 * One mobile product surface only: the north-star MobileApp. Evidence
 * scenarios inject state into this same UI (see the standalone prototype
 * entry `?scenario=…`); there is deliberately no second phone skin.
 */
import { Suspense, lazy } from 'react';

const MobileApp = lazy(async () => import('@peers-touch/prototype-mobile-chat/app'));

export function MobileFrame() {
  return (
    <div className="nb-shell" data-nb="mobile">
      <header className="nb-head">
        <div>
          <span className="nb-overline">PEERS / MOBILE</span>
          <h1>手机原型</h1>
          <p>
            手机产品面与桌面共用同一套交互语法与数据源：消息、动态、我的三个一级入口（联系人是
            消息区内的第二段；头部搜索图标原地展开为局部过滤，不跳页），动态为动态/圈友两段、
            最新/热门排序。人员色调、群拼贴头像、动态/圈子数据与桌面原型同源，控件全部来自
            @peers-touch/ui。受控验收场景以状态注入方式作用于同一界面（独立入口 ?scenario=…）。
          </p>
        </div>
      </header>
      <div className="nb-phone-wrap">
        <div className="nb-phone" data-phone-frame>
          <div className="nb-phone-screen">
            <div className="nb-phone-body" data-phone-body>
              <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: '#7e8d85' }}>载入手机原型…</div>}>
                <MobileApp />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
