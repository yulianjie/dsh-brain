# -*- coding: utf-8 -*-
"""Render the dsh-brain architecture diagrams (Pillow only, no graph toolchain).

Layout is measured, not hand-tuned: every box gets its height from the wrapped
text, so editing a label cannot silently clip it. The script prints any box that
would still overflow.

Usage:  python docs/assets/render-architecture.py
Output: docs/assets/brain-architecture.png
        docs/assets/brain-personality-loop.png
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')
REG = os.path.join(FONT_DIR, 'msyh.ttc')
BOLD = os.path.join(FONT_DIR, 'msyhbd.ttc')

BG = '#F5F7FB'
INK = '#0F172A'
BODY = '#44536B'
MUTED = '#74839A'
BORDER = '#D9E1ED'
SHADOW = '#E4E9F2'
GRAY = '#94A3B8'
BLUE = '#2563EB'
TEAL = '#0D9488'
AMBER = '#B26A00'
VIOLET = '#7C3AED'
ROSE = '#D6246E'
SLATE = '#475569'

WARN = []
_fonts = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(BOLD if bold else REG, size)
    return _fonts[key]


TOKEN = re.compile(r'[A-Za-z0-9_\-\./:*]+|\s+|.')
LINE_GAP = 8


def wrap(text, fnt, maxw):
    lines, cur = [], ''
    for tk in TOKEN.findall(text):
        if fnt.getlength(cur + tk) <= maxw or not cur.strip():
            cur += tk
        else:
            lines.append(cur.rstrip())
            cur = '' if tk.isspace() else tk
    if cur.strip():
        lines.append(cur.rstrip())
    return lines


def body_lines(body, w, pad, size):
    out, fnt = [], font(size)
    for para in body:
        out.extend(wrap(para, fnt, w - pad - 18))
    return out


def box_height(title, body, w, title_size=21, body_size=17, pad=26):
    return (15 + title_size + 14 + len(body_lines(body, w, pad, body_size)) * (body_size + LINE_GAP)
            + 3 * max(0, len(body) - 1) + 10)


def dashed_line(draw, p1, p2, color, width=3, dash=13, gap=9):
    x1, y1 = p1
    x2, y2 = p2
    length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    if not length:
        return
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        draw.line([(x1 + ux * pos, y1 + uy * pos), (x1 + ux * end, y1 + uy * end)],
                  fill=color, width=width)
        pos = end + gap


def segment(draw, a, b, color, width, dashed):
    if dashed:
        dashed_line(draw, a, b, color, width)
    else:
        draw.line([a, b], fill=color, width=width)


def route(draw, pts, color, width=3, dashed=False, head=9):
    for a, b in zip(pts, pts[1:]):
        segment(draw, a, b, color, width, dashed)
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = max((dx * dx + dy * dy) ** 0.5, 1e-6)
    ux, uy = dx / n, dy / n
    px, py = -uy, ux
    draw.polygon([(x2, y2),
                  (x2 - ux * head * 1.8 + px * head, y2 - uy * head * 1.8 + py * head),
                  (x2 - ux * head * 1.8 - px * head, y2 - uy * head * 1.8 - py * head)],
                 fill=color)


def label(draw, xy, text, color=MUTED, size=15, anchor='la'):
    draw.text(xy, text, font=font(size), fill=color, anchor=anchor)


def pill(draw, xy, text, color, size=14):
    fnt = font(size)
    x, y = xy
    draw.rounded_rectangle([x - 5, y - 12, x + fnt.getlength(text) + 7, y + 12],
                           radius=7, fill=BG)
    draw.text((x, y), text, font=fnt, fill=color, anchor='lm')


def draw_box(draw, x, y, w, h, title, body, accent, title_size=21, body_size=17):
    draw.rounded_rectangle([x + 4, y + 5, x + w + 4, y + h + 5], radius=16, fill=SHADOW)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=16, fill='#FFFFFF',
                           outline=BORDER, width=2)
    draw.rounded_rectangle([x, y, x + 9, y + h], radius=4, fill=accent)
    draw.rectangle([x + 5, y + 10, x + 9, y + h - 10], fill=accent)
    pad = 26
    ty = y + 15
    draw.text((x + pad, ty), title, font=font(title_size, True), fill=INK)
    ty += title_size + 14
    fnt = font(body_size)
    for i, para in enumerate(body):
        for line in wrap(para, fnt, w - pad - 18):
            draw.text((x + pad, ty), line, font=fnt, fill=BODY)
            ty += body_size + LINE_GAP
        if i < len(body) - 1:
            ty += 3
    if ty + 6 - (y + h) > 0:
        WARN.append('box "%s" overflow %dpx' % (title, ty + 6 - (y + h)))


def draw_chip(draw, x, y, w, head, text, accent, size=15):
    lines = wrap(text, font(size), w - 38)
    h = 42 + len(lines) * 22 + 8
    draw.rounded_rectangle([x, y, x + w, y + h], radius=12, fill='#FFFFFF',
                           outline=BORDER, width=2)
    draw.rounded_rectangle([x, y, x + 6, y + h], radius=3, fill=accent)
    draw.text((x + 20, y + 12), head, font=font(16, True), fill=accent)
    ty = y + 40
    for line in lines:
        draw.text((x + 20, ty), line, font=font(size), fill=BODY)
        ty += 22
    return h


def header(draw, x, y, w, text, accent):
    draw.rounded_rectangle([x, y, x + w, y + 40], radius=10, fill=accent + '16',
                           outline=accent + '55', width=2)
    draw.text((x + 14, y + 8), text, font=font(18, True), fill=accent)


def legend(draw, x, y):
    items = [(BLUE, '同步调用', False), (AMBER, '异步后台', True), (ROSE, '读取快照', True)]
    for color, text, dashed in items:
        route(draw, [(x, y + 8), (x + 54, y + 8)], color, 3, dashed, head=8)
        draw.text((x + 64, y - 2), text, font=font(15), fill=MUTED)
        x += 64 + int(font(15).getlength(text)) + 28


# --------------------------------------------------------------------------
# Diagram 1: end-to-end architecture
# --------------------------------------------------------------------------
COLUMN_TOP = 206
COLUMN_GAP = 16


def architecture_spec():
    return [
        ('host', 60, 430, BLUE, '① 宿主（DeepSeek Harness）', [
            ('b1', '会话事件总线', ['agent/inbox/claimed 记录本轮真实用户文本',
                               'session/event(turn/end) 仅在根 agent 完成时触发'], BLUE),
            ('b2', '模型请求管道', ['agent/pre-step：首轮在系统头之后插入参考',
                               'agent/request：之后只替换自己的快照节点'], BLUE),
            ('b3', '设置通道', ['loader/volatile-update 热更新 23 项配置',
                            '变更即递增 configEpoch，取消在途学习'], BLUE),
            ('b4', '本地 CLI', ['bin/brain.mjs：list / export / import',
                            '人格 history / rollback（服务不可用时）'], SLATE),
        ]),
        ('plugin', 560, 600, TEAL, '② 插件适配层 lib/index.js', [
            ('c1', 'createIntegration()', ['装配 Brain · 绑定事件 · 注册工具与命令；单一入口'], TEAL),
            ('c2', 'BackgroundLearner（后台学习器）',
             ['单飞：同时最多 1 次模型调用，绝不递归调用 agent',
              '有界队列 16 · 超时 15s · abort 传播 · 去重 4096',
              '关闭或改配置后拒绝再写，旧任务失效'], AMBER),
            ('c3', '工具与命令', ['brain_search / list / read / remember / forget',
                              '/brain status|remember|freeze|rollback…'], TEAL),
            ('c4', 'contextFor / updateContext',
             ['同步读最新快照 → 参考文本', '单节点替换 + tokenMeter 计量事件'], TEAL),
            ('c5', 'Config（23 项 · volatile）', ['学习 / 注入 / 预算 / 模式 / 提取路由，成对校验'], TEAL),
        ]),
        ('core', 1250, 600, VIOLET, '③ 语义核心 lib/core.js', [
            ('d1', 'extraction.js：提取与门禁',
             ['提示词：只接受用户原话中的逐字片段作证据',
              '校验：引用、临时、项目限定、人口学推断 → 拒绝',
              '离线兜底：中英文明确表达的正则规则'], VIOLET),
            ('d2', 'Brain.learn()',
             ['sha256(session, turn) 去重；墓碑阻断已删事实复活',
              '记忆：按 key 或归一化文本合并，容量 500 条',
              '性格：证据 → 共识 → 有界步进（见下图）'], VIOLET),
            ('d3', '检索与分页', ['关键词 + 中文二元组打分，updatedAt 兜底排序',
                             '400 码点预览 · 结果绑定游标 · 工作区隔离'], VIOLET),
            ('d4', 'context() 预算化注入',
             ['核心偏好 ≤3 条 + 检索命中，合计 ≤10 条',
              '字符 6000 / 估算 token 2000 双重上限',
              '风格只注入 5 个 0..1 维度，不注入证据与历史'], VIOLET),
        ]),
        ('state', 1920, 420, ROSE, '④ 状态、预算与出口', [
            ('e1', 'brain.json（schemaVersion 1）',
             ['memories / tombstones / processedTurns',
              'personality{traits, frozen, evidence, version}',
              'history ≤100，全量校验后才写入'], ROSE),
            ('e2', '并发与原子写', ['.brain.lock 目录锁，不抢占超时写者',
                             '临时文件 + fsync + rename 原子替换'], ROSE),
            ('e3', '人格历史与回退', ['每版本记录 reason 与 changes 证据',
                              'freeze / manual / off 三态并存'], ROSE),
            ('e4', 'budget.js', ['保守 token 估算（ASCII/3，CJK×1.5）',
                             'Unicode 安全截断，满足双层预算'], ROSE),
            ('e5', 'llm.stream()', ['提取走宿主 llm 服务，不另读凭据文件',
                                '失败 → 回退本地正则，不阻塞主对话'], AMBER),
            ('e6', '会话 surface', ['单一 brain:long-term-reference 节点',
                                '内容不变不写事件；压缩后自动重建'], ROSE),
        ]),
    ]


def diagram_architecture():
    spec = architecture_spec()
    rect = {}
    for col, x, w, _accent, _title, boxes in spec:
        y = COLUMN_TOP
        for key, title, body, accent in boxes:
            h = box_height(title, body, w)
            rect[key] = (x, y, w, h)
            y += h + COLUMN_GAP
        rect[col + ':bottom'] = y - COLUMN_GAP

    band_top = max(rect[k + ':bottom'] for k in ('host', 'plugin', 'core', 'state')) + 42
    W = 2400
    H = band_top + 42 + 116 + 46

    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((60, 34), 'dsh-brain v0.3.1 架构总览：长期记忆 + 交流风格自进化',
           font=font(42, True), fill=INK)
    d.text((62, 92), '宿主事件驱动 · 单轮至多一次模型提取 · 本地单一 JSON 状态 · 字符与 token 双预算注入',
           font=font(20), fill=MUTED)
    legend(d, 1680, 108)

    for _, x, w, accent, title, _ in spec:
        header(d, x, 150, w, title, accent)

    for _, _, _, _, _, boxes in spec:
        for key, title, body, accent in boxes:
            x, y, w, h = rect[key]
            draw_box(d, x, y, w, h, title, body, accent)

    def edge(key, side='l', frac=0.5):
        x, y, w, h = rect[key]
        return {'l': (x, y + h * frac), 'r': (x + w, y + h * frac),
                't': (x + w * frac, y), 'b': (x + w * frac, y + h)}[side]

    def crosses(p, q, box, shrink=3):
        x, y, w, h = box
        x0, y0, x1, y1 = x + shrink, y + shrink, x + w - shrink, y + h - shrink
        if abs(p[0] - q[0]) < 0.5:  # vertical
            if not (x0 < p[0] < x1):
                return False
            lo, hi = sorted((p[1], q[1]))
            return hi > y0 and lo < y1
        lo, hi = sorted((p[0], q[0]))
        if not (lo < x1 and hi > x0):
            return False
        return y0 < p[1] < y1

    def audit(pts, name):
        for key, box in rect.items():
            if key.endswith(':bottom'):
                continue
            for p, q in zip(pts, pts[1:]):
                if crosses(p, q, box):
                    WARN.append('route "%s" crosses box %s' % (name, key))

    def elbow(a, b, gx, color, dashed=False, width=3):
        pts = [a, (gx, a[1]), (gx, b[1]), b]
        audit(pts, '%s->%s' % (a, b))
        route(d, pts, color, width, dashed)

    elbow(edge('b1', 'r'), edge('c2', 'l', 0.45), 525, AMBER, True)
    pill(d, (534, (edge('b1', 'r')[1] + edge('c2', 'l', 0.45)[1]) / 2 - 10), 'turn/end 入队', AMBER)

    elbow(edge('c4', 'l', 0.5), edge('b2', 'r', 0.55), 525, TEAL)
    pill(d, (534, edge('c4', 'l', 0.5)[1] - 28), '参考消息', TEAL)

    elbow(edge('c2', 'r', 0.5), edge('d1', 'l', 0.7), 1205, BLUE)
    pill(d, (1214, edge('c2', 'r', 0.5)[1] - 28), '每轮 ≤1 次', BLUE)

    route(d, [edge('d1', 'b', 0.3), edge('d2', 't', 0.3)], BLUE, 3)

    elbow(edge('c3', 'r', 0.5), edge('d2', 'l', 0.75), 1205, BLUE)
    pill(d, (1214, edge('c3', 'r', 0.5)[1] + 26), '工具调用', BLUE)

    elbow(edge('d2', 'r', 0.6), edge('e1', 'l', 0.75), 1890, BLUE)
    pill(d, (1899, (edge('d2', 'r', 0.6)[1] + edge('e1', 'l', 0.75)[1]) / 2 - 10), '写入', BLUE)

    elbow(edge('e1', 'l', 0.25), edge('d4', 'r', 0.55), 1882, ROSE, True)
    pill(d, (1891, edge('d4', 'r', 0.55)[1] - 30), '读最新快照', ROSE)

    elbow(edge('d4', 'l', 0.6), edge('c4', 'r', 0.5), 1180, TEAL)
    pill(d, (1189, edge('d4', 'l', 0.6)[1] + 30), '参考文本', TEAL)

    d.text((60, band_top), '当前实现的可靠性缺口（对照外部实现见报告 §4）', font=font(19, True), fill=INK)
    chips = [
        (AMBER, '缺口 1 · 学习队列只在内存', '桌面重启即丢；无重试、租约与水位'),
        (AMBER, '缺口 2 · 没有整合阶段', '只逐轮追加，接近上限后无法合并与淘汰'),
        (AMBER, '缺口 3 · 没有使用反馈', '排序只有关键词与时间，缺使用计数与衰减'),
        (ROSE, '缺口 4 · 风格每轮可变', '改变注入前缀，影响 prompt 缓存与稳定性'),
    ]
    cw, cgap = 545, 20
    for i, (color, head, text) in enumerate(chips):
        draw_chip(d, 60 + i * (cw + cgap), band_top + 34, cw, head, text, color)

    out = os.path.join(HERE, 'brain-architecture.png')
    img.save(out, optimize=True)
    return out


# --------------------------------------------------------------------------
# Diagram 2: personality evolution loop
# --------------------------------------------------------------------------
def diagram_loop():
    W = 2400
    stages = [
        (BLUE, '① 本轮用户原话', ['仅根 agent、仅 turn 完成', '截断 8000 字符', '到达时快照控制代数']),
        (AMBER, '② 模型提取反馈', ['{trait, value 0..1, evidence}', '与本地正则结果合并', '每 trait 至多 1 条']),
        (VIOLET, '③ 证据门禁', ['逐字子串，排除引用/假设', '必须是明确风格请求', '项目限定 → 不训练全局']),
        (TEAL, '④ 证据窗口', ['每 trait 存 ≤20 条', '判定只看最近 5 条', '按 turn 哈希去重']),
        (ROSE, '⑤ 共识判定', ['≥3 个轮次且 ≥75% 同向', '最新一条必须同向', '|反馈−当前| ≤0.05 不更新']),
        ('#1D4ED8', '⑥ 步进与落库', ['目标 = 支持值中位数', '单轮步长 ≤0.05', 'version++ 并写 history']),
    ]
    sw, sgap = 330, 40
    sy = 156
    sh = max(box_height(t, b, sw, 20, 16) for _, t, b in stages)

    bypass = [
        (SLATE, 'freeze 冻结', '清空证据并停止学习；解除后从当前值继续，不补算冻结期'),
        (SLATE, 'manual 模式', '只替换注入值，不改写已学习状态；回到 adaptive 即恢复'),
        (SLATE, 'off 模式', '既不注入也不学习，状态原样保留'),
        (SLATE, '控制代数', '人工操作 +1；旧的在途提取因代数不匹配被丢弃'),
    ]
    bw, bgap = 545, 20
    by = sy + sh + 132

    notes = [
        '稳健性优先于响应速度：宁可三轮后才变化，也不要一句话就改写人格。',
        '可解释优先于拟合：每条驱动变更的证据都能回溯到用户原话，并可回退到任一版本。',
        '风格与事实分离：风格反馈不进入普通记忆检索，项目内的风格要求不污染全局人格。',
        '边界诚实：traits 只是「行为倾向的数值代理」，不代表情绪、意识或模型能力。',
    ]
    note_h = 52 + sum(24 * len(wrap(n, font(16), 2180)) + 6 for n in notes) + 20
    ny = by + 132

    H = ny + note_h + 46
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((60, 34), '交流风格自进化闭环：五个 0..1 维度，单轮最多移动 0.05', font=font(40, True), fill=INK)
    d.text((62, 92), '全部规则都在 lib/core.js 的 learn() 与 lib/extraction.js 的 validateExtraction() 内实现',
           font=font(20), fill=MUTED)

    for i, (color, title, body) in enumerate(stages):
        x = 60 + i * (sw + sgap)
        draw_box(d, x, sy, sw, sh, title, body, color, title_size=20, body_size=16)
        if i:
            px = x - sgap
            route(d, [(px + 2, sy + sh / 2), (px + sgap - 2, sy + sh / 2)], GRAY, 3, head=8)

    fx = 60 + 5 * (sw + sgap) + sw / 2
    loop_y = sy + sh + 56
    route(d, [(fx, sy + sh), (fx, loop_y), (60 + sw / 2, loop_y), (60 + sw / 2, sy + sh)],
          '#1D4ED8', 3, True)
    label(d, (60 + sw / 2 + 24, loop_y + 10),
          '下一轮以新的 0..1 维度注入参考消息（同一路径，无限循环）', '#1D4ED8', 16)

    d.text((60, by - 34), '旁路控制：人工干预永远优先于学习，且不进入证据窗口', font=font(19, True), fill=INK)
    for i, (color, head, text) in enumerate(bypass):
        draw_chip(d, 60 + i * (bw + bgap), by, bw, head, text, color)

    d.rounded_rectangle([60, ny, W - 60, ny + note_h], radius=16, fill='#FFFFFF',
                        outline=BORDER, width=2)
    d.rounded_rectangle([60, ny, 69, ny + note_h], radius=4, fill=VIOLET)
    d.rectangle([65, ny + 10, 69, ny + note_h - 10], fill=VIOLET)
    d.text((92, ny + 18), '设计取舍（不是文献证明的最优参数）', font=font(19, True), fill=INK)
    ty = ny + 54
    for note in notes:
        d.text((96, ty), '·', font=font(17), fill=VIOLET)
        for line in wrap(note, font(16), 2180):
            d.text((116, ty), line, font=font(16), fill=BODY)
            ty += 24
        ty += 6

    out = os.path.join(HERE, 'brain-personality-loop.png')
    img.save(out, optimize=True)
    return out


if __name__ == '__main__':
    print(diagram_architecture())
    print(diagram_loop())
    for warning in WARN:
        print('WARN:', warning)
    print('warnings:', len(WARN))
