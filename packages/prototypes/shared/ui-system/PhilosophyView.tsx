/**
 * PhilosophyView — 设计理念 tab.
 *
 * The readable half of the self-training UI/UX system: product thesis, the six
 * review dimensions, the pine-glass grammar, and the gap-first constitution.
 * Canonical source:
 * docs/architecture/platform/client/ui-system/prototype/self-training-methodology.md
 */
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
  ['色彩', '色彩只为语义说话：近墨主动作，琥珀单点强调，成功/警告/危险/信息有专属角色。'],
  ['图标', '同一语义资产、统一线重与光学中心；业务不发明图标。'],
  ['表面', '画布凹陷、阅读面浮起、浮层真正抬升；发丝分隔而非描边堆叠，玻璃不进日常内容面。'],
  ['布局', '稳定阅读轴：共同轨道、元信息/动作轨道、混合行高、窄屏重排；相同内容相同语义结构。'],
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
            <li>松绿凹陷画布 + 不透明白色阅读面 + 近墨主动作；琥珀只给单一强调。</li>
            <li>发丝分隔（hairline）与色调步进分层，不靠多重描边与卡片阴影堆叠。</li>
            <li>方圆几何：头像 11、控件 12、卡片 16–20；全圆不属于交互容器。</li>
            <li>静息/轻抬/浮层三档阴影；玻璃模糊只用于窗框与浮层，不进正文阅读面。</li>
            <li>候选主题与生产冷墨主题并存，只在原型与本系统的 UIProvider 作用域内生效。</li>
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
            <li>手机原型仍直接消费 antd，未走 peers-ui；回迁计划另列，当前在手机框内诚实标注。</li>
            <li>north-star-pine-glass 仍是候选主题；生产默认主题未变，晋升需整体人审。</li>
          </ul>
        </article>
      </div>
    </div>
  );
}
