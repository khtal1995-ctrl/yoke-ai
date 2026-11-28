import numpy as np, os, math, random, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
W,H,FPS=1280,720,30; F=os.path.expanduser('~/.fonts/'); random.seed(7); np.random.seed(7)
def mm(sz,w='Black'):
    f=ImageFont.truetype(F+'NotoSansMyanmar[wdth,wght].ttf',sz); f.set_variation_by_name(w); return f
def serif(sz,w='Black'):
    f=ImageFont.truetype(F+'PlayfairDisplay[wght].ttf',sz); f.set_variation_by_name(w); return f
bebas=lambda sz: ImageFont.truetype(F+'BebasNeue-Regular.ttf',sz)
def ease(t): t=min(max(t,0),1); return t*t*(3-2*t)
def eout(t): t=min(max(t,0),1); return 1-(1-t)**3
yy,xx=np.mgrid[0:H,0:W]
vig=np.clip(((xx-W/2)/(W*0.6))**2+((yy-H/2)/(H*0.6))**2,0,1)[...,None]
def A(img): return np.asarray(img).astype(np.float32)
def I(a): return Image.fromarray(np.clip(a,0,255).astype(np.uint8))
def teal_orange(img,amt):
    a=A(img); l=(a@[0.299,0.587,0.114])[...,None]/255
    sh=np.array([10,45,60]); hi=np.array([255,190,120])
    toned=(1-l)*sh+l*hi; toned=toned*0.55+a*0.45
    out=a*(1-amt)+toned*amt; out=out*(1+0.25*amt)-18*amt
    return I(out*(1-0.7*vig*amt))
def zoom(img,z,cx=.5,cy=.45,dx=0,dy=0):
    w,h=W/z,H/z; x=cx*W-w/2+dx; y=cy*H-h/2+dy; x=min(max(x,0),W-w); y=min(max(y,0),H-h)
    return img.crop((x,y,x+w,y+h)).resize((W,H),Image.BICUBIC)
def rgbsplit(img,s):
    r,g,b=img.split(); r=ImageChops.offset(r,int(s),0); b=ImageChops.offset(b,-int(s),0); return Image.merge('RGB',(r,g,b))
def bars(img,frac):
    if frac<=0: return img
    d=ImageDraw.Draw(img); h=int(H*0.125*frac); d.rectangle((0,0,W,h),fill=(0,0,0)); d.rectangle((0,H-h,W,H),fill=(0,0,0)); return img
P=[(random.random()*W,random.random()*H,random.random()*2+0.6,random.random()*0.4+0.1) for _ in range(90)]
def dust(img,t,alpha=1):
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    for x,y,r,sp in P:
        yy_=(y-t*sp*60)%H; xx_=(x+math.sin(t*0.7+y)*12)%W
        d.ellipse((xx_-r,yy_-r,xx_+r,yy_+r),fill=(255,220,180,int(120*alpha)))
    return Image.alpha_composite(img.convert('RGBA'),lay.filter(ImageFilter.GaussianBlur(1))).convert('RGB')
def leak(img,t,alpha):
    a=A(img); cx=W*(-0.3+1.6*t); g=np.exp(-((xx-cx)/(W*0.18))**2)[...,None]*np.array([255,140,60])*0.55*alpha
    return I(a+g)
def text_layer(items):
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    for (txt,font,xy,fill,anchor,shadow) in items:
        if shadow:
            sh=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sh).text(xy,txt,font=font,fill=(0,0,0,int(fill[3]*0.8)),anchor=anchor)
            lay=Image.alpha_composite(lay,sh.filter(ImageFilter.GaussianBlur(10))); d=ImageDraw.Draw(lay)
        d.text(xy,txt,font=font,fill=fill,anchor=anchor)
    return lay
def punch(txt,font,cx,cy,t,fill):  # scale-in punch
    s=1.6-0.6*eout(t/0.25); a=min(1,t/0.12)
    tmp=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(tmp).text((W//2,H//2),txt,font=font,fill=fill,anchor='mm')
    bb=tmp.getbbox(); 
    if not bb: return None
    g=tmp.crop(bb); g=g.resize((max(1,int(g.width*s)),max(1,int(g.height*s))),Image.BICUBIC)
    if s>1.05: g=g.filter(ImageFilter.GaussianBlur((s-1)*6))
    al=g.split()[3].point(lambda v:int(v*a)); g.putalpha(al)
    out=Image.new('RGBA',(W,H),(0,0,0,0)); out.paste(g,(int(cx-g.width/2),int(cy-g.height/2)),g); return out
live=[Image.open(f'/tmp/ep/live2/{i:03d}.png').convert('RGB') for i in range(1,79)]
fr=Image.open('/tmp/ep/fr2.png').convert('RGB'); kk=Image.open('/tmp/ep/kk.png').convert('RGB')
OUT='/tmp/ep/v2/g'; shutil.rmtree(OUT,ignore_errors=True); os.makedirs(OUT)
T=10.6; N=int(T*FPS)
GOLD=(255,214,150,255); WHITE=(245,245,245,255)
for k in range(N):
    t=k/FPS
    if t<2.6:   # last scene, cinema bars slide in, grade creeps
        img=live[min(k,77)]; img=teal_orange(img,0.35*ease(t/2.6)); img=bars(img,ease((t-1.2)/1.2))
    elif t<5.3: # FREEZE + punchline
        lt=t-2.6
        sh=(np.random.randn()*14*max(0,1-lt/0.35), np.random.randn()*10*max(0,1-lt/0.35))
        img=zoom(fr,1.04+0.10*ease(lt/2.7),0.66,0.40,sh[0],sh[1]); img=teal_orange(img,0.85)
        if lt<0.25: img=rgbsplit(img,22*(1-lt/0.25))
        img=dust(img,t,ease(lt/0.6)); img=leak(img,lt/2.7,0.5*ease(lt/0.5))
        a=A(img); ramp=np.clip((0.55-xx/W)/0.5,0,1)[...,None]*0.7*ease(lt/0.4); img=I(a*(1-ramp))
        img=bars(img,1)
        if lt<0.1: img=I(A(img)*(1-lt/0.1)+255*(1-lt/0.1)*0.9+A(img)*0)
        lay=Image.new('RGBA',(W,H),(0,0,0,0))
        if lt>0.25:
            p=punch('ကယ်တင်ရှင်လား…',mm(64,'Black'),370,300,lt-0.25,WHITE)
            if p: lay=Image.alpha_composite(lay,p)
        if lt>1.0:
            p=punch('မာရ်နတ်လား?',mm(92,'Black'),360,410,lt-1.0,GOLD)
            if p: lay=Image.alpha_composite(lay,p)
        if lt>1.7:
            aa=int(255*ease((lt-1.7)/0.4)); ImageDraw.Draw(lay).text((362,505),'THE OLD MAN',font=bebas(30),fill=(220,220,220,aa),anchor='mm')
        if lt>2.3: lay.putalpha(lay.split()[3].point(lambda v:int(v*(1-ease((lt-2.3)/0.4)))))
        img=Image.alpha_composite(img.convert('RGBA'),lay).convert('RGB')
        if lt>2.45:  # whip streak to black
            q=ease((lt-2.45)/0.25); img=img.filter(ImageFilter.BoxBlur(int(1+q*25))); img=I(A(img)*(1-q))
    elif t<8.2: # TEASER: flash cuts, accelerating heartbeat
        lt=t-5.3
        cuts=[0.0,0.55,1.0,1.35,1.62,1.85,2.05,2.22,2.36,2.48,2.58]
        idx=max(i for i,c in enumerate(cuts) if lt>=c)
        if idx%2==0: src=zoom(fr,2.3,0.69,0.33)   # old man's eyes
        else: src=zoom(kk,1.9,0.21,0.30)          # Kaung Khant looking up
        cl=lt-cuts[idx]; img=teal_orange(src,0.9); img=I(A(img)*(0.55+0.45*min(1,cl/0.06)))
        if cl<0.05: img=rgbsplit(img,10)
        img=bars(img,1); img=dust(img,t,0.6)
        lay=Image.new('RGBA',(W,H),(0,0,0,0))
        if lt>0.3:
            aa=int(255*ease((lt-0.3)/0.3)*(1-ease((lt-2.55)/0.3)))
            lay=text_layer([('သူ တောင်းမယ့် အဖိုးအခက…',mm(46,'ExtraBold'),(W//2,H-150),(255,255,255,aa),'mm',True)])
        img=Image.alpha_composite(img.convert('RGBA'),lay).convert('RGB')
        if lt>2.62: img=Image.new('RGB',(W,H),(0,0,0))
    else:       # TITLE CARD
        lt=t-8.2
        img=Image.new('RGB',(W,H),(4,4,6)); img=dust(img,t,0.35)
        lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
        a=int(255*ease(lt/0.35))
        p=punch('EPISODE 04',bebas(150),W//2,370,lt,GOLD)
        if p: lay=Image.alpha_composite(lay,p)
        # light sweep across title
        sx=-300+ (W+600)*ease((lt-0.5)/1.0)
        sw=Image.new('L',(W,H),0); ImageDraw.Draw(sw).polygon([(sx,280),(sx+70,280),(sx-10,460),(sx-80,460)],fill=200); sw=sw.filter(ImageFilter.GaussianBlur(14))
        hl=Image.new('RGBA',(W,H),(255,255,255,0)); hl.putalpha(ImageChops.multiply(sw,lay.split()[3]))
        lay=Image.alpha_composite(lay,hl); d=ImageDraw.Draw(lay)
        if lt>0.9:
            aa=int(255*ease((lt-0.9)/0.4)); d.line((W//2-150,455,W//2+150,455),fill=(255,214,150,aa),width=2)
            d.text((W//2,490),'မကြာခင် ဆက်လက် ကြည့်ရှုပါ',font=mm(26,'SemiBold'),fill=(230,230,235,aa),anchor='mm')
        img=Image.alpha_composite(img.convert('RGBA'),lay).convert('RGB')
        if t>T-0.4: img=I(A(img)*(1-ease((t-(T-0.4))/0.4)))
    img.save(f'{OUT}/{k:04d}.png')
print(N)
