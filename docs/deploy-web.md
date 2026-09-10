# 部署课表网页

构建产物在 `site/dist/`，是纯静态文件，没有后端。把这个目录整个传上去就行。

```
site/dist/
├── index.html        课表网页，数据已内联，断网也能看
├── calendar.ics      日历订阅文件
├── schedule.json     给小程序远程拉取的数据
├── manifest.json     PWA 清单
├── assets/           你放进 site/assets/ 的图片
└── icon-*.png        图标
```

三个硬要求：

1. **必须 HTTPS。** 小程序的 request 白名单和日历订阅都不接受 http。
2. **`config.json` 里的 `site.baseUrl` 要和实际地址一致**，结尾不带斜杠。日历订阅链接、小程序远程数据地址都是从它拼出来的。改了地址要重新 `npm run build`。
3. **`.ics` 文件的 Content-Type 要是 `text/calendar`。** 大部分托管平台会自动识别，自建 nginx 需要手动配。配错了 iOS 添加订阅会失败。

---

## 方式一：Cloudflare Pages(推荐)

免费、国内访问相对稳、自带 HTTPS、不需要备案。

```bash
npm run build
npx wrangler pages deploy site/dist --project-name=my-schedule
```

也可以在 Cloudflare 控制台直接连 GitHub 仓库，设置：

- 构建命令：`npm run build`
- 输出目录：`site/dist`

绑自己的域名在 Pages 项目的「Custom domains」里加。

## 方式二：Vercel

```bash
npm run build
npx vercel deploy site/dist --prod
```

国内访问 Vercel 不太稳，给国内同学用建议优先 Cloudflare。

## 方式三：GitHub Pages

```bash
npm run build
# 把 site/dist 推到 gh-pages 分支
npx gh-pages -d site/dist
```

注意两点：GitHub Pages 在国内时通时不通；仓库如果是公开的，你的课表数据也就公开了。

## 方式四：自建 nginx

```nginx
server {
    listen 443 ssl;
    server_name schedule.example.com;

    ssl_certificate     /etc/letsencrypt/live/schedule.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/schedule.example.com/privkey.pem;

    root /var/www/schedule;
    index index.html;

    # 日历订阅文件的 MIME 类型，配错了 iOS 会添加失败
    location ~ \.ics$ {
        default_type text/calendar;
        charset utf-8;
        add_header Cache-Control "public, max-age=1800";
    }

    # schedule.json 给小程序拉，缓存别设太长
    location = /schedule.json {
        default_type application/json;
        charset utf-8;
        add_header Cache-Control "public, max-age=300";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

没有公网 IP 的话，用 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 把本机的 80 端口暴露出去，不需要端口映射，也不需要固定 IP。

---

## 缓存的坑

课表改了但同学看到的还是旧的，九成是缓存问题。

- `index.html` 和 `schedule.json` 的缓存时间别设太长，建议 5 到 30 分钟。
- 图标、`assets/` 里的图片可以设长一点。
- 网页自带下拉刷新，会带时间戳参数强制绕过缓存，可以让同学下拉一下试试。
- 用了 CDN 的话，改完记得清一次缓存。

## 自定义图标

把你自己的图标放进 `site/assets/`，然后在 `config.json` 里：

```json
"site": {
  "logo": "logo.png",
  "watermark": "watermark.png"
}
```

`logo` 是页眉左上角的小图标（44 × 44 即可），`watermark` 是页眉右上角的大号淡水印。两个都可以留空。

没提供的话，构建会自动生成主题色的纯色占位图标，不会报错也不会难看。

**注意版权。** 学校院徽通常有使用规范，用之前确认你有权使用。
