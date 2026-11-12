/** In-page scripts for keyboard and focus testing. Read-only: they observe, they never submit or navigate. */

/** Visual state of every focusable element before any focus moves. */
export const BLURRED_SNAPSHOT_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const snap = (el) => {
    const cs = getComputedStyle(el);
    return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset, cs.boxShadow, cs.borderTopColor, cs.borderTopWidth,
      cs.backgroundColor, cs.textDecorationLine, cs.color, cs.opacity, cs.transform, cs.filter].join('|');
  };
  window.__aa.snap = snap;
  const map = {};
  for (const el of a.focusables()) map[a.cssPath(el)] = snap(el);
  return map;
})()`;

/** Describe document.activeElement after a key press. */
export const ACTIVE_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const inViewport = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  return {
    selector: a.cssPath(el), snippet: a.snippet(el), snap: a.snap ? a.snap(el) : '',
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow,
    hidden: r.width <= 1 || r.height <= 1 || cs.visibility === 'hidden' || cs.opacity === '0' || !inViewport,
    tag: el.tagName.toLowerCase(),
  };
})()`;

/** Is there an open dialog, and does it contain focus? */
export const DIALOG_STATE_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const d = Array.from(document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]')).find((e) => a.visible(e));
  if (!d) return null;
  const ae = document.activeElement;
  return {
    selector: a.cssPath(d), snippet: a.snippet(d), modal: d.getAttribute('aria-modal') === 'true' || (d.tagName === 'DIALOG' && d.matches(':modal')),
    focusInside: !!ae && d.contains(ae), active: ae ? a.cssPath(ae) : null, focusables: Array.from(d.querySelectorAll(a.FOCUSABLE)).filter(a.visible).length,
  };
})()`;

export const DIALOG_TRIGGERS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  for (const el of document.querySelectorAll('button,[role=button]')) {
    if (!a.visible(el) || el.disabled) continue;
    const pop = el.getAttribute('aria-haspopup');
    const ctl = el.getAttribute('aria-controls');
    const target = ctl ? document.getElementById(ctl) : null;
    const opensDialog = pop === 'dialog' || (target && (target.tagName === 'DIALOG' || /^(alert)?dialog$/.test(target.getAttribute('role') || '')));
    if (opensDialog) out.push({ selector: a.cssPath(el), snippet: a.snippet(el) });
  }
  return out.slice(0, 3);
})()`;

export const DISCLOSURE_TRIGGERS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  for (const el of document.querySelectorAll('button[aria-expanded],[role=button][aria-expanded]')) {
    if (!a.visible(el) || el.disabled || el.getAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') continue;
    if (el.closest('a[href],form')) continue;
    const ctl = el.getAttribute('aria-controls');
    const target = ctl ? document.getElementById(ctl) : null;
    out.push({ selector: a.cssPath(el), snippet: a.snippet(el), expanded: el.getAttribute('aria-expanded'), targetSelector: target ? a.cssPath(target) : null });
  }
  return out.slice(0, 4);
})()`;

export const MENU_TRIGGERS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  for (const el of document.querySelectorAll('[aria-haspopup]:not([aria-haspopup=false]):not([aria-haspopup=dialog])')) {
    if (!a.visible(el) || el.disabled || el.matches('a[href]')) continue;
    out.push({ selector: a.cssPath(el), snippet: a.snippet(el), expanded: el.getAttribute('aria-expanded') });
  }
  return out.slice(0, 3);
})()`;

export const TABS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  for (const list of document.querySelectorAll('[role=tablist]')) {
    const tabs = Array.from(list.querySelectorAll('[role=tab]')).filter(a.visible);
    if (tabs.length < 2) continue;
    const idle = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
    if (!idle) continue;
    out.push({ list: a.cssPath(list), tab: a.cssPath(idle), snippet: a.snippet(idle), panelId: idle.getAttribute('aria-controls') });
  }
  return out.slice(0, 2);
})()`;

/** Read a few attributes of one element; returns null when the selector no longer matches. */
export const ATTRS_FN = String.raw`(arg) => {
  let el = null;
  try { el = document.querySelector(arg.selector); } catch { el = null; }
  if (!el) return null;
  const t = arg.targetSelector ? document.querySelector(arg.targetSelector) : null;
  return {
    expanded: el.getAttribute('aria-expanded'), selected: el.getAttribute('aria-selected'),
    targetVisible: t ? window.__aa.visible(t) : null,
  };
}`;

export const PANEL_VISIBLE_FN = String.raw`(id) => { const p = id ? document.getElementById(id) : null; return p ? window.__aa.visible(p) : null; }`;

/** Passive observer for text changes that no live region covers. Installed once, read later. */
export const OBSERVER_SETUP_SCRIPT = String.raw`(() => {
  if (window.__aaMut) return;
  window.__aaMut = [];
  const a = window.__aa;
  new MutationObserver((list) => {
    for (const m of list) {
      const node = m.type === 'characterData' ? m.target.parentElement : m.target;
      if (!node || !(node instanceof Element) || !a.visible(node)) continue;
      const added = m.type === 'characterData' ? (m.target.textContent || '').trim() : Array.from(m.addedNodes).map((n) => (n.textContent || '').trim()).join(' ').trim();
      if (!added) continue;
      if (window.__aaMut.length < 10) window.__aaMut.push({ selector: a.cssPath(node), snippet: a.snippet(node), live: a.live(node), text: added.slice(0, 120) });
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})()`;

export const OBSERVER_READ_SCRIPT = String.raw`(() => (window.__aaMut || []).splice(0))()`;
