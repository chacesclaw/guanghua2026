# AGENTS.md

写给 AI Agent 的说明。人类读者请看 [README.md](README.md)。

---

## 这个项目是什么

一份 JSON 数据 + 一套生成器，产出三样东西：课表网页、日历订阅文件、微信小程序源码。

```
data/schedule.json  +  config.json
        │
        └── node build/build.mjs
                ├── site/dist/index.html          课表网页（数据内联）
                ├── site/dist/calendar.ics        日历订阅
                ├── site/dist/schedule.json       小程序远程数据
                ├── site/dist/manifest.json       PWA 清单
                ├── miniprogram/data/schedule.js  小程序内置兜底数据
                ├── miniprogram/config.js         小程序配置
                └── miniprogram/theme.wxss        小程序主题色
```

## 你可以改哪些文件

| 可以改 | 说明 |
|---|---|
| `data/schedule.json` | 课表数据。日常工作 95% 在这里 |
| `config.json` | 班级名、域名、配色、功能开关 |
| `site/templates/index.template.html` | 网页的样式和渲染逻辑。改这个才需要动 |
| `miniprogram/pages/`、`miniprogram/utils/` | 小程序的页面和逻辑 |

## 你绝对不要改哪些文件

下面这些**全部由构建生成**，你的改动会在下一次 `npm run build` 时被静默覆盖：

- `site/dist/` 里的任何东西
- `miniprogram/data/schedule.js`
- `miniprogram/config.js`
- `miniprogram/theme.wxss`

如果你想改网页上的某段文字，去改 `site/templates/index.template.html` 或者 `config.json`,**不要**去改 `site/dist/index.html`。

---

## 工作流程

### 首次导入课表

1. 读 `schema/schedule.schema.json`，这是数据契约，字段含义都在里面。
2. 读 `data/schedule.example.json`，这是每种字段的用法演示。
3. `cp config.example.json config.json`，按用户给的信息填写。至少要填 `class.name` 和 `site.baseUrl`。
4. 把用户的课表原件（PDF / Excel / 图片 / 邮件）提取成 `data/schedule.json`。
5. 跑 `node build/build.mjs`。
6. **把校验输出、以及所有你读不确定的条目列成表格交给用户确认。这一步不能跳过。**

### 日常改课

1. 改 `data/schedule.json`。
2. 更新顶部的 `version` 和 `lastUpdated`,**这一步必做**，小程序靠 `version` 判断有没有更新，不改的话客户端不会刷新。
3. 在 `CHANGELOG` 里补一条记录。
4. 跑 `node build/build.mjs`。
5. 报告改了哪几条 + 校验结果。不要把整个 JSON 贴给用户。

---

## 数据契约要点

完整定义在 `schema/schedule.schema.json`。这里只列最容易搞错的：

### 时间格式

- `time` 支持 `09:00–12:30`、`09:00-12:30`、`9:00~12:30`，分隔符全角半角都认。
- 全天事件写 `全天`。
- 只写开始时间不写结束时间的，生成日历时默认按 2 小时算。
- **不要**把时间写成 `上午`、`下午`、`第 1-2 节` 这种，解析不了。要么换算成具体钟点，要么问用户。

### 日期块

- `DAYS` 必须按时间**正序**排列，否则页面上「前一天 / 后一天」会乱跳。
- 一个日期块可以覆盖连续多天：`start` 和 `end` 填不同日期即可。集中授课、多日活动用这个。
- `key` 必须唯一，建议用 `0902` 这种月日格式。

### 分类

- `events[].cat` 的值必须在 `CATS` 里定义过，否则构建报错。
- 想让某个分类不出现在图例里，给它加 `"hideInLegend": true`，不要去改代码。

### 链接

- **必须是 `http://` 或 `https://` 开头的绝对地址。** 相对路径在小程序和日历里都点不开，构建会直接报错。
- 单个链接用 `link`，多个用 `links` 数组。
- 这个框架**只存链接，不托管课程材料**。不要把 PDF、录音、课件放进仓库。

### 个人信息

- `TEACHERS` 是可选的，默认由 `config.json` 里 `features.teacherProfiles` 关闭。
- **不要主动去网上搜老师的个人信息填进去。** 用户明确要求才做，并且要注明来源。
- **绝对不要**把学生名单、人数、手机号、邮箱、微信号写进数据文件。这些数据会出现在公开网页上。

---

## 校验

`node build/build.mjs` 会自动跑校验，也可以单独跑 `node build/validate.mjs`。

- ❌ 开头的是错误，会中止构建，必须修。
- ⚠️ 开头的是提示，不拦截，但你应该看一眼，并把值得注意的转告用户。

校验会查：必填字段、分类引用、日期格式与顺序、时间能否解析、**同一天内的时间重叠**、缺教室、相对路径链接、`baseUrl` 是否 https、CalDAV 密码是否会泄露到公开页面。

**校验查不出的**：时间和教室抄错了。`9:00` 抄成 `19:00` 校验是发现不了的，只能靠用户核对。所以第 6 步不能省。

---

## 常见错误

| 现象 | 原因 |
|---|---|
| 改了数据但网页没变 | 忘了跑 `build`，或者改的是 `site/dist/` 里的生成产物 |
| 小程序还是旧课表 | 没改 `version`；或者远程域名没加进小程序后台白名单 |
| 日历订阅了但事件时间差 8 小时 | `config.json` 里 `calendar.timezone` 填错了 |
| 日历里出现重复事件 | 同一个 `key` 用在了多个日期块上，导致 UID 撞车 |
| 构建报「分类未定义」 | `events[].cat` 写了 `CATS` 里没有的 key |
| 小程序打不开 | `config.json` 里 `miniprogram.appid` 没填 |

---

## 环境

- Node 18 以上，**没有任何 npm 依赖**，不需要 `npm install`。
- 所有脚本是 ESM(`.mjs`)。
- 本地预览：`node build/serve.mjs`，默认 8080 端口。

---

## 交付前自检

- [ ] `node build/build.mjs` 跑通，没有 ❌
- [ ] `git status` 里没有意外被修改的生成产物
- [ ] `data/schedule.json` 里没有学生个人信息
- [ ] `config.json` 里 CalDAV 如果开了，密码是专用只读账号
- [ ] 所有链接都是绝对地址
- [ ] 不确定的条目已经列给用户确认过
