"""Local background-blur feasibility preview; preserves original founder recording."""
from pathlib import Path
import subprocess,numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageFont
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'demo/video/output/founder-review';FF=imageio_ffmpeg.get_ffmpeg_exe()
options=vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path='/tmp/bondrail-selfie-segmenter.tflite'),output_confidence_masks=True,running_mode=vision.RunningMode.IMAGE)
segmenter=vision.ImageSegmenter.create_from_options(options)
FONTS=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
font=lambda n:ImageFont.truetype(str(FONTS/'Geist-Regular.ttf'),n)
def process(im):
 arr=np.array(im);result=segmenter.segment(mp.Image(image_format=mp.ImageFormat.SRGB,data=arr));mask=result.confidence_masks[0].numpy_view().copy().squeeze();mask=np.clip((mask-.20)/.65,0,1)
 m=Image.fromarray(np.uint8(mask*255)).resize(im.size,Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(2))
 return Image.composite(im,im.filter(ImageFilter.GaussianBlur(23)),m)
# First verify a still before rendering a moving sample.
im=Image.open(OUT/'frame-40.jpg').convert('RGB');blurred=process(im);blurred.save(OUT/'background-blur-sample.jpg')
# 8-second actual speaking excerpt. Both the large preview and circular crop use the same local segmentation.
source='/Users/adokiye/Documents/Bondrail pitch.mov';FPS=24;duration=8
reader=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-ss','29.7','-i',source,'-t',str(duration),'-vf',f'fps={FPS}','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
writer=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',str(OUT/'blur-silent.mp4')],stdin=subprocess.PIPE)
for n in range(duration*FPS):
 data=reader.stdout.read(1280*720*3)
 if len(data)!=1280*720*3:break
 im=Image.frombytes('RGB',(1280,720),data);im=process(im);canvas=Image.new('RGB',(1920,1080),'#101A15');d=ImageDraw.Draw(canvas)
 d.text((80,62),'Bondrail · founder recording treatment',font=font(43),fill='#F6F5EF');d.text((80,123),'Preview: background blur and circular face crop',font=font(25),fill='#9FE8CA')
 canvas.paste(im.resize((1280,720)),(80,225))
 crop=im.crop((350,10,950,610)).resize((400,400),Image.Resampling.LANCZOS);mask=Image.new('L',(400,400));ImageDraw.Draw(mask).ellipse((2,2,397,397),fill=255);canvas.paste(crop,(1440,350),mask);d.ellipse((1438,348,1842,752),outline='#9FE8CA',width=4);d.text((1440,796),'Loom-style overlay',font=font(28),fill='#F6F5EF');d.text((80,987),'Your original recording is preserved. No footage was uploaded for processing.',font=font(24),fill='#92A69B')
 writer.stdin.write(canvas.tobytes())
 if n==96:canvas.save(OUT/'treatment-preview.jpg')
writer.stdin.close();writer.wait();reader.stdout.close();reader.wait();segmenter.close();assert writer.returncode==0
subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(OUT/'blur-silent.mp4'),'-ss','29.7','-i',source,'-map','0:v','-map','1:a','-t',str(duration),'-c:v','copy','-af','highpass=f=75,loudnorm=I=-16:TP=-1.5:LRA=7','-c:a','aac','-b:a','192k','-movflags','+faststart',str(OUT/'bondrail-face-treatment-preview.mp4')],check=True)
print('8-second blur/circle preview complete')
