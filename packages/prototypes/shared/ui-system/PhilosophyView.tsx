/**
 * PhilosophyView — 设计理念 tab.
 *
 * The readable half of the self-training UI/UX system: product thesis, the six
 * review dimensions, the pine-glass grammar, and the gap-first constitution.
 * Canonical source:
 * docs/architecture/platform/client/ui-system/prototype/self-training-methodology.md
 */
// Gate registry is a compile-time MIRROR of the evaluate-specimens suites — the
// UI imports the exact suite JSON the gate runner reads, so adding/renaming a
// scenario updates this page automatically. Never hand-copy gate items here.
import boardsSuite from '../../../../tooling/scripts/ui-system/suites/boards.suite.json';
import northStarSuite from '../../../../tooling/scripts/ui-system/suites/north-star.suite.json';

interface GateScenario {
  readonly id: string;
  readonly title: string;
  readonly level: string;
}
interface GateSuite {
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly defaultOpen: boolean;
  readonly scenarios: readonly GateScenario[];
}

const GATE_SUITES: readonly GateSuite[] = [
  {
    key: 'boards',
    name: 'Frontend Eles · 基础元素板与手机产品面',
    source: 'tooling/scripts/ui-system/suites/boards.suite.json',
    defaultOpen: true,
    scenarios: boardsSuite.scenarios as readonly GateScenario[],
  },
  {
    key: 'north-star',
    name: 'North Star · 桌面框架',
    source: 'tooling/scripts/ui-system/suites/north-star.suite.json',
    defaultOpen: false,
    scenarios: northStarSuite.scenarios as readonly GateScenario[],
  },
];

const gateLevelLabel = (level: string): string => level.replace(/^L(\d+)_/, 'L$1 · ');

const LAWS: { title: string; body: string }[] = [
  {
    title: '先查库，再动手',
    body: '任何原型需要元素或组件时，先查能力登记册（基础元素 tab）。已验收的直接消费；已实现待样本的先补样本；没有的登记为缺口。禁止在原型目录里私写基础控件。',
  },
  {
    title: '缺口先晋升，原型后消费',
    body: '缺口组件必须在基础层先走完「定义 → 实现 → 样本（状态矩阵）→ 探针门禁 → 人审 → 晋升」，然后原型才允许消费。顺序不可颠倒，不能为了赶原型在功能目录里写一次性控件。',
  },
  {
    title: '人审是唯一晋升权',
    body: '探针 OBSERVED 只证明结构、几何与零 console error；视觉签名、产品语义与品味由用户逐项 review 决定。作者不自判通过，不把候选说成已确认。',
  },
  {
    title: '语法回流，删除私有实现',
    body: '人审通过的语法晋升进令牌包（当前为 north-star-pine-glass 候选主题），原型中的私有变量与私写控件随增量回迁并删除。库里是唯一真值，原型只是训练场。',
  },
  {
    title: '双向可追溯，存量债显式登记',
    body: '每个组件可双向追溯：库实现 ↔ 样本 ↔ 消费它的原型面。历史私写控件（sk-*、手机端 antd）进入缺口/债务登记，门禁只允许债务减少，不允许新增。',
  },
];

const DIMENSIONS: [string, string][] = [
  ['文字', '先读到什么、再读到什么；标题/正文/元信息比例，中英文连续阅读。'],
  ['几何', '尺寸属于同一家族：方圆头像与控件、尺寸相关圆角、间距节奏；全圆只属于点状标记。'],
  ['色彩', '色彩只为语义说话：近墨主动作，松绿只做连接/选中的小面积标点，成功/警告/危险/信息有专属角色。'],
  ['图标', '同一语义资产、统一线重与光学中心；业务不发明图标。'],
  ['表面', '画布凹陷、阅读面浮起、浮层真正抬升；发丝分隔而非描边堆叠，玻璃不进日常内容面（手机产品面整体 flat 实体）。'],
  ['布局', '稳定阅读轴：共同轨道、元信息/动作轨道、混合行高、窄屏重排；相同内容相同语义结构。动作轨道共享右缘，留白必须有意义。'],
];

const SHARED_GRAMMAR: [string, string][] = [
  ['搜索就地展开，头部图标砖同款', '搜索图标在当前轨道行内 morph 成过滤框、原地过滤，不跳页；消息面与动态面的搜索/新增必须是同一套无边框灰色安静图标砖，收起态不画白描边/墨色实心钮。头部主次分区：主菜单 tab 贴合内容、永不收缩换行居左，弹性余量，工具砖贴右缘（主在前，次靠右）。'],
  ['超出可滑，两端必虚化', '横向可滚的行动作行必须用 mask-image 边缘渐隐提示可滚，渐隐端随滚动位置切换；滚动条隐藏。'],
  ['留白有意义，动作贴右缘', '信息居左、动作钮固定贴右，右缘与卡片内容边、评论发送钮对齐；浮动控件零高度锚在卡片内缘，不压发丝边界。手机面「回到上方」是不透明无描边无阴影的 quiet 图标砖，不用带框带影的 SaaS FAB。'],
  ['一张产品面，证据靠状态注入', '桌面/手机同一份交互语法与数据；验收场景注入同一界面的状态，不允许为取证维护第二张皮。'],
  ['输入区解剖统一、无死按钮', '移动端聊天输入区固定为 表情/＋/输入框占满/发送贴右；表情弹库内面板、＋菜单驱动相册与拍摄。摆出来的控件必须接真实行为，禁用要给原因。'],
  ['创建菜单名实相符、真闭环', '＋/新增菜单每一项必须落到名称声明的完整闭环（添加联系人→入通讯录、发起群聊→建群并打开），禁止只关弹层或切 tab 的假动作；空输入/重名/未选成员要给禁用原因。底部 sheet 物理覆盖底栏且为半透毛玻璃，打开期宿主隐藏底栏，故 sheet 开合属 AppState 而非组件本地态。'],
  ['附属动作内联，图标不独占空区', '输入框的附属动作（如添加图片）落在 field frame 自身底栏：左下图标、右下字数，同一轨道对齐正文边缘；禁止在容器外另起一行放被留白包围的独立 pill。能力由 peers-ui TextArea.leadingAccessory 提供，桌面/手机同构。'],
  ['空输入行不点不显示', '窄屏评论 composer 默认不渲染：评论列表可默认展开，但空输入行点评论动作后才出现并聚焦，不为每张卡默认占一行；桌面宽画布可直接回复，属介质差异。'],
  ['消息动作同一词汇表，介质只改容器', '桌面 hover 动作条与手机长按操作表派生自同一 chat-domain：动作目录、分组、归属与时限裁决、反应目录和反应状态合同只此一份；他人消息无编辑/撤回、自己消息无举报，不可用要给原因。反应落气泡下胶囊、再点取消；回复落引用块、转发真实进入目标会话，不允许只关弹层。'],
  ['身份页三层，技术标识不进首屏', '我的页第一层是身份 Hero：与动态同源的植物意象 cover 沉浸式顶到状态栏（图压灵动岛）、头像交叠下沿带切割环；封面和头像都用与 desktop 同一套 iconOnly 深 scrim 铅笔，钉在各自右下角（触摸面常驻），不做整图居中相机、不让两钮风格分叉；第二层凭证收进一个入口行，长 PTID/用户名只在推送的二级页；第三层偏好/网络/通用是留白分层的 inset 白卡，退出登录独立危险区。触摸消费端不放 AI、渠道、日志等生产运维项。'],
  ['通话按角色分配动作，主叫侧没有「接听」', '「接听/拒绝」只属于被叫的居中来电模态；主叫不手动接通，通话按与桌面相同的 1.6s 振铃→0.9s 接通→计时自动推进，接通前控制区只有一枚红色「取消」，active 后才出静音/摄像头与「挂断」。call/accept 是被叫接听信令，由定时器或信令驱动，UI 不给主叫入口。'],
];

export function PhilosophyView() {
  return (
    <div className="nb-shell" data-nb="philosophy">
      <div className="nb-canvas">
        <article className="nb-article" data-philosophy>
          <span className="nb-overline">PEERS / UI UX PHILOSOPHY</span>
          <h1 style={{ fontSize: 24, margin: '0 0 12px', letterSpacing: '-.01em' }}>自训练的 UI/UX：方法论与产物一起长大</h1>
          <p>
            Frontend Eles 不是组件陈列室，而是一台训练机：<strong>桌面/手机原型提出真实需求，
            基础层补齐能力，样本与套件沉淀可复用产物，人审决定晋升</strong>。原型负责暴露问题，
            peers-ui 库负责沉淀答案；两者通过本理念互相约束、双向回流。
          </p>

          <h2>六个 tab 的分工</h2>
          <ul>
            <li><strong>桌面原型 / 手机原型</strong>：真实产品面，是需求与评审现场，不是控件作坊。</li>
            <li><strong>基础元素（组件）</strong>：令牌与能力登记册——已验收 / 已实现待样本 / 缺口已登记。</li>
            <li><strong>套件</strong>：面向产品任务的组合模式（动作、表单、浮层、反馈、列表、身份媒体）。</li>
            <li><strong>样本</strong>：每个已验收组件的状态矩阵（标准 / 长文案 / 禁用），是训练产物本身。</li>
            <li><strong>设计理念</strong>：本页，方法论、语法与宪章的唯一可读入口。</li>
          </ul>

          <h2>六维评审</h2>
          <p>每个元素晋升前都要回答这六个问题，探针能检验其中的几何与结构，品味留给人审。</p>
          <ol>
            {DIMENSIONS.map(([title, body]) => <li key={title}><strong>{title}：</strong>{body}</li>)}
          </ol>

          <h2>松绿玻璃语法（当前候选主题 north-star-pine-glass）</h2>
          <ul>
            <li>中性纸灰凹陷画布 + 不透明白色阅读面 + 近墨主动作；松绿只给连接/在线/选中的小面积标点。</li>
            <li>发丝分隔（hairline）与色调步进分层，不靠多重描边与卡片阴影堆叠。</li>
            <li>方圆几何：头像 11、控件 12、卡片 16–20；全圆不属于交互容器。</li>
            <li>静息/轻抬/浮层三档阴影；毛玻璃只保留半透与模糊质感、不染色，环境辉光一律拍平。</li>
            <li>玻璃只属于窗框与浮层；手机日常内容面整体走 flat 实体材质（卡片/底栏/输入框不透明）。</li>
            <li>动态发图同一九宫格规则：上限 9 张，1 张 16:10 宽幅、2 张两列、3–9 张三列方形。</li>
            <li>候选主题与生产冷墨主题并存，只在原型与本系统的 UIProvider 作用域内生效。</li>
          </ul>

          <h2>跨面交互语法（桌面 / 手机同一份）</h2>
          <ul>
            {SHARED_GRAMMAR.map(([title, body]) => <li key={title}><strong>{title}：</strong>{body}</li>)}
          </ul>

          <h2>自训练宪章</h2>
          <div>
            {LAWS.map((law, i) => (
              <div className="nb-law" key={law.title} data-law={i + 1}>
                <span className="nb-law-num">{i + 1}</span>
                <div><strong>{law.title}</strong><span>{law.body}</span></div>
              </div>
            ))}
          </div>

          <h2>证据规则</h2>
          <ul>
            <li>机器：探针套件覆盖结构计数、焦点归属、无横向溢出（1360/390）、craft battery、0 console error。</li>
            <li>人：截图逐项过目；候选/草稿/已验收状态必须显式标注，不得把候选说成结论。</li>
            <li>来源：样本只用真实种子数据（邻居、会话、动态、设置 IA），不引入外部业务与品牌素材。</li>
          </ul>

          <h2>当前债务（显式登记，只许减少）</h2>
          <ul data-debt-list>
            <li>桌面原型仍有 <code>sk-*</code> 私写组合件：设置下划线 tab/侧栏行、全局搜索命令面、会话行等——已在登记册标为组合缺口，逐增量回迁。</li>
            <li><s>手机原型直接消费 antd</s>——已清偿：antd 与自绘第二张皮全量删除，手机面只剩单一产品 UI，全部走 peers-ui，证据以场景状态注入同一界面。</li>
            <li>north-star-pine-glass 仍是候选主题；生产默认主题未变，晋升需整体人审。</li>
          </ul>

          <h2>机器门禁清单（镜像自套件 · 单一真值）</h2>
          <p>
            下列审核项不是手写副本，而是直接 <code>import</code> 门禁运行器 evaluate-specimens 读取的同一套套件 JSON 渲染——
            套件新增、删除或改名，本页随构建自动同步，禁止在此手抄维护。包级几何与真机 Journey 门禁
            （<code>check-layout</code>、<code>check-call-states</code>、<code>check-long-lists</code>、<code>check-residual-parity</code>、<code>mobile-surface-boundary</code>）以脚本探针为准，不在此另立清单。
          </p>
          <div className="nb-gates" data-gate-registry>
            {GATE_SUITES.map(suite => (
              <details key={suite.key} className="nb-gate-suite" data-gate-suite={suite.key}
                open={suite.defaultOpen || undefined}>
                <summary>
                  <span className="nb-gate-suite-name">{suite.name}</span>
                  <span className="nb-gate-count" data-gate-count>{suite.scenarios.length} 项</span>
                  <code className="nb-gate-source">{suite.source}</code>
                </summary>
                <ol className="nb-gate-list">
                  {suite.scenarios.map(scenario => (
                    <li key={scenario.id} className="nb-gate-item" data-gate-item data-gate-level={scenario.level}>
                      <span className="nb-gate-level">{gateLevelLabel(scenario.level)}</span>
                      <span className="nb-gate-title">{scenario.title}</span>
                      <code className="nb-gate-id">{scenario.id}</code>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
