/**
 * Rich content is stored as a Tiptap/ProseMirror JSON document, never as raw HTML.
 * This module cleans incoming documents against an allowlist so the frontend
 * renderer can trust what it gets, and derives plain text / reading time.
 */

const NODE_ATTRS = {
  doc: [],
  paragraph: ['textAlign'],
  text: [],
  heading: ['level', 'textAlign', 'id'],
  bulletList: [],
  orderedList: ['start'],
  listItem: [],
  taskList: [],
  taskItem: ['checked'],
  blockquote: [],
  codeBlock: ['language'],
  horizontalRule: [],
  hardBreak: [],
  image: ['src', 'alt', 'title', 'caption', 'layout', 'width', 'height'],
  youtube: ['src', 'start'],
  table: [],
  tableRow: [],
  tableHeader: ['colspan', 'rowspan', 'colwidth'],
  tableCell: ['colspan', 'rowspan', 'colwidth'],
  callout: ['variant'],
  pullQuote: ['cite'],
};

const MARK_ATTRS = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  subscript: [],
  superscript: [],
  link: ['href', 'target'],
  highlight: ['color'],
  textStyle: ['color'],
};

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/|#)/i;
const SAFE_IMAGE = /^(https?:\/\/|\/uploads\/)/i;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\)|rgba?\([\d\s.,%]+\))$/i;
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i;

const MAX_DEPTH = 40;
const MAX_NODES = 20000;

function cleanAttrs(type, attrs, allowed) {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const out = {};
  for (const key of allowed) {
    let v = attrs[key];
    if (v === undefined || v === null || v === '') continue;
    switch (`${type}.${key}`) {
      case 'link.href':
        if (typeof v !== 'string' || !SAFE_URL.test(v.trim())) continue;
        v = v.trim();
        break;
      case 'link.target':
        if (v !== '_blank') continue;
        break;
      case 'image.src':
        if (typeof v !== 'string' || !SAFE_IMAGE.test(v)) continue;
        break;
      case 'youtube.src':
        if (typeof v !== 'string' || !YOUTUBE.test(v)) continue;
        break;
      case 'highlight.color':
      case 'textStyle.color':
        if (typeof v !== 'string' || !SAFE_COLOR.test(v)) continue;
        break;
      case 'heading.level':
        v = Math.min(4, Math.max(2, Number(v) || 2));
        break;
      case 'image.layout':
        if (!['normal', 'wide', 'full'].includes(v)) v = 'normal';
        break;
      case 'callout.variant':
        if (!['info', 'tip', 'warning', 'success'].includes(v)) v = 'info';
        break;
      case 'paragraph.textAlign':
      case 'heading.textAlign':
        if (!['left', 'center', 'right', 'justify'].includes(v)) continue;
        if (v === 'left') continue;
        break;
      case 'taskItem.checked':
        v = Boolean(v);
        break;
      default:
        if (typeof v === 'string') v = v.slice(0, 2000);
        else if (typeof v === 'number') v = Number.isFinite(v) ? v : undefined;
        else if (Array.isArray(v)) v = v.filter((n) => typeof n === 'number').slice(0, 20);
        else if (typeof v !== 'boolean') continue;
    }
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeDoc(input) {
  let count = 0;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || ++count > MAX_NODES) return null;
    const allowed = NODE_ATTRS[node.type];
    if (!allowed) return null;

    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) return null;
      const out = { type: 'text', text: node.text };
      if (Array.isArray(node.marks)) {
        const marks = node.marks
          .filter((m) => m && MARK_ATTRS[m.type])
          .map((m) => {
            const attrs = cleanAttrs(m.type, m.attrs, MARK_ATTRS[m.type]);
            if (m.type === 'link' && !attrs?.href) return null;
            return attrs ? { type: m.type, attrs } : { type: m.type };
          })
          .filter(Boolean);
        if (marks.length) out.marks = marks;
      }
      return out;
    }

    const out = { type: node.type };
    const attrs = cleanAttrs(node.type, node.attrs, allowed);
    if (attrs) out.attrs = attrs;
    if ((node.type === 'image' || node.type === 'youtube') && !attrs?.src) return null;
    if (Array.isArray(node.content)) {
      const children = node.content.map((c) => walk(c, depth + 1)).filter(Boolean);
      if (children.length) out.content = children;
    }
    return out;
  };

  const doc = input && typeof input === 'object' && input.type === 'doc' ? walk(input, 0) : null;
  return doc || { type: 'doc', content: [] };
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader', 'callout', 'pullQuote']);

export function docToText(doc) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'text') parts.push(node.text);
    else if (node.type === 'hardBreak') parts.push('\n');
    else if (node.type === 'image' && node.attrs?.caption) parts.push(node.attrs.caption + '\n');
    node.content?.forEach(walk);
    if (BLOCKS.has(node.type)) parts.push('\n');
  };
  walk(doc);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function readingMinutes(text, imageCount = 0) {
  const words = text.split(/\s+/).filter(Boolean).length;
  // 230 wpm, plus ~10s per image.
  return Math.max(1, Math.round(words / 230 + imageCount / 6));
}

export function countImages(doc) {
  let n = 0;
  const walk = (node) => {
    if (node?.type === 'image') n++;
    node?.content?.forEach(walk);
  };
  walk(doc);
  return n;
}

export function makeExcerpt(text, max = 180) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\-–—]+$/, '') + '…';
}

export function slugify(input) {
  return (
    String(input || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'untitled'
  );
}
