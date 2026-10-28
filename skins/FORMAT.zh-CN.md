# Untangle 皮肤包格式 · 第 1 版（草案）

日期：2026-10-23。状态：草案，待确认后实现引擎。

## 1. 目标与边界

- 任何人都能做一个皮肤包交给别人；对方**不用更新 App** 就能安装使用。
- 皮肤包**只含数据**：描述文件、图片、字体、效果图。App 内置一个通用的皮肤引擎，按描述去画。
- 不允许任何可执行内容：没有脚本、没有着色器程序、没有网页或 SVG。超出引擎“词汇”的效果需要更新 App，所以词汇要足够丰富。
- 皮肤**只管画成什么样**，不改变任何面板或标签的尺寸、位置和可点击区域；尺寸类设置在各模块面板里调。
  唯一例外是平行四边形外形：面板按倾角自动加宽、内容跟随倾斜，这一行为由引擎负责。
- 内置的“玻璃”“极简”“赛博朋克”继续由 App 代码绘制；其他皮肤一律是皮肤包（四套像素皮肤 2026-10-23 已从 App 删除）。

## 2. 包结构

`.untangleskin` 是一个 zip 文件（只认不压缩和 Deflate 两种方式，不能加密），解开后是下面的结构。用访达“压缩”整个文件夹也可以：最外层多出的一层文件夹会自动去掉，`__MACOSX/` 和 `.DS_Store` 会被忽略。

```
skin.json          必需。描述文件，UTF-8 JSON
assets/            可选。PNG 或 PDF 图片
fonts/             可选。OTF、TTF 字体
previews/card.png  必需。预览卡片，工坊顶部的皮肤卡片用它；PNG，建议 640 × 400 像素（16:10）
previews/          可选。其他 PNG 效果图
README.md          可选。说明
LICENSE*.txt       可选。素材和字体的授权；带第三方素材时应当附上
```

**限制**（任何一项不满足，整个包拒绝安装，并说明原因）：

| 项 | 限制 |
|---|---|
| 包大小 | 解压后合计不超过 20 MB，单个文件不超过 10 MB，文件不超过 200 个 |
| 文件类型 | 只认上表这几类扩展名；其他文件、隐藏文件、符号链接一律拒绝 |
| 路径 | 只能是包内相对路径，不能含 `..`，不能是绝对路径 |
| 图片 | 每边不超过 4096 像素 |
| `skin.json` | 不超过 256 KB；未知字段忽略，未知图层类型跳过并在工坊提示 |

安装后存放在 `~/.untangler/skins/<id>/`。字体只为 Untangle 这个进程注册，不装进系统。

## 3. skin.json 顶层

| 字段 | 必需 | 说明 |
|---|---|---|
| `format` | 是 | 固定为 `"untangle-skin"` |
| `formatVersion` | 是 | 本文为 `1` |
| `id` | 是 | 反向域名式唯一标识，如 `"io.untangle.cyberpunk"`；同 id 再次安装视为更新 |
| `version` | 是 | 皮肤自己的版本号，如 `"1.0.0"` |
| `name` | 是 | 名称，按语言给出：`{"zh-Hans": "赛博朋克", "en": "Cyberpunk"}` |
| `author`、`license`、`description` | 否 | 作者、授权说明、简介（简介同样按语言给出） |
| `appearance` | 是 | `"dark"` 或 `"light"`：面板里系统控件（输入框光标、滚动条等）按哪种外观画 |
| `tokens` | 否 | 变量，见第 4 节 |
| `editable` | 否 | 工坊里允许用户调整的变量，见第 9 节 |
| `roles` | 是 | 各元素各状态怎么画，见第 5–7 节 |
| `text` | 否 | 文字样式，见第 8 节 |
| `motion` | 否 | 动效，见第 10 节 |

## 4. 变量与引用

```json
"tokens": {
  "color":  { "accent": "#00f0ff", "deckTop": "#1a0f2e" },
  "number": { "cut": 10, "cell": 2 },
  "font":   { "pixel": { "file": "fonts/FusionPixel.otf", "size": 12 },
              "ui":    { "system": true, "size": 13, "weight": "medium" } },
  "image":  { "slot": "assets/slot.png" }
}
```

- 任何值的位置都可以写 `"$分组.名字"` 引用变量，例如 `"$color.accent"`、`"$number.cut"`。
- 颜色写 `#rrggbb` 或 `#rrggbbaa`；也可写 `{"color": "$color.accent", "alpha": 0.32}` 调透明度。
- 字体：`file` 指向包内字体并给出固定字号（像素字体应使用其设计字号），所有用到它的文字都用这个字号；或写 `"system": true` 用系统字体，字号和字重由模块决定，皮肤只能改 `design`（default、rounded、monospaced），并可用 `weight`（regular、medium、semibold、bold）统一改字重。

## 5. 元素与状态

`roles` 的键是元素名，值是该元素的默认画法；元素下的 `states` 再为各状态追加或覆盖图层。

| 元素 | 是什么 | 状态 |
|---|---|---|
| `panel` | 所有浮层面板的外壳 | — |
| `panel.switcher`、`panel.dockPreview`、`panel.palette`、`panel.hints`、`panel.toast` | 某个模块的面板：继承 `panel`，可写 `shape`、`add`、`replace` | — |
| `tabBar` | 标签栏 | — |
| `tab` | 一个标签 | `rest`、`hover`、`active`、`incoming` |
| `card` | 切换器和 Dock 预览里的窗口卡片 | `rest`、`hover`、`selected` |
| `well` | 卡片里放缩略图的区域 | — |
| `field` | 搜索面板顶部的输入区 | — |
| `row` | 搜索结果行 | `rest`、`selected` |
| `chip` | 键帽 | — |
| `control` | 卡片上的关闭、最小化按钮 | `rest`、`hover` |
| `dropTarget` | 拖动标签时标签栏外的提示环 | — |

```json
"card": {
  "shape": { "kind": "chamfer", "cut": 8 },
  "layers": [ ... ],
  "states": {
    "hover":    { "add":  [ ... ] },
    "selected": { "replace": [ ... ], "transition": "select" }
  }
}
```

`add` 叠在默认图层之上，`replace` 整体替换默认图层。`transition` 引用第 10 节里的过渡。

增强对比度：任何元素都可以再写一个 `"contrast": { ... }`，结构同状态，在系统开启“增强对比度”时使用。没有写时，引擎会自动把描边加粗、去掉纹理和模糊。

快捷键提示在命令执行后会停留一会儿并变淡。默认只淡化文字和键帽；`panel.hints`（或 `panel`）里写 `"dimmed": "panel"` 时整个面板连同外框和底一起变淡，像素皮肤就是这样。

## 6. 外形

`shape` 决定元素的轮廓，图层默认裁在轮廓里。

| `kind` | 参数 | 说明 |
|---|---|---|
| `rect` | — | 直角 |
| `rounded` | `radius` | 圆角 |
| `chamfer` | `cut` | 左上、右下切角 |
| `parallelogram` | `angle`（度） | 平行四边形；同一皮肤内所有斜边平行，面板自动加宽、内容跟随倾斜 |
| `notched` | `cell` | 像素直角，四个角各缺一格 |

## 7. 图层

每个图层是一个对象，`type` 决定种类。所有图层共有的属性：

| 属性 | 说明 |
|---|---|
| `inset` | 向内缩进，一个数或 `[上, 右, 下, 左]`；可为负，最多向外 4 点（如缩略图外的一圈格子边） |
| `over` | `true` 画在内容（文字、缩略图）上方；默认在内容下方 |
| `shape` | 这一层自己的外形，默认用元素的外形 |
| `opacity` | 0–1 |
| `blend` | `normal`、`screen`、`multiply`、`plusLighter` |
| `offset` | `[x, y]`，整层平移（如错位描边） |
| `clip` | `true`（默认）裁在元素外形里；`false` 不裁，配合负 `inset` 可画到元素外最多 4 点 |
| `animate` | 引用第 10 节里的动画，见那里 |

图层种类：

| `type` | 参数 | 用途 |
|---|---|---|
| `fill` | `color` | 纯色 |
| `gradient` | `kind`（`linear`、`radial`）、`stops`（`[[位置, 颜色], …]`）、`from`/`to`（单位坐标，如 `[0,0]`→`[1,1]`） | 渐变 |
| `material` | `style`（`ultraThin`、`thin`、`regular`、`glass`） | 系统模糊材质或液态玻璃 |
| `image` | `src`、`mode`（`nineSlice`、`tile`、`stretch`、`center`）、`slice`（九宫格四边像素 `[上, 右, 下, 左]`）、`scale`（素材 1 像素对应几点）、`filter`（`pixel` 保持锐利，`smooth`） | 素材图片；九宫格让边框按尺寸拉伸而四角不变形 |
| `stroke` | `color` 或 `gradient`、`width`、`dash`、`segments`（`all`、`cuts` 只描切角、`leading` 只描左边缘、`top`、`bottom`） | 描边 |
| `bevel` | `light`、`dark`、`width`、`sunken`（`true` 时亮暗互换） | 立体边：左上亮、右下暗 |
| `shadow` | `color`、`radius`、`offset`、`inner`（默认 `true`） | 阴影；外阴影被裁在元素边界内 |
| `glow` | `color`、`width`、`radius` | 沿轮廓向内的发光 |
| `pattern` | `kind`（`scanlines`、`grid`、`dots`、`noise`）、`color`、`spacing`、`size` | 程序纹理 |
| `box` | `anchor`（如 `topLeading`）、`at`（`[x, y]`）、`size`（`[宽, 高]`）、`color`、`shape` | 定位的小色块，如 HUD 标签、角标 |

## 8. 文字样式

```json
"text": {
  "title":     { "font": "$font.pixel", "color": "$color.ink" },
  "secondary": { "font": "$font.pixel", "color": "$color.inkMuted" },
  "key":       { "font": "$font.pixel", "color": "$color.key", "shadow": { "color": "#00000059", "offset": [1, 1] } }
}
```

样式名：`title`（卡片标题、标签名、结果行标题）、`body`（提示内容）、`secondary`（副标题、说明）、`key`（键帽）、`field`（搜索输入）。
各元素和元素的状态里都可以写 `"text": { "title": { "color": … } }` 覆盖，作用于这个元素里的文字。文字区域的大小由模块决定，皮肤不改变排版尺寸。
标签上的关闭按钮 × 用顶层 `title` 的颜色（平时 65%，悬停时不透明并垫一层 12% 的底）；没写这个颜色时用系统文字色。

## 9. 工坊里可调的项

```json
"editable": [
  { "token": "color.accent", "label": { "zh-Hans": "强调色", "en": "Accent" } },
  { "token": "number.glow",  "label": { "zh-Hans": "发光", "en": "Glow" }, "range": [0, 100] }
]
```

工坊只显示列出的项；用户的调整保存在设置里，不改动皮肤包本身。导出时连同调整一起打成新包。

## 10. 动效

```json
"motion": {
  "transitions": {
    "select": { "curve": "spring", "duration": 0.2, "bounce": 0.2, "slide": true },
    "jump":   { "curve": "steps", "steps": 1 }
  },
  "animations": {
    "flash":  { "duration": 0.45, "keyframes": [ { "t": 0, "opacity": 1 }, { "t": 1, "opacity": 0 } ] },
    "scroll": { "duration": 6, "repeat": "forever", "keyframes": [ { "t": 0, "patternOffset": [0, 0] }, { "t": 1, "patternOffset": [0, 3] } ] }
  }
}
```

- **过渡**：状态切换时怎么动。`curve`：`linear`、`ease`、`smooth`、`spring`（可加 `bounce`）、`steps`（`steps` 为步数，1 即直接跳）。`slide: true` 让这个状态的画在内容下方的图层从上一个处于该状态的元素滑过来（如选中底色）；画在内容上方的图层（边框、下划线等）原地淡入淡出。没写过渡的状态（如悬停）沿用这个元素选中状态的曲线和时长，但不滑动。
  标签栏里别的标签让位、拖入提示环出现，跟随 `tab` 的 `active` 过渡：它直接跳（`steps`）时这两处也直接跳，否则按 App 自己的节奏滑动、淡入。
- **动画**：关键帧，`t` 为 0–1 的进度。可动的属性：`opacity`、`offset`、`scale`、`rotation`、`colorMix`（与 `toColor` 混合的比例）、`patternOffset`、`dashPhase`。
  `repeat`：次数或 `"forever"`；`autoreverse`：往返；`curve` 同过渡；`steps: n` 时只取首尾之间等分的 n 个值、直接跳变（像素皮肤用它做跳格闪烁）。
- **触发**：图层里写 `"animate": { "name": "flash", "on": "enter" }`。`on`：`enter`（元素出现、或进入该状态时播一次）、`always`（一直循环）。
- **减少动态效果**：系统开启时，所有过渡改为直接切换；只播一次的动画直接显示最后一帧，循环动画停在第一帧。皮肤不能关闭这条规则。

## 11. 版本与兼容

- 引擎遇到更高的 `formatVersion` 时拒绝安装，并提示需要更新 App。
- 同一版本内新增的字段、图层类型、动画属性，旧引擎忽略并在工坊里提示“部分效果需要更新 App 才能显示”。
- 安装同 `id` 的包视为更新，用户在工坊里的调整保留。

## 12. 安全

- 只解析 JSON、PNG、PDF、OTF、TTF；不执行、不加载任何代码，不访问网络。
- 解压到临时目录逐项校验后才放进皮肤目录；校验失败不留下任何文件。
- 图片解码前检查尺寸；字体只在本进程注册。
- 来自网络的包带有 macOS 的“来自互联网”标记，引擎照常读取，因为其中只有数据。

## 13. 示例包

| 包 | 位置 | 演示了什么 |
|---|---|---|
| 赛博朋克 | `赛博朋克-2026-10-23/package/` | 纯描述，无图片，逐项复刻内置赛博朋克：渐变底、扫描线纹理、错位描边、切角高亮、HUD 色块、选中渐变与左边缘色条、内发光、选中框滑动、悬停原地淡入 |
| 像素·方块 | `像素方块-2026-10-23/package/` | 九宫格像素素材、像素字体、立体边、直接跳格、紫边说明框 |
| 像素·霓虹 | `像素霓虹-2026-10-23/package/` | 霓虹地牢风格（2.0.0 起不再复刻内置版）：圆角霓虹灯管描边、内侧柔光（`glow`）与外圈光晕（负 `inset`）、网格纹理加平铺图片、选中时只播一次的闪烁（`steps`）、白色键帽（只描下边的描边）、`"dimmed": "panel"` |
| 像素·田园 | `像素田园-2026-10-23/package/` | 逐格复刻原内置的像素·田园（2026-10-23 已从 App 删除）：方框描边由元素的缺角外形裁出角格（底下的格子用 `"clip": false` 保持方角）、两格粗的外框和选中框、`bevel` 画成的单色边、浅色外观、`"dimmed": "panel"` |
