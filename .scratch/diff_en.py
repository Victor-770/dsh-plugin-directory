from PIL import Image
import os
base = r'D:/1codeprojects/nextjs/deepseek harness/dsh-plugin-directory/.scratch/shots'
zh = Image.open(os.path.join(base,'desktop.png')).convert('RGB')
en = Image.open(os.path.join(base,'en.png')).convert('RGB')
w, h = zh.size
diff = sum(1 for a, b in zip(zh.getdata(), en.getdata()) if abs(a[0]-b[0])>15 or abs(a[1]-b[1])>15 or abs(a[2]-b[2])>15)
print('en_vs_zh changed: %.1f%%' % (100*diff/(w*h)))
print('en size:', en.size, 'exists:', os.path.exists(os.path.join(base,'en.png')))