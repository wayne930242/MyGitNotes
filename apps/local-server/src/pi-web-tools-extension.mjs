// Loaded into the bridged Pi with `--extension` when its agent edits a remote workspace from the web panel.
// Each tool is answered by the page that holds the panel, through the bridge: a write becomes one of that page's
// working changes, and nothing is committed until the person commits it. The bridge names its endpoint and the
// session's token in the environment it starts Pi with.
import { Type } from 'typebox';

const target = { notebookId: Type.Optional(Type.String({ description: 'The notebook, to tell two repositories with the same path apart.' })) };
const TOOLS = [{ name: 'mygitnotes_read_note', label: 'Read note', description: 'Read a note as the person sees it: their working change when there is one (source: working), else the committed note (source: committed). Paths are repository-relative, such as notes/plan.md.', parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_write_note', label: 'Write note', description: "Create a note or replace its body and frontmatter, as a working change in the person's browser. Nothing is committed; the person reviews and commits it.", parameters: Type.Object({ path: Type.String(), content: Type.String({ description: 'The Markdown body, without frontmatter.' }), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Frontmatter; keys left out keep their values.' })), ...target }) }, { name: 'mygitnotes_edit_note', label: 'Edit note', description: 'Replace one exact, unique occurrence of oldText in the note body with newText, as a working change. Read the note first.', parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String(), ...target }) }, { name: 'mygitnotes_delete_note', label: 'Delete note', description: "Delete a note as a working change: it moves to the person's uncommitted trash, where they can restore it, and goes only when they commit.", parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_list_changes', label: 'List changes', description: "List the person's working changes (added, modified, deleted), with a unified diff of each.", parameters: Type.Object({}) }];

export default function webTools(pi) {
  const url = process.env.MYGITNOTES_WEB_TOOLS_URL, token = process.env.MYGITNOTES_WEB_TOOLS_TOKEN;
  if (!url || !token) return;
  for (const tool of TOOLS) {
    pi.registerTool({
      ...tool,
      async execute(_toolCallId, params, signal) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tool: tool.name.replace(/^mygitnotes_/, ''), arguments: params }), signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `The note tool failed (${res.status}).`);
        return { content: [{ type: 'text', text: JSON.stringify(body.result) }], details: body.result };
      },
    });
  }
}
