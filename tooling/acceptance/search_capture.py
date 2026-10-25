"""Search-owned native capture predicates shared by business Gate runners."""

CAPTURE_START_JS = """
window.__PT_SEARCH_CAPTURE_WATCH__?.observer.disconnect();
const watch = {revision: 0};
watch.observer = new MutationObserver(() => { watch.revision += 1; });
watch.observer.observe(document.body, {
  childList: true, subtree: true, characterData: true, attributes: true,
});
window.__PT_SEARCH_CAPTURE_WATCH__ = watch;
"""
CAPTURE_END_JS = """
window.__PT_SEARCH_CAPTURE_WATCH__?.observer.disconnect();
delete window.__PT_SEARCH_CAPTURE_WATCH__;
"""
CAPTURE_PAINT_JS = """
const done = arguments[arguments.length - 1];
let finished = false;
const finish = value => { if (!finished) { finished = true; done(value); } };
const timeout = setTimeout(() => finish(false), arguments[0]);
requestAnimationFrame(() => requestAnimationFrame(() => {
  clearTimeout(timeout);
  finish(true);
}));
"""

# Use the native WebView's styles, clipping and hit testing, never box size alone.
TARGET_VISIBILITY_JS = """
const targetVisibility = (element, fully = true) => {
  if (!element?.isConnected) return {visible: false, reason: 'missing'};
  const rect = element.getBoundingClientRect();
  const viewport = window.visualViewport;
  let left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  let right = Math.min(innerWidth, left + (viewport?.width || innerWidth));
  let bottom = Math.min(innerHeight, top + (viewport?.height || innerHeight));
  let opacity = 1, motion = false;
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    opacity *= Number(style.opacity);
    motion ||= node.getAnimations().some(
      animation => animation.pending || animation.playState === 'running');
    if (style.display === 'none' || style.visibility !== 'visible'
        || style.contentVisibility === 'hidden' || opacity < 0.99
        || (style.clipPath && style.clipPath !== 'none')
        || (style.clip && style.clip !== 'auto')) {
      return {visible: false, reason: 'style', opacity, motion};
    }
    if (node !== element) {
      const box = node.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip', 'overlay'].includes(style.overflowX)) {
        left = Math.max(left, box.left + node.clientLeft);
        right = Math.min(right, box.left + node.clientLeft + node.clientWidth);
      }
      if (['auto', 'scroll', 'hidden', 'clip', 'overlay'].includes(style.overflowY)) {
        top = Math.max(top, box.top + node.clientTop);
        bottom = Math.min(bottom, box.top + node.clientTop + node.clientHeight);
      }
    }
  }
  const intersection = {
    left: Math.max(left, rect.left), top: Math.max(top, rect.top),
    right: Math.min(right, rect.right), bottom: Math.min(bottom, rect.bottom),
  };
  const fits = !fully || (rect.left >= left - 1 && rect.right <= right + 1
    && rect.top >= top - 1 && rect.bottom <= bottom + 1);
  if (motion || !fits || rect.width <= 0 || rect.height <= 0
      || intersection.right <= intersection.left || intersection.bottom <= intersection.top) {
    return {visible: false, reason: motion ? 'motion' : 'clipped', opacity, intersection};
  }
  const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
  const unobscured = points.every(([x, y]) => {
    const hit = document.elementFromPoint(
      intersection.left + (intersection.right - intersection.left) * x,
      intersection.top + (intersection.bottom - intersection.top) * y);
    return !!hit && (hit === element || element.contains(hit));
  });
  // Hit testing skips pointer-events:none paint. Inspect that paint independently,
  // conservatively rejecting an overlapping layer not demonstrably behind us.
  const stack = (node, pseudoStyle) => {
    const chain = [];
    const context = (parent, style) =>
      parent === document.documentElement
      || (style.zIndex !== 'auto' && style.zIndex
        && (style.position !== 'static' || ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(
          getComputedStyle(parent.parentElement).display)))
      || ['fixed', 'sticky'].includes(style.position)
      || Number(style.opacity) < 1 || style.isolation === 'isolate'
      || ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter',
        'backdropFilter', 'clipPath', 'maskImage'].some(key => style[key] && style[key] !== 'none')
      || (style.mixBlendMode && style.mixBlendMode !== 'normal')
      || /paint|layout|strict|content/.test(style.contain || '')
      || /transform|translate|rotate|scale|opacity|filter|perspective|clip-path|mask/.test(
        style.willChange || '');
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (context(parent, style)) chain.unshift({node: parent, style});
    }
    if (pseudoStyle && context(node, pseudoStyle)) {
      chain.push({node, style: pseudoStyle, pseudo: true});
    }
    return chain;
  };
  const above = (candidate, pseudoStyle) => {
    const front = stack(candidate, pseudoStyle), back = stack(element);
    let index = 0;
    while (front[index] && back[index] && front[index].node === back[index].node
        && front[index].pseudo === back[index].pseudo) index++;
    const a = front[index] || {node: candidate, style: pseudoStyle || getComputedStyle(candidate)};
    const b = back[index] || {node: element, style: getComputedStyle(element)};
    const az = front[index] ? Number.parseInt(a.style.zIndex) || 0 : 0;
    const bz = back[index] ? Number.parseInt(b.style.zIndex) || 0 : 0;
    if (az !== bz) return az > bz;
    // An ancestor's generated child can paint above its own descendants.
    // Equal-level generated paint is not proven behind by host DOM order.
    if (pseudoStyle && (candidate === element || candidate.contains(element))) return true;
    if (a.style.position !== 'static'
        && b.style.position === 'static') return true;
    return !(a.node.compareDocumentPosition(b.node) & 4);
  };
  const transparent = color => color === 'transparent'
    || /^(?:rgba\\(.+,|.+\\/)\\s*0(?:\\.0+)?\\s*\\)$/.test(color || '');
  const outlined = style => Number.parseFloat(style.outlineWidth) > 0
    && !['none', 'hidden'].includes(style.outlineStyle)
    && !transparent(style.outlineColor);
  const painted = (node, style, pseudo = false, includeOutline = true) => {
    const background = style.backgroundColor || '';
    return (background && background !== 'transparent'
        && !transparent(background))
      || (style.backgroundImage && style.backgroundImage !== 'none')
      || ['Top', 'Right', 'Bottom', 'Left'].some(edge =>
        Number.parseFloat(style['border' + edge + 'Width']) > 0
        && !['none', 'hidden'].includes(style['border' + edge + 'Style']))
      || (style.boxShadow && style.boxShadow !== 'none')
      || (style.textShadow && style.textShadow !== 'none')
      || (style.backdropFilter && style.backdropFilter !== 'none')
      || (includeOutline && outlined(style))
      || (pseudo ? !['""', "''"].includes(style.content)
        : ['IMG', 'CANVAS', 'VIDEO', 'SVG'].includes(node.tagName)
          || [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()));
  };
  const px = value => /^-?(?:\\d+\\.?\\d*|\\.\\d+)px$/.test(value)
    ? Number.parseFloat(value) : null;
  const pseudoBox = (node, style) => {
    if (!['absolute', 'fixed'].includes(style.position)) return null;
    let containing = null;
    for (let parent = node; parent; parent = parent.parentElement) {
      const value = getComputedStyle(parent);
      if (['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter',
          'backdropFilter'].some(key => value[key] && value[key] !== 'none')
          || /transform|filter|perspective/.test(value.willChange || '')
          || /paint|layout|strict|content/.test(value.contain || '')
          || (value.zoom && !['1', 'normal'].includes(value.zoom))) return null;
      if (!containing && value.position !== 'static') containing = parent;
    }
    if (!['""', "''"].includes(style.content)
        || ['transform', 'translate', 'rotate', 'scale', 'filter', 'boxShadow',
          'textShadow', 'backdropFilter'].some(key => style[key] && style[key] !== 'none')
        || style.direction === 'rtl'
        || (containing && (getComputedStyle(containing).display === 'contents'
          || containing.getClientRects().length !== 1))) return null;
    const base = style.position === 'absolute' && containing
      ? {left: containing.getBoundingClientRect().left + containing.clientLeft
            - containing.scrollLeft,
         top: containing.getBoundingClientRect().top + containing.clientTop
            - containing.scrollTop,
         width: containing.clientWidth, height: containing.clientHeight}
      : {left: 0, top: 0, width: document.documentElement?.clientWidth || innerWidth,
         height: document.documentElement?.clientHeight || innerHeight};
    const axis = (origin, extent, startValue, endValue, size, edges) => {
      const start = px(startValue), end = px(endValue);
      if ((start === null && startValue !== 'auto')
          || (end === null && endValue !== 'auto')) return null;
      const margins = edges.map(edge => px(style['margin' + edge]));
      const extras = edges.map(edge => (
        px(style['padding' + edge]) ?? NaN) + (px(style['border' + edge + 'Width']) ?? NaN));
      if (margins.some(value => value === null) || extras.some(value => !Number.isFinite(value))) {
        return null;
      }
      let length = px(size);
      if (length !== null && style.boxSizing !== 'border-box') {
        length += extras[0] + extras[1];
      }
      if (length === null && size === 'auto' && start !== null && end !== null) {
        length = extent - start - end - margins[0] - margins[1];
      }
      if (length === null || !Number.isFinite(length) || length < 0) return null;
      const offset = start !== null ? start + margins[0]
        : end !== null ? extent - end - length - margins[1] : null;
      return offset === null ? null : [origin + offset, origin + offset + length];
    };
    const x = axis(base.left, base.width, style.left, style.right,
      style.width, ['Left', 'Right']);
    const y = axis(base.top, base.height, style.top, style.bottom,
      style.height, ['Top', 'Bottom']);
    return x && y && [...x, ...y].every(Number.isFinite)
      ? {left: x[0], right: x[1], top: y[0], bottom: y[1]} : null;
  };
  const overlaps = box => box.right > intersection.left && box.left < intersection.right
    && box.bottom > intersection.top && box.top < intersection.bottom;
  const paintOverlaps = (box, node, style, pseudo = false) => {
    if (!['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(box[key]))
        || box.right < box.left || box.bottom < box.top) return true;
    if (painted(node, style, pseudo, false) && overlaps(box)) return true;
    if (!outlined(style)) return false;
    const width = px(style.outlineWidth), offset = px(style.outlineOffset);
    if (width === null || offset === null) return true;
    for (let parent = node; parent; parent = parent.parentElement) {
      const value = getComputedStyle(parent);
      if (['transform', 'translate', 'rotate', 'scale', 'perspective'].some(
          key => value[key] && value[key] !== 'none')
          || (value.zoom && !['1', 'normal'].includes(value.zoom))) return true;
    }
    const inner = {left: box.left - offset, right: box.right + offset,
      top: box.top - offset, bottom: box.bottom + offset};
    const outer = {left: inner.left - width, right: inner.right + width,
      top: inner.top - width, bottom: inner.bottom + width};
    if (![...Object.values(inner), ...Object.values(outer)].every(Number.isFinite)
        || inner.right < inner.left || inner.bottom < inner.top) return true;
    // An outline paints edge bands, never the transparent interior of its host.
    return [
      {left: outer.left, right: outer.right, top: outer.top, bottom: inner.top},
      {left: outer.left, right: outer.right, top: inner.bottom, bottom: outer.bottom},
      {left: outer.left, right: inner.left, top: inner.top, bottom: inner.bottom},
      {left: inner.right, right: outer.right, top: inner.top, bottom: inner.bottom},
    ].some(overlaps);
  };
  const paintCover = node => {
    let alpha = 1;
    for (let parent = node; parent; parent = parent.parentElement) {
      const ancestor = getComputedStyle(parent);
      alpha *= Number(ancestor.opacity);
      if (!Number.isFinite(alpha)) return true;
      if (ancestor.display === 'none'
          || ancestor.contentVisibility === 'hidden' || alpha <= 0) return false;
    }
    const style = getComputedStyle(node);
    if (node !== element && !node.contains(element) && !element.contains(node)
        && style.pointerEvents === 'none' && style.visibility === 'visible'
        && painted(node, style) && above(node)) {
      if (['boxShadow', 'textShadow', 'filter', 'backdropFilter'].some(
          key => style[key] && style[key] !== 'none')) return true;
      const boxes = [...node.getClientRects()];
      if (boxes.some(box => paintOverlaps(box, node, style))) return true;
    }
    for (const pseudo of ['::before', '::after']) {
      const value = getComputedStyle(node, pseudo);
      if (!value.content) return true;
      if (['none', 'normal'].includes(value.content) || value.display === 'none'
          || value.visibility !== 'visible' || Number(value.opacity) <= 0) continue;
      if (!Number.isFinite(Number(value.opacity))) return true;
      if (!painted(node, value, true) || !above(node, value)) continue;
      const box = pseudoBox(node, value);
      // CSSOM has no portable pseudo-element rect API. Unresolved potentially
      // front paint must fail closed, never fall back to the host's rectangle.
      if (!box || paintOverlaps(box, node, value, true)) return true;
    }
    return false;
  };
  let noninteractiveCover;
  try {
    noninteractiveCover = [...document.querySelectorAll('*')].some(paintCover);
  } catch {
    return {visible: false, reason: 'paint-unqualified', opacity, intersection};
  }
  return {visible: unobscured && !noninteractiveCover,
    reason: noninteractiveCover ? 'noninteractive-cover' : unobscured ? '' : 'occluded',
    opacity, intersection};
};
"""

# Observe continuity across the existing 2s Search timer without invoking reconcile.
SEARCH_CONTINUITY_START_JS = """
const root = document.querySelector(arguments[0]);
if (!root) return null;
const rows = [...root.querySelectorAll(arguments[1])];
const anchor = rows.find(row => row.getBoundingClientRect().bottom
  > root.getBoundingClientRect().top);
const snapshot = () => ({
  items: rows.map(row => ({id: row.dataset.resourceId, text: row.innerText})),
  scrollTop: root.scrollTop,
  anchor: anchor?.dataset.resourceId || '',
  anchorTop: anchor?.getBoundingClientRect().top ?? null,
});
window.__PT_SEARCH_CONTINUITY__ = {root, rows, anchor, started: performance.now()};
return snapshot();
"""
SEARCH_CONTINUITY_END_JS = """
const previous = window.__PT_SEARCH_CONTINUITY__;
const root = document.querySelector(arguments[0]);
const rows = root ? [...root.querySelectorAll(arguments[1])] : [];
const anchor = rows.find(row => row.getBoundingClientRect().bottom
  > root.getBoundingClientRect().top);
return {
  elapsedMs: previous ? performance.now() - previous.started : 0,
  sameNodes: !!previous && root === previous.root && rows.length === previous.rows.length
    && rows.every((row, index) => row === previous.rows[index]),
  items: rows.map(row => ({id: row.dataset.resourceId, text: row.innerText})),
  scrollTop: root?.scrollTop,
  anchor: anchor?.dataset.resourceId || '',
  anchorTop: anchor?.getBoundingClientRect().top ?? null,
};
"""
