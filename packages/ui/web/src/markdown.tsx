import { createElement, useEffect, useId, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Marked, type TokenizerExtension, type RendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import type { ResourceView } from '@peers-touch/ui-contracts';
import { CodeBlock, DiagramPreview, sanitizeDocument } from './content';
import { Image } from './media';
import 'katex/dist/katex.min.css';

export interface DocumentCode { code: string; language: string }
export interface DocumentImage { source: string; alt: string; title?: string }
export interface MarkdownProps extends HTMLAttributes<HTMLDivElement> {
  content: string;
  features?: { math?: boolean; diagrams?: boolean; footnotes?: boolean; alerts?: boolean };
  streaming?: boolean;
  renderReasoning?: (content: string) => ReactNode;
  codeActions?: (block: DocumentCode) => ReactNode;
  resolveImage?: (image: DocumentImage) => ResourceView | undefined;
}
type Slot = { kind: 'code'; code: string; language: string }
  | { kind: 'reasoning' | 'math'; text: string; display?: boolean }
  | { kind: 'image'; source: string; alt: string; title?: string };

function MathContent({ text, display }: { text: string; display?: boolean }) {
  const [rendered, setRendered] = useState<{ text: string; display?: boolean; html: string }>();
  useEffect(() => {
    let active = true;
    if (text.length > 20_000) return;
    import('katex').then(({ default: engine }) => {
      const html = engine.renderToString(text, {
        displayMode: display, throwOnError: false, trust: false, strict: 'warn', maxExpand: 1000,
      });
      if (active) setRendered({ text, display, html });
    }).catch(() => {});
    return () => { active = false; };
  }, [text, display]);
  // KaTeX owns this generated markup; trust:false prohibits URL/HTML extensions.
  return rendered?.text === text && rendered.display === display
    ? <span className="pt-math" dangerouslySetInnerHTML={{ __html: rendered.html }} />
    : <code aria-label="Mathematical expression">{text}</code>;
}

function compileDocument(content: string, features: MarkdownProps['features'], id: string) {
  const slots: Slot[] = [], definitions = new Map<string, string>(), references = new Map<string, number>();
  const slot = (value: Slot) => `<pt-slot data-pt-slot="${slots.push(value) - 1}"></pt-slot>`;
  const extensions: (TokenizerExtension & RendererExtension)[] = [{
    name: 'peersReasoning', level: 'inline', start: source => source.indexOf('<think>'),
    tokenizer(source) {
      if (!source.startsWith('<think>')) return;
      const end = source.indexOf('</think>', 7), raw = end < 0 ? source : source.slice(0, end + 8);
      return { type: 'peersReasoning', raw, text: raw.slice(7, end < 0 ? undefined : -8) };
    },
    renderer: token => slot({ kind: 'reasoning', text: token.text }),
  }];
  if (features?.math) extensions.push({
    name: 'peersMath', level: 'inline', start: source => source.search(/\$|\\\(|\\\[/),
    tokenizer(source) {
      const match = /^(\$\$|\\\[)([\s\S]+?)(?:\$\$|\\\])/.exec(source)
        ?? /^(\\\()([\s\S]+?)\\\)/.exec(source)
        ?? /^(\$)(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/.exec(source);
      if (!match) return;
      return { type: 'peersMath', raw: match[0], text: match[2], display: match[1] === '$$' || match[1] === '\\[' };
    },
    renderer: token => slot({ kind: 'math', text: token.text, display: token.display }),
  });
  if (features?.footnotes) {
    content = content.replace(/^\[\^([^\]\n]+)\]:[ \t]*(.*)((?:\n(?: {4}|\t).*)*)/gm, (_, name, body, continuation) => {
      definitions.set(name, `${body}${continuation.replace(/\n(?: {4}|\t)/g, '\n')}`);
      return '';
    });
    extensions.push({
      name: 'peersFootnote', level: 'inline', start: source => source.indexOf('[^'),
      tokenizer(source) {
        const match = /^\[\^([^\]\n]+)\]/.exec(source);
        if (!match || !definitions.has(match[1])) return;
        return { type: 'peersFootnote', raw: match[0], name: match[1] };
      },
      renderer(token) {
        if (!references.has(token.name)) references.set(token.name, references.size + 1);
        const number = references.get(token.name)!;
        return `<sup><a href="#${id}-note-${number}">${number}</a></sup>`;
      },
    });
  }
  const engine = new Marked({
    gfm: true, extensions,
    renderer: {
      code: token => slot({ kind: 'code', code: token.text, language: token.lang?.split(/\s/)[0] ?? 'text' }),
      // Raw HTML can never forge a renderer slot or acquire event/resource attributes.
      html: token => {
        const match = /^<think>([\s\S]*?)(?:<\/think>|$)/.exec(token.text);
        return match ? slot({ kind: 'reasoning', text: match[1] }) : sanitizeDocument(token.text);
      },
      image: token => slot({ kind: 'image', source: token.href, alt: token.text, title: token.title ?? undefined }),
      blockquote(token) {
        const body = this.parser.parse(token.tokens);
        if (!features?.alerts) return `<blockquote>${body}</blockquote>`;
        const match = /^(<p>)?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(body);
        return match
          ? `<blockquote aria-label="${match[2].toLowerCase()}">${match[1] ?? ''}<strong>${match[2]}</strong> ${body.slice(match[0].length)}</blockquote>`
          : `<blockquote>${body}</blockquote>`;
      },
    },
  });
  let html = engine.parse(content, { async: false });
  if (references.size) {
    html += `<section aria-label="Footnotes"><ol>`;
    for (const [name, number] of [...references]) {
      html += `<li id="${id}-note-${number}">${engine.parse(definitions.get(name)!, { async: false })}</li>`;
    }
    html += '</ol></section>';
  }
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','strong','em','s','del','blockquote','ul','ol','li','pre','code','a',
      'h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','span','sup','section','input','pt-slot'],
    ALLOWED_ATTR: ['href','title','colspan','rowspan','id','aria-label','data-pt-slot','type','checked','disabled'],
    ALLOW_DATA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  return { fragment, slots };
}

export function Markdown({ content, features, streaming, renderReasoning, codeActions, resolveImage,
  className = '', ...props }: MarkdownProps) {
  const id = `pt-document-${useId().replace(/[^a-z0-9]/gi, '')}`;
  const document = useMemo(() => content.length <= 1_000_000
    ? compileDocument(content, features, id) : undefined, [content, features, id]);
  const render = (node: Node, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === 'pt-slot') {
      const item = document?.slots[Number(node.getAttribute('data-pt-slot'))];
      if (!item) return null;
      if (item.kind === 'code') return features?.diagrams && item.language === 'mermaid'
        ? <DiagramPreview key={key} source={item.code} label="Diagram" />
        : <CodeBlock key={key} code={item.code} language={item.language} actions={codeActions?.(item)} />;
      if (item.kind === 'math') return <MathContent key={key} text={item.text} display={item.display} />;
      if (item.kind === 'reasoning') return <div key={key}>{renderReasoning?.(item.text)
        ?? <details><summary>Reasoning</summary><div style={{ whiteSpace: 'pre-wrap' }}>{item.text}</div></details>}</div>;
      if (item.kind === 'image') {
        const resource = resolveImage?.(item);
        return resource ? <Image key={key} resource={resource} alt={item.alt} preview /> : <span key={key}>{item.alt || 'Image'}</span>;
      }
      return null;
    }
    const attributes: Record<string, unknown> = { key };
    for (const attr of [...node.attributes]) {
      if (attr.name === 'colspan') attributes.colSpan = Number(attr.value);
      else if (attr.name === 'rowspan') attributes.rowSpan = Number(attr.value);
      else if (!['data-pt-slot','checked','disabled'].includes(attr.name)) attributes[attr.name] = attr.value;
    }
    if (tag === 'a') { attributes.rel = 'noopener noreferrer'; attributes.target = attributes.href?.toString().startsWith('#') ? undefined : '_blank'; }
    if (tag === 'input') return <input key={key} type="checkbox" disabled checked={node.hasAttribute('checked')} readOnly />;
    return createElement(tag, attributes, ...[...node.childNodes].map((child, index) => render(child, `${key}.${index}`)));
  };
  return <div {...props} className={`pt-document ${className}`} aria-busy={streaming || undefined}>
    {document ? [...document.fragment.childNodes].map((node, index) => render(node, String(index))) : <pre>{content}</pre>}
  </div>;
}
