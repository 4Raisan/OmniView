import { sanitizeDocument } from '../utils/safeHtml.js';
import { selectedDocumentText } from '../utils/selectedText.js';
import { marked } from 'marked';
import { hljs, loadCodeLanguage } from '../utils/codeLanguages.js';
import { icons } from '../icons.js';

// marked 18 removed the `highlight` option; fenced code is highlighted after
// sanitizing, in setupCodeBlockCopyButtons.
marked.setOptions({ gfm: true, breaks: true });

export class MarkdownViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.rawText = '';
    this.viewMode = 'formatted'; // 'formatted', 'split', 'raw'
    this.headings = [];
  }

  async render(text, filename = 'document.md') {
    this.filename = filename;
    this.rawText = typeof text === 'string' ? text : new TextDecoder().decode(text);
    const languages = new Set();
    marked.walkTokens(marked.lexer(this.previewSource(this.rawText)), token => {
      if (token.type === 'code' && token.lang) languages.add(token.lang.split(/\s/)[0]);
    });
    this.loadedLanguages = Object.fromEntries(await Promise.all([...languages].map(async language => [language, await loadCodeLanguage(language)])));

    this.renderToolbar();
    this.renderContent();
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'markdown-toolbar';

    // View mode switch
    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'toolbar-button-group';
    modeSwitch.innerHTML = `
      <button class="btn-group-item ${this.viewMode === 'formatted' ? 'active' : ''}" id="md-formatted">Preview</button>
      <button class="btn-group-item ${this.viewMode === 'split' ? 'active' : ''}" id="md-split">Split</button>
      <button class="btn-group-item ${this.viewMode === 'raw' ? 'active' : ''}" id="md-raw">Raw</button>
    `;

    modeSwitch.querySelector('#md-formatted').onclick = () => {
      this.viewMode = 'formatted';
      this.renderToolbar();
      this.renderContent();
    };

    modeSwitch.querySelector('#md-split').onclick = () => {
      this.viewMode = 'split';
      this.renderToolbar();
      this.renderContent();
    };

    modeSwitch.querySelector('#md-raw').onclick = () => {
      this.viewMode = 'raw';
      this.renderToolbar();
      this.renderContent();
    };
    toolbar.appendChild(modeSwitch);

    // Reading stats
    const words = this.rawText.trim().split(/\s+/).filter(Boolean).length;
    const readTimeMin = Math.max(1, Math.round(words / 200));
    const statsBadge = document.createElement('div');
    statsBadge.className = 'toolbar-badge';
    statsBadge.textContent = `${words} words • ~${readTimeMin} min read`;
    toolbar.appendChild(statsBadge);

    const find = document.createElement('input');
    find.className = 'md-find'; find.placeholder = 'Find in Markdown…'; find.setAttribute('aria-label', 'Find in Markdown');
    find.value = this.query || '';
    find.oninput = () => {
      this.query = find.value;
      clearTimeout(this.findTimer);
      this.findTimer = setTimeout(() => this.applySearch(), 150);
    };
    find.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const marks = [...this.container.querySelectorAll('.md-match')];
      if (marks.length) { this.matchIndex = ((this.matchIndex ?? -1) + (event.shiftKey ? marks.length - 1 : 1)) % marks.length; marks[this.matchIndex].scrollIntoView({ block: 'center' }); }
    };
    const findWrapper = document.createElement('div'); findWrapper.className = 'toolbar-search';
    findWrapper.innerHTML = `<span class="search-icon">${icons.search}</span>`;
    findWrapper.append(find); toolbar.append(findWrapper);
    const count = document.createElement('span'); count.className = 'markdown-find-count'; toolbar.append(count);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';

    const copyRawBtn = document.createElement('button');
    copyRawBtn.className = 'btn-icon document-copy';
    copyRawBtn.title = 'Copy selected text, or raw Markdown';
    copyRawBtn.innerHTML = icons.copy;
    copyRawBtn.onmousedown = event => event.preventDefault();
    copyRawBtn.onclick = async () => {
      const selected = selectedDocumentText(this.container);
      try {
        await navigator.clipboard.writeText(selected ?? this.editor?.text ?? this.rawText);
        this.showToast(selected !== null ? 'Selected text copied!' : 'Markdown copied!');
      } catch { this.showToast('Could not copy text. Try Ctrl+C.'); }
    };
    actions.appendChild(copyRawBtn);

    const printBtn = document.createElement('button');
    printBtn.className = 'btn-icon';
    printBtn.title = 'Print document';
    printBtn.innerHTML = icons.printer;
    printBtn.onclick = () => window.print();
    actions.appendChild(printBtn);

    toolbar.appendChild(actions);
    this.toolbarContainer.appendChild(toolbar);
    this.editor?.renderButtons();
  }

  renderContent() {
    this.container.innerHTML = '';
    const htmlContent = this.previewHtml(this.rawText);

    if (this.viewMode === 'formatted') {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-rendered-view';
      wrapper.innerHTML = `<div class="markdown-body">${htmlContent}</div>`;
      this.setupCodeBlockCopyButtons(wrapper);
      this.container.appendChild(wrapper);
    } else if (this.viewMode === 'raw') {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-raw-view';
      const lines = this.rawText.split('\n');
      const linesHtml = lines.map((line, i) =>
        `<div class="code-line"><span class="line-num">${i + 1}</span><span class="line-content">${this.escapeHtml(line)}</span></div>`
      ).join('');
      wrapper.innerHTML = `<pre class="code-pre">${linesHtml}</pre>`;
      this.container.appendChild(wrapper);
    } else if (this.viewMode === 'split') {
      const splitWrap = document.createElement('div');
      splitWrap.className = 'markdown-split-view';

      const left = document.createElement('div');
      left.className = 'split-pane left';
      const lines = this.rawText.split('\n');
      const linesHtml = lines.map((line, i) =>
        `<div class="code-line"><span class="line-num">${i + 1}</span><span class="line-content">${this.escapeHtml(line)}</span></div>`
      ).join('');
      left.innerHTML = `<pre class="code-pre">${linesHtml}</pre>`;

      const right = document.createElement('div');
      right.className = 'split-pane right markdown-body';
      right.innerHTML = htmlContent;
      this.setupCodeBlockCopyButtons(right);

      // Sync scroll
      left.onscroll = () => {
        const pct = left.scrollTop / (left.scrollHeight - left.clientHeight || 1);
        right.scrollTop = pct * (right.scrollHeight - right.clientHeight);
      };

      splitWrap.appendChild(left);
      splitWrap.appendChild(right);
      this.container.appendChild(splitWrap);
    }
    this.applySearch();
  }

  renderLivePreview(target, text) {
    target.innerHTML = this.previewHtml(text);
    target.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    this.applySearch();
  }

  previewSource(text) { return text.slice(0, 64 * 1024).split('\n').slice(0, 2000).join('\n'); }
  previewHtml(text) {
    const source = this.previewSource(text);
    const notice = source.length < text.length ? '<p class="preview-limit">Preview limited to the first 65,536 characters or 2,000 lines. Raw view and editing keep the full document.</p>' : '';
    return notice + sanitizeDocument(marked.parse(source));
  }

  applySearch() {
    this.container.querySelectorAll('mark.md-match').forEach(mark => { const parent = mark.parentNode; mark.replaceWith(document.createTextNode(mark.textContent)); parent.normalize(); });
    const query = (this.query || '').toLocaleLowerCase();
    const counter = this.toolbarContainer.querySelector('.markdown-find-count');
    if (!query) { if (counter) counter.textContent = ''; return; }
    const root = this.container.querySelector('.markdown-body') || this.container;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) if (!node.parentElement.closest('button,.line-num,textarea')) nodes.push(node);
    let count = 0;
    for (const node of nodes) {
      const value = node.textContent; const lower = value.toLocaleLowerCase(); let start = 0, index;
      const fragment = document.createDocumentFragment(); let found = false;
      while ((index = lower.indexOf(query, start)) !== -1) {
        fragment.append(document.createTextNode(value.slice(start, index)));
        const mark = document.createElement('mark'); mark.className = 'md-match'; mark.textContent = value.slice(index, index + query.length); fragment.append(mark);
        start = index + query.length; count++; found = true;
        if (count >= 2000) break;
      }
      if (found) { fragment.append(document.createTextNode(value.slice(start))); node.replaceWith(fragment); }
      if (count >= 2000) break;
    }
    if (counter) counter.textContent = `${count}${count >= 2000 ? '+' : ''} matches`;
    this.matchIndex = -1;
  }

  suspend() {
    clearTimeout(this.findTimer);
    if (this.editor?.editing) { this.editor.suspend(); return; }
    this.scrollPosition = this.container.firstElementChild?.scrollTop || 0;
    this.container.replaceChildren();
  }

  resume() {
    if (this.editor?.editing) { this.editor.resume(); return; }
    if (!this.container.childElementCount) { this.renderContent(); this.container.firstElementChild.scrollTop = this.scrollPosition || 0; }
  }

  destroy() { clearTimeout(this.findTimer); this.editor?.destroy(); this.container.replaceChildren(); }

  setupCodeBlockCopyButtons(container) {
    container.querySelectorAll('pre code').forEach(code => {
      const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
      const registered = this.loadedLanguages[language];
      if (registered && code.textContent.length <= 1_000_000) {
        code.innerHTML = hljs.highlight(code.textContent, { language: registered }).value;
        code.classList.add('hljs');
      }
    });
    container.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    container.querySelectorAll('pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.innerHTML = icons.copy;
      btn.title = 'Copy code snippet';
      btn.onclick = (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code);
        btn.innerHTML = icons.check;
        setTimeout(() => { btn.innerHTML = icons.copy; }, 2000);
      };
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
}
