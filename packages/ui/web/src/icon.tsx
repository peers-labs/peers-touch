import { createElement, type SVGProps } from 'react';
import { getGlyph, brands, type IconId, type BrandId } from '@peers-touch/ui-assets';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  iconId: IconId;
  size?: number;
  label?: string;
}
export function BrandMark({brandId,size=24,label,...props}:Omit<IconProps,'iconId'>&{brandId:BrandId}) {
  const asset = brands[brandId];
  return <svg {...props} width={size} height={size} viewBox={asset.viewBox} fill="currentColor"
    role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true} focusable="false">
    {asset.shapes.map(([tag, attributes],index)=>createElement(tag,{...attributes,key:index}))}
  </svg>;
}
export function Icon({ iconId, size = 18, label, ...props }: IconProps) {
  const glyph = getGlyph(iconId);
  if (!glyph) throw new Error(`Unregistered Peers glyph: ${iconId}`);
  return (
    <svg {...props} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      focusable="false">
      {glyph.shapes.map(([tag, attributes], index) => createElement(tag, { ...attributes, key: index }))}
    </svg>
  );
}
