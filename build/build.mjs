/**
 * 单一数据源 → 三个产物
 *
 *   data/schedule.json  +  config.json
 *            │
 *            ├── site/dist/index.html          课表网页（数据内联，离线可看）
 *            ├── site/dist/schedule.json       给小程序远程拉取的数据
 *            ├── site/dist/calendar.ics        日历订阅文件
 *            ├── site/dist/manifest.json       PWA 清单
 *            └── miniprogram/data/schedule.js  小程序内置兜底数据
 *
 * 用法：
 *   node build/build.mjs
 *   node build/build.mjs --data data/schedule.example.json --config config.example.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildIcs } from './ics.mjs';
import { validate, report } from './validate.mjs';
import { solidIcon, icoFromPng } from './png.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const p = (...x) => path.join(ROOT, ...x);
const pick = (a, b) => (fs.existsSync(p(a)) ? a : b);

const dataPath = arg('data', pick('data/schedule.json', 'data/schedule.example.json'));
const cfgPath = arg('config', pick('config.json', 'config.example.json'));
const outDir = arg('out', 'site/dist');

const readJson = f => JSON.parse(fs.readFileSync(p(f), 'utf8'));
const data = readJson(dataPath);
const config = readJson(cfgPath);

console.log(`\n数据：${dataPath}\n配置：${cfgPath}\n`);
const usingExample = dataPath.includes('example');
if (usingExample) {
  console.log('提示：正在用仓库自带的示例数据构建。示例内容全部是虚构的，');
  console.log('      正式使用请把你自己的课表写进 data/schedule.json。\n');
}

// ---------- 1. 体检 ----------
console.log('校验数据：');
if (!report(validate(data, config))) {
  console.log('\n构建中止：请先修掉上面的错误。');
  process.exit(1);
}

// ---------- 2. 准备变量 ----------
const cls = config.class || {};
const site = config.site || {};
const cal = config.calendar || {};
const theme = config.theme || {};
const features = config.features || {};
const baseUrl = (site.baseUrl || '').replace(/\/+$/, '');
const icsName = cal.icsFileName || 'calendar.ics';
const icsUrl = baseUrl ? `${baseUrl}/${icsName}` : icsName;

const fmtDate = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const wk = '日一二三四五六'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y} 年 ${m} 月 ${d} 日（周${wk}）`;
};
const termRange = [cls.termStart, cls.termEnd].every(Boolean)
  ? `${fmtDate(cls.termStart)} — ${fmtDate(cls.termEnd)}` : '';

// ---------- 3. 网页 ----------
let html = fs.readFileSync(p('site/templates/index.template.html'), 'utf8');

// 功能开关：<!--IF:xxx--> ... <!--ENDIF:xxx-->
html = html.replace(/<!--IF:(\w+)-->([\s\S]*?)<!--ENDIF:\1-->/g,
  (_, feat, body) => (features[feat] === false ? '' : body));

const logoImg = site.logo
  ? `<img class="emblem" src="assets/${site.logo}" alt="" width="44" height="44">`
  : '';

const vars = {
  PAGE_TITLE: [cls.school, cls.name, cls.title].filter(Boolean).join(' · '),
  SHORT_NAME: site.shortName || '课表',
  THEME_COLOR: site.themeColor || theme.red || '#7d1c26',
  SCHOOL: cls.school || '',
  SCHOOL_EN: cls.schoolEn || '',
  CLASS_NAME: cls.name || '',
  TITLE: cls.title || '课表',
  TERM_RANGE: termRange,
  DISCLAIMER: cls.disclaimer || '',
  FOOTER_NOTE: cls.footerNote || '',
  LOGO_IMG: logoImg,
};
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

// 主题色
const cssVars = {
  '--red-deep': theme.redDeep, '--red': theme.red, '--red-bright': theme.redBright,
  '--gold': theme.gold, '--paper': theme.paper,
};
for (const [k, v] of Object.entries(cssVars)) {
  if (v) html = html.replace(new RegExp(`(${k}\\s*:\\s*)[^;]+;`), `$1${v};`);
}
if (site.watermark) {
  html = html.replace('background-image: var(--watermark-img, none);',
    `background-image: url("assets/${site.watermark}");`);
}

// 注入数据与配置（只注入页面用得到的部分）
const pageCfg = {
  features,
  calendar: {
    calName: cal.calName || '课表',
    caldav: cal.caldav?.enabled ? {
      enabled: true, server: cal.caldav.server, user: cal.caldav.user,
      pass: cal.caldav.pass, displayName: cal.caldav.displayName,
    } : { enabled: false },
  },
};
html = html.replace('/*__DATA__*/{}', JSON.stringify(data));
html = html.replace('/*__CONFIG__*/{}', JSON.stringify(pageCfg));
html = html.replace("/*__ICS_URL__*/''", JSON.stringify(icsUrl));

// ---------- 4. 写产物 ----------
const out = f => p(outDir, f);
fs.mkdirSync(p(outDir, 'assets'), { recursive: true });
fs.writeFileSync(out('index.html'), html);
fs.writeFileSync(out('schedule.json'), JSON.stringify({ ...data, icsUrl }, null, 2));

const { ics, count } = buildIcs(data, config);
fs.writeFileSync(out(icsName), ics);

fs.writeFileSync(out('manifest.json'), JSON.stringify({
  name: vars.PAGE_TITLE,
  short_name: vars.SHORT_NAME,
  start_url: baseUrl ? baseUrl + '/' : './',
  display: 'standalone',
  background_color: theme.paper || '#f7f2e7',
  theme_color: vars.THEME_COLOR,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2));

// 图标：用户没放自己的就生成纯色占位图
const userAssets = p('site/assets');
if (fs.existsSync(userAssets)) {
  for (const f of fs.readdirSync(userAssets)) {
    if (f.startsWith('.')) continue;
    fs.copyFileSync(path.join(userAssets, f), out(`assets/${f}`));
  }
}
const tc = vars.THEME_COLOR;
for (const [f, size] of [['icon-192.png', 192], ['icon-512.png', 512],
                         ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['favicon-16.png', 16]]) {
  if (!fs.existsSync(out(f))) fs.writeFileSync(out(f), solidIcon(size, tc));
}
if (!fs.existsSync(out('favicon.ico'))) {
  fs.writeFileSync(out('favicon.ico'), icoFromPng(solidIcon(32, tc)));
}

// ---------- 5. 小程序 ----------
const mpDir = p('miniprogram');
if (fs.existsSync(mpDir)) {
  const mp = config.miniprogram || {};
  const remote = mp.remoteDataUrl || (baseUrl ? `${baseUrl}/schedule.json` : '');

  fs.mkdirSync(path.join(mpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(mpDir, 'data/schedule.js'),
    '// 本文件由 npm run build 自动生成，请勿手工编辑。\n' +
    '// 这是随小程序包内置的兜底数据；线上优先读取远程 schedule.json，\n' +
    '// 所以日常改课表只需要重新部署网页，不用重新提审小程序。\n' +
    `// 生成时间：${data.version}\n\n` +
    `module.exports = ${JSON.stringify(data, null, 2)};\n`);

  const cfgJs = path.join(mpDir, 'config.js');
  fs.writeFileSync(cfgJs,
    '// 本文件由 npm run build 自动生成，请勿手工编辑。改 config.json 后重新 build。\n' +
    `module.exports = ${JSON.stringify({
      remoteDataUrl: remote,
      remoteDataUrlBackup: mp.remoteDataUrlBackup || '',
      icsUrl,
      siteUrl: baseUrl,
      school: cls.school || '',
      schoolEn: cls.schoolEn || '',
      className: cls.name || '',
      title: cls.title || '课表',
      termRange,
      disclaimer: cls.disclaimer || '',
      logo: site.logo ? `/images/${site.logo}` : '',
      calName: cal.calName || '课表',
      caldav: cal.caldav?.enabled ? {
        enabled: true, server: cal.caldav.server, user: cal.caldav.user, pass: cal.caldav.pass,
      } : { enabled: false },
    }, null, 2)};\n`);

  // 主题变量文件（app.wxss 通过 @import 引用）
  fs.writeFileSync(path.join(mpDir, 'theme.wxss'),
    '/* 本文件由 npm run build 自动生成，请勿手工编辑。改 config.json 里的 theme 后重新 build。 */\n' +
    'page {\n' +
    `  --red-deep: ${theme.redDeep || '#5c1119'};\n` +
    `  --red: ${theme.red || '#7d1c26'};\n` +
    `  --red-bright: ${theme.redBright || '#a8323d'};\n` +
    `  --gold: ${theme.gold || '#b8860b'};\n` +
    `  --paper: ${theme.paper || '#f7f2e7'};\n` +
    '}\n');

  // 小程序 wxss 里是写死的十六进制色值（wxss 对 var() 支持不稳），
  // 这里按角色做一次替换，让配色跟着 config.json 走。
  const PALETTE = {
    '#7d1c26': theme.red, '#8c1d2b': theme.redBright, '#a8232f': theme.redBright,
    '#b8860b': theme.gold, '#f7f2e7': theme.paper,
  };
  const wxssFiles = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.wxss') && f !== 'theme.wxss') wxssFiles.push(full);
    }
  })(mpDir);
  for (const f of wxssFiles) {
    let css = fs.readFileSync(f, 'utf8');
    let changed = false;
    for (const [from, to] of Object.entries(PALETTE)) {
      if (!to || to.toLowerCase() === from) continue;
      const re = new RegExp(from, 'gi');
      if (re.test(css)) { css = css.replace(re, to); changed = true; }
    }
    if (changed) fs.writeFileSync(f, css);
  }

  // logo 同步进小程序包
  if (site.logo && fs.existsSync(p('site/assets', site.logo))) {
    fs.mkdirSync(path.join(mpDir, 'images'), { recursive: true });
    fs.copyFileSync(p('site/assets', site.logo), path.join(mpDir, 'images', site.logo));
  }

  // project.config.json 里的 appid
  const pcPath = path.join(mpDir, 'project.config.json');
  if (fs.existsSync(pcPath)) {
    const pc = JSON.parse(fs.readFileSync(pcPath, 'utf8'));
    pc.appid = mp.appid || '';
    pc.projectname = mp.navTitle || vars.SHORT_NAME;
    fs.writeFileSync(pcPath, JSON.stringify(pc, null, 2) + '\n');
  }
  // app.json 里的导航栏标题与配色
  const appPath = path.join(mpDir, 'app.json');
  if (fs.existsSync(appPath)) {
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
    app.window = app.window || {};
    app.window.navigationBarTitleText = mp.navTitle || vars.SHORT_NAME;
    app.window.navigationBarBackgroundColor = vars.THEME_COLOR;
    app.window.backgroundColor = theme.paper || '#f7f2e7';
    fs.writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
  }
}

// ---------- 6. 汇报 ----------
const kb = f => (fs.statSync(out(f)).size / 1024).toFixed(0) + ' KB';
const dayCount = (data.DAYS || []).length;
const evCount = (data.DAYS || []).reduce((n, d) => n + (d.events || []).length, 0);
console.log(`\n构建完成：${dayCount} 个日期块，${evCount} 条事件\n`);
console.log(`  ${outDir}/index.html      ${kb('index.html')}   课表网页`);
console.log(`  ${outDir}/${icsName}   ${kb(icsName)}   日历订阅（${count} 个事件）`);
console.log(`  ${outDir}/schedule.json   ${kb('schedule.json')}   小程序远程数据`);
console.log(`  ${outDir}/manifest.json   ${kb('manifest.json')}   PWA 清单`);
console.log(`  miniprogram/data/schedule.js       小程序内置兜底数据`);
console.log(`\n下一步：把 ${outDir}/ 整个目录传到你的静态托管上。`);
if (!baseUrl) console.log('注意：config.site.baseUrl 还没填，日历订阅链接暂时是相对路径。');
console.log('');
