from PIL import Image, ImageDraw
import os
def rounded(im, r):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0,0,im.width-1,im.height-1], r, fill=255)
    out = Image.new('RGBA', im.size, (0,0,0,0)); out.paste(im, (0,0), m); return out
def framed(src, dst, crop_top=0):
    im = Image.open(src).convert('RGB')
    if crop_top: im = im.crop((0, crop_top, im.width, im.height))
    im = im.resize((585, int(im.height*585/im.width)), Image.LANCZOS)
    b = 22; inner = rounded(im, 58)
    shell = Image.new('RGBA', (im.width+2*b, im.height+2*b), (0,0,0,0))
    ImageDraw.Draw(shell).rounded_rectangle([0,0,shell.width-1,shell.height-1], 78, fill=(29,41,57,255))
    shell.alpha_composite(inner, (b,b)); shell.save(dst)
def fit(src, dst, w, crop=None):
    im = Image.open(src).convert('RGB')
    if crop: im = im.crop(crop)
    if im.width > w: im = im.resize((w, int(im.height*w/im.width)), Image.LANCZOS)
    rounded(im, 18 if w > 900 else 14).save(dst)
for lang in ['ru','kk']:
    s = f'/tmp/cap/{lang}'; d = f'/tmp/deckbuild/img/{lang}'; os.makedirs(d, exist_ok=True)
    for n in ['mobile-form','mobile-confirm','mobile-cooling-intro','mobile-cooling-question','mobile-cooling-review','mobile-trusted-offer','mobile-trusted-sent','mobile-trusted-suspicion']:
        framed(f'{s}/{n}.png', f'{d}/{n}.png')
    for n in ['phone-form','phone-confirm','phone-approved','phone-blocked']:
        im = Image.open(f'{s}/{n}.png'); im = im.resize((560, int(im.height*560/im.width)), Image.LANCZOS); im.save(f'{d}/{n}.png')
    fit(f'{s}/soc-after-phone.png', f'{d}/soc-full.png', 1800)
    fit(f'{s}/soc-feed.png', f'{d}/soc-feed.png', 1800)
    fit(f'{s}/soc-graph.png', f'{d}/soc-graph.png', 1800)
    fit(f'{s}/soc-stage-qr.png', f'{d}/soc-qr.png', 1800)
    a = Image.open(f'{s}/soc-analysis.png'); fit(f'{s}/soc-analysis.png', f'{d}/soc-analysis.png', 900, (0, 0, a.width, min(a.height, 1220)))
    for st in ['offer','sent','suspicion']: fit(f'{s}/card-trusted-{st}.png', f'{d}/card-trusted-{st}.png', 1074)
    c = Image.open(f'{s}/soc-case.png'); fit(f'{s}/soc-case.png', f'{d}/soc-case.png', 900)
print('ok')
