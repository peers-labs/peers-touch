import { useEffect, useId, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { diffLines } from 'diff';
import { ActionGroup, Button, CopyButton } from './actions';
import { Alert, Spin } from './feedback';
import { TextArea } from './fields';
import { useUITokens } from './provider';

/** No arbitrary styles, scripting, frames or remote image requests from document text. */
export function sanitizeDocument(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','strong','em','s','del','blockquote','ul','ol','li','pre','code','a',
      'h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','span'],
    ALLOWED_ATTR: ['href','title','colspan','rowspan'],
    ALLOW_DATA_ATTR: false,
  });
}
export interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  code: string; language?: string; label?: string; copyLabel?: string; copiedLabel?: string; lineNumbers?: boolean; actions?: ReactNode;
}
interface CodeToken { content: string; color?: string }
export function CodeBlock({ code, language = 'text', label, actions, copyLabel = 'Copy code', copiedLabel = 'Copied',
  lineNumbers, className = '', ...props }: CodeBlockProps) {
  const theme = useUITokens(), [tokens, setTokens] = useState<CodeToken[][] | null>(null);
  const [highlightedSource, setHighlightedSource] = useState('');
  useEffect(() => {
    let active = true;
    if (code.length > 100_000) { setTokens(null); return; }
    import('shiki').then(async engine => {
      const result = await engine.codeToTokens(code, {
        lang: language in engine.bundledLanguages ? language as keyof typeof engine.bundledLanguages : 'text',
        theme: theme.color.canvas === '#111318' ? 'github-dark' : 'github-light',
      });
      if (active) { setTokens(result.tokens); setHighlightedSource(code); }
    }).catch(() => { if (active) setTokens(null); });
    return () => { active = false; };
  }, [code, language, theme]);
  const lines: CodeToken[][] = tokens && highlightedSource === code ? tokens : code.split('\n').map(content => [{content}]);
  return <div {...props} className={`pt-code ${className}`}>
    <div className="pt-code-toolbar"><span>{label ?? language}</span>
      <ActionGroup label="Code actions"><CopyButton actionId="code.copy" label={copyLabel} copiedLabel={copiedLabel} text={code} emphasis="quiet" density="compact" />{actions}</ActionGroup></div>
    <pre aria-label={label}><code>{lines.map((line, i) => <span className="pt-code-line" key={i}>{lineNumbers && <span className="pt-line-number" aria-hidden="true">{i+1}</span>}
        {line.map((token,j) => <span key={j} style={{color:token.color}}>{token.content}</span>)}{i < code.split('\n').length-1 ? '\n' : ''}</span>)}</code></pre>
  </div>;
}
export function CodeSnippet(props: CodeBlockProps) { return <CodeBlock {...props} />; }
export interface CodeEditorProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string; onValueChange: (value: string) => void; label: string; language?: string; readOnly?: boolean;
  rows?: number; onCommit?: (value: string) => void; commitLabel?: string;
}
export function CodeEditor({ value, onValueChange, label, language = 'text', readOnly, rows = 12,
  onCommit, commitLabel = 'Save', ...props }: CodeEditorProps) {
  return <div {...props} className={`pt-code-editor ${props.className ?? ''}`}>
    <label>{label}<TextArea value={value} rows={rows} readOnly={readOnly} spellCheck={false}
      aria-label={label} style={{fontFamily:'var(--pt-mono)'}} onChange={event => onValueChange(event.target.value)}
      onKeyDown={event => {
        if (event.key !== 'Tab' || readOnly || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        const target = event.currentTarget, start = target.selectionStart, end = target.selectionEnd;
        target.setRangeText('  ', start, end, 'end');
        onValueChange(target.value);
      }} /></label>
    <div className="pt-code-toolbar"><span>{language}</span>{onCommit && <Button actionId="editor.commit" label={commitLabel}
      availability={readOnly ? {kind:'disabled',reason:'Read only'} : undefined} onActivate={() => onCommit(value)} />}</div>
  </div>;
}
export interface CodeDiffProps extends HTMLAttributes<HTMLDivElement> { before: string; after: string; beforeLabel: string; afterLabel: string; }
export function CodeDiff({ before, after, beforeLabel, afterLabel, ...props }: CodeDiffProps) {
  const changes = useMemo(() => diffLines(before, after), [before, after]);
  return <div {...props} className={`pt-code-diff ${props.className ?? ''}`} aria-label={`${beforeLabel} → ${afterLabel}`}>
    <div className="pt-code-toolbar">{beforeLabel} → {afterLabel}</div>
    <pre>{changes.map((change,i) => <span key={i} className="pt-diff-line" data-change={change.added?'added':change.removed?'removed':'same'}>
      <span className="pt-diff-kind">{change.added?'+':change.removed?'−':' '}</span>{change.value}</span>)}</pre>
  </div>;
}
export interface DiagramPreviewProps { source: string; label: string; }
let diagramQueue = Promise.resolve();
export function DiagramPreview({ source, label }: DiagramPreviewProps) {
  const id = useId().replace(/[^a-z0-9]/gi,''), [result,setResult] = useState<{source:string;svg:string;error?:string} | null>(null);
  useEffect(() => {
    let active = true;
    diagramQueue = diagramQueue.then(async () => {
      try {
        const { default: engine } = await import('mermaid');
        engine.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 50_000, suppressErrorRendering: true });
        const rendered = await engine.render(`ptdiagram${id}`, source);
        const svg = DOMPurify.sanitize(rendered.svg, {USE_PROFILES:{svg:true,svgFilters:true}, FORBID_TAGS:['foreignObject','image','a']});
        if (active) setResult({source,svg});
      } catch { if (active) setResult({source,svg:'',error:'Diagram could not be rendered.'}); }
    });
    return () => { active = false; };
  }, [source, id]);
  if (result?.source !== source) return <Spin label="Rendering diagram" />;
  if (result.error) return <Alert tone="danger" title={result.error} description={<pre>{source}</pre>} />;
  return <figure className="pt-diagram" aria-label={label}><div dangerouslySetInnerHTML={{__html:result.svg}} /><figcaption>{label}</figcaption></figure>;
}
export function ShortcutHint({ keys, label }: {keys: readonly string[]; label?: string}) {
  return <span aria-label={label ?? keys.join('+')} className="pt-shortcut">{keys.map((key,i) => <kbd key={`${i}-${key}`}>{key}</kbd>)}</span>;
}
export interface SecretValueProps { value: string; label: string; revealed: boolean; onRevealChange: (value: boolean) => void; copyAllowed?: boolean; }
export function SecretValue({ value, label, revealed, onRevealChange, copyAllowed }: SecretValueProps) {
  return <ActionGroup label={label}><code aria-label={revealed?label:`${label}: hidden`}>{revealed?value:'••••••••'}</code>
    <Button actionId="secret.reveal" label={revealed?'Hide':'Reveal'} onActivate={() => onRevealChange(!revealed)} />
    {copyAllowed && <CopyButton actionId="secret.copy" label="Copy" copiedLabel="Copied" text={value} />}</ActionGroup>;
}
export function HighlightText({ text, query }: {text:string;query:string}) {
  if (!query) return <>{text}</>;
  const lower=text.toLocaleLowerCase(), needle=query.toLocaleLowerCase(), pieces:ReactNode[]=[];
  let start=0, index=lower.indexOf(needle);
  while(index>=0) { pieces.push(text.slice(start,index),<mark key={index}>{text.slice(index,index+query.length)}</mark>); start=index+query.length; index=lower.indexOf(needle,start); }
  pieces.push(text.slice(start)); return <>{pieces}</>;
}
