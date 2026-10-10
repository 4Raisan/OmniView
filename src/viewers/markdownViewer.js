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
    
    
    
    
    
    

    
      
    
    
    
     
    
     
      

    // Action buttons
    
    

    
    
    
    
    
    
    

    
    
    
    
    
    

    
    
    
  }

  

  

  
  

  

  

  

  

  

  

  
}
