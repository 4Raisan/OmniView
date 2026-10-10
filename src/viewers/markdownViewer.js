import { sanitizeDocument } from '../utils/safeHtml.js';
import { escapeHtml } from '../utils/safeHtml.js';
import { selectedDocumentText } from '../utils/selectedText.js';
import { marked } from 'marked';
import { hljs, loadCodeLanguage } from '../utils/codeLanguages.js';
import { icons } from '../icons.js';

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

    // Configure marked with highlight.js
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch {}
        }
        return escapeHtml(code);
      }
    });

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
    
    
    
    

    
    
    
  }

  

  

  
  

  

  

  

  

  

  

  
}
