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
  if (mimeType === 'application/pdf') return FILE_TYPES.PDF;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FILE_TYPES.EXCEL;
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return FILE_TYPES.WORD;
  if (mimeType.startsWith('text/')) return FILE_TYPES.CODE;

  return FILE_TYPES.CODE; // default to text/code viewer as ultra-safe fallback
}

export function getFileTypeIcon(type) {
  switch (type) {
    case FILE_TYPES.EXCEL: return icons.fileSpreadsheet;
    case FILE_TYPES.WORD: return icons.fileWord;
    case FILE_TYPES.PDF: return icons.filePdf;
    case FILE_TYPES.MARKDOWN: return icons.fileMarkdown;
    case FILE_TYPES.IMAGE: return icons.fileImage;
    case FILE_TYPES.MEDIA: return icons.fileMedia;
    case FILE_TYPES.ZIP: return icons.fileArchive;
    case FILE_TYPES.CODE: return icons.fileCode;
    default: return icons.file;
  }
}

export function formatFileSize(bytes = 0) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function downloadBlob(blob, filename) {
  if (window.desktop) {
    try {
      return await window.desktop.saveFile(filename, new Uint8Array(await blob.arrayBuffer()));
    } catch (error) {
      alert('Could not save file: ' + error.message);
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
