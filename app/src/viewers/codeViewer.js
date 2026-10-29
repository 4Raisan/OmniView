import { escapeHtml } from '../utils/safeHtml.js';
import { selectedDocumentText } from '../utils/selectedText.js';
import { hljs, loadCodeLanguage } from '../utils/codeLanguages.js';
import { icons } from '../icons.js';
import { getFileExtension } from '../utils/fileHelpers.js';

// hljs spans cross newlines, so highlighting line by line loses the state of block
// comments, template literals and multi-line strings. Highlight once, then split
// into lines while carrying the open spans across each break.
function highlightLines(text, language) {
  let html;
  try { html = hljs.highlight(text, { language }).value; }
  catch { return text.split('\n').map(line => escapeHtml(line)); }
  const template = document.createElement('template');
  template.innerHTML = html;
  const lines = [];
  const open = [];
  let current = '';
  const reopen = () => open.map(element => `<span class="${element.className}">`).join('');
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.data.split('\n');
        for (let index = 0; index < parts.length; index++) {
          if (index > 0) {
            current += '</span>'.repeat(open.length);
            lines.push(current);
            current = reopen();
          }
          current += escapeHtml(parts[index]);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        open.push(child);
        current += `<span class="${child.className}">`;
        walk(child);
        open.pop();
        current += '</span>';
      }
    }
  };
  walk(template.content);
  lines.push(current);
  return lines;
}

// A 2 MB file can hold 60,000 lines. Building every row up front freezes the UI and
// keeps three nodes per line alive, so rows are appended in chunks as they are needed.
const INITIAL_LINES = 1200;
const CHUNK_LINES = 1200;
const SCROLL_AHEAD_PX = 1200;

export class CodeViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.rawText = '';
    this.filename = '';
    this.wrapLines = true;
    this.showLineNumbers = true;
    this.searchQuery = '';
    this.isJson = false;
    this.isFormattedJson = false;
    this.highlightedLines = null;
    this.lineElements = [];
    this.matchLines = [];
    this.matchIndex = -1;
    this.renderedLines = 0;
  }

  async render(text, filename = 'code.txt') {
    this.filename = filename;
    this.rawText = typeof text === 'string' ? text : new TextDecoder().decode(text);
    const ext = getFileExtension(filename);
    this.language = await loadCodeLanguage(ext);
    this.isJson = ext === 'json' || this.rawText.trim().startsWith('{') || this.rawText.trim().startsWith('[');

    this.renderToolbar();
    this.renderContent();
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';

    // Language badge
    const ext = getFileExtension(this.filename);
    const badge = document.createElement('div');
    badge.className = 'toolbar-badge lang-badge';
    badge.textContent = (ext ? ext.toUpperCase() : 'TEXT');
    toolbar.appendChild(badge);

    // Line & char counts
    const lineCount = this.rawText.split('\n').length;
    const charCount = this.rawText.length;
    const statsBadge = document.createElement('div');
    statsBadge.className = 'toolbar-badge';
    statsBadge.textContent = `${lineCount} lines • ${charCount.toLocaleString()} chars`;
    toolbar.appendChild(statsBadge);

    const renderedBadge = document.createElement('div');
    renderedBadge.className = 'toolbar-badge code-rendered-count';
    renderedBadge.hidden = true;
    toolbar.appendChild(renderedBadge);
    this.renderedBadge = renderedBadge;

    // Search bar
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'toolbar-search';
    searchWrapper.innerHTML = `
      <span class="search-icon">${icons.search}</span>
      <input type="text" placeholder="Find in file..." value="${escapeHtml(this.searchQuery)}" />
      <span class="code-find-nav" hidden>
        <span class="code-find-count" role="status"></span>
        <button class="search-nav-btn code-find-prev" title="Previous matching line" aria-label="Previous matching line">${icons.chevronLeft}</button>
        <button class="search-nav-btn code-find-next" title="Next matching line" aria-label="Next matching line">${icons.chevronRight}</button>
      </span>
      ${this.searchQuery ? `<button class="search-clear-btn">${icons.close}</button>` : ''}
    `;

    const input = searchWrapper.querySelector('input');
    input.oninput = (e) => {
      this.searchQuery = e.target.value;
      this.matchIndex = -1;
      clearTimeout(this.searchTimer);
      // Walking every rendered line per keystroke stalls on large files.
      this.searchTimer = setTimeout(() => this.renderSearch(), 150);
    };
    input.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      clearTimeout(this.searchTimer);
      this.renderSearch();
      this.stepMatch(event.shiftKey ? -1 : 1);
    };
    searchWrapper.querySelector('.code-find-prev').onclick = () => this.stepMatch(-1);
    searchWrapper.querySelector('.code-find-next').onclick = () => this.stepMatch(1);

    const clearBtn = searchWrapper.querySelector('.search-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        clearTimeout(this.searchTimer);
        this.searchQuery = '';
        this.renderToolbar();
        this.renderContent();
      };
    }
    toolbar.appendChild(searchWrapper);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'toolbar-actions';

    // JSON pretty format button if JSON
    if (this.isJson) {
      const formatBtn = document.createElement('button');
      formatBtn.className = `btn-text ${this.isFormattedJson ? 'active' : ''}`;
      formatBtn.textContent = this.isFormattedJson ? 'Compact JSON' : 'Pretty JSON';
      formatBtn.onclick = () => {
        try {
          if (!this.isFormattedJson) {
            const parsed = JSON.parse(this.rawText);
            this.rawText = JSON.stringify(parsed, null, 2);
            this.isFormattedJson = true;
          } else {
            const parsed = JSON.parse(this.rawText);
            this.rawText = JSON.stringify(parsed);
            this.isFormattedJson = false;
          }
          this.renderToolbar();
          this.highlightedLines = null;
          this.matchIndex = -1;
          this.renderContent();
        } catch (e) {
          alert('Invalid JSON: ' + e.message);
        }
      };
      controls.appendChild(formatBtn);
    }

    // Wrap toggle
    const wrapBtn = document.createElement('button');
    wrapBtn.className = `btn-icon ${this.wrapLines ? 'active' : ''}`;
    wrapBtn.title = this.wrapLines ? 'Disable line wrap' : 'Enable line wrap';
    wrapBtn.innerHTML = icons.wrap;
    wrapBtn.onclick = () => {
      this.wrapLines = !this.wrapLines;
      this.renderContent();
      wrapBtn.classList.toggle('active', this.wrapLines);
    };
    controls.appendChild(wrapBtn);

    // Copy text
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon document-copy';
    copyBtn.title = 'Copy selected text, or all text';
    copyBtn.innerHTML = icons.copy;
    copyBtn.onmousedown = event => event.preventDefault();
    copyBtn.onclick = async () => {
      const selected = selectedDocumentText(this.container);
      try {
        await navigator.clipboard.writeText(selected ?? this.editor?.text ?? this.rawText);
        this.showToast(selected !== null ? 'Selected text copied!' : 'All text copied!');
      } catch { this.showToast('Could not copy text. Try Ctrl+C.'); }
    };
    controls.appendChild(copyBtn);

    toolbar.appendChild(controls);
    this.toolbarContainer.appendChild(toolbar);
    this.editor?.renderButtons();
  }

  renderContent() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = `code-viewer-container ${this.wrapLines ? 'wrap-lines' : 'no-wrap'}`;
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    wrapper.appendChild(pre);
    this.container.appendChild(wrapper);

    this.wrapper = wrapper;
    this.block = pre;
    this.lines = this.rawText.split('\n');
    this.lowercaseLines = this.lines.map(line => line.toLowerCase());
    this.lineElements = [];
    this.renderedLines = 0;

    // Reuse syntax work when searching or toggling wrap. Very large files stay plain.
    if (!this.highlightedLines) {
      this.highlightedLines = this.language && this.rawText.length <= 1_000_000
        ? highlightLines(this.rawText, this.language)
        : this.lines.map(line => escapeHtml(line));
    }

    this.appendChunk(INITIAL_LINES);
    wrapper.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.renderSearch();
  }

  appendChunk(count) {
    const start = this.renderedLines;
    const end = Math.min(this.lines.length, start + count);
    if (end <= start) return;
    let html = '';
    for (let index = start; index < end; index++) {
      html += `<div class="code-line"><span class="line-num">${index + 1}</span><span class="line-code">${this.highlightedLines[index] || '&nbsp;'}</span></div>`;
    }
    const first = this.block.childElementCount;
    this.block.insertAdjacentHTML('beforeend', html);
    for (let index = first; index < this.block.childElementCount; index++) {
      this.lineElements.push(this.block.children[index]);
    }
    this.renderedLines = end;
    if (this.searchQuery) this.highlightRows(start, end);
    if (this.renderedBadge) {
      this.renderedBadge.hidden = end >= this.lines.length;
      this.renderedBadge.textContent = `Showing first ${end.toLocaleString()} of ${this.lines.length.toLocaleString()} lines`;
    }
  }

  onScroll() {
    if (this.renderedLines >= this.lines.length) return;
    const { scrollTop, scrollHeight, clientHeight } = this.wrapper;
    if (scrollHeight - scrollTop - clientHeight > SCROLL_AHEAD_PX) return;
    this.appendChunk(CHUNK_LINES);
  }

  computeMatches() {
    const query = this.searchQuery.toLowerCase();
    this.matchLines = [];
    if (!query) return;
    // Count over the whole file, not just the rows built so far, or the total would
    // silently grow as the reader scrolls.
    for (let index = 0; index < this.lowercaseLines.length; index++) {
      if (this.lowercaseLines[index].includes(query)) this.matchLines.push(index);
    }
  }

  renderSearch() {
    this.computeMatches();
    if (this.matchIndex >= this.matchLines.length) this.matchIndex = this.matchLines.length - 1;
    this.highlightRows(0, this.renderedLines);
    this.markCurrent();
    this.updateSearchStatus();
  }

  highlightRows(start, end) {
    const query = this.searchQuery.toLowerCase();
    const regex = query ? new RegExp(this.escapeRegExp(this.searchQuery), 'gi') : null;
    for (let index = start; index < end; index++) {
      const element = this.lineElements[index];
      const matches = !!query && this.lowercaseLines[index].includes(query);
      const line = element.querySelector('.line-code');
      if (element.classList.contains('has-match')) line.innerHTML = this.highlightedLines[index] || '&nbsp;';
      element.classList.toggle('has-match', matches);
      if (!matches) continue;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        regex.lastIndex = 0;
        const text = node.textContent;
        const fragment = document.createDocumentFragment();
        let offset = 0, match;
        while ((match = regex.exec(text))) {
          fragment.append(text.slice(offset, match.index));
          const mark = document.createElement('mark');
          mark.className = 'search-match'; mark.textContent = match[0];
          fragment.append(mark); offset = match.index + match[0].length;
        }
        if (offset) { fragment.append(text.slice(offset)); node.replaceWith(fragment); }
      }
    }
  }

  stepMatch(delta) {
    if (!this.matchLines.length) return;
    this.matchIndex = this.matchIndex < 0
      ? (delta > 0 ? 0 : this.matchLines.length - 1)
      : (this.matchIndex + delta + this.matchLines.length) % this.matchLines.length;
    const target = this.matchLines[this.matchIndex];
    // Rows only exist up to the reading position, so reaching a later match has to
    // build the lines in front of it first.
    if (target >= this.renderedLines) this.appendChunk(target + 1 - this.renderedLines);
    this.markCurrent();
    this.updateSearchStatus();
    this.lineElements[target].scrollIntoView({ block: 'center' });
  }

  markCurrent() {
    this.block?.querySelector('.code-line.current-match')?.classList.remove('current-match');
    if (this.matchIndex < 0) return;
    this.lineElements[this.matchLines[this.matchIndex]]?.classList.add('current-match');
  }

  updateSearchStatus() {
    const nav = this.toolbarContainer.querySelector('.code-find-nav');
    if (!nav) return;
    nav.hidden = !this.searchQuery;
    const count = this.matchLines.length;
    this.toolbarContainer.querySelector('.code-find-count').textContent = !count ? 'No matches'
      : this.matchIndex < 0 ? `${count.toLocaleString()} matching line${count === 1 ? '' : 's'}`
      : `${this.matchIndex + 1} / ${count.toLocaleString()}`;
    this.toolbarContainer.querySelector('.code-find-prev').disabled = !count;
    this.toolbarContainer.querySelector('.code-find-next').disabled = !count;
  }

  async print() {
    // Printing walks the DOM, so the whole file has to exist before the dialog opens.
    if (!this.editor?.editing && this.block) this.appendChunk(this.lines.length - this.renderedLines);
    if (window.desktop) await window.desktop.print();
    else window.print();
  }

  destroy() {
    clearTimeout(this.searchTimer);
    this.editor?.destroy();
    this.container.replaceChildren();
    this.highlightedLines = null;
    this.rawText = '';
    this.lines = null;
    this.lineElements = [];
    this.lowercaseLines = null;
    this.matchLines = [];
    this.block = null;
    this.wrapper = null;
    this.renderedBadge = null;
  }

  suspend() {
    clearTimeout(this.searchTimer);
    if (this.editor?.editing) return;
    this.scrollPosition = this.wrapper?.scrollTop || 0;
    this.resumeLines = this.renderedLines;
    this.container.replaceChildren();
    this.lineElements = [];
    this.lines = null;
    this.lowercaseLines = null;
    this.block = null;
    this.wrapper = null;
  }

  resume() {
    if (this.container.childElementCount) return;
    this.renderContent();
    // Restore the reading position, which may be past the first chunk.
    if (this.resumeLines > this.renderedLines) this.appendChunk(this.resumeLines - this.renderedLines);
    this.markCurrent();
    this.wrapper.scrollTop = this.scrollPosition || 0;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
}
