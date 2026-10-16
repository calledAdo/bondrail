"""Decode both finished films, verify copy/audio/timing, export review artifacts. Local files only."""
from pathlib import Path
import json, re, subprocess
import av
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

PKG=Path(__file__).resolve().parents[1]
OUT=PKG.parent/'output/concepts'
PLAN=json.loads((PKG/'src/concepts/timeline.json').read_text())
FF=imageio_ffmpeg.get_ffmpeg_exe()
BANNED=r'credit layer|\bloans?\b|\byields?\b|guaranteed? returns?|\bAPY\b|\bAPR\b|\$[0-9]|0x[a-fA-F0-9]{40,}|\bwallets?\b|\bexplorers?\b|\btransactions?\b|\bterminal\b'

def check_copy():
    source=PKG/'src/concepts'
    result=subprocess.run(['rg','-ni',BANNED,str(source)],capture_output=True,text=True)
    assert result.returncode in (0,1), result.stderr
    assert result.returncode==1, 'Banned film copy: '+result.stdout
    (OUT/'banned-phrase-grep.txt').write_text('PASS — no banned phrases, financial amounts, addresses or operation UI terms in src/concepts.\nPattern: '+BANNED+'\n')
    previous=0
    for beat in PLAN['beats']:
        assert beat['start']==previous, f"Timeline gap at {beat['id']}"
        assert beat['end']-beat['start']>=2.1, f"Insufficient hold: {beat['id']}"
        previous=beat['end']
    assert previous==76

def inspect(suffix,width):
    file=OUT/f'bondrail-concepts{suffix}.mp4'
    container=av.open(str(file))
    stream=container.streams.video[0]
    assert (stream.width,stream.height)==(width,1080)
    assert float(stream.average_rate)==30
    assert stream.codec_context.name=='h264'
    assert stream.codec_context.format.name=='yuv420p'
    assert stream.codec_context.colorspace==1 and stream.codec_context.color_range==1,'Expected limited-range Rec.709'
    assert stream.codec_context.color_primaries==1 and stream.codec_context.color_trc==1
    assert abs(container.duration/av.time_base-PLAN['seconds'])<.001,'Unexpected container duration'
    times=PLAN['reviewSeconds']+[24,24.3,24.6,32,32.3,32.6,56,56.3,56.6]
    indices={round(t*30):t for t in times}
    review=OUT/f'review{suffix}';review.mkdir(exist_ok=True)
    count=0;last=-1;brightness=[]
    for frame in container.decode(video=0):
        assert frame.time>last,'Non-monotonic presentation timestamps'
        if count:assert abs(frame.time-last-1/30)<.0001,'Irregular frame cadence'
        last=frame.time
        if count in indices:
            frame.to_image().save(review/f'frame-{indices[count]}.png')
        if count%30==0:
            small=frame.to_image().resize((32,18)).convert('L')
            brightness.append(sum(small.get_flattened_data())/(32*18))
        count+=1
    container.close()
    assert count==PLAN['seconds']*30, f'Unexpected frame count: {count}'
    assert abs(last+1/30-PLAN['seconds'])<.001
    assert min(brightness)>15,'Unexpected black frame'
    audio=av.open(str(file));astream=audio.streams.audio[0]
    assert astream.codec_context.name=='aac'
    assert astream.codec_context.sample_rate==48000
    assert len(astream.codec_context.layout.channels)==2
    audio_samples=sum(frame.samples for frame in audio.decode(audio=0))
    audio.close()
    assert abs(audio_samples/48000-PLAN['seconds'])<.05
    # Independent ffmpeg full decode catches codec errors in either stream.
    decode=subprocess.run([FF,'-hide_banner','-v','error','-xerror','-i',str(file),'-f','null','-'],capture_output=True,text=True)
    assert decode.returncode==0 and not decode.stderr,decode.stderr
    result=subprocess.run([FF,'-hide_banner','-i',str(file),'-af','loudnorm=I=-18:TP=-2:LRA=7:print_format=json','-vn','-f','null','-'],capture_output=True,text=True,check=True)
    measurement=json.loads(re.search(r'\{[^{}]+\}',result.stderr,re.S).group())
    assert -19<=float(measurement['input_i'])<=-17, measurement
    assert float(measurement['input_tp'])<=-1.5,measurement
    data={'file':file.name,'width':width,'height':1080,'fps':30,'frames':count,'duration':round(last+1/30,3),'audio_seconds':round(audio_samples/48000,3),'integrated_lufs':float(measurement['input_i']),'true_peak_dbtp':float(measurement['input_tp']),'loudness_range_lu':float(measurement['input_lra']),'decode':'PASS','copy':'PASS'}
    print(json.dumps(data),flush=True)
    return data

def boards():
    rows=[]
    for suffix,w in [('',640),('-square',360)]:
        h=round(w*1080/(1920 if not suffix else 1080));label=42
        board=Image.new('RGB',(w*3,(h+label)*4),'#202A27');d=ImageDraw.Draw(board)
        for i,t in enumerate(PLAN['reviewSeconds']):
            im=Image.open(OUT/f'review{suffix}'/f'frame-{t}.png').resize((w,h),Image.Resampling.LANCZOS)
            x=(i%3)*w;y=(i//3)*(h+label);board.paste(im,(x,y))
            beat=next(b for b in PLAN['beats'] if b['start']<=t<b['end'])
            d.text((x+14,y+h+12),f'{t:04.1f}s  /  {beat["id"]}',fill='#9FE8CA',font=ImageFont.load_default(size=17))
        board.save(OUT/f'contact-sheet{suffix}.jpg',quality=94)
    for suffix in ['', '-square']:
        times=[24,24.3,24.6,32,32.3,32.6,56,56.3,56.6]
        w=480 if not suffix else 320
        h=270 if not suffix else 320
        board=Image.new('RGB',(w*3,(h+30)*3),'#202A27');d=ImageDraw.Draw(board)
        for i,t in enumerate(times):
            im=Image.open(OUT/f'review{suffix}'/f'frame-{t}.png').resize((w,h),Image.Resampling.LANCZOS)
            x=i%3*w;y=i//3*(h+30);board.paste(im,(x,y));d.text((x+10,y+h+7),f'{t:g}s',fill='#9FE8CA',font=ImageFont.load_default(size=17))
        board.save(OUT/f'transitions{suffix}.jpg',quality=94)
    for t in PLAN['reviewSeconds']:
        beat=next(b for b in PLAN['beats'] if b['start']<=t<b['end'])
        rows.append(f'<section><h2>{t:g}s · {beat["id"]}</h2><p>{" / ".join(beat["lines"])}</p><div><img src="review/frame-{t}.png"><img src="review-square/frame-{t}.png"></div></section>')
    (OUT/'storyboard.html').write_text('<!doctype html><meta charset="utf-8"><title>Bondrail, continued — storyboard</title><style>body{background:#202a27;color:#f6f5ef;font:18px system-ui;margin:5vw}h1{font-size:48px}h2{color:#9fe8ca}section{margin:70px 0}section div{display:flex;gap:20px;align-items:start}img:first-child{width:62%}img:last-child{width:35%}p{max-width:70ch}</style><h1>Bondrail, continued</h1><p>76 seconds · original illustrations · 30 fps · landscape and square</p>'+''.join(rows))

if __name__=='__main__':
    check_copy()
    report=[inspect('',1920),inspect('-square',1080)]
    boards()
    (OUT/'checks.json').write_text(json.dumps({'result':'PASS','films':report,'copy':'PASS','timeline':'PASS'},indent=2)+'\n')
    print('PASS: both full decodes, duration, dimensions, frame cadence, audio, copy and storyboard exports.')
