import type { Editor } from '@tiptap/core';

// Empty paragraphs can carry alignment/styles, so serialized HTML is not an
// emptiness test. Only hydrate empty content; keep existing seller edits intact.
export function syncRichTextValue(editor: Editor, value: string) {
  const incoming = value || '';
  if (incoming === editor.getHTML()) return;
  if (incoming && editor.isEmpty) {
    editor.commands.setContent(incoming, { emitUpdate: false });
  } else if (!incoming && !editor.isEmpty) {
    editor.commands.clearContent(false);
  }
}
