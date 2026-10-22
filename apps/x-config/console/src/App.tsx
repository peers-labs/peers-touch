import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ThemeProvider } from "@lobehub/ui";
import {
  Alert,
  Checkbox,
  ConfigProvider,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  theme,
} from "antd";
import {
  Check,
  FileDiff,
  History,
  LogOut,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { ApiError, api } from "./api";
import { messages } from "./messages";
import { catalogDiff, publicationState } from "./model";
import type {
  Catalog,
  CatalogEndpoint,
  CatalogRelease,
  Draft,
  EditableItem,
  Finding,
  Publication,
  Session,
} from "./types";
import { emptyCatalog } from "./types";
import "./style.css";

const platformOptions = ["macos", "windows", "linux", "ios", "android"];
const architectureOptions = ["arm64", "x86_64", "universal"];

export function App() {
  const [dark, setDark] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [sourceBaseline, setSourceBaseline] = useState<Catalog>(emptyCatalog);
  const [publishedBaseline, setPublishedBaseline] = useState<Catalog>(emptyCatalog);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [historyStale, setHistoryStale] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [tab, setTab] = useState<"catalog" | "history">("catalog");
  const [filter, setFilter] = useState<"all" | "endpoint" | "release">("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditableItem | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [notice, setNotice] = useState<
    "conflict" | "failed" | "history_stale" | "published" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const loadGeneration = useRef(0);
  const localEditGeneration = useRef(0);
  const reloadInFlight = useRef(false);

  const unsavedDiff = useMemo(
    () => catalogDiff(sourceBaseline, catalog),
    [sourceBaseline, catalog],
  );
  const publicationDiff = useMemo(
    () => catalogDiff(publishedBaseline, catalog),
    [publishedBaseline, catalog],
  );
  const sourceState = historyStale
    ? "stale"
    : publicationState(publications, draft?.content_sha256 ?? "");
  const initialPublication = publications.length === 0;
  const renewalPublication =
    publications.length > 0 && publicationDiff.length === 0;
  const shownEndpoints = catalog.endpoints.filter((item) =>
    filter !== "release" &&
    `${item.display_name} ${item.seed_id}`.toLowerCase().includes(query.toLowerCase()));
  const shownReleases = catalog.releases.filter((item) =>
    filter !== "endpoint" &&
    `${item.release_id} ${item.version}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    let currentSession: Session;
    try {
      currentSession = await api.session();
    } catch (error) {
      setSession(null);
      if (!(error instanceof ApiError && error.status === 401)) {
        setNotice("failed");
      }
      return;
    }
    setSession(currentSession);
    try {
      await loadData();
    } catch {
      setNotice("failed");
    } finally {
      setDataReady(true);
    }
  }

  async function loadData(options: { preserveLocalCatalog?: boolean } = {}) {
    const generation = ++loadGeneration.current;
    const editGeneration = localEditGeneration.current;
    const loadedDraft = await api.loadDraft("stable").catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    if (generation !== loadGeneration.current) return;
    const next = loadedDraft?.catalog ?? emptyCatalog();
    setDraft(loadedDraft);
    setSourceBaseline(cloneCatalog(next));
    if (
      !options.preserveLocalCatalog &&
      editGeneration === localEditGeneration.current
    ) {
      setCatalog(cloneCatalog(next));
    }
    setFindings([]);
    try {
      const history = await api.publications("stable");
      if (generation !== loadGeneration.current) return;
      setPublications(history.publications);
      setPublishedBaseline(cloneCatalog(
        history.publications[0]?.catalog ?? emptyCatalog(),
      ));
      setHistoryStale(false);
      setNotice(null);
    } catch {
      if (generation !== loadGeneration.current) return;
      setHistoryStale(true);
      setNotice("history_stale");
    }
  }

  async function reloadData(preserveLocalCatalog: boolean) {
    if (reloadInFlight.current) return;
    reloadInFlight.current = true;
    setBusy(true);
    try {
      await loadData({ preserveLocalCatalog });
    } catch {
      setNotice("failed");
    } finally {
      reloadInFlight.current = false;
      setBusy(false);
    }
  }

  async function validate() {
    setBusy(true);
    try {
      const result = await api.validate(catalog);
      setFindings(result.findings);
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const result = await api.validate(catalog);
      setFindings(result.findings);
      if (!result.valid) return null;
      const saved = await api.saveDraft(draft?.revision ?? "", catalog);
      setDraft(saved);
      setSourceBaseline(cloneCatalog(saved.catalog));
      setNotice(null);
      return saved;
    } catch (error) {
      if (error instanceof ApiError && error.code === "draft_conflict") {
        setNotice("conflict");
        return null;
      }
      setNotice("failed");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (
      !acknowledged ||
      (!publicationDiff.length &&
        !initialPublication &&
        !renewalPublication) ||
      historyStale
    ) return;
    setBusy(true);
    try {
      const result = await api.validate(catalog);
      setFindings(result.findings);
      if (!result.valid) return;
      const saved = unsavedDiff.length || !draft
        ? await api.saveDraft(draft?.revision ?? "", catalog)
        : draft;
      if (!saved) return;
      const published = await api.publish(
        saved.catalog.channel,
        saved.revision,
        saved.content_sha256,
      );
      setDraft(saved);
      setSourceBaseline(cloneCatalog(saved.catalog));
      setPublishedBaseline(cloneCatalog(saved.catalog));
      setPublications((current) => [
        published,
        ...current.filter(
          (item) => item.publication_id !== published.publication_id,
        ),
      ]);
      setHistoryStale(false);
      setReviewOpen(false);
      setAcknowledged(false);
      await loadData({ preserveLocalCatalog: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "draft_conflict") {
        setNotice("conflict");
      } else {
        setNotice("failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function commitEditor() {
    if (!editor) return;
    if (editor.type === "endpoint") {
      const endpoints = [...catalog.endpoints];
      if (editor.index < 0) endpoints.push(editor.value);
      else endpoints[editor.index] = editor.value;
      setCatalog({ ...catalog, endpoints });
    } else {
      const releases = [...catalog.releases];
      if (editor.index < 0) releases.push(editor.value);
      else releases[editor.index] = editor.value;
      setCatalog({ ...catalog, releases });
    }
    localEditGeneration.current += 1;
    setEditor(null);
    setFindings([]);
    setAcknowledged(false);
  }

  function removeEditor() {
    if (!editor || editor.index < 0) return;
    if (editor.type === "endpoint") {
      setCatalog({
        ...catalog,
        endpoints: catalog.endpoints.filter((_, index) => index !== editor.index),
      });
    } else {
      setCatalog({
        ...catalog,
        releases: catalog.releases.filter((_, index) => index !== editor.index),
      });
    }
    localEditGeneration.current += 1;
    setEditor(null);
    setAcknowledged(false);
  }

  async function restore(revision: string) {
    if (!draft) return;
    setBusy(true);
    try {
      const restored = await api.restore("stable", revision, draft.revision);
      setDraft(restored);
      setCatalog(cloneCatalog(restored.catalog));
      setSourceBaseline(cloneCatalog(restored.catalog));
      setTab("catalog");
    } catch (error) {
      setNotice(error instanceof ApiError && error.code === "draft_conflict" ? "conflict" : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    setSession(null);
  }

  if (session === undefined || (session !== null && !dataReady)) {
    return <div className="xcfg-loading"><Spin /></div>;
  }

  return (
    <ThemeProvider
      themeMode={dark ? "dark" : "light"}
      theme={{ token: { motion: false, colorPrimary: dark ? "#a89cf2" : "#6b5bd6" } }}
      enableGlobalStyle={false}
    >
      <ConfigProvider theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? "#a89cf2" : "#6b5bd6",
          borderRadius: 8,
          controlHeight: 32,
          fontSize: 14,
          motion: false,
        },
      }}>
        <div className={`x-config-console ${dark ? "dark" : ""}`} data-state={sourceState}>
          <Header
            dark={dark}
            signedIn={!!session}
            onTheme={() => setDark(!dark)}
            onLogout={() => void logout()}
          />
          {!session ? (
            <main className="xcfg-signin">
              <ShieldCheck size={32} />
              <h1>{messages.signInTitle}</h1>
              <p>{messages.signInBody}</p>
              <Button type="primary" onClick={() => {
                window.location.assign("/api/admin/auth/start");
              }}>{messages.signIn}</Button>
            </main>
          ) : (
            <>
              <RevisionStrip
                draft={draft}
                diffCount={unsavedDiff.length}
                state={sourceState}
              />
              <div className="xcfg-body">
                <Navigation tab={tab} onChange={setTab} />
                <main className="xcfg-main">
                  <StateAlerts
                    state={sourceState}
                    notice={notice}
                    findings={findings}
                    busy={busy}
                    onReload={() => void reloadData(notice === "conflict")}
                  />
                  {tab === "catalog" ? (
                    <>
                      <div className="xcfg-page-heading">
                        <div>
                          <h1>{messages.catalog}</h1>
                          <p>{messages.catalogDescription}</p>
                        </div>
                        <div className="xcfg-heading-actions">
                          <Button
                            icon={<Plus size={16} />}
                            disabled={busy}
                            onClick={() => setEditor(newEndpoint())}
                          >{messages.addEndpoint}</Button>
                          <Button
                            icon={<Upload size={16} />}
                            disabled={busy}
                            onClick={() => setEditor(newRelease())}
                          >{messages.addRelease}</Button>
                        </div>
                      </div>
                      <div className="xcfg-toolbar">
                        <div className="xcfg-filters">
                          {(["all", "endpoint", "release"] as const).map((value) => (
                            <button
                              key={value}
                              aria-pressed={filter === value}
                              onClick={() => setFilter(value)}
                            >{value === "all" ? messages.filterAll : value === "endpoint" ? messages.filterEndpoint : messages.filterRelease}</button>
                          ))}
                        </div>
                        <Input
                          aria-label={messages.searchLabel}
                          placeholder={messages.searchPlaceholder}
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          allowClear
                        />
                      </div>
                      <section className="xcfg-list">
                        {!shownEndpoints.length && !shownReleases.length ? (
                          <div className="xcfg-empty">
                            <Server size={26} />
                            <strong>{messages.empty}</strong>
                          </div>
                        ) : (
                          <>
                            {shownEndpoints.map((endpoint) => (
                              <EndpointRow
                                key={endpoint.seed_id}
                                value={endpoint}
                                onEdit={() => setEditor({
                                  type: "endpoint",
                                  index: catalog.endpoints.indexOf(endpoint),
                                  value: { ...endpoint, regions: [...endpoint.regions] },
                                })}
                              />
                            ))}
                            {shownReleases.map((release) => (
                              <ReleaseRow
                                key={release.release_id}
                                value={release}
                                onEdit={() => setEditor({
                                  type: "release",
                                  index: catalog.releases.indexOf(release),
                                  value: { ...release },
                                })}
                              />
                            ))}
                          </>
                        )}
                      </section>
                      <footer className="xcfg-actions">
                        <span>{unsavedDiff.length ? messages.unsavedChanges(unsavedDiff.length) : messages.noChanges}</span>
                        <div>
                          <Button
                            disabled={busy || !unsavedDiff.length}
                            onClick={() => void saveDraft()}
                          >{messages.save}</Button>
                          <Button
                            icon={<Check size={16} />}
                            disabled={busy}
                            onClick={() => void validate()}
                          >{messages.validate}</Button>
                          <Button
                            type="primary"
                            icon={<FileDiff size={16} />}
                            disabled={
                              busy ||
                              sourceState === "stale"
                            }
                            onClick={() => {
                              setReviewOpen(true);
                              void validate();
                            }}
                          >{messages.review}</Button>
                        </div>
                      </footer>
                    </>
                  ) : (
                    <HistoryView
                      publications={publications}
                      busy={busy}
                      stale={historyStale}
                      onRestore={(revision) => void restore(revision)}
                      onBack={() => setTab("catalog")}
                    />
                  )}
                </main>
              </div>
            </>
          )}
          <EditorModal
            editor={editor}
            onChange={setEditor}
            onCancel={() => setEditor(null)}
            onDelete={removeEditor}
            onSave={commitEditor}
          />
          <ReviewModal
            open={reviewOpen}
            diff={publicationDiff}
            initial={initialPublication}
            renewal={renewalPublication}
            findings={findings}
            acknowledged={acknowledged}
            busy={busy}
            onAcknowledged={setAcknowledged}
            onClose={() => setReviewOpen(false)}
            onSubmit={() => void publish()}
          />
        </div>
      </ConfigProvider>
    </ThemeProvider>
  );
}

function Header(props: {
  dark: boolean;
  signedIn: boolean;
  onTheme: () => void;
  onLogout: () => void;
}) {
  return <header className="xcfg-header">
    <div className="xcfg-brand">
      <Radio size={22} />
      <div><strong>{messages.brand}</strong><span>{messages.subtitle}</span></div>
    </div>
    <div className="xcfg-header-actions">
      <Tag>stable</Tag>
      <Button
        aria-label={props.dark ? messages.themeLight : messages.themeDark}
        onClick={props.onTheme}
        icon={props.dark ? <Sun size={16} /> : <Moon size={16} />}
      />
      {props.signedIn && (
        <Button icon={<LogOut size={16} />} onClick={props.onLogout}>{messages.logout}</Button>
      )}
    </div>
  </header>;
}

function RevisionStrip(props: {
  draft: Draft | null;
  diffCount: number;
  state: string;
}) {
  return <aside className="xcfg-revision" aria-label={messages.revisionStatus}>
    <div><span>{messages.sourceRevision}</span><strong>{props.draft?.revision.slice(0, 9) ?? messages.notCreated}</strong></div>
    <div><span>{messages.currentDraft}</span><strong>{props.diffCount ? String(props.diffCount) : messages.noChanges}</strong></div>
    <div className="xcfg-revision-state" role="status">
      <ShieldCheck size={16} />
      <strong>{props.state === "published" ? messages.statusPublished : props.state === "stale" ? messages.statusStale : messages.statusEditable}</strong>
    </div>
    <span className="xcfg-readback">{messages.publishBoundary}</span>
  </aside>;
}

function Navigation(props: {
  tab: "catalog" | "history";
  onChange: (value: "catalog" | "history") => void;
}) {
  return <nav className="xcfg-nav" aria-label={messages.navigation}>
    <button className={props.tab === "catalog" ? "active" : ""} onClick={() => props.onChange("catalog")}>
      <Server size={17} />{messages.catalog}
    </button>
    <button className={props.tab === "history" ? "active" : ""} onClick={() => props.onChange("history")}>
      <History size={17} />{messages.history}
    </button>
    <div className="xcfg-nav-note">{messages.suggestionBoundary}</div>
  </nav>;
}

function StateAlerts(props: {
  state: string;
  notice: string | null;
  findings: Finding[];
  busy: boolean;
  onReload: () => void;
}) {
  return <>
    {props.state === "stale" && (
      <Alert
        type="warning"
        showIcon
        message={messages.historyUnavailable}
        description={messages.historyUnavailableBody}
      />
    )}
    {props.notice === "failed" && (
      <Alert type="error" showIcon message={messages.operationFailed} description={messages.operationFailedBody} />
    )}
    {props.notice === "conflict" && (
      <Alert type="warning" showIcon message={messages.sourceConflict} action={<Button disabled={props.busy} onClick={props.onReload}>{messages.reloadSource}</Button>} />
    )}
    {props.state === "published" && (
      <Alert type="success" showIcon message={messages.publishedReadback} />
    )}
    {!!props.findings.length && (
      <Alert
        type="error"
        showIcon
        message={messages.validationFailed(props.findings.length)}
        description={<ul>{props.findings.map((finding, index) => (
          <li key={`${finding.field}-${finding.code}-${index}`}>
            <code>{finding.field || "catalog"}</code> · {finding.message} · {finding.owner}
          </li>
        ))}</ul>}
      />
    )}
  </>;
}

function EndpointRow(props: { value: CatalogEndpoint; onEdit: () => void }) {
  return <article className="xcfg-entry">
    <div className="xcfg-entry-icon">{props.value.kind === "relay" ? <Radio size={19} /> : <Server size={19} />}</div>
    <div className="xcfg-entry-content">
      <div className="xcfg-entry-title">
        <strong>{props.value.display_name}</strong>
        <Tag>{props.value.kind === "relay" ? messages.relay : messages.directStation}</Tag>
      </div>
      <code>{props.value.seed_id}</code>
      <span>{props.value.regions.join(" · ") || messages.regionsUnset}</span>
    </div>
    <div className="xcfg-entry-trust"><ShieldCheck size={14} /><span>{messages.trustImported}</span></div>
    <div className="xcfg-entry-actions"><Button onClick={props.onEdit}>{messages.edit}</Button></div>
  </article>;
}

function ReleaseRow(props: { value: CatalogRelease; onEdit: () => void }) {
  return <article className="xcfg-entry">
    <div className="xcfg-entry-icon"><Upload size={19} /></div>
    <div className="xcfg-entry-content">
      <div className="xcfg-entry-title"><strong>{props.value.release_id}</strong><Tag>{messages.releaseConfig}</Tag></div>
      <code>{props.value.manifest_url}</code>
      <span>{props.value.version} · {props.value.platform}/{props.value.architecture}</span>
    </div>
    <div className="xcfg-entry-trust"><ShieldCheck size={14} /><span>{messages.releaseSigned}</span></div>
    <div className="xcfg-entry-actions"><Button onClick={props.onEdit}>{messages.edit}</Button></div>
  </article>;
}

function HistoryView(props: {
  publications: Publication[];
  busy: boolean;
  stale: boolean;
  onRestore: (revision: string) => void;
  onBack: () => void;
}) {
  return <>
    <div className="xcfg-page-heading">
      <div><h1>{messages.history}</h1><p>{messages.historyDescription}</p></div>
      <Button icon={<RefreshCw size={16} />} onClick={props.onBack}>{messages.back}</Button>
    </div>
    <section className="xcfg-list">
      {!props.publications.length ? <div className="xcfg-empty"><History size={26} /><strong>{messages.noPublications}</strong></div> :
        props.publications.map((publication) => (
          <article className="xcfg-history" key={publication.publication_id}>
            <strong>{publication.source_revision.slice(0, 9)}</strong>
            <span>{messages.publicationStatePublished}</span>
            <span>{new Date(publication.published_at).toLocaleString()}</span>
            <Button disabled={props.busy || props.stale} onClick={() => props.onRestore(publication.source_revision)}>{messages.restore}</Button>
          </article>
        ))}
    </section>
  </>;
}

function EditorModal(props: {
  editor: EditableItem | null;
  onChange: (value: EditableItem | null) => void;
  onCancel: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const { editor } = props;
  return <Modal
    title={editor?.index === -1 ? messages.editorAdd : messages.editorEdit}
    open={!!editor}
    onCancel={props.onCancel}
    footer={null}
    destroyOnHidden
  >
    {editor?.type === "endpoint" && (
      <div className="xcfg-editor">
        <label>{messages.type}<Select value={editor.value.kind} onChange={(kind) => props.onChange({
          ...editor, value: { ...editor.value, kind },
        })} options={[
          { value: "relay", label: messages.relay },
          { value: "direct_station", label: messages.directStation },
        ]} /></label>
        <label>{messages.seedId}<Input value={editor.value.seed_id} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, seed_id: event.target.value },
        })} /></label>
        <label>{messages.displayName}<Input value={editor.value.display_name} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, display_name: event.target.value },
        })} /></label>
        <label>{messages.connectionMaterial}<Input.TextArea rows={5} value={editor.value.connection_material_base64} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, connection_material_base64: event.target.value },
        })} /></label>
        {editor.value.kind === "direct_station" && (
          <label>{messages.stationConsent}<Input.TextArea rows={4} value={editor.value.station_advertisement_base64 ?? ""} onChange={(event) => props.onChange({
            ...editor, value: { ...editor.value, station_advertisement_base64: event.target.value },
          })} /></label>
        )}
        <label>{messages.regions}<Input value={editor.value.regions.join(", ")} onChange={(event) => props.onChange({
          ...editor,
          value: {
            ...editor.value,
            regions: event.target.value.split(",").map((value) => value.trim()).filter(Boolean).sort(),
          },
        })} /></label>
        <label>{messages.availableUntil}<Input value={editor.value.available_until ?? ""} placeholder="2026-10-19T00:00:00Z" onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, available_until: event.target.value },
        })} /></label>
        <EditorFooter {...props} />
      </div>
    )}
    {editor?.type === "release" && (
      <div className="xcfg-editor">
        <label>{messages.releaseId}<Input value={editor.value.release_id} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, release_id: event.target.value },
        })} /></label>
        <div className="xcfg-form-grid">
          <label>{messages.platform}<Select value={editor.value.platform} options={platformOptions.map((value) => ({ value }))} onChange={(platform) => props.onChange({
            ...editor, value: { ...editor.value, platform },
          })} /></label>
          <label>{messages.architecture}<Select value={editor.value.architecture} options={architectureOptions.map((value) => ({ value }))} onChange={(architecture) => props.onChange({
            ...editor, value: { ...editor.value, architecture },
          })} /></label>
        </div>
        <div className="xcfg-form-grid">
          <label>{messages.version}<Input value={editor.value.version} onChange={(event) => props.onChange({
            ...editor, value: { ...editor.value, version: event.target.value },
          })} /></label>
          <label>{messages.minimumVersion}<Input value={editor.value.minimum_supported_version} onChange={(event) => props.onChange({
            ...editor, value: { ...editor.value, minimum_supported_version: event.target.value },
          })} /></label>
        </div>
        <label>{messages.manifestUrl}<Input value={editor.value.manifest_url} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, manifest_url: event.target.value },
        })} /></label>
        <label>{messages.manifestSha256}<Input value={editor.value.manifest_sha256} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, manifest_sha256: event.target.value },
        })} /></label>
        <label>{messages.releaseSigningKeyId}<Input value={editor.value.release_signing_key_id} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, release_signing_key_id: event.target.value },
        })} /></label>
        <label>{messages.releaseNotesUrl}<Input value={editor.value.release_notes_url} onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, release_notes_url: event.target.value },
        })} /></label>
        <label>{messages.publishedAt}<Input value={editor.value.published_at} placeholder="2026-10-18T00:00:00Z" onChange={(event) => props.onChange({
          ...editor, value: { ...editor.value, published_at: event.target.value },
        })} /></label>
        <EditorFooter {...props} />
      </div>
    )}
  </Modal>;
}

function EditorFooter(props: {
  editor: EditableItem | null;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <div className="xcfg-editor-footer">
    {props.editor && props.editor.index >= 0 && <Button danger onClick={props.onDelete}>{messages.delete}</Button>}
    <Button onClick={props.onCancel}>{messages.cancel}</Button>
    <Button type="primary" onClick={props.onSave}>{messages.save}</Button>
  </div>;
}

function ReviewModal(props: {
  open: boolean;
  diff: ReturnType<typeof catalogDiff>;
  initial: boolean;
  renewal: boolean;
  findings: Finding[];
  acknowledged: boolean;
  busy: boolean;
  onAcknowledged: (value: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return <Modal title={messages.reviewTitle} open={props.open} onCancel={props.onClose} footer={null} destroyOnHidden>
    <div className="xcfg-diff">
      {props.diff.length ? props.diff.map((item) => (
        <div className="xcfg-diff-item" key={item.id}>
          <strong>{item.label}</strong>
          <span>{item.kind === "added" ? messages.diffAdded : item.kind === "modified" ? messages.diffModified : messages.diffRemoved}</span>
        </div>
      )) : <Alert
        type="info"
        message={
          props.initial
            ? messages.initialPublication
            : props.renewal
              ? messages.renewPublication
              : messages.noUnsavedChanges
        }
      />}
      {props.findings.length ? (
        <Alert type="error" showIcon message={messages.fixValidation} />
      ) : (
        <Alert type="info" showIcon message={messages.publishReady} description={messages.publishBoundary} />
      )}
      <Checkbox checked={props.acknowledged} onChange={(event) => props.onAcknowledged(event.target.checked)}>
        {messages.exactDiff}
      </Checkbox>
      <div className="xcfg-editor-footer">
        <Button onClick={props.onClose} icon={<X size={15} />}>{messages.returnEdit}</Button>
        <Button
          type="primary"
          disabled={
            (!props.diff.length && !props.initial && !props.renewal) ||
            !props.acknowledged ||
            !!props.findings.length ||
            props.busy
          }
          onClick={props.onSubmit}
        >{messages.submit}</Button>
      </div>
    </div>
  </Modal>;
}

function newEndpoint(): EditableItem {
  return {
    type: "endpoint",
    index: -1,
    value: {
      seed_id: "",
      kind: "relay",
      display_name: "",
      connection_material_base64: "",
      regions: [],
      available_until: "",
    },
  };
}

function newRelease(): EditableItem {
  return {
    type: "release",
    index: -1,
    value: {
      release_id: "",
      platform: "macos",
      architecture: "arm64",
      version: "",
      minimum_supported_version: "",
      manifest_url: "",
      manifest_sha256: "",
      release_signing_key_id: "",
      release_notes_url: "",
      published_at: "",
    },
  };
}

function cloneCatalog(value: Catalog): Catalog {
  return JSON.parse(JSON.stringify(value)) as Catalog;
}
