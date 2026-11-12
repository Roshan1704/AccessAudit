/**
 * Scripts that run inside the scanned page. They are plain strings so the engine package does not
 * need the DOM lib, and so nothing from the page is ever evaluated in Node. Every helper is read-only:
 * it never submits, navigates or writes to storage.
 */

/** Installs window.__aa helpers once per document. */
export const HELPERS_SCRIPT = String.raw`(() => {
  if (window.__aa) return;
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"],iframe';
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id && document.querySelectorAll('#' + esc(n.id)).length === 1) { parts.unshift('#' + esc(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const p = n.parentElement;
      if (p) {
        const same = Array.from(p.children).filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(part);
      if (n === document.body) break;
    }
    return parts.join(' > ');
  };
  const snippet = (el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 400);
  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelledBy = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => { const t = document.getElementById(id); return t ? text(t) : ''; }).join(' ').trim();
  };
  // Approximation of the accessible name computation (aria-labelledby, aria-label, native label, content, title).
  const accName = (el) => {
    const lb = labelledBy(el);
    if (lb) return { name: lb, source: 'aria-labelledby' };
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return { name: al, source: 'aria-label' };
    if (el.labels && el.labels.length) {
      const t = Array.from(el.labels).map(text).join(' ').trim();
      if (t) return { name: t, source: 'label' };
    }
    if (el.tagName === 'IMG' || el.tagName === 'AREA') {
      const alt = (el.getAttribute('alt') || '').trim();
      if (alt) return { name: alt, source: 'alt' };
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) return { name: el.value, source: 'value' };
    const t = text(el);
    if (t) return { name: t, source: 'content' };
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return { name: img.getAttribute('alt').trim(), source: 'img-alt' };
    const title = (el.getAttribute('title') || '').trim();
    if (title) return { name: title, source: 'title' };
    const ph = (el.getAttribute('placeholder') || '').trim();
    if (ph) return { name: ph, source: 'placeholder' };
    return { name: '', source: 'none' };
  };
  const styleOf = (el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow,
      display: cs.display, visibility: cs.visibility, position: cs.position, cursor: cs.cursor,
    };
  };
  const focusables = () => Array.from(document.querySelectorAll(FOCUSABLE)).filter((e) => visible(e) && !e.disabled && e.tabIndex >= 0);
  const live = (el) => !!el.closest('[aria-live]:not([aria-live=off]),[role=status],[role=alert],[role=log],output');
  window.__aa = { FOCUSABLE, visible, cssPath, snippet, text, accName, styleOf, focusables, live };
})()`;

/** Resolve an axe target (single-document selector) to evidence about the element. */
export const ENRICH_FN = String.raw`(selectors) => {
  const out = {};
  for (const s of selectors) {
    let el = null;
    try { el = document.querySelector(s); } catch { el = null; }
    if (!el) continue;
    out[s] = { style: window.__aa.styleOf(el), accessibleName: window.__aa.accName(el), role: el.getAttribute('role'), tag: el.tagName.toLowerCase() };
  }
  return out;
}`;

/** Facts about the DOM used for coverage and context (DOM analysis). */
export const DOM_FACTS_SCRIPT = String.raw`(() => {
  const q = (s) => document.querySelectorAll(s).length;
  return {
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    elements: document.getElementsByTagName('*').length,
    headings: q('h1,h2,h3,h4,h5,h6,[role=heading]'),
    h1: q('h1'),
    landmarks: q('main,nav,header,footer,aside,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[role=region]'),
    links: q('a[href]'),
    buttons: q('button,[role=button],input[type=button],input[type=submit]'),
    forms: q('form'),
    formControls: q('input:not([type=hidden]),select,textarea'),
    images: q('img,[role=img],svg[role=img]'),
    tables: q('table'),
    dialogs: q('dialog,[role=dialog],[role=alertdialog]'),
    iframes: q('iframe'),
    media: q('video,audio'),
    focusable: window.__aa.focusables().length,
  };
})()`;

/** Static (no interaction) custom checks. Returns raw detections; Node turns them into findings. */
export const STATIC_CHECKS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  const GENERIC = /^(click here|here|read more|more|learn more|link|this|details|continue|click)$/i;
  for (const el of document.querySelectorAll('a[href]')) {
    if (!a.visible(el)) continue;
    const { name, source } = a.accName(el);
    const label = (el.getAttribute('aria-label') || '').trim();
    if (name && GENERIC.test(name.replace(/[.…»›>]+$/, '').trim()) && !el.getAttribute('aria-describedby') && !(label && !GENERIC.test(label))) {
      out.push({ rule: 'custom:generic-link-text', selector: a.cssPath(el), snippet: a.snippet(el), data: { name, source } });
    }
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]),textarea,select')) {
    if (!a.visible(el)) continue;
    const { name, source } = a.accName(el);
    if (source === 'placeholder' && name) {
      out.push({ rule: 'custom:placeholder-only-label', selector: a.cssPath(el), snippet: a.snippet(el), data: { placeholder: name, source } });
    }
  }
  for (const el of document.querySelectorAll('[aria-invalid="true"]')) {
    if (!a.visible(el)) continue;
    const ok = el.getAttribute('aria-describedby') || el.getAttribute('aria-errormessage');
    if (!ok) out.push({ rule: 'interaction:form-error-association', selector: a.cssPath(el), snippet: a.snippet(el), data: { ariaInvalid: true, describedby: null, errormessage: null } });
  }
  const PERSONAL = /^(email|e-mail|phone|tel|telephone|first_?name|last_?name|given-name|family-name|full_?name|address|zip|postcode|postal_?code|city|country)$/i;
  for (const el of document.querySelectorAll('input:not([type=hidden]),textarea')) {
    if (!a.visible(el) || el.hasAttribute('autocomplete')) continue;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    const nm = el.getAttribute('name') || '';
    if (t === 'email' || t === 'tel' || PERSONAL.test(nm)) {
      out.push({ rule: 'custom:missing-autocomplete', selector: a.cssPath(el), snippet: a.snippet(el), data: { type: t, name: nm } });
    }
  }
  const radios = new Map();
  for (const el of document.querySelectorAll('input[type=radio][name]')) {
    if (!a.visible(el)) continue;
    const k = (el.form ? 'f' + Array.from(document.forms).indexOf(el.form) : 'd') + ':' + el.name;
    if (!radios.has(k)) radios.set(k, []);
    radios.get(k).push(el);
  }
  for (const group of radios.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const g = first.closest('fieldset,[role=group],[role=radiogroup]');
    let named = false;
    if (g) {
      if (g.tagName === 'FIELDSET') { const lg = g.querySelector('legend'); named = !!(lg && a.text(lg)); }
      if (!named) named = !!((g.getAttribute('aria-label') || '').trim() || g.getAttribute('aria-labelledby'));
    }
    if (!named) out.push({ rule: 'custom:group-no-legend', selector: a.cssPath(first), snippet: a.snippet(first), data: { name: first.name, count: group.length } });
  }
  const REQ = /(\*|\(required\)|\brequired\b)/i;
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')) {
    if (!a.visible(el) || el.required || el.getAttribute('aria-required') === 'true') continue;
    if (!el.labels || !el.labels.length) continue;
    const lt = Array.from(el.labels).map(a.text).join(' ');
    if (REQ.test(lt)) out.push({ rule: 'custom:required-not-programmatic', selector: a.cssPath(el), snippet: a.snippet(el), data: { label: lt.slice(0, 80) } });
  }
  return out;
})()`;

/** Signals that need a human. Returns at most one entry per rule. */
export const MANUAL_SIGNALS_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  const media = document.querySelector('video,audio');
  if (media) out.push({ rule: 'manual:media-alternatives', selector: a.cssPath(media), snippet: a.snippet(media), data: { count: document.querySelectorAll('video,audio').length, hasTrack: !!document.querySelector('track') } });
  const moving = document.querySelector('marquee,blink,[class*=carousel],[class*=slider],[class*=swiper],[data-autoplay],[autoplay]');
  let anim = null;
  if (!moving) {
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && a.visible(el)) { anim = el; break; }
    }
  }
  const m = moving || anim;
  if (m) out.push({ rule: 'manual:motion-control', selector: a.cssPath(m), snippet: a.snippet(m), data: { reason: moving ? 'carousel or autoplay markup' : 'infinite CSS animation' } });
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && a.visible(el) && el.getBoundingClientRect().height > 20) {
      out.push({ rule: 'manual:focus-not-obscured', selector: a.cssPath(el), snippet: a.snippet(el), data: { position: cs.position, height: Math.round(el.getBoundingClientRect().height) } });
      break;
    }
  }
  const body = (document.body && document.body.innerText || '').slice(0, 20000);
  const sm = /\b(?:click|press|tap|select) the (?:red|green|blue|round|square|round|left|right|top|bottom)\b[^.]{0,40}|\bon the (?:left|right)\b[^.]{0,40}|\bthe (?:red|green) (?:button|link|icon)\b/i.exec(body);
  if (sm) out.push({ rule: 'manual:sensory-characteristics', selector: 'body', snippet: sm[0], data: { phrase: sm[0] } });
  return out;
})()`;

/** Elements that look clickable but are not keyboard focusable. */
export const UNREACHABLE_CANDIDATES_SCRIPT = String.raw`(() => {
  const a = window.__aa;
  const out = [];
  const ROLES = 'button,link,tab,menuitem,checkbox,switch,option';
  for (const el of document.querySelectorAll('[role]')) {
    const role = el.getAttribute('role');
    if (!ROLES.split(',').includes(role) || !a.visible(el)) continue;
    if (el.tabIndex >= 0 || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest('[aria-hidden=true]')) continue;
    if (el.closest('[role=tablist],[role=menu],[role=listbox],[role=radiogroup]')) continue; // roving tabindex
    out.push({ selector: a.cssPath(el), snippet: a.snippet(el), role });
  }
  for (const el of document.querySelectorAll('[onclick]')) {
    if (!a.visible(el) || el.tabIndex >= 0 || el.matches('a[href],button,input,select,textarea,summary')) continue;
    if (el.closest('a[href],button,[tabindex]')) continue;
    out.push({ selector: a.cssPath(el), snippet: a.snippet(el), role: el.getAttribute('role') });
  }
  return out.slice(0, 20);
})()`;

export const REFLOW_PROBE_SCRIPT = String.raw`(() => {
  const w = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  if (sw <= w + 1) return null;
  let widest = null; let max = w;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > max + 1 && window.__aa.visible(el)) { max = r.right; widest = el; }
  }
  return { viewportWidth: w, scrollWidth: sw, selector: widest ? window.__aa.cssPath(widest) : 'html', snippet: widest ? window.__aa.snippet(widest) : '' };
})()`;

/** Build a self-invoking expression for a string function; avoids ambiguity in how string functions are evaluated. */
export function callFn(fn: string, arg: unknown): string {
  return `(${fn})(${arg === undefined ? 'undefined' : JSON.stringify(arg)})`;
}
