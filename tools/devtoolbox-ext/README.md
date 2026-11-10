# DevToolbox Chrome 扩展

这是 DevToolbox 开发者工具箱的 **Chrome 扩展完整代码**，独立存放，与网站源码目录（`~/Desktop/tools/devtoolbox`）**完全隔离**——本目录自带全部页面与静态资源，不依赖网站目录即可运行。

## 目录结构

```
devtoolbox-ext/
├── manifest.json      # MV3 清单（无任何权限申请）
├── popup.html         # 形态 1：点击图标弹出的悬浮弹窗
├── sidepanel.html     # 形态 2：侧边栏（常驻）
├── background.js      # 后台：右键菜单切换形态
├── icons/             # 16 / 32 / 48 / 128 四种尺寸图标
├── index.html         # 完整首页（弹窗右上「首页」按钮打开）
├── css/app.css        # 站点样式（含 4 套主题）
├── js/                # app.js（通用组件）、sqlfmt.js、vendor/（diff、marked）
├── tools/             # json / diff / sql / date / md 五个工具页
├── build-ext.py       # 内联脚本抽取 + 注入 state-bridge（CSP 兼容，见下）
├── state-bridge.js    # 侧边栏「全屏」时还原填写内容/选项
└── *-1.js             # 各页面抽出后的页面脚本（index-1/2.js、popup-1.js、tools/*-1.js）
```

## 安装（开发者模式）

1. Chrome 打开 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本目录 `~/Desktop/tools/devtoolbox-ext`
4. 点工具栏拼图图标 → 将 **DevToolbox** 固定到工具栏
5. 点击图标 → 弹出工具列表；点任意工具在新标签页打开

## 三种交互形态

| 形态 | 触发方式 | 说明 |
|---|---|---|
| **悬浮弹窗** | 单击工具栏图标 | 紧凑 340px，5 个工具 + 搜索 + 主题 |
| **侧边栏** | 弹窗右上「侧边栏」按钮；或**右键工具栏图标 → 在侧边栏中打开** | 常驻右侧；**点工具直接在面板内打开使用**（不跳标签页），↗ 才把当前工具放到全屏标签页 |
| **全屏标签页** | 弹窗右上「标签页」按钮（🏠/窗口图标）；或右键菜单「在标签页中打开」 | 打开完整首页，空间最大 |

需要 Chrome 114+（侧边栏 API）。三种形态共享同一份主题设置（`localStorage['devtoolbox.theme.v1']`）。

## 使用

- 弹窗顶部搜索框支持关键词过滤（json / diff / sql / date / md），输入后按 `Enter` 打开第一个匹配项
- 弹窗右上两个按钮：🌙 **主题切换**（深色 / 浅色 / 护眼绿 / 暖米黄，可循环）、🏠 **打开完整首页**
- 扩展首页右上角同样有浮动主题按钮
- 主题保存在 `localStorage['devtoolbox.theme.v1']`，弹窗与所有工具页同源共享——在弹窗切换后，工具页也同步生效
- **Markdown 工具：预览区可直接编辑（Typora 式）**，编辑内容会自动回写成 Markdown 源码；右侧「目录」按钮打开大纲，点条目光标跳到对应标题，滚动时自动高亮当前小节
- 所有数据都在本地浏览器处理，不上传任何服务器

## 为什么需要 build-ext.py（重要）

Manifest V3 扩展页面有严格 CSP：`script-src 'self'; object-src 'self'`，
**禁止内联 `<script>`、禁止 `eval`**。站点页面原本把 JS 写在内联 `<script>` 里，
直接放进扩展会「只有页面、没有功能」。

`build-ext.py` 会把每个页面的内联脚本抽成同目录下的 `*-1.js` 外部文件并改写引用。
同步网站代码后**必须再执行一次**，否则又会变回内联脚本：

```bash
python3 build-ext.py
```

## 可选：从网站同步最新工具代码

网站侧更新工具页后，手动同步一次（只覆盖页面与资源，不动 manifest/popup/README）：

```bash
rsync -a --exclude '.DS_Store' \
  ~/Desktop/tools/devtoolbox/index.html \
  ~/Desktop/tools/devtoolbox/css \
  ~/Desktop/tools/devtoolbox/js \
  ~/Desktop/tools/devtoolbox/tools \
  ~/Desktop/tools/devtoolbox-ext/
python3 build-ext.py     # ← 同步后必跑，重新抽内联脚本
```

## 可选：打包上架 Chrome 应用商店

```bash
cd ~/Desktop/tools/devtoolbox-ext
zip -r devtoolbox-ext.zip . -x '*.DS_Store'
# 或在 chrome://extensions 点「打包扩展程序」，选择本目录
```

## 备注

- 工具页运行在 `chrome-extension://` 源下：`⌘⏎`、全屏、复制均正常
- 若某处复制失效，给 `manifest.json` 增加 `"permissions": ["clipboardWrite"]` 后重新加载
