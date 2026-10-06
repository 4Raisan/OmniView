import { icons } from '../icons.js';

export const FILE_TYPES = {
  EXCEL: 'excel',
  WORD: 'word',
  PDF: 'pdf',
  MARKDOWN: 'markdown',
  CODE: 'code',
  IMAGE: 'image',
  MEDIA: 'media',
  ZIP: 'zip',
  UNKNOWN: 'unknown'
};

const EXTENSION_MAP = {
  // Spreadsheets
  xlsx: FILE_TYPES.EXCEL,
  xls: FILE_TYPES.EXCEL,
  csv: FILE_TYPES.EXCEL,
  tsv: FILE_TYPES.EXCEL,
  ods: FILE_TYPES.EXCEL,

  // Word docs
  docx: FILE_TYPES.WORD,
  doc: FILE_TYPES.WORD,
  rtf: FILE_TYPES.WORD,

  // PDF
  pdf: FILE_TYPES.PDF,

  // Markdown
  md: FILE_TYPES.MARKDOWN,
  markdown: FILE_TYPES.MARKDOWN,
  mdown: FILE_TYPES.MARKDOWN,
  mkd: FILE_TYPES.MARKDOWN,

  // Images
  png: FILE_TYPES.IMAGE,
  jpg: FILE_TYPES.IMAGE,
  jpeg: FILE_TYPES.IMAGE,
  gif: FILE_TYPES.IMAGE,
  svg: FILE_TYPES.IMAGE,
  webp: FILE_TYPES.IMAGE,
  bmp: FILE_TYPES.IMAGE,
  ico: FILE_TYPES.IMAGE,
  avif: FILE_TYPES.IMAGE,

  // Audio / Video
  mp4: FILE_TYPES.MEDIA,
  webm: FILE_TYPES.MEDIA,
  ogv: FILE_TYPES.MEDIA,
  mp3: FILE_TYPES.MEDIA,
  wav: FILE_TYPES.MEDIA,
  ogg: FILE_TYPES.MEDIA,
  m4a: FILE_TYPES.MEDIA,
  flac: FILE_TYPES.MEDIA,

  // Archives
  zip: FILE_TYPES.ZIP,

  // Code / Text
  txt: FILE_TYPES.CODE,
  json: FILE_TYPES.CODE,
  js: FILE_TYPES.CODE,
  mjs: FILE_TYPES.CODE,
  cjs: FILE_TYPES.CODE,
  jsx: FILE_TYPES.CODE,
  ts: FILE_TYPES.CODE,
  tsx: FILE_TYPES.CODE,
  py: FILE_TYPES.CODE,
  html: FILE_TYPES.CODE,
  htm: FILE_TYPES.CODE,
  css: FILE_TYPES.CODE,
  scss: FILE_TYPES.CODE,
  less: FILE_TYPES.CODE,
  xml: FILE_TYPES.CODE,
  yaml: FILE_TYPES.CODE,
  yml: FILE_TYPES.CODE,
  sql: FILE_TYPES.CODE,
  sh: FILE_TYPES.CODE,
  bash: FILE_TYPES.CODE,
  bat: FILE_TYPES.CODE,
  cmd: FILE_TYPES.CODE,
  ps1: FILE_TYPES.CODE,
  c: FILE_TYPES.CODE,
  cpp: FILE_TYPES.CODE,
  h: FILE_TYPES.CODE,
  hpp: FILE_TYPES.CODE,
  cs: FILE_TYPES.CODE,
  java: FILE_TYPES.CODE,
  kt: FILE_TYPES.CODE,
  rs: FILE_TYPES.CODE,
  go: FILE_TYPES.CODE,
  php: FILE_TYPES.CODE,
  rb: FILE_TYPES.CODE,
  lua: FILE_TYPES.CODE,
  toml: FILE_TYPES.CODE,
  ini: FILE_TYPES.CODE,
  env: FILE_TYPES.CODE,
  log: FILE_TYPES.CODE,
  diff: FILE_TYPES.CODE,
  patch: FILE_TYPES.CODE
};

export function getFileExtension(filename = '') {
  const parts = filename.split('.');
  if (parts.length <= 1) return '';
  return parts.pop().toLowerCase();
}

export function detectFileType(filename = '', mimeType = '') {
  const ext = getFileExtension(filename);
  if (EXTENSION_MAP[ext]) {
    return EXTENSION_MAP[ext];
  }

  if (mimeType.startsWith('image/')) return FILE_TYPES.IMAGE;
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return FILE_TYPES.MEDIA;
  
  
  
  

   // default to text/code viewer as ultra-safe fallback
}












