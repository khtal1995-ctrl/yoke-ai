import numpy as np, os, math, random, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
W,H,FPS=1280,720,30; F=os.path.expanduser('~/.fonts/'); random.seed(11); np.random.seed(11)
LM='/usr/share/texmf/fonts/opentype/public/lm/'
def mm(sz,w='Bold'):
    f=ImageFont.truetype(F+'NotoSansMyanmar[wdth,wght].ttf',sz); f.set_variation_by_name(w); return f
mono=lambda sz: ImageFont.truetype(LM+'lmmonolt10-bold.otf',sz)
def ease(t): t=min(max(t,0),1); return t*t*(3-2*t)
def eout(t): t=min(max(t,0),1); return 1-(1-t)**3
def eback(t):
    t=min(max(t,0),1); c=1.7; return 1+(c+1)*(t-1)**3+c*(t-1)**2
yy,xx=np.mgrid[0:H,0:W]
A=lambda im: np.asarray(im).astype(np.float32)
I=lambda a: Image.fromarray(np.clip(a,0,255).astype(np.uint8))
# desk: dark warm paper with grain + vignette
n=np.random.rand(H//4,W//4); n=np.asarray(Image.fromarray((n*255).astype(np.uint8)).resize((W,H),Image.BICUBIC)).astype(np.float32)/255
grain=np.random.rand(H,W)*0.08
v=np.clip(((xx-W/2)/(W*0.65))**2+((yy-H/2)/(H*0.65))**2,0,1)
base=(0.55+0.25*n+grain)*(1-0.75*v)
DESK=I(np.stack([base*58,base*44,base*34],2))
def mono_grade(im,amt=1):
    g=ImageEnhance.Color(im).enhance(1-0.85*amt); a=A(g); a=a*np.array([1.05,1.0,0.9])*(1-0.1*amt)+np.array([10,6,0])*amt; return I(a)
fr=Image.open('/tmp/ep/fr2.png').convert('RGB'); kk=Image.open('/tmp/ep/kk.png').convert('RGB')
def photo(src,crop,w,border=18,bottom=60):
    im=src.crop(crop).resize((w,int(w*(crop[3]-crop[1])/(crop[2]-crop[0]))),Image.LANCZOS)
    im=mono_grade(im)
    card=Image.new('RGBA',(im.width+2*border,im.height+border+bottom),(236,230,218,255)); card.paste(im,(border,border)); return card
OM=photo(fr,(560,40,1180,640),440)        # old man photo
KK=photo(kk,(380,20,740,380),250)          # Kaung Khant photo
def place(canvas,card,cx,cy,rot,scale=1,shadow=True,alpha=1):
    c=card.resize((max(1,int(card.width*scale)),max(1,int(card.height*scale))),Image.BICUBIC).rotate(rot,expand=True,resample=Image.BICUBIC)
    if alpha<1: c.putalpha(c.split()[3].point(lambda v:int(v*alpha)))
    x,y=int(cx-c.width/2),int(cy-c.height/2)
    if shadow:
        s=Image.new('RGBA',c.size,(0,0,0,0)); s.putalpha(c.split()[3].point(lambda v:int(v*0.6))); s=s.filter(ImageFilter.GaussianBlur(14))
        canvas.alpha_composite(s,(x+12,y+16))
    canvas.alpha_composite(c,(x,y)); return (x,y,c.size)
def rot_pt(px,py,cx,cy,deg):
    r=math.radians(-deg); dx,dy=px-cx,py-cy; return (cx+dx*math.cos(r)-dy*math.sin(r), cy+dx*math.sin(r)+dy*math.cos(r))
def typed(s,t,t0,cps=14): return s[:max(0,min(len(s),int((t-t0)*cps)))]
def stamp(txt,font,ang,col=(196,30,36)):
    tmp=Image.new('RGBA',(700,220),(0,0,0,0)); d=ImageDraw.Draw(tmp)
    bb=d.textbbox((0,0),txt,font=font); w,h=bb[2]-bb[0],bb[3]-bb[1]
    d.rounded_rectangle((20,20,w+70,h+70),18,outline=col+(255,),width=7); d.text((45-bb[0],45-bb[1]),txt,font=font,fill=col+(255,))
    tmp=tmp.crop(tmp.getbbox())
    a=np.asarray(tmp).copy(); mask=np.random.rand(*a.shape[:2])>0.06; a[...,3]=(a[...,3]*mask*0.92).astype(np.uint8); tmp=Image.fromarray(a)
    return tmp.rotate(ang,expand=True,resample=Image.BICUBIC)
UNK=stamp('UNKNOWN',mono(56),14); SOON=stamp('မကြာခင်',mm(64,'Black'),-7)
OUT='/tmp/ep/v5/f'; shutil.rmtree(OUT,ignore_errors=True); os.makedirs(OUT)
T=9.4; N=int(T*FPS); RED=(206,34,40)
for k in range(N):
    t=k/FPS
    cv=DESK.convert('RGBA')
    shake=(0,0)
    if 1.8<t<2.05: shake=(np.random.randn()*8,np.random.randn()*6)
    if 6.85<t<7.1: shake=(np.random.randn()*8,np.random.randn()*6)
    if t<6.6:
        # old man photo: from full-frame freeze to card
        p=eout((t-0.25)/0.75)
        if t<0.25:
            im=mono_grade(fr,ease(t/0.25)).convert('RGBA'); cv=im
        else:
            sc=1.0*(1-p)+0.78*p; rot=-4*p; cx=W/2*(1-p)+390*p; cy=H/2*(1-p)+350*p
            if p<1:
                full=mono_grade(fr).convert('RGBA'); f2=full.resize((int(W*(1-p*0.6)),int(H*(1-p*0.6))))
                cv.alpha_composite(f2,(int(W/2-f2.width/2),int(H/2-f2.height/2))) if p<0.35 else None
            pos=place(cv,OM,cx+shake[0],cy+shake[1],rot,sc*(0.35+0.65*min(1,p*1.6)) if p<1 else sc)
            # red marker circle around face
            if t>1.0:
                q=ease((t-1.0)/0.7); d=ImageDraw.Draw(cv)
                ccx,ccy=cx+shake[0]+18,cy+shake[1]-62; rx,ry=112,124
                pts=[(ccx+rx*math.cos(a)+3*math.sin(a*7),ccy+ry*math.sin(a)+3*math.cos(a*5)) for a in np.linspace(-2.2,-2.2+2*math.pi*1.08*q,max(2,int(140*q)))]
                if len(pts)>1: d.line(pts,fill=RED+(230,),width=6,joint='curve')
            if t>1.8:
                s=1.6-0.6*eout((t-1.8)/0.12); st=UNK.resize((int(UNK.width*s*0.7),int(UNK.height*s*0.7)))
                cv.alpha_composite(st,(int(cx+60-st.width/2+shake[0]),int(cy+150-st.height/2+shake[1])))
        # right note: typewriter punchline
        if 2.1<t<6.4:
            fa=1-ease((t-6.0)/0.4)
            note=Image.new('RGBA',(520,250),(236,230,218,int(245*fa))); dn=ImageDraw.Draw(note)
            dn.text((30,22),typed('CASE NOTE — EP.03',t,2.1,22),font=mono(22),fill=(60,50,40,int(255*fa)))
            dn.text((30,62),typed('သူ ဘယ်သူလဲ?',t,2.5,9),font=mm(54,'Black'),fill=(25,22,20,int(255*fa)))
            dn.text((30,160),typed('ဆရာဝန်တွေ လက်လျှော့တာကို',t,3.6,16),font=mm(26,'SemiBold'),fill=(90,30,30,int(255*fa)))
            dn.text((30,198),typed('ဘာကြောင့် သူ လာကူတာလဲ…',t,4.6,16),font=mm(26,'SemiBold'),fill=(90,30,30,int(255*fa)))
            slide=eout((t-2.1)/0.4); place(cv,note,880+(1-slide)*500,250,2,1,True)
        # Kaung Khant photo + red string
        if t>4.9:
            s2=eback((t-4.9)/0.5); place(cv,KK,1110,560+(1-min(1,s2))*400,6,1)
            if t>5.4:
                q=ease((t-5.4)/0.6); d=ImageDraw.Draw(cv)
                a0=(600,400); a1=(1040,455); m=((a0[0]+a1[0])/2,(a0[1]+a1[1])/2+70)
                pts=[((1-u)**2*a0[0]+2*(1-u)*u*m[0]+u*u*a1[0],(1-u)**2*a0[1]+2*(1-u)*u*m[1]+u*u*a1[1]) for u in np.linspace(0,q,40)]
                d.line(pts,fill=(180,20,25,255),width=4)
                for px,py in (a0,):
                    d.ellipse((px-9,py-9,px+9,py+9),fill=(200,30,30,255))
                if q>=1: d.ellipse((a1[0]-9,a1[1]-9,a1[0]+9,a1[1]+9),fill=(200,30,30,255))
        if t>6.2: cv=I(A(cv.convert('RGB'))*(1-ease((t-6.2)/0.4))).convert('RGBA')
    else:
        # title card on desk: label + stamp
        lt=t-6.6; cv=I(A(DESK)*ease(lt/0.3)).convert('RGBA')
        lab=Image.new('RGBA',(620,220),(236,230,218,255)); dl=ImageDraw.Draw(lab)
        dl.rectangle((10,10,609,209),outline=(60,50,40,255),width=3)
        dl.text((310,72),typed('NEXT FILE',t,6.75,20),font=mono(26),fill=(80,65,50,255),anchor='mm')
        dl.text((310,140),typed('EPISODE 04',t,6.95,14),font=mono(78),fill=(25,22,20,255),anchor='mm')
        place(cv,lab,W/2+shake[0],H/2-10+shake[1],-1.5,1)
        if t>6.85:
            s=1.6-0.6*eout((t-6.85)/0.12); st=SOON.resize((int(SOON.width*s*0.8),int(SOON.height*s*0.8)))
            cv.alpha_composite(st,(int(W/2+230-st.width/2+shake[0]),int(H/2+95-st.height/2+shake[1])))
        if t>T-0.45: cv=I(A(cv.convert('RGB'))*(1-ease((t-(T-0.45))/0.45))).convert('RGBA')
    cv.convert('RGB').save(f'{OUT}/{k:04d}.png')
print(N)
