/**
 * 品牌资源统一配置
 * 品牌名称、主题色等非矢量品牌配置在这里统一管理。品牌图形标识的唯一真源是
 * components/common/BrandMark.tsx 的矢量 P-mark（与 macOS tray 资产同源）。
 */
export const BRANDING = {
  /** 应用名称 */
  appName: 'Peers',

  /** 主题色配置（north-star：近墨动作色 + 松绿品牌强调，仅作单一真源） */
  colors: {
    primary: '#1a1d20',
    secondary: '#2f6a50',
    gradient: 'linear-gradient(135deg, #1a1d20, #2f6a50)',
  },
} as const;

export default BRANDING;
