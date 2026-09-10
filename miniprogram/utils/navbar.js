/**
 * 自定义导航栏适配（navigationStyle: custom 页面专用）
 *
 * 背景铺满状态栏 + 系统导航栏所在区域时，页面自身内容需要下移，
 * 避免被状态栏图标 / 胶囊按钮遮挡。
 *
 * 真机上 wx.getMenuButtonBoundingClientRect() 偶发在页面刚 onLoad 时
 * 取到异常值（胶囊按钮尚未完成原生布局），导致算出的安全区偏小甚至为负，
 * 页面头部因此被顶到胶囊按钮底下——因此这里做了两层兜底：
 * 1. 数值有效性校验，异常时退回经验默认值；
 * 2. 结果不低于一个保守下限，宁可留白多一点也不能让内容被遮挡。
 */

const FALLBACK_NAV_HEIGHT = 32; // 微信胶囊按钮标准高度（px），经验值
const FALLBACK_GAP = 8;         // 胶囊与状态栏之间的常见间距（px），经验值

/** 状态栏高度、胶囊按钮高度、内容应留出的总安全区高度（均为 px） */
function getNavClearance() {
  const sys = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
  const statusBarHeight = sys.statusBarHeight > 0 ? sys.statusBarHeight : 20;

  const rect = wx.getMenuButtonBoundingClientRect();
  const valid = rect && rect.height > 0 && rect.width > 0 && rect.top >= statusBarHeight;

  const navHeight = valid ? rect.height : FALLBACK_NAV_HEIGHT;
  const menuTop = valid ? rect.top : statusBarHeight + FALLBACK_GAP;
  const menuBottom = valid ? rect.bottom : menuTop + navHeight;

  // 胶囊底部 + 胶囊顶部与状态栏之间的间距（对称留白，业界通用算法）
  const computed = menuBottom + (menuTop - statusBarHeight);
  // 保守下限：任何机型都至少留出状态栏 + 胶囊高度 + 上下间距，防止塌陷
  const minClearance = statusBarHeight + navHeight + FALLBACK_GAP * 2;

  return {
    statusBarHeight,
    navHeight,
    navClearance: Math.max(computed, minClearance)
  };
}

/** 深色头图背景下，胶囊按钮图标改为白色，否则黑色图标不可见 */
function applyLightCapsule() {
  wx.setNavigationBarColor({
    frontColor: '#ffffff',
    backgroundColor: '#7d1c26',
    animation: { duration: 0 }
  });
}

module.exports = { getNavClearance, applyLightCapsule };
