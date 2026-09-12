import path from 'node:path';
import picomatch from 'picomatch';
import { GitHubSource, GitHubEntry, SourceError } from './github-source.js';
import { isNotebookContent, serializeFolderConfig } from './folders.js';
import { NotebookConfig } from './types.js';
import YAML from 'yaml';

type Args = Record<string, unknown>;
const mutating = new Set(['write', 'append', 'edit', 'mkdir', 'cp', 'mv', 'rm', 'update_folder_metadata']);
export const noteShellWrites = mutating;
function string(args: Args, key: string, fallback?: string) {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string' || value.includes('\0')) throw new SourceError(`${key} must be a string.`);
  return value;
}
function integer(args: Args, key: string, fallback: number, min: number, max: number) {
  const value = args[key] ?? fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new SourceError(`${key} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
export function matchNoteGlob(pattern: string) {
  if (!pattern || pattern.length > 256 || pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').includes('..')) throw new SourceError('Use a repository-relative glob of at most 256 characters.');
  return picomatch(pattern, { dot: false, strictBrackets: true, nonegate: true });
}
export function textLines(content: string): string[] { return content.match(/[^\n]*\n|[^\n]+$/g) || []; }
export function replaceNoteLines(original: string, start: number, end: number, replacement: string) {
  const lines = textLines(original);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > lines.length + 1 || end < start - 1 || end > lines.length) throw new SourceError('Invalid line range. Read the file first; use endLine = startLine - 1 to insert.');
  let inserted = replacement;
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  if (inserted && !inserted.endsWith('\n') && (end < lines.length || original.endsWith('\n'))) inserted += eol;
  return [...lines.slice(0, start - 1), inserted, ...lines.slice(end)].join('');
}
function relative(file: string) {
  if (!file || file.startsWith('/') || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new SourceError('Use a repository-relative path with no traversal segments.');
  return file;
}
function inNotebook(file: string, notebooks: NotebookConfig[]) {
  return notebooks.find(nb => file.startsWith(nb.root + '/') && isNotebookContent(file.slice(nb.root.length + 1), nb));
}
function noteFile(file: string, notebooks: NotebookConfig[]) {
  return Boolean(inNotebook(file, notebooks) && (/\.(md|markdown|txt)$/i.test(file) || path.posix.basename(file) === '_dir.yml'));
}

/** Shell-shaped operations over the configured note tree, pinned to one commit. */
export async function callNoteShell(reader: GitHubSource, operation: string, args: Args, write: boolean): Promise<Record<string, unknown>> {
  if (mutating.has(operation) && !write) throw new SourceError('This agent grant is read-only.', 403);
  const [config, snapshot] = await Promise.all([reader.config(), reader.getSnapshot()]);
  const notebooks = config.notebooks;
  const blobs = snapshot.entries.filter(e => e.type === 'blob' && e.mode !== '120000' && noteFile(e.path, notebooks)).sort((a,b)=>a.path.localeCompare(b.path));
  const revision = snapshot.sha;
  const read = async (file: string) => {
    relative(file);
    if (!blobs.some(e => e.path === file)) throw new SourceError('File is not a configured note or folder metadata file.', 404);
    return (await reader.readFile(file)).toString('utf8');
  };
  const selected = (file: string, recursive: boolean) => {
    relative(file);
    if (!inNotebook(file, notebooks)) throw new SourceError('Notebook roots and files outside note directories are protected.', 403);
    const exact = snapshot.entries.find(e=>e.path===file);
    if (exact?.type === 'blob') {
      if (!blobs.includes(exact)) throw new SourceError('Path is not a regular note file.', 403);
      return [exact];
    }
    const children = snapshot.entries.filter(e => e.path.startsWith(file + '/') && e.type !== 'tree');
    if (!children.length) throw new SourceError('Source does not exist.',404);
    if (!recursive) throw new SourceError('Directory operations require recursive: true.');
    if (children.some(e => !blobs.includes(e))) throw new SourceError('Directory contains protected files or assets. Select note files explicitly.',403);
    return children;
  };
  const receipt = async (changes: {path:string;content?:string;sha?:string|null}[]) => {
    const expected = string(args,'revision');
    return reader.commitChanges(changes, expected, operation);
  };
  if (operation === 'ls') {
    const dir = string(args,'path','.');
    if (dir !== '.' && !notebooks.some(nb=>nb.root===dir) && !inNotebook(relative(dir),notebooks)) throw new SourceError('List a configured notebook directory.',403);
    if (dir !== '.' && !snapshot.entries.some(e => e.path === dir && e.type === 'tree') && !blobs.some(e => e.path.startsWith(dir + '/'))) throw new SourceError('Directory not found.', 404);
    const all = new Map<string,{path:string;type:string;size?:number}>();
    if (dir === '.') for (const nb of notebooks) all.set(nb.root,{path:nb.root,type:'directory'});
    else for (const file of blobs.filter(e=>e.path.startsWith(dir+'/'))) {
      const child = file.path.slice(dir.length+1).split('/')[0];const name = dir+'/'+child;
      all.set(name,file.path===name?{path:name,type:'file',size:file.size||0}:{path:name,type:'directory'});
    }
    const entries=[...all.values()].sort((a,b)=>a.path.localeCompare(b.path));
    const offset=integer(args,'offset',0,0,100000);const limit=integer(args,'limit',100,1,500);
    return {revision,path:dir,entries:entries.slice(offset,offset+limit),total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null};
  }
  if (operation === 'glob') {
    const matcher=matchNoteGlob(string(args,'pattern','**/*'));
    const matches=blobs.filter(e=>matcher(e.path)).map(e=>e.path);
    const offset=integer(args,'offset',0,0,100000);const limit=integer(args,'limit',100,1,500);
    return {revision,paths:matches.slice(offset,offset+limit),total:matches.length,nextOffset:offset+limit<matches.length?offset+limit:null};
  }
  if (operation === 'read') {
    const file=string(args,'path');const lines=textLines(await read(file));
    const startLine=integer(args,'startLine',1,1,Math.max(lines.length+1,1));const maxLines=integer(args,'maxLines',200,1,500);
    const chosen=lines.slice(startLine-1,startLine-1+maxLines);const content=chosen.join('');
    if(Buffer.byteLength(content)>256*1024)throw new SourceError('Read output exceeds 256 KiB. Reduce maxLines.',413);
    const endLine=startLine-1+chosen.length;
    return {path:file,revision,startLine,endLine,totalLines:lines.length,content,truncated:endLine<lines.length,nextLine:endLine<lines.length?endLine+1:null};
  }
  if (operation === 'find') {
    const query=string(args,'query');if(!query||query.length>1000)throw new SourceError('query must contain 1 to 1000 characters.');
    const matcher=matchNoteGlob(string(args,'pattern','**/*'));const files=blobs.filter(e=>matcher(e.path));
    const fileOffset=integer(args,'fileOffset',0,0,100000);const maxFiles=integer(args,'maxFiles',25,1,100);const maxResults=integer(args,'maxResults',100,1,500);
    const sensitive=args.caseSensitive===true;const needle=sensitive?query:query.toLowerCase();
    const matches:{path:string;line:number;text:string}[]=[];let scannedFiles=0;let truncated=false;
    for(const file of files.slice(fileOffset,fileOffset+maxFiles)) {
      const lines=textLines(await read(file.path));scannedFiles++;
      for(let i=0;i<lines.length;i++)if((sensitive?lines[i]:lines[i].toLowerCase()).includes(needle)) {
        if(matches.length===maxResults){truncated=true;break;}
        matches.push({path:file.path,line:i+1,text:lines[i].replace(/\r?\n$/,'').slice(0,2000)});
      }
      if(truncated)break;
    }
    return {revision,matches,scannedFiles,truncated:truncated||fileOffset+scannedFiles<files.length,nextFileOffset:!truncated&&fileOffset+scannedFiles<files.length?fileOffset+scannedFiles:null};
  }
  if (operation === 'write' || operation === 'append' || operation === 'edit') {
    const file=relative(string(args,'path'));if(!noteFile(file,notebooks))throw new SourceError('Target must be a note or folder metadata file.',403);
    const exists=blobs.some(e=>e.path===file);
    if(args.createOnly===true&&snapshot.entries.some(e=>e.path===file))throw new SourceError('Target already exists.',409);
    const original=exists?await read(file):'';
    let content=string(args,'content');
    if(operation==='append')content=original+content;
    if(operation==='edit') {
      if(!exists)throw new SourceError('Read an existing note before editing.',404);
      content=replaceNoteLines(original,integer(args,'startLine',1,1,1000000),integer(args,'endLine',1,0,1000000),content);
    }
    if(exists&&content===original)throw new SourceError('No content change to commit.');
    return receipt([{path:file,content}]);
  }
  if (operation === 'mkdir') {
    const dir = relative(string(args, 'path')).replace(/\/(_dir\.yml)?$/, '');
    if (!inNotebook(dir, notebooks)) throw new SourceError('Create a folder inside a notebook.', 403);
    const exists = snapshot.entries.some((e) => e.path === dir || e.path.startsWith(dir + '/'));
    if (exists && args.overwrite !== true) throw new SourceError('Target already exists.', 409);
    const title = args.title !== undefined ? string(args, 'title') : path.posix.basename(dir);
    const meta: Record<string, unknown> = {
      ...(args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata) ? (args.metadata as Record<string, unknown>) : {}),
      title,
    };
    if (args.order !== undefined) meta.order = integer(args, 'order', 0, -1000000, 1000000);
    if (args.description !== undefined) meta.description = string(args, 'description');
    const content = serializeFolderConfig(meta);
    return receipt([{ path: dir + '/_dir.yml', content }]);
  }
  if (operation === 'update_folder_metadata') {
    const dir = relative(string(args, 'path')).replace(/\/(_dir\.yml)?$/, '');
    if (!inNotebook(dir, notebooks)) throw new SourceError('Target must be inside a configured notebook.', 403);
    const exists = snapshot.entries.some((e) => e.path === dir || e.path.startsWith(dir + '/'));
    if (!exists) throw new SourceError('Folder does not exist.', 404);
    const dirFile = dir + '/_dir.yml';
    let currentRaw = '';
    const fileEntry = blobs.find((e) => e.path === dirFile);
    if (fileEntry) {
      currentRaw = await read(dirFile);
    }
    let currentData: Record<string, unknown> = {};
    if (currentRaw) {
      try {
        currentData = (YAML.parse(currentRaw) as Record<string, unknown>) || {};
      } catch {
        // fallback
      }
    }
    const meta: Record<string, unknown> = {
      ...currentData,
      ...(args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata) ? (args.metadata as Record<string, unknown>) : {}),
    };
    if (args.title !== undefined) meta.title = string(args, 'title');
    else if (!meta.title) meta.title = path.posix.basename(dir);
    if (args.order !== undefined) meta.order = integer(args, 'order', 0, -1000000, 1000000);
    if (args.description !== undefined) meta.description = string(args, 'description');
    const content = serializeFolderConfig(meta);
    return receipt([{ path: dirFile, content }]);
  }
  if (operation === 'rm') {
    if(!Array.isArray(args.paths)||!args.paths.length||args.paths.length>200||args.paths.some(p=>typeof p!=='string'))throw new SourceError('paths must be an explicit list of 1 to 200 paths.');
    const files=new Map<string,GitHubEntry>();for(const file of args.paths as string[])for(const entry of selected(file,args.recursive===true))files.set(entry.path,entry);
    return receipt([...files.keys()].map(file=>({path:file,sha:null})));
  }
  if (operation === 'mv' || operation === 'cp') {
    const from=relative(string(args,'source'));let to=relative(string(args,'destination'));
    const files=selected(from,args.recursive===true);
    if(snapshot.entries.some(e=>e.path===to&&e.type==='tree'))to=to+'/'+path.posix.basename(from);
    if(to===from||to.startsWith(from+'/')||from.startsWith(to+'/'))throw new SourceError('Source and destination must be separate paths.');
    const changes:{path:string;sha:string|null}[]=[];
    for(const entry of files){
      const target=to+entry.path.slice(from.length);
      if(!noteFile(target,notebooks))throw new SourceError('Destination must be inside a configured note directory.',403);
      if(snapshot.entries.some(e=>e.path===target||e.path.startsWith(target+'/'))&&args.overwrite!==true)throw new SourceError('Destination exists. Set overwrite: true to replace a file.',409);
      changes.push({path:target,sha:entry.sha});if(operation==='mv')changes.push({path:entry.path,sha:null});
    }
    return receipt(changes);
  }
  throw new SourceError('Unknown note operation.');
}
