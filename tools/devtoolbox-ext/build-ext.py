#!/usr/bin/env python3
"""把站点页面里的内联 <script> 抽成外部 js 文件（Manifest V3 CSP 禁止内联脚本）。
网站代码同步过来后执行一次：python3 build-ext.py"""
import pathlib, re, sys

EXT = pathlib.Path(__file__).resolve().parent
pages = ([EXT / 'index.html', EXT / 'popup.html', EXT / 'sidepanel.html']
         + sorted((EXT / 'tools').glob('*.html')))

changed = 0
for page in pages:
    if not page.exists():
        continue
    html = page.read_text()
    blocks = re.findall(r'<script>([\s\S]*?)</script>', html)
    if not blocks:
        continue
    for i, code in enumerate(blocks, 1):
        name = '%s-%d.js' % (page.stem, i)
        (page.parent / name).write_text(code.lstrip('\n'))
        html = html.replace('<script>' + code + '</script>',
                            '<script src="%s"></script>' % name, 1)
    page.write_text(html)
    changed += 1
    print('[ok] %s 抽出 %d 个内联脚本' % (page.relative_to(EXT), len(blocks)))

# 给工具页注入状态桥接脚本（幂等）
for page in sorted((EXT / 'tools').glob('*.html')):
    s = page.read_text()
    if 'state-bridge.js' in s:
        continue
    if s.count('</body>') == 1:
        page.write_text(s.replace('</body>', '  <script src="../state-bridge.js"></script>\n</body>'))
        print('[ok] %s 注入 state-bridge.js' % page.relative_to(EXT))

print('完成：处理 %d 个页面；内联脚本剩余 %d 处' %
      (changed, sum(1 for p in pages if p.exists() and '<script>' in p.read_text())))
