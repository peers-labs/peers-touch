import type { HTMLAttributes, ReactNode } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import { Avatar, type AvatarProps } from './data';
import { Icon, type IconProps } from './icon';

export function AgentAvatar({name,...props}:AvatarProps) {
  return <Avatar {...props} name={name} data-identity="agent" fallback={<Icon iconId="bot"/>}/>;
}
export function GroupAvatar({name,members,size=36,...props}:Omit<AvatarProps,'source'>&{members:readonly {id:string;name:string;source?:string}[]}) {
  return <span {...props} className="pt-group-avatar" role="img" aria-label={name} style={{display:'inline-grid',gridTemplateColumns:'repeat(2,1fr)',
    width:size,height:size,overflow:'hidden',gap:1,borderRadius:'var(--pt-radius-md)',...props.style}}>
    {members.slice(0,4).map(member=><Avatar key={member.id} name={member.name} source={member.source} size={Math.floor((size-1)/2)}
      aria-hidden="true" style={{borderRadius:0}}/>)}</span>;
}
export interface FileTypeGlyphProps extends Omit<IconProps,'iconId'> {mimeType?:string;filename?:string;}
export function FileTypeGlyph({mimeType='',filename='',...props}:FileTypeGlyphProps) {
  const parts=filename.split('.'), extension=parts[parts.length-1]?.toLowerCase()??'';
  const icon:IconId=mimeType.startsWith('image/')?'file-image':mimeType.startsWith('audio/')?'file-audio':mimeType.startsWith('video/')?'file-video'
    :['zip','tar','gz','7z'].includes(extension)?'file-archive':['json','js','ts','py','rs','go'].includes(extension)?'file-json'
      :mimeType.startsWith('text/')||['txt','md','pdf','doc','docx'].includes(extension)?'file-text':'file';
  return <Icon {...props} iconId={icon}/>;
}
export function EmojiArtwork({emoji,label,...props}:HTMLAttributes<HTMLSpanElement>&{emoji:string;label:string}) {
  return <span {...props} className={`pt-emoji-artwork ${props.className ?? ''}`} role="img" aria-label={label}>{emoji}</span>;
}
export function GuideStep({title,description,action,illustration}: {title:string;description:ReactNode;action:ReactNode;illustration?:ReactNode}) {
  return <section className="pt-guide-step">{illustration}<h3>{title}</h3><p>{description}</p>{action}</section>;
}
