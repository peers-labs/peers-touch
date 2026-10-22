import { useMemo, useState } from "react";
import { Button, ThemeProvider } from "@lobehub/ui";
import { Alert, Checkbox, ConfigProvider, Input, Modal, Select, Switch, Tag, theme } from "antd";
import { Check, FileDiff, History, Moon, Plus, Radio, RefreshCw, Server, ShieldCheck, Sun, Upload, X } from "lucide-react";
import { entryDiff, INITIAL_ENTRIES, validateEntries, type Entry, type EntryKind, type PublicationState } from "./prototypeModel";
import "./style.css";

const kindName: Record<EntryKind, string> = { relay: "Relay", station: "公开 Station", release: "升级配置" };
const stateName: Record<PublicationState, string> = {
  clean: "与线上一致", dirty: "草稿有变更", valid: "校验通过",
  publishing: "正在发布", failed: "发布失败", published: "已发布", conflict: "源版本冲突",
};

export function XConfigPrototype() {
  const [dark, setDark] = useState(false);
  const [signedIn, setSignedIn] = useState(true);
  const [tab, setTab] = useState<"catalog" | "history">("catalog");
  const [filter, setFilter] = useState<"all" | EntryKind>("all");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>(() => {
    try { return JSON.parse(localStorage.getItem("peers-x-config-prototype-draft") ?? "null") ?? INITIAL_ENTRIES; }
    catch { return INITIAL_ENTRIES; }
  });
  const [published, setPublished] = useState<Entry[]>(() => {
    try { return JSON.parse(localStorage.getItem("peers-x-config-prototype-published") ?? "null") ?? INITIAL_ENTRIES; }
    catch { return INITIAL_ENTRIES; }
  });
  const [state, setState] = useState<PublicationState>("clean");
  const [findings, setFindings] = useState<string[]>([]);
  const [editor, setEditor] = useState<Entry | null>(null);
  const [editorError, setEditorError] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("peers-x-config-prototype-history") ?? "null") ??
      [{ revision: 12, label: "发布基线", count: INITIAL_ENTRIES.length, entries: INITIAL_ENTRIES }]; }
    catch { return [{ revision: 12, label: "发布基线", count: INITIAL_ENTRIES.length, entries: INITIAL_ENTRIES }]; }
  });
  const diff = useMemo(() => entryDiff(published, entries), [published, entries]);
  const shown = entries.filter((entry) =>
    (filter === "all" || entry.kind === filter) &&
    `${entry.name} ${entry.address}`.toLowerCase().includes(query.toLowerCase()));
  const revision = history[0].revision;
  const effectiveState = state === "clean" && diff.length ? "dirty" : state;
  const busy = state === "publishing";

  function save(next: Entry[]) {
    setEntries(next);
    localStorage.setItem("peers-x-config-prototype-draft", JSON.stringify(next));
    setState(entryDiff(published, next).length ? "dirty" : "clean");
    setFindings([]);
    setAcknowledged(false);
  }
  function validate() {
    const errors = validateEntries(entries);
    setFindings(errors);
    setState(errors.length ? "dirty" : "valid");
  }
  function add() {
    setEditorError("");
    setEditor({ id: `draft-${Date.now()}`, kind: "relay", name: "", address: "", detail: "", trust: "webpki", enabled: true });
  }
  function saveEditor() {
    if (!editor) return;
    if (!editor.name.trim() || !editor.address.trim()) {
      setEditorError("请填写名称和地址。"); return;
    }
    const next = entries.some((entry) => entry.id === editor.id)
      ? entries.map((entry) => entry.id === editor.id ? editor : entry) : [...entries, editor];
    save(next);
    setEditor(null);
  }
  function publishNow() {
    if (!acknowledged || !diff.length || validateEntries(entries).length) return;
    setState("publishing"); setDiffOpen(false);
    window.setTimeout(completePublication, 350);
  }
  function completePublication() {
    setPublished(entries);
    localStorage.setItem("peers-x-config-prototype-published", JSON.stringify(entries));
    const nextHistory = [{ revision: revision + 1, label: `${diff.length} 项变更 · 已签名发布`, count: entries.filter((entry) => entry.enabled).length, entries }, ...history];
    setHistory(nextHistory);
    localStorage.setItem("peers-x-config-prototype-history", JSON.stringify(nextHistory));
    setState("published"); setAcknowledged(false);
  }
  function inject(sample: string) {
    if (sample === "signed-out") { setSignedIn(false); return; }
    if (sample === "empty") { save([]); return; }
    if (sample === "invalid") {
      save([...entries, { id: "invalid-ip", kind: "station", name: "私有 IP 节点", address: "http://192.0.2.42:18280", detail: "缺少所有者连接材料", trust: "missing", enabled: true }]); return;
    }
    if (sample === "conflict") { setState("conflict"); return; }
    if (sample === "failure") { setState("failed"); return; }
    save(INITIAL_ENTRIES);
  }

  return (
    <ThemeProvider themeMode={dark ? "dark" : "light"} theme={{ token: { motion: false, colorPrimary: dark ? "#a89cf2" : "#6b5bd6" } }} enableGlobalStyle={false}>
    <ConfigProvider theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: { colorPrimary: dark ? "#a89cf2" : "#6b5bd6", borderRadius: 8, controlHeight: 32, fontSize: 14, motion: false },
    }}>
      <div className={`x-config-prototype ${dark ? "dark" : ""}`} data-entity="x-config-prototype" data-state={effectiveState}>
        <header className="xcfg-header">
          <div className="xcfg-brand"><Radio size={22} /><div><strong>X Config</strong><span>官方节点与升级配置</span></div></div>
          <div className="xcfg-header-actions">
            <Tag>stable</Tag>
            <Button aria-label={dark ? "切换亮色" : "切换暗色"} onClick={() => setDark(!dark)} icon={dark ? <Sun size={16} /> : <Moon size={16} />} />
            {signedIn && <Button onClick={() => setSignedIn(false)}>退出</Button>}
          </div>
        </header>
        {!signedIn ? (
          <main className="xcfg-signin">
            <ShieldCheck size={32} />
            <h1>登录管理控制台</h1>
            <p>管理公开节点、升级配置和发布记录。</p>
            <Button type="primary" onClick={() => setSignedIn(true)}>使用 GitHub 登录（原型）</Button>
          </main>
        ) : (
          <>
            <aside className="xcfg-revision" aria-label="版本状态">
              <div><span>线上版本</span><strong>#{revision}</strong></div>
              <div><span>当前草稿</span><strong>{diff.length ? `${diff.length} 项变更` : "无变更"}</strong></div>
              <div className="xcfg-revision-state" role="status"><ShieldCheck size={16} /><strong>{stateName[effectiveState]}</strong></div>
              <span className="xcfg-readback">线上签名与内容已验证 · 示例数据</span>
            </aside>
            <div className="xcfg-body">
              <nav className="xcfg-nav" aria-label="X Config 导航">
                <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><Server size={17} />配置目录</button>
                <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={17} />发布历史</button>
                <div className="xcfg-nav-note">X Config 只提供候选。<br />客户端选择后仍会验证节点身份。</div>
              </nav>
              <main className="xcfg-main">
                {state === "publishing" && <Alert type="info" showIcon message="正在签名并发布" description="服务正在分配下一序列并原子保存签名快照。" />}
                {state === "failed" && <Alert type="error" showIcon message="发布失败" description="公开快照未变化，草稿未丢失。检查服务后可重新审查发布。" action={<Button onClick={() => { setState("valid"); setDiffOpen(true); }}>重新审查</Button>} />}
                {state === "conflict" && <Alert type="warning" showIcon message="源版本已变化" description="草稿保留。请重新同步源版本并审查差异，不能强制覆盖。" action={<Button onClick={() => { setState("dirty"); setAcknowledged(false); }}>同步并保留草稿</Button>} />}
                {state === "published" && <Alert type="success" showIcon message="新版本已发布并通过内容校验" description="客户端会在下一次配置刷新后获得候选；不会自动切换当前 Station。" />}
                {findings.length > 0 && <Alert type="error" showIcon message={`${findings.length} 项校验未通过`} description={<ul>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>} />}
                {tab === "catalog" ? (
                  <>
                    <div className="xcfg-page-heading"><div><h1>配置目录</h1><p>维护可推荐的节点和各端升级信息。</p></div><Button icon={<Plus size={16} />} disabled={busy} onClick={add}>添加配置</Button></div>
                    <div className="xcfg-toolbar">
                      <div className="xcfg-filters" aria-label="目录分类">
                        {(["all", "relay", "station", "release"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "全部" : kindName[value]}</button>)}
                      </div>
                      <Input aria-label="搜索配置" placeholder="搜索名称或地址" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
                    </div>
                    <section className="xcfg-list" aria-label="配置项">
                      {shown.length === 0 ? <div className="xcfg-empty"><Server size={26} /><strong>暂无配置</strong><span>添加 Relay、公开 Station 或升级信息。</span><Button onClick={add}>添加配置</Button></div> :
                        shown.map((entry) => (
                          <article className="xcfg-entry" key={entry.id} data-entity="x-config-entry">
                            <div className="xcfg-entry-icon">{entry.kind === "release" ? <Upload size={19} /> : entry.kind === "relay" ? <Radio size={19} /> : <Server size={19} />}</div>
                            <div className="xcfg-entry-content"><div className="xcfg-entry-title"><strong>{entry.name}</strong><Tag>{kindName[entry.kind]}</Tag></div><code>{entry.address}</code><span>{entry.detail}</span></div>
                            <div className="xcfg-entry-trust"><ShieldCheck size={14} /><span>{entry.trust === "missing" ? "材料待补充" : entry.trust === "material" ? "已导入可信材料" : entry.kind === "release" ? "独立升级签名" : "HTTPS 签名发现"}</span></div>
                            <div className="xcfg-entry-actions"><Switch aria-label={`${entry.name} 启用`} checked={entry.enabled} disabled={busy} onChange={(enabled) => save(entries.map((item) => item.id === entry.id ? { ...item, enabled } : item))} /><Button disabled={busy} onClick={() => { setEditorError(""); setEditor(entry); }}>编辑</Button></div>
                          </article>
                        ))}
                    </section>
                    <footer className="xcfg-actions">
                      <span>{diff.length ? `${diff.length} 项待发布变更` : "目录与线上内容一致"}</span>
                      <div><Button disabled={!diff.length || busy} onClick={validate} icon={<Check size={16} />}>校验草稿</Button><Button type="primary" disabled={!diff.length || busy || state === "conflict"} icon={<FileDiff size={16} />} onClick={() => { validate(); setDiffOpen(true); }}>审查并发布</Button></div>
                    </footer>
                  </>
                ) : (
                  <>
                    <div className="xcfg-page-heading"><div><h1>发布历史</h1><p>每次发布均保留源版本、签名与单调序列。</p></div><Button icon={<RefreshCw size={16} />} onClick={() => setTab("catalog")}>返回目录</Button></div>
                    <div className="xcfg-list">{history.map((item: {revision: number; label: string; count: number; entries: Entry[]}) => <article className="xcfg-history" key={item.revision}><strong>#{item.revision}</strong><span>{item.label}</span><span>{item.count} 项配置</span><Button onClick={() => { save(item.entries); setTab("catalog"); }}>以此版本创建新草稿</Button></article>)}</div>
                  </>
                )}
              </main>
            </div>
          </>
        )}
        <details className="xcfg-scenarios"><summary>原型演示状态 · 不连接真实服务</summary><div>
          <Select aria-label="演示场景" placeholder="选择场景" onChange={inject} options={[{ value: "invalid", label: "缺少 IP 身份材料" }, { value: "failure", label: "发布失败与重试" }, { value: "conflict", label: "源版本冲突" }, { value: "empty", label: "空目录" }, { value: "signed-out", label: "未登录" }, { value: "reset", label: "恢复示例" }]} />
        </div></details>
        <Modal title={editor && entries.some((entry) => entry.id === editor.id) ? "编辑配置" : "添加配置"} open={!!editor} onCancel={() => setEditor(null)} footer={null} destroyOnHidden>
          {editor && <div className="xcfg-editor">
            <label>配置类型<Select aria-label="配置类型" value={editor.kind} onChange={(kind) => setEditor({ ...editor, kind })} options={(Object.keys(kindName) as EntryKind[]).map((value) => ({ value, label: kindName[value] }))} /></label>
            <label>名称<Input aria-label="名称" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>地址<Input aria-label="地址" value={editor.address} onChange={(event) => setEditor({ ...editor, address: event.target.value })} placeholder="https://example.com" /></label>
            <label>说明<Input aria-label="说明" value={editor.detail} onChange={(event) => setEditor({ ...editor, detail: event.target.value })} /></label>
            {editor.kind === "release" && <>
              <label>版本<Input aria-label="版本" value={editor.releaseVersion ?? ""} placeholder="0.0.1" onChange={(event) => setEditor({ ...editor, releaseVersion: event.target.value })} /></label>
              <label>平台与架构<Select aria-label="平台与架构" value={editor.releaseTarget} onChange={(releaseTarget) => setEditor({ ...editor, releaseTarget })} options={["macos-arm64", "macos-x86_64", "windows-x86_64", "linux-x86_64", "ios-arm64", "android-arm64"].map((value) => ({ value, label: value }))} /></label>
              <label>Manifest SHA-256<Input aria-label="Manifest SHA-256" value={editor.manifestDigest ?? ""} onChange={(event) => setEditor({ ...editor, manifestDigest: event.target.value })} /></label>
              <label>签名 Key ID<Input aria-label="签名 Key ID" value={editor.signingKeyId ?? ""} onChange={(event) => setEditor({ ...editor, signingKeyId: event.target.value })} /></label>
            </>}
            {editor.kind !== "release" && <label>接入材料<Select aria-label="接入材料" value={editor.trust} onChange={(trust) => setEditor({ ...editor, trust })} options={[{ value: "webpki", label: "公开 HTTPS · 仍需签名发现" }, { value: "material", label: "已导入所有者连接材料（演示）" }, { value: "missing", label: "材料待补充 · 不可发布" }]} /></label>}
            <p className="xcfg-helper">IP 或自签证书需要可信节点身份材料。原型只演示材料状态，不导入真实证书。</p>
            {editorError && <Alert type="error" message={editorError} role="alert" />}
            <div className="xcfg-editor-footer">
              {entries.some((entry) => entry.id === editor.id) && <Button danger onClick={() => { save(entries.filter((entry) => entry.id !== editor.id)); setEditor(null); }}>从草稿删除</Button>}
              <Button onClick={() => setEditor(null)}>取消</Button><Button type="primary" onClick={saveEditor}>保存草稿</Button>
            </div>
          </div>}
        </Modal>
        <Modal title="审查发布" open={diffOpen} onCancel={() => setDiffOpen(false)} footer={null} destroyOnHidden>
          <div className="xcfg-diff">
            <p>线上 #{revision} → 新草稿 · {diff.length} 项变更</p>
            {diff.map((change) => <div className="xcfg-diff-item" key={change.id}><strong>{change.name}</strong><span>{change.description}</span></div>)}
            {findings.length ? <Alert type="error" showIcon message="先修复校验问题" description={findings.join("；")} /> : <Alert type="info" showIcon message="确认后立即发布" description="服务会为此精确版本分配下一序列、签名并保存公开快照。已有 Station 绑定保留。" />}
            <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>我已审查这些精确变更，并确认立即发布此版本</Checkbox>
            <div className="xcfg-editor-footer"><Button onClick={() => setDiffOpen(false)} icon={<X size={15} />}>返回修改</Button><Button type="primary" disabled={!acknowledged || !!findings.length || !diff.length} onClick={publishNow}>立即发布</Button></div>
          </div>
        </Modal>
      </div>
    </ConfigProvider>
    </ThemeProvider>
  );
}
