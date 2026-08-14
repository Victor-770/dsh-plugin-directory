from PIL import Image
from collections import Counter
import os
base = r'D:/1codeprojects/nextjs/deepseek harness/dsh-plugin-directory/.scratch/shots'
for name in ['live-home.png', 'live-search.png', 'live-mobile.png']:
    im = Image.open(os.path.join(base, name)).convert('RGB')
    w, h = im.size
    small = im.resize((max(1, w//4), max(1, h//4)))
    px = list(small.getdata())
    top = Counter(px).most_common(2)
    lum = [0.299*r+0.587*g+0.114*b for r, g, b in px]
    avg = sum(lum)/len(lum)
    print(f"{name}: {w}x{h} avg_lum={avg:.1f} top={[(c, n) for c, n in top]}")
# home vs search 差异（搜索态应变化）
h1 = Image.open(os.path.join(base, 'live-home.png')).convert('RGB')
s1 = Image.open(os.path.join(base, 'live-search.png')).convert('RGB')
diff = sum(1 for a, b in zip(h1.getdata(), s1.getdata()) if abs(a[0]-b[0])>15 or abs(a[1]-b[1])>15 or abs(a[2]-b[2])>15)
print('home_vs_search changed: %.1f%%' % (100*diff/(h1.size[0]*h1.size[1])))