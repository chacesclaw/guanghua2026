/**
 * 上线前体检。跑 npm run build 时自动执行，也可以单独 npm run validate。
 * 分两级：ERROR 会让构建失败，WARN 只提示。
 */
import fs from 'node:fs';
import { parseTimeRange } from './ics.mjs';

const E = [], W = [];
const err = (m) => E.push(m);
const warn = (m) => W.push(m);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const mins = t => t.h * 60 + t.m;

export function validate(data, config = {}) {
  E.length = 0; W.length = 0;

  if (!data || typeof data !== 'object') { err('数据文件不是一个 JSON 对象'); return { E, W }; }
  for (const k of ['version', 'lastUpdated', 'CATS', 'DAYS']) {
    if (!data[k]) err(`缺少必填字段 ${k}`);
  }
  const CATS = data.CATS || {};
  const DAYS = Array.isArray(data.DAYS) ? data.DAYS : [];
  if (!DAYS.length) err('DAYS 是空的，没有任何日期');

  const keys = new Set();
  let prevStart = null;

  DAYS.forEach((day, di) => {
    const at = `DAYS[${di}]${day.key ? `（${day.key}）` : ''}`;
    for (const k of ['key', 'start', 'end', 'd1', 'd2', 'big', 'week']) {
      if (!day[k]) err(`${at} 缺少字段 ${k}`);
    }
    if (day.key) {
      if (keys.has(day.key)) err(`${at} 的 key 重复了，key 必须唯一`);
      keys.add(day.key);
    }
    if (day.start && !ISO.test(day.start)) err(`${at} start 不是 YYYY-MM-DD 格式：${day.start}`);
    if (day.end && !ISO.test(day.end)) err(`${at} end 不是 YYYY-MM-DD 格式：${day.end}`);
    if (day.start && day.end && day.end < day.start) err(`${at} end 早于 start`);
    if (prevStart && day.start && day.start < prevStart) {
      warn(`${at} 的日期比上一个日期块早，DAYS 建议按时间正序排列，否则页面上的「前一天/后一天」会跳来跳去`);
    }
    prevStart = day.start || prevStart;

    const events = Array.isArray(day.events) ? day.events : [];
    if (!events.length) warn(`${at} 一个事件都没有，页面上会是空白的一天`);

    const parsed = [];
    events.forEach((ev, ei) => {
      const eat = `${at} 第 ${ei + 1} 条`;
      if (!ev.title) err(`${eat} 缺少 title`);
      if (!ev.time) err(`${eat} 缺少 time`);
      if (!ev.cat) err(`${eat} 缺少 cat`);
      else if (!CATS[ev.cat]) err(`${eat} 的分类 "${ev.cat}" 在 CATS 里没有定义`);

      const r = ev.time ? parseTimeRange(ev.time) : null;
      if (ev.time && !r) err(`${eat} 的 time "${ev.time}" 解析不了。支持的写法：09:00–12:30、09:00-12:30、全天`);
      if (r && !r.allDay) {
        if (r.start.h > 23 || r.start.m > 59 || r.end.m > 59) err(`${eat} 的时间数值越界：${ev.time}`);
        parsed.push({ ei, ev, r });
      }
      if (ev.endDate && !ISO.test(ev.endDate)) err(`${eat} endDate 不是 YYYY-MM-DD 格式`);
      if (ev.endDate && day.start && ev.endDate < day.start) err(`${eat} endDate 早于所在日期块的 start`);

      if (!ev.where) warn(`${eat}「${ev.title || ''}」没写上课地点 where`);
      const links = [...(ev.links || []), ...(ev.link ? [ev.link] : [])];
      for (const l of links) {
        if (!l.url) err(`${eat} 的 link 缺少 url`);
        else if (!/^https?:\/\//i.test(l.url)) {
          err(`${eat} 的链接必须是 http(s) 开头的绝对地址，相对路径在小程序和日历里都点不开：${l.url}`);
        }
      }
      if (ev.credit && !/^\d+(\.\d+)?$/.test(String(ev.credit))) {
        warn(`${eat} 的 credit "${ev.credit}" 不是纯数字，筛选下拉框里会单独占一项`);
      }
    });

    // 同一天时间重叠检测
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i], b = parsed[j];
        const as = mins(a.r.start), ae = mins(a.r.end), bs = mins(b.r.start), be = mins(b.r.end);
        if (as < be && bs < ae) {
          const sameSlot = a.ev.time === b.ev.time;
          const msg = `${at}「${a.ev.title}」(${a.ev.time}) 与「${b.ev.title}」(${b.ev.time}) 时间重叠`;
          // 完全同一时间段通常是有意的并行场次，只提示；部分重叠更可能是录入错误
          sameSlot ? warn(msg + '，如果是并行场次可以忽略') : warn(msg + '，请确认不是录错了');
        }
      }
    }
  });

  // 老师简介与实际授课人对不上
  const whoSet = new Set();
  DAYS.forEach(d => (d.events || []).forEach(ev => {
    if (ev.who) String(ev.who).split(/[、\/,，]/).forEach(n => n.trim() && whoSet.add(n.trim()));
  }));
  for (const name of Object.keys(data.TEACHERS || {})) {
    if (!whoSet.has(name)) warn(`TEACHERS 里的「${name}」在课表里没有任何一节课，可以删掉`);
  }

  // 配置层体检
  const site = config.site || {};
  if (!site.baseUrl) warn('config.site.baseUrl 没填，日历订阅链接会是相对路径，手机上订阅不了');
  else if (!/^https:\/\//i.test(site.baseUrl)) err('config.site.baseUrl 必须是 https，小程序和日历订阅都不接受 http');
  else if (/\/$/.test(site.baseUrl)) warn('config.site.baseUrl 结尾多了一个斜杠，建议去掉');

  const dav = config.calendar?.caldav || {};
  if (dav.enabled && dav.pass) {
    warn('config.calendar.caldav 里填了密码，它会原样出现在公开网页的源码里。请确认这是一个只读、专用、可随时作废的账号。');
  }
  if (config.miniprogram && !config.miniprogram.appid) {
    warn('config.miniprogram.appid 没填，小程序产物可以生成但没法用开发者工具打开');
  }

  return { E, W };
}

export function report({ E, W }) {
  for (const w of W) console.log(`  ⚠️  ${w}`);
  for (const e of E) console.log(`  ❌ ${e}`);
  if (!E.length && !W.length) console.log('  ✓ 校验通过，没有发现问题');
  else console.log(`\n  小计：${E.length} 个错误，${W.length} 个提示`);
  return E.length === 0;
}

// 单独运行
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataPath = fs.existsSync('data/schedule.json') ? 'data/schedule.json' : 'data/schedule.example.json';
  const cfgPath = fs.existsSync('config.json') ? 'config.json' : 'config.example.json';
  console.log(`校验 ${dataPath}（配置 ${cfgPath}）`);
  const ok = report(validate(
    JSON.parse(fs.readFileSync(dataPath, 'utf8')),
    JSON.parse(fs.readFileSync(cfgPath, 'utf8'))));
  process.exit(ok ? 0 : 1);
}
