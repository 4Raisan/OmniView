const LIMIT = 2 * 1024 * 1024;
export class TextEditor {
  constructor(viewer, meta, onSaved, onDirty) {
    this.viewer = viewer;
    this.meta = meta;
    this.base = viewer.rawText.replace(/\r\n/g, '\n');
    this.onSaved = onSaved;
    this.onDirty = onDirty;
    viewer.editor = this;
    this.renderButtons();
  }
  get text() { return this.editing ? this.area.value : this.viewer.rawText; }
  get dirty() {
    if (!this.changed) return false;
    const text = this.text;
    // Without a CR there is nothing to normalize; skip allocating a full copy per keystroke.
    return text.includes('\r') ? text.replace(/\r\n/g, '\n') !== this.base : text !== this.base;
  }
  renderButtons() {
    const toolbar = this.viewer.toolbarContainer.firstElementChild;
    if (!toolbar) return;
    toolbar.querySelectorAll('.toolbar-button-group').forEach(group => { group.hidden = this.editing; group.style.display = this.editing ? 'none' : ''; });
    toolbar.querySelectorAll('input').forEach(input => { input.disabled = !!this.editing && !input.classList.contains('md-find'); });
    toolbar.querySelectorAll('button:not(.document-copy)').forEach(button => {
      if (!button.closest('.text-edit-controls')) button.disabled = !!this.editing;
    });
    toolbar.querySelector('.text-edit-controls')?.remove();
    const group = document.createElement('div');
    group.className = 'text-edit-controls';
    const edit = document.createElement('button');
    edit.className = 'btn-text'; edit.textContent = this.editing ? 'Preview' : 'Edit';
    edit.disabled = !this.meta.eligible;
    edit.title = this.meta.eligible ? 'Edit text (up to 2 MB)' : 'Editing requires a valid UTF-8 file up to 2 MB';
    edit.onclick = () => this.toggle(); group.append(edit);
    if (this.editing && this.viewer.renderLivePreview) {
      const split = document.createElement('button'); split.className = 'btn-text'; split.textContent = this.liveSplit ? 'Text only' : 'Live split';
      split.onclick = () => { this.liveSplit = !this.liveSplit; this.renderEditing(); this.renderButtons(); }; group.append(split);
      if (this.liveSplit && this.area.value.length > 128 * 1024) {
        const refresh = document.createElement('button'); refresh.className = 'btn-text'; refresh.textContent = 'Refresh preview';
        refresh.title = 'Large Markdown uses manual preview to keep typing responsive'; refresh.onclick = () => this.updatePreview(); group.append(refresh);
      }
    }
    for (const saveAs of [false, true]) {
      const button = document.createElement('button'); button.className = 'btn-text';
      button.textContent = saveAs ? 'Save As' : 'Save';
      button.disabled = !this.meta.eligible || this.saving;
      button.onclick = () => this.save(saveAs); group.append(button);
    }
    const state = document.createElement('span'); state.className = 'edit-state';
    state.textContent = this.dirty ? 'Unsaved' : ''; group.append(state);
    if (this.error) {
      const error = document.createElement('span'); error.className = 'edit-error';
      error.setAttribute('role', 'status'); error.textContent = this.error; error.title = this.error; group.append(error);
    }
    toolbar.append(group);
  }
  async toggle() {
    if (this.editing) {
      clearTimeout(this.previewTimer);
      this.persistDraft();
      const text = this.area.value;
      this.area = null;
      this.editing = false;
      this.viewer.highlightedLines = null;
      await this.viewer.render(text, this.viewer.filename);
    } else {
      this.viewer.lineElements = null;
      this.viewer.lowercaseLines = null;
      this.viewer.highlightedLines = null;
      this.area = document.createElement('textarea');
      this.area.className = 'text-editor'; this.area.setAttribute('aria-label', 'Edit document text');
      this.area.spellcheck = false; this.area.value = this.viewer.rawText;
      this.area.maxLength = LIMIT;
      this.area.oninput = () => {
        this.changed = true;
        const dirty = this.dirty;
        const state = this.viewer.toolbarContainer.querySelector('.edit-state'); if (state) state.textContent = dirty ? 'Unsaved' : '';
        this.onDirty?.(dirty);
        const large = this.area.value.length > 128 * 1024;
        if (large !== this.largePreview) { this.largePreview = large; this.renderButtons(); }
        clearTimeout(this.previewTimer);
        if (this.liveSplit && !large && !this.suspended) this.previewTimer = setTimeout(() => this.updatePreview(), 250);
        this.scheduleDraft();
      };
      this.area.onkeydown = event => {
        if (event.key === 'Tab') { event.preventDefault(); document.execCommand('insertText', false, '    '); }
      };
      this.editing = true;
      this.liveSplit = this.viewer.viewMode === 'split';
      this.largePreview = this.area.value.length > 128 * 1024;
      this.renderEditing();
      this.area.focus();
    }
    this.renderButtons();
  }
  renderEditing() {
    clearTimeout(this.previewTimer);
    if (!this.liveSplit) { this.preview = null; this.viewer.container.replaceChildren(this.area); return; }
    const wrap = document.createElement('div'); wrap.className = 'live-edit-split';
    this.preview = document.createElement('div'); this.preview.className = 'markdown-body';
    wrap.append(this.area, this.preview); this.viewer.container.replaceChildren(wrap); this.updatePreview();
  }
  updatePreview() { if (this.preview && this.area && !this.suspended) this.viewer.renderLivePreview(this.preview, this.area.value); }
  scheduleDraft() {
    clearTimeout(this.draftTimer);
    // An unanswered recovery offer must not be overwritten by new typing.
    if (!this.meta.token || !window.desktop || this.draftPending) return;
    this.draftTimer = setTimeout(() => this.persistDraft(), 2000);
  }
  async persistDraft() {
    clearTimeout(this.draftTimer);
    if (!this.editing || !this.meta.token || !window.desktop || this.saving || this.draftPending) return;
    const text = this.area.value.replace(/\r\n/g, '\n');
    // Typing back to the original leaves nothing worth recovering.
    if (text === this.base) { window.desktop.discardDraft(this.meta.token); return; }
    try {
      await window.desktop.saveDraft({ token: this.meta.token, text, bom: this.meta.bom, lineEnding: this.meta.lineEnding });
    } catch {
      // Recovery is best effort: a full or read-only disk must never interrupt typing.
    }
  }
  async restoreDraft(text) {
    if (!this.editing) await this.toggle();
    this.area.value = text;
    this.changed = true;
    this.area.dispatchEvent(new Event('input'));
    this.area.focus();
  }
  suspend() {
    this.suspended = true;
    clearTimeout(this.previewTimer);
    this.preview?.replaceChildren();
    // A hidden tab still holds unsaved work; capture it before a crash can.
    if (this.editing) this.persistDraft();
  }
  resume() { this.suspended = false; this.updatePreview(); }
  destroy() { clearTimeout(this.previewTimer); clearTimeout(this.draftTimer); this.area = null; this.preview = null; }
  async save(saveAs = false) {
    if (this.saving || !this.meta.eligible) return false;
    clearTimeout(this.draftTimer);
    this.error = ''; this.saving = true; this.renderButtons();
    try {
      const text = this.text;
      const normalized = text.replace(/\r\n/g, '\n');
      const bytes = new TextEncoder().encode((this.meta.bom ? '\uFEFF' : '') + normalized.replace(/\n/g, this.meta.lineEnding || '\n'));
      if (bytes.byteLength > LIMIT) throw new Error('Edited text exceeds the 2 MB limit. Reduce it before saving.');
      const result = await window.desktop.saveText({ token: this.meta.token, name: this.viewer.filename, bytes, saveAs });
      if (!result) return false;
      this.meta.token = result.token; this.base = normalized; this.changed = false;
      this.viewer.rawText = text; this.viewer.filename = result.name;
      this.onSaved(result);
      return true;
    } catch (error) { this.error = error.message; return false; }
    finally { this.saving = false; this.renderButtons(); }
  }
  async canClose() {
    if (!this.dirty) return true;
    const answer = await window.desktop.confirmEditClose(this.viewer.filename);
    return answer === 1 || (answer === 0 && await this.save());
  }
}
