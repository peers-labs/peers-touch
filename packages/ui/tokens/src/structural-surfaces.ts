/** Approved A · 矿灰纸白. Structure is independent of control wells/materials. */
export const structuralSurfaces: Record<'light' | 'dark', {
  frame: string; catalog: string; reading: string;
}> = {
  light: { frame: '#f1f3f2', catalog: '#f7f8f7', reading: '#fdfefd' },
  dark: { frame: '#141615', catalog: '#1b1d1c', reading: '#222524' },
};
