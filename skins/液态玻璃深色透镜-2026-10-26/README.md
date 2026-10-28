# 液态玻璃·深色透镜 · 2026-10-26

烟熏深色的液态玻璃，双线亮边；选中处浮起一块发亮的透镜，在卡片、行和标签之间弹着滑过去。

依据：液态玻璃参考板的 03（macOS 27 双线边缘）、02（Spotlight）和 11（选中胶囊与选中透镜）。外壳是原生玻璃加黑 30% 的烟熏色，外侧 0.5 点黑 40% 暗线，内侧 1 点亮边（顶部白 40%、底部白 12%）。

![总览](previews/package-render.png)

![tab-bar](previews/tab-bar.png)
![switcher](previews/switcher.png)
![dock-preview](previews/dock-preview.png)
![palette](previews/palette.png)
![hints](previews/hints.png)
![toasts](previews/toasts.png)

生成：`python3 skins/make-glass-packages.py`；图片：`UNTANGLE_GALLERY_DIR=<画廊> zsh scripts/gallery.sh SkinPackageGallery/glassShots`，再 `python3 skins/make-glass-packages.py --renders <画廊>`。
