#!/usr/bin/env python3
"""
生成一张 Markdown 控制面板：每个档位是一个可点击链接。

点链接 = 你的浏览器发出请求，AI 一个字节都没发。
这就是"不用 MCP 也能让 AI 控设备"的全部原理。

用法：
    python3 scripts/make_panel.py                    # 自动生成随机频道名
    python3 scripts/make_panel.py mybridge-x7k2m9p4  # 指定频道名
    python3 scripts/make_panel.py --self-host https://ntfy.example.com mybridge-x7k2
"""
import sys
import random
import string
import urllib.parse

BUS_DEFAULT = "https://ntfy.sh"


def gen_topic():
    alphabet = string.ascii_lowercase + string.digits
    return "mybridge-" + "".join(random.choices(alphabet, k=12))


def link(bus, topic, label, message):
    q = urllib.parse.urlencode({"message": message})
    return f"[{label}]({bus}/{urllib.parse.quote(topic)}/trigger?{q})"


def main():
    args = sys.argv[1:]
    bus = BUS_DEFAULT
    if "--self-host" in args:
        i = args.index("--self-host")
        bus = args[i + 1].rstrip("/")
        del args[i:i + 2]

    topic = args[0] if args else gen_topic()

    levels = [15, 25, 35, 45, 55, 65, 80]
    patterns = [
        ("缓", "pattern:15,25,15:1.2:6"),
        ("中", "pattern:20,40,25,45:0.9:5"),
        ("猛", "pattern:35,55,40,65:0.6:6"),
    ]

    out = []
    out.append(f"## 控制面板")
    out.append("")
    out.append(f"频道 `{topic}`　总线 `{bus}`")
    out.append("")
    out.append("**档位**")
    out.append("")
    row = [link(bus, topic, "停", "stop")]
    row += [link(bus, topic, str(v), f"level:{v}") for v in levels]
    out.append(" · ".join(row))
    out.append("")
    out.append("**定时**（到时自动停）")
    out.append("")
    timed = [link(bus, topic, f"{v}／{sec}秒", f"level:{v}:{sec}")
             for v, sec in [(35, 30), (50, 20), (65, 10)]]
    out.append(" · ".join(timed))
    out.append("")
    out.append("**节奏**")
    out.append("")
    out.append(" · ".join(link(bus, topic, n, m) for n, m in patterns))
    out.append("")
    out.append("---")
    out.append("")
    out.append(f"手机页面填这个频道名：`{topic}`")
    out.append("")
    out.append("> 频道名就是唯一凭证，别截图发出去。")

    print("\n".join(out))


if __name__ == "__main__":
    main()
