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
  
  /** 主题色配置 */
  colors: {
    primary: '#667eea',
    secondary: '#764ba2',
    gradient: 'linear-gradient(135deg, #667eea, #764ba2)',
  },
} as const;

export default BRANDING;
