from PIL import Image, ImageDraw, ImageFont
import os
W, H = 1200, 630
img = Image.new("RGB", (W, H), (11, 14, 20))
d = ImageDraw.Draw(img)
# 强调色边框 + 顶部渐变条
d.rectangle([0, 0, W, 6], fill=(79, 140, 255))
d.rectangle([48, 48, W - 48, H - 48], outline=(35, 42, 59), width=2)
# 方块 logo
d.rounded_rectangle([72, 72, 152, 152], radius=20, outline=(79, 140, 255), width=6)
d.ellipse([98, 98, 126, 126], fill=(79, 140, 255))
# 字体
def font(size):
    for p in [r"C:/Windows/Fonts/arialbd.ttf", r"C:/Windows/Fonts/segoeuib.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()
f_big = font(64)
f_mid = font(30)
f_small = font(22)
# 标题
d.text((200, 96), "DSH Plugin Directory", font=f_big, fill=(230, 233, 240))
d.text((200, 190), "DeepSeek Harness 插件一站式目录", font=f_mid, fill=(139, 147, 167))
# 特性标签
tags = ["中英互搜", "README 全文搜索", "分类目录", "star 热度"]
x = 200
for t in tags:
    w = d.textlength(t, font=f_small) + 36
    d.rounded_rectangle([x, 260, x + w, 306], radius=23, fill=(18, 22, 31), outline=(35, 42, 59))
    d.text((x + 18, 270), t, font=f_small, fill=(79, 140, 255))
    x += w + 16
# 底部数据
d.text((200, 500), "1000+ 插件 · 每 6 小时自动同步 · github.com/topics/dsh-plugin", font=f_small, fill=(139, 147, 167))
img.save(r"D:/1codeprojects/nextjs/deepseek harness/dsh-plugin-directory/site/public/og.png", "PNG")
print("og.png written", img.size)
