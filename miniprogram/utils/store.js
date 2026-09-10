/**
 * 内容数据加载器
 *
 * 策略：内置/缓存数据先渲染（秒开、可离线），同时后台静默拉取远程 schedule.json，
 * 拉到新数据就更新界面并写入缓存。
 *
 * 这样做的意义：课表/答疑/更新记录等内容改动只需重新部署 schedule.json，
 * 小程序无需重新提审。只有页面结构/样式/逻辑改动才需要走审核。
 *
 * 注意：wx.request 要求域名已备案并加入「服务器域名」白名单。域名就绪前，
 * 远程拉取会静默失败，页面自动使用内置数据，不影响使用。
 */
const BUNDLED = require('../data/schedule.js');

const CFG = require('../config.js');

// 远程数据地址由 config.json 生成，可以配多个做容错（第一个拉失败自动试下一个）
const REMOTE_URLS = [].concat(CFG.remoteDataUrl || [], CFG.remoteDataUrlBackup || []).filter(Boolean);

const CACHE_KEY = 'guanghua_schedule_cache_v2';

function isValidFeed(feed) {
  return !!(feed && feed.CATS && Array.isArray(feed.DAYS) && feed.DAYS.length);
}

function readCache() {
  try {
    const cached = wx.getStorageSync(CACHE_KEY);
    return isValidFeed(cached) ? cached : null;
  } catch (e) {
    return null;
  }
}

function writeCache(feed) {
  try {
    wx.setStorageSync(CACHE_KEY, feed);
  } catch (e) {
    // 存储写满或不可用时忽略，不影响展示
  }
}

function bundledFeed() {
  // 内置数据由 npm run build 生成，结构与远程 schedule.json 完全一致
  return Object.assign({ icsUrl: CFG.icsUrl }, BUNDLED);
}

/** 立即可用的数据：优先缓存，其次包内内置 */
function getInitial() {
  const cached = readCache();
  if (!cached) return bundledFeed();
  // 缓存缺字段时用内置补齐，避免旧缓存导致新功能空白
  const base = bundledFeed();
  return {
    version: cached.version || base.version,
    lastUpdated: cached.lastUpdated || base.lastUpdated,
    icsUrl: cached.icsUrl || base.icsUrl,
    CATS: cached.CATS || base.CATS,
    DAYS: cached.DAYS || base.DAYS,
    QA_ITEMS: cached.QA_ITEMS || base.QA_ITEMS,
    CHANGELOG: cached.CHANGELOG || base.CHANGELOG,
    TEACHERS: cached.TEACHERS || base.TEACHERS,
    CAL_MONTHS: cached.CAL_MONTHS || base.CAL_MONTHS
  };
}

/** 后台拉取远程数据；成功且内容有变化时回调 */
function refresh(onUpdate) {
  let idx = 0;

  function attempt() {
    if (idx >= REMOTE_URLS.length) return;
    const url = REMOTE_URLS[idx++];
    wx.request({
      url: url,
      method: 'GET',
      timeout: 8000,
      success(res) {
        if (res.statusCode === 200 && isValidFeed(res.data)) {
          const current = getInitial();
          writeCache(res.data);
          if (res.data.version !== current.version) {
            onUpdate && onUpdate(res.data);
          }
        } else {
          attempt();
        }
      },
      fail() {
        attempt();
      }
    });
  }

  attempt();
}

module.exports = { getInitial, refresh };
