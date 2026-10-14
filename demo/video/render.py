"""Assemble genuine browser recordings, local narration and timed captions with FFmpeg."""
import argparse
import concurrent.futures
import json
import subprocess
import textwrap
from pathlib import Path
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'output'
MEDIA = OUT / 'edit'
MEDIA.mkdir(parents=True, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FONTDIR = ROOT / 'apps/web/node_modules/geist/dist/fonts/geist-sans'
FONT = str(FONTDIR / 'Geist-Regular.ttf')
BOLD = str(FONTDIR / 'Geist-SemiBold.ttf')
SCENES = json.loads((OUT / 'narration.json').read_text())
EDITS = json.loads((HERE / 'edit.json').read_text())

def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)

def base(scene, preview=False):
    im = Image.new('RGB', (1920, 1080), '#090b0b')
    draw = ImageDraw.Draw(im)
    draw.text((64, 20), scene['eyebrow'], font=font(16, True), fill='#30e0b1')
    draw.text((64, 45), scene['title'], font=font(40, True), fill='#f4f5f5')
    text = 'MONAD TESTNET / TEAM-CONTROLLED DEMO'
    if preview:
        text = 'STYLE PREVIEW / STILL FRAME'
    elif scene['id'] in ('05-kuru', '06-deposit'):
        text = 'AUTOMATED DEMO WALLET / MONAD TESTNET'
    draw.text((1856, 26), text, anchor='ra', font=font(15), fill='#a8b2b0')
    label = 'slice-flame.vercel.app'
    if scene['id'] == '07-cre': label = 'CRE simulation + real testnet report / 30-minute schedule'
    draw.text((1856, 54), label, anchor='ra', font=font(16), fill='#d0d7d5')
    draw.rounded_rectangle((94, 111, 1826, 979), radius=5, outline='#2f3835', width=2)
    # Eight scene markers make the progression legible without visual noise.
    current = next(i for i,s in enumerate(SCENES) if s['id'] == scene['id'])
    for i in range(8):
        draw.line((64+i*224, 1069, 64+i*224+212, 1069), fill='#30e0b1' if i<=current else '#26302d', width=3)
    path = MEDIA / f"{scene['id']}-base.png"
    im.save(path)
    return path

def ass_time(n):
    h=int(n//3600); m=int(n%3600//60); sec=n%60
    return f'{h}:{m:02}:{sec:05.2f}'

def captions(scene):
    text = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Geist,30,&H00F5F5F5,&H00F5F5F5,&H00090B0B,&H00090B0B,0,0,0,0,100,100,0,0,1,1,0,2,120,120,22,1
Style: Note,Geist,18,&H00B8C4C0,&H00B8C4C0,&H00090B0B,&H00090B0B,0,0,0,0,100,100,0,0,3,5,0,9,115,115,126,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    for line in scene['lines']:
        caption = r'\N'.join(textwrap.wrap(line['text'], width=92))
        text += f"Dialogue: 0,{ass_time(line['start'])},{ass_time(line['end'])},Default,,0,0,0,,{caption}\n"
    if scene['id'] in ('04-payment','05-kuru','06-deposit','07-cre'):
        text += f"Dialogue: 0,0:00:00.00,{ass_time(scene['duration'])},Note,,0,0,0,,Edited timing / pauses held\n"
    target = MEDIA / f"{scene['id']}.ass"
    target.write_text(text)
    return target

def ranges(scene, shot):
    marks = {x['label']:x['at'] for x in shot.get('marks',[])}
    start,end = shot['begin'],shot['end']
    if scene['id']=='04-payment' and 'explorer-ready' in marks:
        return [(start, marks['confirmed']+1),
                (max(marks['confirmed']+1,marks['ui-updated']-1), marks['explorer-navigation']),
                (marks['explorer-ready'],end)]
    if scene['id']=='05-kuru' and 'quote' in marks:
        return [(max(start,marks['quote']-2),end)]
    if scene['id']=='06-deposit' and 'ready' in marks:
        return [(max(start,marks['ready']-1),end)]
    if scene['id']=='07-cre' and 'explorer-ready' in marks:
        return [(start,marks['explorer-navigation']), (marks['explorer-ready'],end)]
    return [(start,end)]

def render_scene(scene, shots=None, preview=None):
    background = base(scene, preview is not None)
    subs = captions(scene)
    target = MEDIA / f"{scene['id']}.mp4"
    args = [FFMPEG,'-hide_banner','-loglevel','error','-y','-loop','1','-framerate','30','-i',str(background)]
    if preview:
        args += ['-loop','1','-framerate','30','-i',str(preview)]
        video = '[1:v]scale=1728:864:force_original_aspect_ratio=increase,crop=1728:864,setsar=1[screen];'
        audio_index = 2
    else:
        cuts = EDITS.get(scene['id'])
        if not cuts:
            shot = shots[scene['id']]
            cuts = [dict(source=scene['id'], start=a, end=b) for a,b in ranges(scene,shot)]
        video = ''
        for i,cut in enumerate(cuts):
            shot = shots[cut['source']]
            if shot.get('failed') and not cut.get('verified_usable'):
                raise ValueError('Failed capture requires an explicitly verified usable interval')
            a,b = cut['start'],cut['end']
            if a < 0 or b <= a or b > shot['end']:
                raise ValueError(f'Invalid edit interval: {cut}')
            args += ['-i',shot['video']]
            length = cut.get('duration',b-a)
            # Keep action speed intact; extend only by holding the last actual frame.
            video += f'[{i+1}:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS,fps=30,'
            video += f'tpad=stop_mode=clone:stop_duration={length},trim=duration={length},setpts=PTS-STARTPTS[v{i}];'
        video += ''.join(f'[v{i}]' for i in range(len(cuts)))+f'concat=n={len(cuts)}:v=1:a=0,'
        video += f"fps=30,scale=1728:864,setsar=1,tpad=stop_mode=clone:stop_duration={scene['duration']}[screen];"
        audio_index = len(cuts)+1
    args += ['-i',scene['audio']]
    video += f"[0:v][screen]overlay=96:113:shortest=1,subtitles='{subs}':fontsdir='{FONTDIR}',format=yuv420p[out]"
    args += ['-filter_complex',video,'-map','[out]','-map',f'{audio_index}:a','-t',str(scene['duration']),'-r','30',
             '-c:v','libx264','-preset','fast','-crf','18','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
             '-af','loudnorm=I=-16:TP=-1.5:LRA=11','-movflags','+faststart',str(target)]
    subprocess.run(args,check=True)
    print('Rendered',scene['id'],flush=True)
    return target

def srt_time(n):
    h=int(n//3600); m=int(n%3600//60); s=int(n%60); ms=round((n-int(n))*1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--preview',type=Path)
    args=parser.parse_args()
    if args.preview:
        target=render_scene(SCENES[0],preview=args.preview)
        (OUT/'slice-style-preview.mp4').write_bytes(target.read_bytes())
    else:
        shots=json.loads((OUT/'capture.json').read_text())
        missing=[s['id'] for s in SCENES if s['id'] not in shots or (shots[s['id']].get('failed') and s['id'] not in EDITS)]
        if missing: raise RuntimeError('Missing genuine footage: '+', '.join(missing))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            rendered=list(executor.map(lambda s:render_scene(s,shots),SCENES))
        listing=MEDIA/'concat.txt'
        listing.write_text(''.join(f"file '{p}'\n" for p in rendered))
        subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(OUT/'slice-metropolis-demo.mp4')],check=True)
        cursor=0;lines=[];i=0
        for scene in SCENES:
            for line in scene['lines']:
                i+=1
                lines.append(f"{i}\n{srt_time(cursor+line['start'])} --> {srt_time(cursor+line['end'])}\n{line['text']}\n")
            cursor+=scene['duration']
        (OUT/'slice-metropolis-demo.srt').write_text('\n'.join(lines))
        print('Final:',OUT/'slice-metropolis-demo.mp4','duration',cursor,'seconds')
