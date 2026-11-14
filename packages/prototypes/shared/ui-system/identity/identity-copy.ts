import type { IdentityCardCopy } from '@peers-touch/ui';

export const identityCopy: IdentityCardCopy = {
  localStation: '本站',
  followers: '粉丝',
  mutual: '互相关注',
  recentMoments: '最近动态',
  follow: '关注',
  following: '已关注',
  block: '拉黑',
  unblock: '取消拉黑',
  message: '发消息',
  openProfile: '查看主页',
  openSelfProfile: '查看我的主页',
  cardLabel: name => `${name} 的名片`,
  momentLabel: (name, text) => `${name} 的动态：${text}`,
};
