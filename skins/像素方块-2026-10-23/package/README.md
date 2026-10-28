# 像素·方块 · 皮肤包示例

格式见 `../../FORMAT.zh-CN.md`。这个包演示图片素材和自带字体：

- `assets/panel.png`（8×8）：带黑色外框、四角缺格的凸起面板；`assets/raised.png`（6×6）：没有外框的凸起面；`assets/slot.png`（6×6）：凹进去的格子。
  素材 1 像素 = 2 点 = 网格 1 格，按九宫格拉伸，保持锐利。
- 选中框、悬停框用描边画，不画进图片，所以工坊里改颜色立即生效。
- 说明框（快捷键提示、提示浮窗）用填充 + 外框 + 上下渐变的内边，三层画出。
- 字体：`fonts/FusionPixel-12px-Proportional-zh_hans.otf`，固定 12 点；授权见 `LICENSE-*.txt`（SIL OFL 1.1）。
- 动效：和内置像素皮肤一样，状态切换直接跳格，没有过渡。
- 工坊可调：选中框、悬停框颜色。

按本包画出的样子：

![皮肤包渲染](../previews/package-render.png)

打包：在本目录执行 `zip -r ../像素方块.untangleskin . -x '.*'`。
