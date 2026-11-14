import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import type { ChoiceOption, QueryProjection } from '@peers-touch/ui-contracts';
import { nextEnabledIndex } from '@peers-touch/ui-semantics';
import { Button, ActionGroup, Toggle } from './actions';
import { Field, TextField, type TextFieldProps } from './fields';
import { Select, RadioGroup } from './selection';
import { Alert } from './feedback';
import { Icon } from './icon';
import { sanitizeDocument } from './content';
import { restoreNavigationFocus } from './focus';

export interface SearchFieldProps extends Omit<TextFieldProps,'value'|'onChange'|'onEnter'> {
  query:string;onQueryChange:(value:string)=>void;onSearch:(value:string)=>void;label:string;
  pending?:boolean;scope?:ReactNode;submitLabel?:ReactNode;
}
export function SearchField({query,onQueryChange,onSearch,label,pending,scope,submitLabel='Search',...props}:SearchFieldProps) {
  return <div className="pt-query" role="search" aria-label={label}>
    <Field><TextField appearance="search" {...props} value={query} aria-label={label} onChange={event=>onQueryChange(event.target.value)}
      onEnter={()=>{if(!props.disabled&&!pending)onSearch(query);}}
      leading={scope??props.leading} trailing={<Button actionId="search.submit" behavior="action" emphasis="quiet"
        availability={props.disabled?{kind:'disabled',reason:'Search unavailable'}:undefined}
        onActivate={()=>onSearch(query)} execution={pending?'pending':'idle'}>{submitLabel}</Button>} clearable onClear={()=>onQueryChange('')}/></Field>
  </div>;
}
export interface AutocompleteProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {projection:QueryProjection<ChoiceOption>;onQueryChange:(query:string)=>void;
  onSelect:(value:string)=>void;label:string;placeholder?:string;clearable?:boolean;}
export function Autocomplete({projection,onQueryChange,onSelect,label,placeholder,clearable,...props}:AutocompleteProps) {
  const [open,setOpen]=useState(false),[active,setActive]=useState(-1),id=useId(),input=useRef<HTMLInputElement>(null);
  const visible=open&&projection.state==='ready',options=projection.items;
  useEffect(()=>setActive(-1),[projection.queryId]);
  const choose=(index:number)=>{const option=options[index];if(!option||option.availability?.kind==='disabled')return;onSelect(option.value);setOpen(false);restoreNavigationFocus(input.current);};
  return <div {...props}><Field><TextField aria-label={label} placeholder={placeholder} clearable={clearable} onClear={()=>onQueryChange('')} ref={input} value={projection.query} role="combobox" aria-expanded={visible}
    aria-controls={`${id}-results`} aria-activedescendant={visible&&active>=0?`${id}-result-${active}`:undefined}
    onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onChange={event=>{setOpen(true);onQueryChange(event.target.value);}}
    aria-autocomplete="list" onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();setOpen(false);}
      else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);
        setActive(nextEnabledIndex(active,event.key==='ArrowDown'?1:-1,options.length,i=>options[i].availability?.kind==='disabled'));}
      else if(event.key==='Enter'&&visible&&active>=0){event.preventDefault();choose(active);}
    }}/></Field>
    {projection.state==='failed'?<Alert title={projection.error??'Search failed'} tone="danger"/>:null}
    {visible&&<ul id={`${id}-results`} role="listbox" aria-label={`${label} results`} className="pt-autocomplete-results">
      {options.map((option,index)=><li key={option.value} id={`${id}-result-${index}`} role="option" aria-selected={index===active}
        aria-disabled={option.availability?.kind==='disabled'||undefined}>
        <Button actionId={`autocomplete.${option.value}`} label={option.label} emphasis="quiet" tabIndex={-1}
          availability={option.availability} onMouseDown={event=>event.preventDefault()} onActivate={()=>choose(index)}/>
      </li>)}</ul>}
  </div>;
}
export interface InlineEditProps {value:string;onCommit:(value:string)=>void;label:string;execution?:'idle'|'pending'|'failed';error?:string;saveLabel?:string;cancelLabel?:string;finishLabel?:string;}
export function InlineEdit({value,onCommit,label,execution='idle',error,saveLabel='Save',cancelLabel='Cancel',finishLabel='Finish editing'}:InlineEditProps) {
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value);
  useEffect(()=>{if(!editing)setDraft(value);},[value,editing]);
  return editing?<div><Field label={label}><TextField autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Escape'){setEditing(false);setDraft(value);}}}/></Field>
    {error&&<Alert title={error} tone="danger"/>}<ActionGroup label="Edit actions">
      <Button actionId="inline.save" label={saveLabel} execution={execution==='pending'?'pending':'idle'} onActivate={()=>onCommit(draft)}/>
      <Button actionId="inline.cancel" label={cancelLabel} onActivate={()=>{setEditing(false);setDraft(value);}}/>
      <Button actionId="inline.finish" label={finishLabel} onActivate={()=>setEditing(false)}/></ActionGroup></div>
    :<Button actionId="inline.edit" label={value||label} emphasis="inline" onActivate={()=>setEditing(true)}/>;
}
export interface ColorPickerProps {value:string;onValueChange:(value:string)=>void;label:string;disabled?:boolean;}
export function ColorPicker({value,onValueChange,label,disabled}:ColorPickerProps) {
  const valid=/^#[a-f0-9]{6}$/i.test(value);
  return <Field label={label} validation={valid?{state:'valid'}:{state:'invalid',message:'Use a six-digit hex color.'}}>
    <TextField value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}
      leading={<input type="color" aria-label={`${label} palette`} value={valid?value:'#000000'} disabled={disabled}
        onChange={e=>onValueChange(e.target.value)} style={{width:32,border:0,padding:0,background:'transparent'}}/>}/>
  </Field>;
}
export function ColorSwatches({colors,value,onValueChange,label}: {colors:readonly {value:string;label:string}[];value:string;onValueChange:(value:string)=>void;label:string}) {
  return <RadioGroup label={label} value={value} onValueChange={onValueChange} options={colors}/>;
}
export interface DateFieldProps {value:string;onValueChange:(value:string)=>void;label:string;min?:string;max?:string;disabled?:boolean;}
export function DateField({value,onValueChange,label,...props}:DateFieldProps) {
  return <Field label={label}><TextField {...props} type="date" value={value} onChange={e=>onValueChange(e.target.value)}/></Field>;
}
export function TimeField({value,onValueChange,label,...props}:DateFieldProps) {
  return <Field label={label}><TextField {...props} type="time" value={value} onChange={e=>onValueChange(e.target.value)}/></Field>;
}
export function DateTimeField({value,onValueChange,label,...props}:DateFieldProps) {
  return <Field label={label}><TextField {...props} type="datetime-local" step={1} value={value} onChange={e=>onValueChange(e.target.value)}/></Field>;
}
export function DateTimeRangeField({value,onValueChange,label,startLabel='Start time',endLabel='End time'}: {value:readonly [string,string];onValueChange:(range:[string,string])=>void;label:string;startLabel?:string;endLabel?:string}) {
  return <fieldset className="pt-fieldset"><legend>{label}</legend><ActionGroup label={label}>
    <DateTimeField label={startLabel} value={value[0]} max={value[1]||undefined} onValueChange={next=>onValueChange([next,value[1]])}/>
    <DateTimeField label={endLabel} value={value[1]} min={value[0]||undefined} onValueChange={next=>onValueChange([value[0],next])}/></ActionGroup></fieldset>;
}
export function DateRangeField({value,onValueChange,label,min,max,startLabel='Start date',endLabel='End date'}: {value:readonly [string,string];onValueChange:(range:[string,string])=>void;label:string;min?:string;max?:string;startLabel?:string;endLabel?:string}) {
  return <fieldset className="pt-fieldset"><legend>{label}</legend><ActionGroup label={label}>
    <DateField label={startLabel} value={value[0]} min={min} max={value[1]||max} onValueChange={next=>onValueChange([next,value[1]])}/>
    <DateField label={endLabel} value={value[1]} min={value[0]||min} max={max} onValueChange={next=>onValueChange([value[0],next])}/></ActionGroup></fieldset>;
}
export function ShortcutField({value,onValueChange,label,conflict}: {value:string;onValueChange:(value:string)=>void;label:string;conflict?:string}) {
  return <Field label={label} validation={conflict?{state:'invalid',message:conflict}:{state:'valid'}}><TextField value={value} readOnly
    onKeyDown={event=>{
      if(['Tab','Escape'].includes(event.key)||event.nativeEvent.isComposing)return;
      event.preventDefault();
      if(event.key==='Backspace'||event.key==='Delete'){onValueChange('');return;}
      if(['Control','Meta','Alt','Shift'].includes(event.key))return;
      onValueChange([event.metaKey?'Meta':'',event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.key].filter(Boolean).join('+'));
    }}/></Field>;
}
export function Rating({value,maximum=5,onValueChange,label,readOnly}: {value:number;maximum?:number;onValueChange:(value:number)=>void;label:string;readOnly?:boolean}) {
  return <RadioGroup label={label} value={String(value)} onValueChange={next=>onValueChange(Number(next))}
    options={Array.from({length:maximum},(_,i)=>({value:String(i+1),label:`${i+1} / ${maximum}`,
      availability:readOnly?{kind:'disabled' as const,reason:'Read only'}:undefined}))}/>;
}
export interface ToggleGroupProps {options:readonly ChoiceOption[];value:readonly string[];onValueChange:(values:string[])=>void;label:string;}
export function ToggleGroup({options,value,onValueChange,label}:ToggleGroupProps) {
  return <ActionGroup label={label}>{options.map(option=><Toggle key={option.value} actionId={`toggle.${option.value}`} label={option.label}
    selected={value.includes(option.value)} availability={option.availability}
    onSelectedChange={selected=>onValueChange(selected?[...value,option.value]:value.filter(v=>v!==option.value))}/>)}</ActionGroup>;
}
export function ImageChoice({items,value,onValueChange,label}: {items:readonly {id:string;label:string;artwork:ReactNode}[];value:string;onValueChange:(id:string)=>void;label:string}) {
  return <div role="group" aria-label={label} className="pt-image-choices">{items.map(item=><Toggle key={item.id} actionId={`image-choice.${item.id}`}
    aria-label={item.label} selected={value===item.id} onSelectedChange={()=>onValueChange(item.id)}>{item.artwork}<span>{item.label}</span></Toggle>)}</div>;
}
export interface FilePickerProps {label:string;iconId?:IconId;iconOnly?:boolean;accept?:string;multiple?:boolean;disabled?:boolean;maximumBytes?:number;onFiles:(files:readonly File[])=>void;onRejected?:(reason:string)=>void;}
// The native file input is always visually hidden (still keyboard-operable);
// the visible affordance is a token-styled custom button. A raw
// "Choose File / No file chosen" control is forbidden by the craft contract.
function HiddenFileInput({label,accept,multiple,disabled,maximumBytes,onFiles,onRejected}:Omit<FilePickerProps,'iconId'|'iconOnly'|'label'>&{label?:string}) {
  return <input type="file" className="pt-sr-only" accept={accept} multiple={multiple} disabled={disabled}
    aria-label={label}
    onChange={event=>{const files=[...(event.target.files??[])];if(maximumBytes&&files.some(f=>f.size>maximumBytes))onRejected?.('File exceeds the size limit.');
      else onFiles(files);event.target.value='';}}/>;
}
export function FilePicker({label,iconId='upload',iconOnly=false,...inputProps}:FilePickerProps) {
  return <label className="pt-file-picker" data-icon-only={iconOnly||undefined} data-disabled={inputProps.disabled||undefined}>
    <HiddenFileInput label={label} {...inputProps}/>
    <span className="pt-file-button" aria-hidden="true"><Icon iconId={iconId} size={15}/>{iconOnly?null:label}</span>
  </label>;
}
export function FileDropzone({children,label,disabled,...inputProps}:FilePickerProps&{children?:ReactNode}) {
  const [dragging,setDragging]=useState(false);
  const matches=(file:File)=>!inputProps.accept||inputProps.accept.split(',').some(rule=>{
    const item=rule.trim();return item.startsWith('.')?file.name.toLowerCase().endsWith(item.toLowerCase())
      :item.endsWith('/*')?file.type.startsWith(item.slice(0,-1)):file.type===item;
  });
  return <label className="pt-dropzone" data-dragging={dragging||undefined} data-disabled={disabled||undefined}
    onDragOver={e=>{if(!disabled){e.preventDefault();setDragging(true);}}} onDragLeave={()=>setDragging(false)}
    onDrop={e=>{e.preventDefault();setDragging(false);if(disabled)return;const files=[...e.dataTransfer.files];
      if((!inputProps.multiple&&files.length>1)||files.some(f=>!matches(f)||(inputProps.maximumBytes&&f.size>inputProps.maximumBytes)))inputProps.onRejected?.('Files do not meet the selection policy.');
      else inputProps.onFiles(files);}}>
    <HiddenFileInput {...inputProps} disabled={disabled}/>
    <span className="pt-dropzone-glyph" aria-hidden="true"><Icon iconId="cloud-upload" size={22}/></span>
    {children}
    <span className="pt-file-button" aria-hidden="true"><Icon iconId="upload" size={15}/>{label}</span>
  </label>;
}
export interface ReorderableListProps<T> {items:readonly T[];itemKey:(item:T)=>string;renderItem:(item:T)=>ReactNode;onOrderChange:(items:T[])=>void;label:string;}
export function ReorderableList<T>({items,itemKey,renderItem,onOrderChange,label}:ReorderableListProps<T>) {
  const [dragged,setDragged]=useState<string|null>(null);
  const move=(from:number,to:number)=>{if(to<0||to>=items.length||from===to)return;const next=[...items];next.splice(to,0,next.splice(from,1)[0]);onOrderChange(next);};
  return <ol className="pt-list" aria-label={label}>{items.map((item,i)=><li key={itemKey(item)} draggable
    onDragStart={()=>setDragged(itemKey(item))} onDragEnd={()=>setDragged(null)} onDragOver={e=>e.preventDefault()}
    onDrop={e=>{e.preventDefault();move(items.findIndex(x=>itemKey(x)===dragged),i);setDragged(null);}}>
    <div className="pt-list-item">{renderItem(item)}<ActionGroup label={`Reorder item ${i+1}`}>
      <Button actionId={`reorder.${itemKey(item)}.up`} label="Move up" density="compact" availability={i===0?{kind:'disabled',reason:'First item'}:undefined} onActivate={()=>move(i,i-1)}/>
      <Button actionId={`reorder.${itemKey(item)}.down`} label="Move down" density="compact" availability={i===items.length-1?{kind:'disabled',reason:'Last item'}:undefined} onActivate={()=>move(i,i+1)}/>
    </ActionGroup></div></li>)}</ol>;
}
export interface CommandPickerProps {commands:readonly {id:string;label:string;description?:string;disabledReason?:string}[];onSelect:(id:string)=>void;label:string;}
export function CommandPicker({commands,onSelect,label}:CommandPickerProps) {
  return <Select searchable label={label} options={commands.map(command=>({value:command.id,label:command.label,description:command.description,
    availability:command.disabledReason?{kind:'disabled' as const,reason:command.disabledReason}:undefined}))} onValueChange={id=>{if(typeof id==='string')onSelect(id);}}/>;
}
export function SlashCommandMenu(props:CommandPickerProps){return <CommandPicker {...props}/>;}
export function MentionPicker(props:CommandPickerProps){return <CommandPicker {...props}/>;}
export function EmojiPicker({items,onSelect,label,presentation='list'}: {items:readonly {id:string;emoji:string;name:string}[];onSelect:(id:string)=>void;label:string;presentation?:'list'|'palette'}) {
  if (presentation === 'palette') return <div className="pt-emoji-picker" role="group" aria-label={label}>
    <span className="pt-emoji-picker-label">{label}</span>
    <div className="pt-emoji-picker-grid">{items.map(item => <Button key={item.id} actionId={`emoji.${item.id}`}
      aria-label={item.name} emphasis="quiet" density="comfortable"
      onActivate={() => onSelect(item.id)}><span aria-hidden="true">{item.emoji}</span></Button>)}</div>
  </div>;
  return <CommandPicker label={label} commands={items.map(item=>({id:item.id,label:`${item.emoji} ${item.name}`}))} onSelect={onSelect}/>;
}
export interface RichTextEditorProps extends HTMLAttributes<HTMLDivElement> {value:string;onValueChange:(html:string)=>void;label:string;readOnly?:boolean;}
export function RichTextEditor({value,onValueChange,label,readOnly,...props}:RichTextEditorProps) {
  const editor=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(editor.current&&editor.current.innerHTML!==sanitizeDocument(value))editor.current.innerHTML=sanitizeDocument(value);},[value]);
  return <div {...props} className={`pt-rich-editor ${props.className??''}`}>
    <ActionGroup label="Formatting">{(['bold','italic','insertUnorderedList'] as const).map(command=><Button key={command}
      actionId={`editor.${command}`} label={command==='insertUnorderedList'?'Bullet list':command} emphasis="quiet"
      availability={readOnly?{kind:'disabled',reason:'Read only'}:undefined}
      onMouseDown={e=>e.preventDefault()} onActivate={()=>{if(!restoreNavigationFocus(editor.current))return;editor.current?.ownerDocument.execCommand(command);
        onValueChange(sanitizeDocument(editor.current?.innerHTML??''));}}/>)}</ActionGroup>
    <div ref={editor} role="textbox" aria-label={label} aria-multiline="true" aria-readonly={readOnly||undefined} contentEditable={!readOnly}
      suppressContentEditableWarning className="pt-rich-editor-content"
      onInput={e=>onValueChange(sanitizeDocument(e.currentTarget.innerHTML))}
      onPaste={e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');editor.current?.ownerDocument.execCommand('insertText',false,text);}}
    />
  </div>;
}
export interface TreeChoiceNode {id:string;label:string;children?:readonly TreeChoiceNode[];disabledReason?:string;}
export function TreeSelect({nodes,value,onValueChange,label}: {nodes:readonly TreeChoiceNode[];value:string;onValueChange:(id:string)=>void;label:string}) {
  const options:ChoiceOption[]=[];
  const visit=(items:readonly TreeChoiceNode[],parents:string[])=>{for(const node of items){options.push({value:node.id,label:[...parents,node.label].join(' / '),
    availability:node.disabledReason?{kind:'disabled',reason:node.disabledReason}:undefined});if(node.children)visit(node.children,[...parents,node.label]);}};
  visit(nodes,[]);
  return <Select label={label} searchable options={options} value={value} onValueChange={next=>{if(typeof next==='string')onValueChange(next);}}/>;
}
