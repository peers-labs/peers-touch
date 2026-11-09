import desktopLogo from '../src-tauri/icons/icon.png';

/**
 * 品牌资源统一配置
 * 所有品牌相关的静态资源、名称、主题色等都在这里统一管理
 */
export const BRANDING = {
  /** 应用名称 */
  appName: 'Peers',
  
  /** 应用logo */
  logos: {
    desktop: desktopLogo,
  },
  
  /** 主题色配置（north-star：近墨动作色 + 松绿品牌强调，仅作单一真源） */
  colors: {
    primary: '#1a1d20',
    secondary: '#2f6a50',
    gradient: 'linear-gradient(135deg, #1a1d20, #2f6a50)',
  },
} as const;

export default BRANDING;
