import { useEffect, useId, useRef, useState, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode } from 'react';
import QRCodeEngine from 'qrcode';
import type { ResourceView } from '@peers-touch/ui-contracts';
import { ActionGroup, Button, IconButton, type IconButtonProps } from './actions';
import { Empty, Alert, Spin } from './feedback';
import { Dialog } from './overlays';

/** Media-stage action: one shared touch target and a visible caption. */
export interface CallControlProps extends IconButtonProps {
  selected?: boolean;
}
export function CallControl({ selected, label, ...props }: CallControlProps) {
  return <span className="pt-call-control" data-selected={selected || undefined}>
    <IconButton {...props} label={label} aria-pressed={selected} iconSize={props.iconSize ?? 24}
      className={`pt-call-control-button ${props.className ?? ''}`} />
    <span className="pt-call-control-label" aria-hidden="true">{label}</span>
  </span>;
}

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'|'resource'> {
  resource: ResourceView; fallback?: ReactNode; preview?: boolean; previewLabel?: string;
}
export function Image({ resource, fallback, preview, previewLabel = 'View image', alt, ...props }: ImageProps) {
  const [failed,setFailed] = useState<string|null>(null), [open,setOpen] = useState(false);
  const identity=`${resource.resourceId}:${resource.source}`;
  useEffect(() => {setOpen(false);},[identity]);
  if (resource.state === 'loading') return <Spin label={`Loading ${resource.name}`} />;
  if (resource.state !== 'available' || !resource.source || failed === identity)
    return <>{fallback ?? <Empty description={resource.failureReason ?? `${resource.name} unavailable`} />}</>;
  const image=<img {...props} src={resource.source} alt={alt ?? resource.name} onError={event => {setFailed(identity); props.onError?.(event);}}
    style={{maxWidth:'100%',...props.style}} />;
  return <>{preview ? <button type="button" className="pt-image-trigger" aria-label={previewLabel} onClick={() => setOpen(true)}>{image}</button> : image}
    {preview && <ImageViewer resource={resource} open={open} onDismiss={() => setOpen(false)} />}</>;
}
export interface ImageViewerProps { resource: ResourceView; open: boolean; onDismiss: () => void; }
export function ImageViewer({resource,open,onDismiss}:ImageViewerProps) {
  const [zoom,setZoom]=useState(1), [rotation,setRotation]=useState(0);
  useEffect(() => {setZoom(1);setRotation(0);},[resource.resourceId,resource.source,open]);
  return <Dialog open={open} title={resource.name} onDismiss={onDismiss} width="min(90vw,960px)" footer={<ActionGroup label="Image controls">
    <Button actionId="image.zoom-out" label="Zoom out" onActivate={() => setZoom(z=>Math.max(.25,z-.25))} />
    <Button actionId="image.zoom-in" label="Zoom in" onActivate={() => setZoom(z=>Math.min(4,z+.25))} />
    <Button actionId="image.rotate" label="Rotate" onActivate={() => setRotation(r=>r+90)} />
    <Button actionId="image.reset" label="Reset view" onActivate={() => {setZoom(1);setRotation(0);}} /></ActionGroup>}>
    <div className="pt-image-viewport"><Image resource={resource} style={{transform:`scale(${zoom}) rotate(${rotation}deg)`}} /></div>
  </Dialog>;
}
export interface HtmlPreviewProps { html: string; label: string; height?: number|string; }
export function HtmlPreview({html,label,height=320}:HtmlPreviewProps) {
  const document=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'"><meta charset="utf-8">${html}`;
  return <iframe className="pt-html-preview" title={label} sandbox="" referrerPolicy="no-referrer" srcDoc={document}
    style={{width:'100%',height,border:'1px solid var(--pt-border)',borderRadius:'var(--pt-radius-md)'}} />;
}
export interface QrCodeProps { value: string; label: string; size?: number; correction?: 'medium'|'high'; encodeErrorTitle?: string; }
export function QrCode({value,label,size=208,correction='medium',encodeErrorTitle='QR value cannot be encoded'}:QrCodeProps) {
  const modules=(() => {try{return QRCodeEngine.create(value,{errorCorrectionLevel:correction==='high'?'H':'M'}).modules;}catch{return null;}})();
  if (!modules) return <Alert tone="danger" title={encodeErrorTitle} />;
  const dimension=modules.size+8, path:string[]=[];
  for(let y=0;y<modules.size;y++) for(let x=0;x<modules.size;x++) if(modules.get(y,x)) path.push(`M${x+4} ${y+4}h1v1h-1z`);
  return <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${dimension} ${dimension}`}
    style={{display:'block',maxWidth:'100%',height:'auto',background:'#fff',flexShrink:0}} shapeRendering="crispEdges">
    <rect width={dimension} height={dimension} fill="#fff"/><path d={path.join('')} fill="#000"/></svg>;
}
export interface MediaPlayerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'resource'> {
  resource: ResourceView; label?: string; autoPlay?: boolean; poster?: string;
  onPlaybackChange?: (state: 'playing'|'paused'|'ended'|'failed') => void;
}
function MediaPlayer({kind,resource,label,autoPlay,poster,onPlaybackChange,...props}:MediaPlayerProps & {kind:'audio'|'video'}) {
  const ref=useRef<HTMLMediaElement>(null), [failed,setFailed]=useState<string|null>(null), identity=`${resource.resourceId}:${resource.source}`;
  useEffect(() => {const media=ref.current; return()=>{if(media){media.pause();media.removeAttribute('src');media.load();}};},[identity]);
  if(resource.state==='loading') return <Spin label={`Loading ${resource.name}`} />;
  if(resource.state!=='available'||!resource.source||failed===identity) return <Empty description={resource.failureReason??`${resource.name} unavailable`} />;
  const events={onPlay:()=>onPlaybackChange?.('playing'),onPause:()=>onPlaybackChange?.('paused'),
    onEnded:()=>onPlaybackChange?.('ended'),onError:()=>{setFailed(identity);onPlaybackChange?.('failed');}};
  return <div {...props} className={`pt-media-player ${props.className??''}`}>
    {kind==='video'?<video key={identity} ref={ref as React.RefObject<HTMLVideoElement>} src={resource.source} controls
      playsInline autoPlay={autoPlay} poster={poster} aria-label={label??resource.name} {...events} />
      : <audio key={identity} ref={ref as React.RefObject<HTMLAudioElement>} src={resource.source} controls autoPlay={autoPlay}
        aria-label={label??resource.name} {...events}/>}
  </div>;
}
export function VideoPlayer(props:MediaPlayerProps) {return <MediaPlayer {...props} kind="video"/>;}
export function AudioPlayer(props:MediaPlayerProps) {return <MediaPlayer {...props} kind="audio"/>;}
export interface CarouselProps {items:readonly {id:string;label:string;content:ReactNode}[];label:string;}
export function Carousel({items,label}:CarouselProps) {
  const [index,setIndex]=useState(0), active=Math.min(index,Math.max(0,items.length-1)), id=useId();
  if(!items.length)return <Empty/>;
  return <section aria-label={label} aria-roledescription="carousel">
    <div id={id} aria-live="polite" aria-label={items[active].label}>{items[active].content}</div>
    <ActionGroup label="Carousel controls"><Button actionId="carousel.previous" label="Previous" aria-controls={id}
      availability={active===0?{kind:'disabled',reason:'First item'}:undefined} onActivate={()=>setIndex(active-1)}/>
      <span>{active+1} / {items.length}</span><Button actionId="carousel.next" label="Next" aria-controls={id}
        availability={active===items.length-1?{kind:'disabled',reason:'Last item'}:undefined} onActivate={()=>setIndex(active+1)}/></ActionGroup>
  </section>;
}
