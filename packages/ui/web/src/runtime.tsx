import { Activity, Component, createContext, useContext, useEffect, useRef, type ErrorInfo, type HTMLAttributes, type ReactNode } from 'react';
import { geometry } from '@peers-touch/ui-tokens';
import { Alert } from './feedback';
import { Button } from './actions';

export interface FocusBoundaryProps extends HTMLAttributes<HTMLDivElement> {active:boolean;restore?:boolean;}
export function FocusBoundary({active,restore=true,children,...props}:FocusBoundaryProps) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=root.current;if(!active||!element)return;
    const doc=element.ownerDocument,previous=doc.activeElement as HTMLElement|null;
    const selector='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
    const targets=()=>[...element.querySelectorAll<HTMLElement>(selector)].filter(n=>!n.closest('[hidden],[inert]')&&n.getClientRects().length);
    (targets()[0]??element).focus();
    const key=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const list=targets();
      if(!list.length){event.preventDefault();element.focus();return;}
      if(event.shiftKey&&(doc.activeElement===list[0]||doc.activeElement===element)){event.preventDefault();list[list.length-1]?.focus();}
      else if(!event.shiftKey&&doc.activeElement===list[list.length-1]){event.preventDefault();list[0].focus();}};
    element.addEventListener('keydown',key);
    return()=>{element.removeEventListener('keydown',key);if(restore&&previous?.isConnected)previous.focus();};
  },[active,restore]);
  return <div {...props} ref={root} tabIndex={-1}>{children}</div>;
}
export function RenderSuspension({active,children}: {active:boolean;children:ReactNode}) {
  // React Activity preserves view state while removing hidden effects. It does not stop business runtimes.
  return <Activity mode={active?'visible':'hidden'}>{children}</Activity>;
}
const MotionContext=createContext<'system'|'reduced'|'full'>('system');
export function MotionPolicy({preference='system',children}: {preference?:'system'|'reduced'|'full';children:ReactNode}) {
  return <MotionContext.Provider value={preference}><div data-pt-motion={preference}
    style={preference==='reduced'?{'--pt-motion-fast':'0ms','--pt-motion-normal':'0ms','--pt-motion-slow':'0ms'} as React.CSSProperties:undefined}>{children}</div></MotionContext.Provider>;
}
export function useMotionPolicy() {return {preference:useContext(MotionContext),durations:geometry.motion};}
export interface FontAsset {id:string;family:string;source:string;license:string;weight?:string;}
export function FontAssets({assets,children,onFailure}: {assets:readonly FontAsset[];children:ReactNode;onFailure?:(id:string)=>void}) {
  const failure=useRef(onFailure);failure.current=onFailure;
  useEffect(()=>{
    let active=true;const owned:FontFace[]=[];
    for(const asset of assets){
      if(!asset.license||!asset.id)throw new Error('Font assets require identity and license.');
      const font=new FontFace(asset.family,`url(${JSON.stringify(asset.source)})`,{weight:asset.weight??'normal'});owned.push(font);
      font.load().then(loaded=>{if(active)document.fonts.add(loaded);}).catch(()=>{if(active)failure.current?.(asset.id);});
    }
    return()=>{active=false;for(const font of owned)document.fonts.delete(font);};
  },[assets]);
  return <>{children}</>;
}
export interface ViewErrorBoundaryProps {children:ReactNode;label:string;resetKey?:string;onFailure?:(error:Error,info:ErrorInfo)=>void;}
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps,{error:Error|null}> {
  state={error:null as Error|null};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error,info:ErrorInfo){this.props.onFailure?.(error,info);}
  componentDidUpdate(previous:ViewErrorBoundaryProps){if(previous.resetKey!==this.props.resetKey&&this.state.error)this.setState({error:null});}
  render(){if(!this.state.error)return this.props.children;return <Alert title={this.props.label} tone="danger"
    action={<Button actionId="view.retry" label="Retry view" onActivate={()=>this.setState({error:null})}/>}/>;}
}
