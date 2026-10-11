export function selectedDocumentText(container) {
  const area = container.querySelector('.text-editor');
  if (area && area.selectionEnd > area.selectionStart) return area.value.slice(area.selectionStart, area.selectionEnd);
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount ||
      !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return null;
  const selected = selection.getRangeAt(0);
  const textLines = [...container.querySelectorAll('.code-line .line-code, .code-line .line-content')];
  if (!textLines.length || !textLines.some(line => line.contains(selection.anchorNode))) return selection.toString();
  const pieces = [];
  for (const line of textLines) {
    if (!selected.intersectsNode(line)) continue;
    const range = document.createRange();
    range.selectNodeContents(line);
    if (selected.compareBoundaryPoints(Range.START_TO_START, range) > 0) range.setStart(selected.startContainer, selected.startOffset);
    if (selected.compareBoundaryPoints(Range.END_TO_END, range) < 0) range.setEnd(selected.endContainer, selected.endOffset);
    pieces.push(range.toString());
  }
  return pieces.join('\n');
}
