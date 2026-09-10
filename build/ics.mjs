/**
 * schedule.json → calendar.ics
 *
 * 设计要点：
 * - 时间统一换算成 UTC 输出，换算时按 config.calendar.timezone 用 Intl 取真实偏移，
 *   所以换到有夏令时的时区也不会错。
 * - UID 由「日期块 key + 事件内容」派生，内容不变则 UID 不变，
 *   这样重复订阅不会产生重复事件，改动也能被日历正确识别为「同一事件被修改」。
 * - 严格按 RFC 5545 折行（75 字节）与转义。
 */

const DASH = /[–—~～-]/;   // 时间段分隔符，全角半角都认

/** 取某时刻在指定时区的 UTC 偏移分钟数 */
function tzOffsetMinutes(timezone, y, m, d, hh, mi) {
  const asUTC = Date.UTC(y, m - 1, d, hh, mi);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(asUTC)).map(x => [x.type, x.value]));
  const back = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (back - asUTC) / 60000;
}

/** 本地墙上时间 → UTC 的 ICS 时间戳 */
function toUtcStamp(timezone, y, m, d, hh, mi) {
  const off = tzOffsetMinutes(timezone, y, m, d, hh, mi);
  const t = Date.UTC(y, m - 1, d, hh, mi) - off * 60000;
  const dt = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}` +
         `T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00Z`;
}

/** 解析 "09:00–12:30" / "9:00-12:30" / "全天" */
export function parseTimeRange(time) {
  if (!time) return null;
  const s = String(time).trim();
  if (/^(全天|全日|all\s*day)$/i.test(s)) return { allDay: true };
  const parts = s.split(DASH).map(x => x.trim()).filter(Boolean);
  const hm = str => {
    const mm = /^(\d{1,2})[:：](\d{2})$/.exec(str);
    return mm ? { h: +mm[1], m: +mm[2] } : null;
  };
  const a = hm(parts[0]);
  if (!a) return null;
  const b = parts[1] ? hm(parts[1]) : null;
  // 没写结束时间的，默认按 2 小时算
  const end = b || { h: a.h + 2, m: a.m };
  return { allDay: false, start: a, end };
}

function escapeText(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 折行：每行最多 75 字节，续行以单个空格开头 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = Buffer.alloc(0);
  for (const ch of [...line]) {
    const b = Buffer.from(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74;   // 续行前面要占一个空格
    if (cur.length + b.length > limit) { out.push(cur.toString('utf8')); cur = Buffer.alloc(0); }
    cur = Buffer.concat([cur, b]);
  }
  if (cur.length) out.push(cur.toString('utf8'));
  return out[0] + out.slice(1).map(x => '\r\n ' + x).join('');
}

/** 内容哈希，用于生成稳定 UID */
function shortHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = x => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

export function buildIcs(data, config) {
  const cal = config.calendar || {};
  const tz = cal.timezone || 'Asia/Shanghai';
  const domain = cal.uidDomain || 'schedule.local';
  const calName = cal.calName || '课表';
  const refreshH = Number(cal.refreshHours ?? 12);
  const alarmMin = Number(cal.alarmMinutes ?? 0);
  const stamp = toUtcStamp('UTC', ...new Date().toISOString()
    .match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/).slice(1).map(Number));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//guanghua2026//${escapeText(calName)}//CN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
    `X-WR-TIMEZONE:${tz}`,
    `X-PUBLISHED-TTL:PT${refreshH}H`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshH}H`,
  ];

  let count = 0;
  const seen = new Set();

  for (const day of data.DAYS || []) {
    for (const ev of day.events || []) {
      const range = parseTimeRange(ev.time);
      if (!range) continue;

      const startDate = day.start;
      const endDate = ev.endDate || day.end || day.start;

      let dtStart, dtEnd, rrule = null;
      if (range.allDay) {
        // 全天事件横跨整段日期，是一条连续的多日事件。DTEND 排他，要 +1 天
        dtStart = `DTSTART;VALUE=DATE:${startDate.replace(/-/g, '')}`;
        dtEnd = `DTEND;VALUE=DATE:${addDays(endDate, 1).replace(/-/g, '')}`;
      } else {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const e = range.end;
        // 跨零点的课（如 22:00–01:00），当天的结束时间落到第二天
        const crossMidnight = (e.h * 60 + e.m) <= (range.start.h * 60 + range.start.m);
        const dayEndIso = crossMidnight ? addDays(startDate, 1) : startDate;
        const [ey, em, ed] = dayEndIso.split('-').map(Number);
        dtStart = `DTSTART:${toUtcStamp(tz, sy, sm, sd, range.start.h, range.start.m)}`;
        dtEnd = `DTEND:${toUtcStamp(tz, ey, em, ed, e.h % 24, e.m)}`;
        // 定时事件横跨多天时，含义是「这几天每天都上这个时段」，
        // 生成成一条按天重复的事件，而不是一条横跨数天的长事件。
        if (endDate > startDate) {
          const [uy, um, ud] = endDate.split('-').map(Number);
          rrule = `RRULE:FREQ=DAILY;UNTIL=${toUtcStamp(tz, uy, um, ud, 23, 59)}`;
        }
      }

      let uid = `${day.key}-${shortHash(`${ev.time}|${ev.title}|${ev.where || ''}|${ev.who || ''}`)}@${domain}`;
      while (seen.has(uid)) uid = uid.replace('@', 'x@');   // 极小概率撞车时兜底
      seen.add(uid);

      const descParts = [];
      if (ev.sub) descParts.push(ev.sub);
      if (ev.who) descParts.push(`授课：${ev.who}`);
      if (ev.cls) descParts.push(ev.cls);
      if (ev.nature) descParts.push(ev.nature + (ev.credit ? ` ${ev.credit} 学分` : ''));
      if (ev.note) descParts.push(ev.note);
      const links = [...(ev.links || []), ...(ev.link ? [ev.link] : [])];
      for (const l of links) descParts.push(`${l.label}：${l.url}`);

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(dtStart);
      lines.push(dtEnd);
      if (rrule) lines.push(rrule);
      lines.push(`SUMMARY:${escapeText(ev.title)}`);
      if (descParts.length) lines.push(`DESCRIPTION:${escapeText(descParts.join(' · '))}`);
      if (ev.where) lines.push(`LOCATION:${escapeText(ev.where)}`);
      const catLabel = (data.CATS || {})[ev.cat]?.label;
      if (catLabel) lines.push(`CATEGORIES:${escapeText(catLabel)}`);
      if (links[0]) lines.push(`URL:${escapeText(links[0].url)}`);
      if (alarmMin > 0 && !ev.noAlarm && !range.allDay) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
                   `DESCRIPTION:${escapeText(ev.title)}`,
                   `TRIGGER:-PT${alarmMin}M`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
      count++;
    }
  }

  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count };
}
