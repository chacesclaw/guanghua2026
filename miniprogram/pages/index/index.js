const store = require('../../utils/store.js');
const navbar = require('../../utils/navbar.js');
const CFG = require('../../config.js');

// 站点地址，用于把课表里的相对链接补全成绝对地址（小程序 web-view 只认绝对地址）
const SITE_HOST = (CFG.siteUrl || '').replace(/\/+$/, '');
// 更新记录分类排序与文案
const LOG_TYPE_LABEL = { add: '新增', update: '修改', remove: '移除', sync: '同步' };
const LOG_TYPE_ORDER = { add: 0, update: 1, remove: 2, sync: 3 };

/** 图例里要隐藏哪些分类：由数据里 CATS[x].hideInLegend 决定 */
function hiddenChips(feed) {
  const CATS = (feed && feed.CATS) || {};
  return Object.keys(CATS).filter(function (k) { return CATS[k].hideInLegend; });
}

/** 相对链接补全成绝对地址 */
function toAbsolute(u) {
  if (!u) return '';
  if (/^https?:\/\//.test(u)) return u;
  return SITE_HOST + (u.charAt(0) === '/' ? u : '/' + u);
}

/** 日期 -> DAYS 下标（多日日程展开成逐天映射） */
function buildDateIndex(DAYS) {
  const map = {};
  DAYS.forEach(function (day, i) {
    if (!day.start || !day.end) return;
    const s = day.start.split('-').map(Number);
    const e = day.end.split('-').map(Number);
    const cur = new Date(s[0], s[1] - 1, s[2]);
    const end = new Date(e[0], e[1] - 1, e[2]);
    while (cur <= end) {
      const iso = cur.getFullYear() + '-' +
        String(cur.getMonth() + 1).padStart(2, '0') + '-' +
        String(cur.getDate()).padStart(2, '0');
      map[iso] = i;
      cur.setDate(cur.getDate() + 1);
    }
  });
  return map;
}

/** 打开时定位：当天有安排就显示当天，否则显示最近的下一个有安排的日期 */
function computeDefaultIdx(DAYS, dateIndex) {
  const now = new Date();
  const todayIso = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  if (dateIndex[todayIso] !== undefined) return dateIndex[todayIso];
  const future = Object.keys(dateIndex).sort().filter(function (iso) { return iso > todayIso; });
  if (future.length) return dateIndex[future[0]];
  return DAYS.length - 1;
}

/** 同一时间段的多个安排合并成一组 */
function buildGroups(CATS, TEACHERS, day, activeCat) {
  const groups = [];
  day.events.forEach(function (ev) {
    let g = null;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].time === ev.time) { g = groups[i]; break; }
    }
    if (!g) { g = { time: ev.time, items: [] }; groups.push(g); }
    const cat = CATS[ev.cat] || { label: '', color: '#8a7a68' };
    // 老师姓名拆分，带简介的可点开
    const names = (ev.who || '').split(/[、\/]/).map(function (s) { return s.trim(); }).filter(Boolean);
    g.items.push({
      title: ev.title,
      sub: ev.sub || '',
      note: ev.note || '',
      teachers: names.map(function (n) { return { name: n, hasInfo: !!TEACHERS[n] }; }),
      hasWho: names.length > 0,
      where: ev.where || '',
      intl: !!ev.intl,
      catLabel: cat.label,
      catColor: cat.color,
      dim: !!activeCat && ev.cat !== activeCat,
      links: (ev.links || []).map(function (lk) {
        return {
          url: toAbsolute(lk.url || lk.href),
          label: lk.label,
          icon: lk.icon || '📖'
        };
      })
    });
  });
  groups.forEach(function (g) { g.isPair = g.items.length > 1; });
  return groups;
}

function dayHasCat(day, cat) {
  return day.events.some(function (ev) { return ev.cat === cat; });
}

/** 学期总览：按月生成日历网格（周一起始） */
function buildMonths(CAL_MONTHS, DAYS, dateIndex, curIdx, todayIso) {
  return CAL_MONTHS.map(function (cm) {
    const y = cm.y, m = cm.m;
    const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一起始
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ key: 'e' + i, empty: true, label: '' });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const idx = dateIndex[iso];
      const has = idx !== undefined;
      cells.push({
        key: 'd' + d,
        empty: false,
        label: String(d),
        has: has,
        active: has && idx === curIdx,
        hasLink: has && DAYS[idx].events.some(function (ev) { return ev.links && ev.links.length; }),
        isToday: iso === todayIso,
        idx: has ? idx : -1
      });
    }
    return { title: y + '年' + m + '月', ymId: 'ym-' + y + '-' + m, cells: cells };
  });
}

function buildChangelog(CHANGELOG) {
  return CHANGELOG.map(function (entry) {
    const sorted = entry.changes.slice().sort(function (a, b) {
      return LOG_TYPE_ORDER[a.type] - LOG_TYPE_ORDER[b.type];
    });
    return {
      date: entry.date,
      source: entry.source || '',
      changes: sorted.map(function (c) {
        return { type: c.type, label: LOG_TYPE_LABEL[c.type] || c.type, text: c.text };
      })
    };
  });
}

Page({
  data: {
    view: 'day',            // day | all | semester | cal | faq
    tabs: [],
    pinnedTabs: [],
    groups: [],
    allDays: [],
    months: [],
    qaItems: [],
    changelog: [],
    curIdx: 0,
    dayBig: '',
    dayWeek: '',
    dayNote: '',
    activeCat: null,
    lastUpdated: '',
    icsUrl: '',
    cfg: {
      school: CFG.school || '',
      schoolEn: CFG.schoolEn || '',
      className: CFG.className || '',
      title: CFG.title || '课表',
      termRange: CFG.termRange || '',
      disclaimer: CFG.disclaimer || '',
      calName: CFG.calName || '课表',
      logo: CFG.logo || ''
    },
    caldavOn: !!(CFG.caldav && CFG.caldav.enabled),
    caldavServer: (CFG.caldav && CFG.caldav.server) || '',
    caldavUser: (CFG.caldav && CFG.caldav.user) || '',
    caldavPass: (CFG.caldav && CFG.caldav.pass) || '',
    tabScrollLeft: 0,
    calOthersOpen: false,
    calIcsOpen: false,
    hasPrev: false,
    hasNext: false,
    teacherModal: null,
    navClearance: 0,
    navBackTop: 0,
    navBackSize: 0
  },

  onLoad() {
    this.applyNavClearance();
    navbar.applyLightCapsule();
    this.applyFeed(store.getInitial(), true);
    const self = this;
    store.refresh(function (feed) {
      self.applyFeed(feed, false);
      wx.showToast({ title: '内容已更新', icon: 'none' });
    });
  },

  onReady() {
    // 真机上胶囊按钮偶发在 onLoad 时还没就绪，onReady 后重新量一次做兜底纠正
    this.applyNavClearance();
  },

  applyNavClearance() {
    const nav = navbar.getNavClearance();
    this.setData({
      navClearance: nav.navClearance,
      navBackTop: nav.statusBarHeight + (nav.navClearance - nav.statusBarHeight - nav.navHeight) / 2,
      navBackSize: nav.navHeight
    });
  },

  onNavBack() {
    // 课表页也支持被单独分享/扫码直接进入——这种场景下这个页面是页面栈里
    // 唯一的一页，没有"上一页"可退，wx.navigateBack() 会静默失效。
    // 页面栈只有自己一层时改为跳回首页，而不是尝试一个没有目标的返回
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      // 本小程序只有课表这一页，没有可退的上一页，什么都不做即可
    }
  },

  applyFeed(feed, isFirst) {
    this.feed = feed;
    this.dateIndex = buildDateIndex(feed.DAYS);

    this.setData({
      pinnedTabs: [
        { key: 'semester', icon: 'grid', d1: '学期' },
        { key: 'cal', icon: 'cal', d1: '订阅' },
        { key: 'faq', icon: 'help', d1: '更新' }
      ],
      tabs: [{ idx: -1, id: 'taball', d1: '全部', d2: '日期', count: feed.DAYS.reduce(function (s, d) { return s + d.events.length; }, 0), isAll: true }]
        .concat(feed.DAYS.map(function (d, i) {
          return { idx: i, id: 'tab' + i, d1: d.d1, d2: d.d2, count: d.events.length, isLater: !!d.isLater, isAll: false };
        })),
      qaItems: feed.QA_ITEMS || [],
      changelog: buildChangelog(feed.CHANGELOG || []),
      lastUpdated: feed.lastUpdated || '',
      icsUrl: feed.icsUrl || ''
    });

    const idx = isFirst
      ? computeDefaultIdx(feed.DAYS, this.dateIndex)
      : Math.min(this.data.curIdx, feed.DAYS.length - 1);
    this.renderDay(idx, this.data.activeCat);
  },

  renderDay(idx, activeCat) {
    const feed = this.feed;
    const day = feed.DAYS[idx];
    this.setData({
      view: 'day',
      curIdx: idx,
      activeCat: activeCat,
      dayBig: day.big,
      dayWeek: day.week,
      dayNote: day.note || '',
      groups: buildGroups(feed.CATS, feed.TEACHERS || {}, day, activeCat),
      hasPrev: idx > 0,
      hasNext: idx < feed.DAYS.length - 1
    }, () => {
      this.centerTab('tab' + idx);
    });
  },

  renderAll(activeCat) {
    const feed = this.feed;
    const self = this;
    this.setData({
      view: 'all',
      activeCat: activeCat,
      dayBig: '全部日期',
      dayWeek: '共 ' + feed.DAYS.length + ' 个日期',
      dayNote: '',
      tabScrollLeft: 0,
      allDays: feed.DAYS.map(function (d) {
        return {
          big: d.big,
          week: d.week,
          note: d.note || '',
          groups: buildGroups(feed.CATS, feed.TEACHERS || {}, d, activeCat)
        };
      })
    });
  },

  /** 把目标页签滚动到左侧只露出前一天一小截、右侧尽量多露出后几天，配合 wxss 的边缘渐隐遮罩 */
  centerTab(tabId) {
    const query = wx.createSelectorQuery().in(this);
    query.select('.tabbar').boundingClientRect();
    query.select('.tabbar').scrollOffset();
    query.select('#' + tabId).boundingClientRect();
    query.exec((res) => {
      const barRect = res && res[0];
      const barScroll = res && res[1];
      const tabRect = res && res[2];
      if (!barRect || !barScroll || !tabRect) return;
      const tabLeftInContent = barScroll.scrollLeft + (tabRect.left - barRect.left);
      const sys = wx.getSystemInfoSync();
      const pxPerRpx = sys.windowWidth / 750;
      const leftPeek = 56 * pxPerRpx; // 只露出前一天卡片右侧一小截（约能看清日期后两位），不是整张
      const target = tabLeftInContent - leftPeek;
      this.setData({ tabScrollLeft: Math.max(0, Math.round(target)) });
    });
  },

  renderSemester() {
    const feed = this.feed;
    const now = new Date();
    const todayIso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const todayInRange = (feed.CAL_MONTHS || []).some(function (cm) {
      return cm.y === now.getFullYear() && cm.m === now.getMonth() + 1;
    });
    this.setData({
      view: 'semester',
      dayBig: '学期日历总览',
      dayWeek: '2026年8月—2027年1月',
      dayNote: '',
      months: buildMonths(feed.CAL_MONTHS || [], feed.DAYS, this.dateIndex, this.data.curIdx, todayIso),
      showTodayBtn: todayInRange,
      todayYmId: 'ym-' + now.getFullYear() + '-' + (now.getMonth() + 1)
    });
  },

  onTapTodayBtn() {
    const id = this.data.todayYmId;
    if (!id) return;
    const self = this;
    const query = wx.createSelectorQuery();
    query.select('#' + id).boundingClientRect();
    query.select('.tabbar-sticky').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec(function (res) {
      const rect = res[0], stickyRect = res[1], scroll = res[2];
      if (!rect || !scroll) return;
      const stickyH = stickyRect ? stickyRect.height : 0;
      const topOffset = (self.data.navClearance || 0) + stickyH;
      const targetTop = scroll.scrollTop + rect.top - topOffset - 12;
      wx.pageScrollTo({ scrollTop: Math.max(0, targetTop), duration: 300 });
      self.setData({ todayPulse: false });
      setTimeout(function () {
        self.setData({ todayPulse: true });
        setTimeout(function () { self.setData({ todayPulse: false }); }, 1300);
      }, 320);
    });
  },

  renderCal() {
    this.setData({ view: 'cal', dayBig: '订阅日历', dayWeek: '在日历 App 里实时同步', dayNote: '' });
  },

  renderFaq() {
    this.setData({
      view: 'faq',
      dayBig: '更新记录',
      dayWeek: this.data.changelog.length + ' 次更新',
      dayNote: ''
    });
  },

  onTapPinned(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'semester') this.renderSemester();
    else if (key === 'cal') this.renderCal();
    else if (key === 'faq') this.renderFaq();
  },

  onTapTab(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx < 0) this.renderAll(this.data.activeCat);
    else this.renderDay(idx, this.data.activeCat);
  },

  onTapSemCell(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx >= 0) this.renderDay(idx, this.data.activeCat);
  },

  onTapTeacher(e) {
    const name = e.currentTarget.dataset.name;
    const t = (this.feed.TEACHERS || {})[name];
    if (!t) return;
    this.setData({
      teacherModal: {
        name: name,
        title: t.title || '',
        dept: t.dept || '暂无信息',
        focus: t.focus || '暂无信息',
        bio: t.bio || '',
        sourceLabel: t.sourceLabel || t.source || '暂无',
        source: t.source || ''
      }
    });
  },

  onCloseTeacher() {
    this.setData({ teacherModal: null });
  },

  /** 个人主体小程序无「业务域名」配置权限，web-view 用不了，改为复制链接由用户在浏览器打开 */
  onOpenLecture(e) {
    const url = e.currentTarget.dataset.url;
    const title = e.currentTarget.dataset.title;
    const event = e.currentTarget.dataset.event;
    if (!url) return;
    const landingUrl = LANDING_HOST + '/go/?to=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title || '') + '&event=' + encodeURIComponent(event || '');
    wx.setClipboardData({
      data: landingUrl,
      success() {
        wx.showModal({
          title: '链接已复制到剪贴板',
          content: '粘贴到浏览器地址栏即可打开。',
          showCancel: false,
          confirmText: '知道了'
        });
      },
      fail() {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  /** 弹窗内容区占位：吞掉点击，避免冒泡到遮罩层导致误关 */
  noop() {},

  /** 小程序内无法直接打开外部网页，改为复制链接由用户在浏览器打开 */
  onCopySource() {
    const m = this.data.teacherModal;
    if (!m || !m.source) return;
    wx.setClipboardData({
      data: m.source,
      success() {
        wx.showToast({ title: '链接已复制，粘贴到浏览器即可打开', icon: 'none', duration: 2200 });
      }
    });
  },

  /** CalDAV 三项信息一次性复制，省得同学来回切页面抄 */
  onToggleCalOthers() {
    this.setData({ calOthersOpen: !this.data.calOthersOpen });
  },

  onToggleCalIcs() {
    this.setData({ calIcsOpen: !this.data.calIcsOpen });
  },

  onCopyCaldav() {
    const d = this.data;
    const text = '服务器：' + d.caldavServer + '\n用户名：' + d.caldavUser + '\n密码：' + d.caldavPass;
    wx.setClipboardData({
      data: text,
      success() { wx.showToast({ title: 'CalDAV 信息已复制', icon: 'none' }); }
    });
  },

  onCopyIcs() {
    const url = this.data.icsUrl;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success() { wx.showToast({ title: '订阅链接已复制', icon: 'none' }); }
    });
  },

  onPrevDay() {
    if (this.data.view === 'day' && this.data.curIdx > 0) {
      this.renderDay(this.data.curIdx - 1, this.data.activeCat);
    }
  },

  onNextDay() {
    if (this.data.view === 'day' && this.data.curIdx < this.feed.DAYS.length - 1) {
      this.renderDay(this.data.curIdx + 1, this.data.activeCat);
    }
  },

  onPullDownRefresh() {
    const self = this;
    store.refresh(function (feed) { self.applyFeed(feed, false); });
    setTimeout(function () { wx.stopPullDownRefresh(); }, 600);
  },

  onShareAppMessage() {
    return { title: (CFG.className ? CFG.className + ' · ' : '') + (CFG.title || '课表'), path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: (CFG.className ? CFG.className + ' · ' : '') + (CFG.title || '课表') };
  }
});
