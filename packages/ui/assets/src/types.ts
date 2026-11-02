export type GlyphShape = readonly [
  tag: 'path' | 'line' | 'circle' | 'rect' | 'polyline' | 'polygon' | 'ellipse',
  attributes: Readonly<Record<string, string>>,
];
export interface GlyphAsset {shapes:readonly GlyphShape[];source:string;license:string;}
