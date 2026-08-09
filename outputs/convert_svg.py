#!/usr/bin/env python3
import subprocess, os, sys

svg_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
out_dir = sys.argv[2] if len(sys.argv) > 2 else svg_dir

os.makedirs(out_dir, exist_ok=True)

for f in os.listdir(svg_dir):
    if not f.endswith('.svg'): continue
    inp = os.path.join(svg_dir, f)
    out = os.path.join(out_dir, f.replace('.svg', '.png'))
    print(f'{f} → {out}')
    subprocess.run([
        'qlmanage', '-t', '-s', '1200', '-o', out_dir, inp
    ], check=True, capture_output=True)
    # qlmanage outputs .png with filename suffix, rename
    tmp = os.path.join(out_dir, f + '.png')
    if os.path.exists(tmp):
        os.rename(tmp, out)

print('done')