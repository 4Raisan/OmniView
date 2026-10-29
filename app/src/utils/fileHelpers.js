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

export const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
export const SNIFF_BYTES = 8192;

// Signatures that identify a format the extension did not.
const MAGIC_TYPES = [
  { signature: [0x25, 0x50, 0x44, 0x46], type: FILE_TYPES.PDF },
  { signature: [0x50, 0x4b, 0x03, 0x04], type: FILE_TYPES.ZIP },
  { signature: [0x50, 0x4b, 0x05, 0x06], type: FILE_TYPES.ZIP },
  { signature: [0x89, 0x50, 0x4e, 0x47], type: FILE_TYPES.IMAGE },
  { signature: [0xff, 0xd8, 0xff], type: FILE_TYPES.IMAGE },
  { signature: [0x47, 0x49, 0x46, 0x38], type: FILE_TYPES.IMAGE },
  { signature: [0x42, 0x4d], type: FILE_TYPES.IMAGE },
  { signature: [0x49, 0x49, 0x2a, 0x00], type: FILE_TYPES.IMAGE },
  { signature: [0x4d, 0x4d, 0x00, 0x2a], type: FILE_TYPES.IMAGE },
  { signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], type: FILE_TYPES.WORD }
];

// Formats worth naming in the error instead of a generic "unsupported".
const UNSUPPORTED_MAGIC = [
  { signature: [0x52, 0x61, 0x72, 0x21], label: 'RAR archive' },
  { signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], label: '7-Zip archive' },
  { signature: [0x1f, 0x8b], label: 'GZIP archive' },
  { signature: [0x4d, 0x5a], label: 'Windows executable' },
  { signature: [0x7f, 0x45, 0x4c, 0x46], label: 'Linux executable' },
  { signature: [0x25, 0x21, 0x50, 0x53], label: 'PostScript' }
];

const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

const startsWith = (bytes, signature, offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

const containsAscii = (bytes, text) => {
  const target = [...text].map(char => char.charCodeAt(0));
  for (let index = 0; index + target.length <= bytes.length; index++) {
    if (target.every((byte, offset) => bytes[index + offset] === byte)) return true;
  }
  return false;
};

export function utf16Encoding(bytes) {
  if (startsWith(bytes, [0xff, 0xfe])) return 'utf-16le';
  if (startsWith(bytes, [0xfe, 0xff])) return 'utf-16be';
  return null;
}

// Text has no NUL bytes, almost no C0 controls, and decodes as UTF-8. The decode
// check matters: binary padding such as a 0x90 NOP sled has no control bytes.
export function looksLikeText(bytes) {
  if (!bytes.length) return true;
  if (utf16Encoding(bytes)) return true;
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls++;
  }
  if (controls / bytes.length > 0.02) return false;
  try {
    // stream:true tolerates a multi-byte character cut by the sample boundary.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch { return false; }
}

export function sniffFileType(header) {
  for (const { signature, type } of MAGIC_TYPES) if (startsWith(header, signature)) return type;
  // Known binary containers are refused outright, whatever the rest looks like.
  if (UNSUPPORTED_MAGIC.some(({ signature }) => startsWith(header, signature))) return FILE_TYPES.UNKNOWN;
  // RIFF is WAV (supported) or AVI (not); the form name sits at offset 8.
  if (startsWith(header, [0x52, 0x49, 0x46, 0x46])) {
    return ascii(header, 8, 4) === 'WAVE' ? FILE_TYPES.MEDIA : FILE_TYPES.UNKNOWN;
  }
  // ISO base media (MP4/MOV/M4A) carries 'ftyp' at offset 4.
  if (startsWith(header, [0x66, 0x74, 0x79, 0x70], 4)) return FILE_TYPES.MEDIA;
  // WebM and MKV share an EBML header; only the DocType tells them apart.
  if (startsWith(header, EBML_SIGNATURE)) {
    return containsAscii(header, 'matroska') ? FILE_TYPES.UNKNOWN : FILE_TYPES.MEDIA;
  }
  return looksLikeText(header) ? FILE_TYPES.CODE : FILE_TYPES.UNKNOWN;
}

export function describeUnsupported(header, filename) {
  const known = UNSUPPORTED_MAGIC.find(({ signature }) => startsWith(header, signature));
  if (known) return `${known.label} files are not supported. Convert "${filename}" to a supported format first.`;
  if (startsWith(header, [0x52, 0x49, 0x46, 0x46])) return 'AVI video is not supported. Convert it to MP4 or WebM first.';
  if (startsWith(header, EBML_SIGNATURE)) return 'MKV video is not supported. Convert it to MP4 or WebM first.';
  // No NUL but invalid UTF-8 is usually a legacy single-byte encoding, not a binary.
  if (!header.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(header, { stream: true }); }
    catch { return `"${filename}" appears to be text in a legacy encoding rather than UTF-8. Convert it to UTF-8 to open it.`; }
  }
  return `"${filename}" is not a supported format. OmniView opens documents, spreadsheets, PDFs, text, images, audio/video and ZIP archives.`;
}

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

  // Unknown extension: the caller sniffs the header before deciding.
  return FILE_TYPES.UNKNOWN;
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
