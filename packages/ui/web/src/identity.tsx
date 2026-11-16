import type { HTMLAttributes, ReactNode } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import { Avatar, type AvatarProps } from './data';
import { Icon, type IconProps } from './icon';

export function AgentAvatar({name,...props}:AvatarProps) {
  return <Avatar {...props} name={name} data-identity="agent" fallback={<Icon iconId="bot"/>}/>;
}
export interface GroupAvatarMember {
  id: string;
  name: string;
  source?: string;
  /** Member-owned identity tile hue; absent tiles fall back to the Avatar token fill. */
  tone?: string;
}
/**
 * GroupAvatar — the ONE group identity rendering. Layout is derived from the
 * member count exactly like the desktop composite: 2–4 members → 2×2,
 * 5–9 → 3×3; tiles carry each member's own identity tone so a group reads as
 * multiple people, never as one neutral glyph. An owner-uploaded image
 * replaces the composite.
 */
export function GroupAvatar({name,members,size=36,radius,imageUrl,className='',...props}:Omit<AvatarProps,'source'>&{
  members:readonly GroupAvatarMember[]; imageUrl?: string;
}) {
  const tiles = members.slice(0,9);
  const columns = tiles.length > 4 ? 3 : 2;
  const gap = size >= 48 ? 2 : 1;
  const cell = (size - gap * (columns - 1)) / columns;
  return <span {...props} className={`pt-group-avatar ${className}`} role="img" aria-label={name} data-columns={columns}
    style={{display:'inline-grid',gridTemplateColumns:`repeat(${columns},1fr)`,
      width:size,height:size,overflow:'hidden',gap,
      borderRadius:radius ?? Math.max(8,Math.floor(size*.25)),...props.style}}>
    {imageUrl
      ? <img src={imageUrl} alt={name} style={{gridColumn:`1 / -1`,width:'100%',height:'100%',objectFit:'cover',borderRadius:0}} />
      : tiles.map(member=><Avatar key={member.id} name={member.name} source={member.source} background={member.tone}
        size={cell} radius={0} aria-hidden="true"
        style={{fontSize:Math.max(9,Math.round(size*(columns===3?.22:.3)))}}/>)}</span>;
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
