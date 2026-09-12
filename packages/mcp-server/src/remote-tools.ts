import { GitHubSource, callNoteShell, noteShellWrites } from '@github-notes/core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type Schema = Record<string, any>;
const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const int = (description: string, minimum: number, maximum: number): Schema => ({ type: 'integer', description, minimum, maximum });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const object = (properties: Schema, required = Object.keys(properties), additionalProperties = false): Schema => ({ type: 'object', properties, required, additionalProperties });
const array = (items: Schema): Schema => ({ type: 'array', items });
const pathField = str('Exact repository-relative path inside a configured notebook.', { minLength: 1, maxLength: 1024 });
const revisionField = str('Commit revision returned by ls, glob or read. A stale revision rejects the entire mutation.', { minLength: 1, maxLength: 64 });
const contentField = str('UTF-8 file text. Shell tools include YAML frontmatter in file content and line numbers.', { maxLength: 5 * 1024 * 1024 });
const patternField = str('Repository-relative Bash glob, e.g. notes/example/**/*.md. Supports *, **, ?, brackets and braces.', { maxLength: 256, minLength: 1 });
const metadata: Schema = { type: 'object', additionalProperties: true };
const noteSchema = object({ id: str('Note identifier'), path: pathField, notebookId: str('Notebook ID'), title: str('Title'), content: str('Markdown body'), metadata, tags: array(str('Tag')), revision: str('Read commit SHA') }, ['path','title','content','metadata','revision'], true);
const nullableInteger: Schema = { type: ['integer','null'] };
const receiptSchema = object({ success: { const: true }, committed: { const: true }, pushed: { const: true }, repository: str('GitHub owner/repo'), branch: str('Updated branch'), revision: str('Resulting commit SHA'), changedPaths: array(pathField), commit: object({ commitHash: str('Resulting commit SHA'), message: str('Program-generated commit message') }) }, undefined, true);
export function isMutationTool(name: string) { return name === 'save_note' || noteShellWrites.has(name); }
function tool(name: string, description: string, properties: Schema, required: string[], output: Schema): Tool {
  const mutation = isMutationTool(name);
  return { name, description, inputSchema: object(properties,required) as Tool['inputSchema'], outputSchema: output as Tool['outputSchema'],
    annotations: { title: name, readOnlyHint: !mutation, destructiveHint: ['write','edit','mv','rm','cp','save_note'].includes(name), idempotentHint: !mutation, openWorldHint: true } };
}
const page = { offset: int('Zero-based result offset.',0,100000), limit: int('Maximum returned entries; default 100.',1,500) };
const transfer = { source: pathField, destination: str('Destination path; an existing directory receives the source basename.'), revision: revisionField, recursive: bool('Required for copying or moving a directory.'), overwrite: bool('Explicitly allow replacement of destination files; default false.') };
export const remoteTools: Tool[] = [
  tool('ls','List a notebook directory like ls. Start with path "." to list notebooks. Returns the revision for a subsequent write.',{path:str('Directory path; default "." lists notebook roots.'),...page},[],object({revision:revisionField,path:str('Listed directory'),entries:array(object({path:pathField,type:{type:'string',enum:['file','directory']},size:int('Bytes',0,Number.MAX_SAFE_INTEGER)},['path','type'])),total:int('Total entries',0,100000),nextOffset:nullableInteger})),
  tool('glob','Find note paths using a Bash glob without reading each file. Use before read, find, cp, mv or rm.',{pattern:patternField,...page},[],object({revision:revisionField,paths:array(pathField),total:int('Total matches',0,100000),nextOffset:nullableInteger})),
  tool('read','Read a file like sed -n, using one-based lines including YAML frontmatter. Defaults to 200 lines. Returns the revision and next line.',{path:pathField,startLine:int('First line, inclusive; default 1.',1,1000000),maxLines:int('Maximum lines; default 200.',1,500)},['path'],object({path:pathField,revision:revisionField,startLine:int('First returned line',1,1000000),endLine:int('Last returned line',0,1000000),totalLines:int('Total file lines',0,1000000),content:str('Exact text of returned lines'),truncated:bool('More lines remain'),nextLine:nullableInteger})),
  tool('find','Search literal text like grep -n across note files matched by a glob. Returns paths, one-based line numbers and bounded excerpts. Refine the pattern when truncated.',{query:str('Literal text to find.',{minLength:1,maxLength:1000}),pattern:patternField,caseSensitive:bool('Default false.'),maxResults:int('Maximum matches; default 100.',1,500),fileOffset:int('File offset from the previous page.',0,100000),maxFiles:int('Files to scan per call; default 25.',1,100)},['query'],object({revision:revisionField,matches:array(object({path:pathField,line:int('One-based line',1,1000000),text:str('Matching line, at most 2000 characters')})),scannedFiles:int('Files searched',0,100),truncated:bool('The search was bounded; refine query or continue with nextFileOffset'),nextFileOffset:nullableInteger})),
  tool('write','Create or replace a complete UTF-8 note file. One successful call creates one program-named Git commit and updates the remote branch. Overwrites file content.',{path:pathField,content:contentField,revision:revisionField,createOnly:bool('Reject an existing target instead of replacing it.')},['path','content','revision'],receiptSchema),
  tool('append','Append text to a note, creating it if absent. One successful call creates one commit and updates the remote branch.',{path:pathField,content:contentField,revision:revisionField},['path','content','revision'],receiptSchema),
  tool('edit','Replace an inclusive line range in a previously read file. Use endLine = startLine - 1 for insertion, or empty content for deletion. Preserves surrounding text and commits once remotely.',{path:pathField,startLine:int('First replaced line, inclusive.',1,1000000),endLine:int('Last replaced line, inclusive; startLine - 1 inserts.',0,1000000),content:contentField,revision:revisionField},['path','startLine','endLine','content','revision'],receiptSchema),
  tool('mkdir','Create a notebook folder using a _dir.yml metadata file. Parent directories are created as needed. Creates one remote commit.',{path:pathField,title:str('Folder display title; defaults to the basename.'),revision:revisionField},['path','revision'],receiptSchema),
  tool('cp','Copy a note or, with recursive true, a note directory. Keeps the source. One atomic remote commit covers all destination files. overwrite true can replace existing notes.',transfer,['source','destination','revision'],receiptSchema),
  tool('mv','Move or rename a note or note directory. Removes old paths and adds new paths in one atomic remote commit. Relative links keep their original file text.',transfer,['source','destination','revision'],receiptSchema),
  tool('rm','Remove explicitly listed notes, or directories with recursive true. One atomic remote commit covers all removals. Use glob first to review the exact targets.',{paths:{...array(pathField),minItems:1,maxItems:200},recursive:bool('Required to delete a directory and its note files.'),revision:revisionField},['paths','revision'],receiptSchema),
  tool('get_workspace_config','Read the configured workspace manifest.',{},[],object({config:metadata})),
  tool('list_notebooks','List configured notebooks.',{},[],object({notebooks:array(metadata)})),
  tool('list_folders','List notebook folder display metadata.',{},[],object({folders:array(metadata)})),
  tool('list_notes','Read parsed notes and their Markdown bodies. Prefer glob then read for bounded file inspection.',{notebookId:str('Optional notebook ID.')},[],object({notes:array(noteSchema),count:int('Number of notes',0,100000)})),
  tool('read_note','Read a parsed note, including metadata and the body without frontmatter. Use read for line-based edits of the complete file.',{path:pathField},['path'],object({note:noteSchema})),
  tool('list_assets','List notebook assets and their URLs.',{notebookId:str('Optional notebook ID.')},[],object({assets:array(metadata)})),
  tool('save_note','Create or replace a parsed note body and optional frontmatter. Commits once and updates the remote branch with a program-generated message.',{path:pathField,content:str('Markdown body without frontmatter.'),revision:revisionField,metadata,createOnly:bool('Reject existing paths.')},['path','content','revision'],{...receiptSchema,properties:{...receiptSchema.properties,note:noteSchema},required:[...receiptSchema.required,'note']}),
];

function validate(value: unknown, schema: Schema, label: string) {
  if(schema.type==='object') {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`);
    const object=value as Record<string,unknown>;
    for(const key of schema.required||[])if(!Object.hasOwn(object,key))throw new Error(`${label}.${key} is required.`);
    for(const [key,item] of Object.entries(object)) {
      const child=schema.properties?.[key];
      if(child)validate(item,child,`${label}.${key}`);
      else if(schema.additionalProperties===false)throw new Error(`Unknown argument ${key}.`);
    }
  } else if(schema.type==='array') {
    if(!Array.isArray(value)||(schema.minItems!==undefined&&value.length<schema.minItems)||(schema.maxItems!==undefined&&value.length>schema.maxItems))throw new Error(`${label} has an invalid array length.`);
    value.forEach((item,index)=>validate(item,schema.items,`${label}[${index}]`));
  } else if(schema.type==='string') {
    if(typeof value!=='string'||(schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength))throw new Error(`${label} has an invalid string value.`);
  } else if(schema.type==='boolean') {if(typeof value!=='boolean')throw new Error(`${label} must be boolean.`);}
  else if(schema.type==='integer') {if(!Number.isInteger(value)||Number(value)<schema.minimum||Number(value)>schema.maximum)throw new Error(`${label} is outside its integer range.`);}
}
export async function callRemoteTool(reader: GitHubSource, name: string, args: Record<string, unknown>, write: boolean): Promise<Record<string,unknown>> {
  const definition=remoteTools.find(t=>t.name===name);
  if(!definition)throw new Error('This operation is unavailable for a remote source.');
  validate(args,definition.inputSchema,'arguments');
  if(isMutationTool(name)&&!write)throw new Error('This agent grant is read-only.');
  switch (name) {
    case 'get_workspace_config': return { config: await reader.config() };
    case 'list_notebooks': return { notebooks: (await reader.config()).notebooks };
    case 'list_folders': return { folders: await reader.folders() };
    case 'list_notes': { const notes = await reader.notes(args.notebookId as string | undefined); return { notes, count: notes.length }; }
    case 'read_note': return { note: await reader.note(String(args.path)) };
    case 'list_assets': return { assets: await reader.assets(args.notebookId as string | undefined) };
    case 'save_note': return reader.save(String(args.path),String(args.content),args.metadata as Record<string,unknown>|undefined,String(args.revision),args.createOnly===true);
    default: return callNoteShell(reader,name,args,write);
  }
}
