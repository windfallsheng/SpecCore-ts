# 临时脚本：在交底书 HTML 的四段附图说明后插入图片（处理后即删除）
import re

IMG_DIR = "/Users/luzhaosheng/MyWork/专利申请模板+示例/附图"

html = open('/tmp/current.html', encoding='utf-8').read()

figs = [
    # (定位关键词, 图片文件, 显示宽度, 图注)
    ('<b>图 1</b>', 'fig1.png', 430, '图 1  系统总体架构图'),
    ('<b>图 2</b>', 'fig2.png', 280, '图 2  软件开发方法主流程图'),
    ('<b>图 3</b>', 'fig3.png', 430, '图 3  双向追溯链路示意图'),
    ('<b>图 4</b>', 'fig4.png', 360, '图 4  规范数据库五层结构图'),
]

for kw, png, width, caption in figs:
    # 找到包含关键词的 <p ...>...</p> 段落
    pat = re.compile(r'(<p[^>]*>' + re.escape(kw) + r'.*?</p>)', re.S)
    m = pat.search(html)
    if not m:
        print('未找到段落:', kw)
        continue
    insert = (f'\n<p style="text-align:center; margin: 10.0px 0.0px 10.0px 0.0px;">'
              f'<img src="file://{IMG_DIR}/{png}" width="{width}"></p>\n'
              f'<p style="text-align:center; margin: 0.0px 0.0px 12.0px 0.0px; font: 12.0px Times;">{caption}</p>')
    html = html.replace(m.group(1), m.group(1) + insert, 1)
    print('已插入:', kw)

open('/tmp/current_with_figs.html', 'w', encoding='utf-8').write(html)
print('完成')
