import peersWordmark from './assets/peers-logo.png';

/**
 * 品牌资源统一配置
 * 品牌名称、主题色等非矢量品牌配置在这里统一管理。品牌字形标识（藏青 Peers +
 * 绿色 r 肩）与官网共用同一位图母版 apps/desktop/src/assets/peers-logo.png；
 * 仓库内不存在该字形标的矢量真源，禁止自行推导替代图形。
 */
export const BRANDING = {
  /** 应用名称 */
  appName: 'Peers',

  /** 品牌图形标识 */
  logos: {
    /** Peers 字形标（官网 public/peers-logo.png 同源） */
    wordmark: peersWordmark,
  },

  /** 主题色配置（north-star：近墨动作色 + 松绿品牌强调，仅作单一真源） */
  colors: {
    primary: '#1a1d20',
    secondary: '#2f6a50',
    gradient: 'linear-gradient(135deg, #1a1d20, #2f6a50)',
  },
} as const;

export default BRANDING;
