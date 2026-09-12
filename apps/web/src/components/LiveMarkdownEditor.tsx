import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, Transaction, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { renderNote } from '../lib/markdown.js';

export interface LiveMarkdownHandle { insert: (text: string) => void }
interface Props { content: string; notePath: string; readOnly: boolean; ariaLabel?: string; onChange: (content: string) => void }
const focusChanged = StateEffect.define<boolean>();
class RenderedMarkdown extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly block: boolean) { super(); }
  eq(other: RenderedMarkdown) { return this.text === other.text && this.path === other.path && this.from === other.from; }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.block ? 'div' : 'span'); dom.className = 'live-md-rendered prose-custom';
    dom.innerHTML = renderNote(this.text, this.path);
    dom.setAttribute('aria-label', 'Rendered Markdown; click to edit');
    dom.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('a')) return;
      event.preventDefault(); view.dispatch({selection:{anchor:this.from}}); view.focus();
    });
    for (const image of dom.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    return dom;
  }
  get estimatedHeight() { return this.block ? 100 : 160; }
}
class TaskCheckbox extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly readonly: boolean) { super(); }
  eq(other: TaskCheckbox) { return this.checked === other.checked && this.from === other.from && this.readonly === other.readonly; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked; input.disabled = this.readonly;
    input.setAttribute('aria-label', 'Toggle task');
    input.addEventListener('change', () => { if (!view.state.readOnly) view.dispatch({changes:{from:this.from,to:this.from+3,insert:input.checked ? '[x]' : '[ ]'},userEvent:'input'}); });
    return input;
  }
}
class BulletMarker extends WidgetType {
  eq() { return true; }
  toDOM() { const span=document.createElement('span');span.textContent='•';span.setAttribute('aria-hidden','true');return span; }
}
function liveDecorations(state: EditorState, focused: boolean, notePath: string): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const active = (from: number, to: number) => focused && !state.readOnly && state.selection.ranges.some(range => state.doc.lineAt(range.from).from <= to && state.doc.lineAt(range.to).to >= from);
  const hide = (from: number, to: number) => { if (from < to) marks.push(Decoration.replace({}).range(from,to)); };
  syntaxTree(state).iterate({ enter(node) {
    const {from,to,name} = node; const editing = active(from,to);
    if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) marks.push(Decoration.line({class:`live-md-heading live-md-h${name.at(-1)}`}).range(state.doc.lineAt(from).from));
    if (name === 'Blockquote') for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
      marks.push(Decoration.line({class:'live-md-quote'}).range(line.from)); if(line.number === state.doc.lines)break;
    }
    if (name === 'FencedCode' || name === 'CodeBlock') for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
      marks.push(Decoration.line({class:'live-md-codeblock'}).range(line.from)); if(line.number === state.doc.lines)break;
    }
    const styles: Record<string,string> = {StrongEmphasis:'live-md-strong',Emphasis:'live-md-emphasis',Strikethrough:'live-md-strike',InlineCode:'live-md-code',Link:'live-md-link'};
    if (styles[name] && from < to) marks.push(Decoration.mark({class:styles[name]}).range(from,to));
    if (!editing && (name === 'Image' || name === 'Table' || name === 'HorizontalRule')) {
      marks.push(Decoration.replace({widget:new RenderedMarkdown(state.sliceDoc(from,to),notePath,from,name !== 'Image'),block:name !== 'Image'}).range(from,to)); return false;
    }
    if (!editing && name === 'TaskMarker') { marks.push(Decoration.replace({widget:new TaskCheckbox(state.sliceDoc(from,to).toLowerCase()==='[x]',from,state.readOnly)}).range(from,to)); return false; }
    if (!editing && name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
      if (node.node.parent.getChild('Task')) hide(from,to+1);
      else marks.push(Decoration.replace({widget:new BulletMarker()}).range(from,to));
    }
    if (!editing && name === 'Link') {
      const url = node.node.getChild('URL');
      if (url) {
        const href = state.sliceDoc(url.from,url.to);
        if (/^(https?:\/\/|mailto:)/i.test(href)) marks.push(Decoration.mark({attributes:{'data-live-link':href,title:'Ctrl/Cmd-click to open link'}}).range(from,to));
        const source = state.sliceDoc(from,to); const start = source.indexOf('[')+1; const end = source.indexOf('](',start);
        if (end >= start) { hide(from,from+start); hide(from+end,to); return false; }
      }
    }
    if (!editing && /^(HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|QuoteMark)$/.test(name)) {
      // Keep fenced code delimiters visible so language and boundaries remain editable.
      if (name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return;
      let end = to; if ((name === 'HeaderMark' || name === 'QuoteMark') && state.sliceDoc(to,to+1)===' ')end++;
      hide(from,end);
    }
  }});
  return Decoration.set(marks,true);
}
const theme = EditorView.theme({
  '&':{height:'100%',color:'var(--color-text)',backgroundColor:'transparent'},
  '&.cm-focused':{outline:'none'}, '.cm-scroller':{overflow:'auto',fontFamily:'inherit',lineHeight:'1.8'},
  '.cm-content':{padding:'28px 36px',maxWidth:'900px',margin:'0 auto',minHeight:'100%',width:'100%',caretColor:'var(--color-primary)'},
  '.cm-line':{padding:'0 2px'}, '.cm-cursor':{borderLeftColor:'var(--color-primary)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--color-primary-light)'},
  '.live-md-heading':{fontWeight:'700',lineHeight:'1.4',paddingTop:'12px',paddingBottom:'8px'},
  '.live-md-heading span':{textDecoration:'none'},
  '.live-md-h1':{fontSize:'1.85em'},'.live-md-h2':{fontSize:'1.5em'},'.live-md-h3':{fontSize:'1.25em'},
  '.live-md-strong':{fontWeight:'700'},'.live-md-emphasis':{fontStyle:'italic'},'.live-md-strike':{textDecoration:'line-through'},
  '.live-md-link':{color:'var(--color-primary)',textDecoration:'underline'},
  '.live-md-code':{fontFamily:'monospace',backgroundColor:'var(--color-sidebar)',borderRadius:'4px'},
  '.live-md-codeblock':{fontFamily:'monospace',backgroundColor:'var(--color-sidebar)',paddingLeft:'14px'},
  '.live-md-quote':{borderLeft:'3px solid var(--color-primary)',paddingLeft:'14px',color:'var(--color-muted)'},
  '.live-md-rendered':{display:'inline-block',maxWidth:'100%',cursor:'text'},
  '.live-md-rendered p':{margin:'0'},'.live-md-rendered img':{maxWidth:'100%',maxHeight:'360px',borderRadius:'8px'},
  '.cm-content input[type=checkbox]':{accentColor:'var(--color-primary)',verticalAlign:'middle',marginRight:'4px'},
});
export const LiveMarkdownEditor = forwardRef<LiveMarkdownHandle,Props>(({content,notePath,readOnly,onChange,ariaLabel = 'Note content'},ref) => {
  const host = useRef<HTMLDivElement>(null); const editor = useRef<EditorView>();
  const callback = useRef(onChange); callback.current = onChange;
  const permission = useRef(new Compartment());
  useImperativeHandle(ref, () => ({insert(text) {const view=editor.current;if(!view||view.state.readOnly)return;view.dispatch(view.state.replaceSelection(text),{scrollIntoView:true,userEvent:'input'});view.focus();}}),[]);
  useEffect(() => {
    const field = StateField.define<{decorations:DecorationSet;focused:boolean}>({
      create(state) {return {decorations:liveDecorations(state,false,notePath),focused:false};},
      update(value,tr) {
        let focused=value.focused;for(const effect of tr.effects)if(effect.is(focusChanged))focused=effect.value;
        return {focused,decorations:liveDecorations(tr.state,focused,notePath)};
      },
      provide: field => EditorView.decorations.from(field,value=>value.decorations),
    });
    const view = new EditorView({parent:host.current!,state:EditorState.create({doc:content,extensions:[
      markdown({base:markdownLanguage}),history(),keymap.of([...defaultKeymap,...historyKeymap]),drawSelection(),EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle),theme,field,
      permission.current.of([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)]),
      EditorView.contentAttributes.of({'aria-label':ariaLabel,'role':'textbox','aria-multiline':'true'}),
      EditorView.domEventHandlers({focus:(_event,view)=>{view.dispatch({effects:focusChanged.of(true)});},blur:(_event,view)=>{view.dispatch({effects:focusChanged.of(false)});},click:(event,view)=>{
        const link=(event.target as HTMLElement).closest('[data-live-link]')?.getAttribute('data-live-link');
        if(link && (view.state.readOnly || event.ctrlKey || event.metaKey)){event.preventDefault();window.open(link,'_blank','noopener,noreferrer');return true;}
        return false;
      }}),
      EditorView.updateListener.of(update=>{if(update.docChanged)callback.current(update.state.doc.toString());}),
    ]})});
    editor.current=view;return()=>{view.destroy();editor.current=undefined;};
  },[notePath,ariaLabel]);
  useEffect(()=>{const view=editor.current;if(view && view.state.doc.toString()!==content)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content},annotations:Transaction.addToHistory.of(false)});},[content]);
  useEffect(()=>{editor.current?.dispatch({effects:permission.current.reconfigure([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)])});},[readOnly]);
  return <div ref={host} className="flex-1 min-h-0 min-w-0 overflow-hidden" data-live-markdown />;
});
