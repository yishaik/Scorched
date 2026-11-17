#!/usr/bin/env bash
# Cut and assemble the Scorched Tanks 30s Play trailer from tools/trailer/record.mjs output.
# Usage (from the repo root):
#   OUT=/workspace/scorched-trailer tools/trailer/make.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-/workspace/scorched-trailer}"
RAW="$OUT/raw"
EDIT="$RAW/edit.json"
ICON="$ROOT/marketing/play-icon-512.png"
FPS=30
# H.264 / yuv420p, reasonably high quality, web- and Play-friendly.
VCODEC=(-c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 -crf 18 -preset medium -movflags +faststart)
ACODEC=(-c:a aac -b:a 192k -ar 48000 -ac 2)

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo "ffmpeg and ffprobe are required" >&2
  exit 1
fi
if [[ ! -f "$EDIT" ]]; then
  echo "missing $EDIT — run tools/trailer/record.mjs first" >&2
  exit 1
fi

WORKDIR="$OUT/build"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR" "$OUT/frames"

python3 - "$EDIT" "$WORKDIR/clips.json" << 'PY'
import json, sys
edit = json.load(open(sys.argv[1]))
# Order: hook first, title card is appended later by this script.
# Each recorded weapon clip can run long (waitSettled stays busy through later
# CPU turns). Windows are offsets from the clip's marked start (the fire),
# chosen by inspecting this take so each cut contains the weapon's payoff.
# If you re-record, extract a few frames and adjust these offsets.
order = ["hook", "mirv", "napalm", "roller", "digger", "shop", "lobby", "win"]
# (start_offset, end_offset) relative to the recorded clip start
windows = {
    "hook":   (0.20, 5.20),   # flight, full-screen nuke blast ~3.8s, death taunt ~5.0s
    "mirv":   (3.35, 5.25),   # warheads splitting, then the cluster of explosions
    "napalm": (1.60, 5.10),   # arc over the ridge, fire on the right slope
    "roller": (7.00, 11.20),  # lands in the valley and rolls downhill
    "digger": (1.10, 4.60),   # flight, then the tunnel blown through the ridge
    "shop":   (0.00, 3.40),   # buying Nuke / MIRV / Napalm / Roller / Digger
    "lobby":  (0.10, 3.20),   # room code + two players in the online lobby
    "win":    (0.12, 2.50),   # round result card
}
clips = {c["id"]: c for c in edit["clips"]}
out = []
for name in order:
    c = clips.get(name)
    if not c:
        continue
    base_s, base_e = float(c["start"]), float(c["end"])
    off_s, off_e = windows.get(name, (0.0, min(3.0, base_e - base_s)))
    start = base_s + off_s
    end = min(base_e, base_s + off_e)
    if end - start < 0.6:
        continue
    out.append({
        "id": name,
        "file": c["file"],
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(end - start, 3),
        # No punch-in on the hook: the nuke fireball sits on the left edge.
        "zoom": 1.0,
    })
json.dump({"audioOffsetMs": edit.get("audioOffsetMs") or 0,
           "audio": edit.get("audio"),
           "clips": out,
           "issues": edit.get("issues") or []}, open(sys.argv[2], "w"), indent=2)
print("planned clips:")
total = 0
for c in out:
    total += c["duration"]
    print(f"  {c['id']:8} {c['start']:.2f}-{c['end']:.2f} ({c['duration']:.2f}s) file={c['file']}")
print(f"  live total {total:.2f}s (+ title card ~4s)")
PY
# Build a silent or sourced audio bed per clip, then concat.
python3 - "$RAW" "$WORKDIR" "$FPS" << 'PY'
import json, os, subprocess, sys
raw, work, fps = sys.argv[1], sys.argv[2], sys.argv[3]
plan = json.load(open(os.path.join(work, "clips.json")))
offset = (plan.get("audioOffsetMs") or 0) / 1000.0
audio_file = os.path.join(raw, plan["audio"]) if plan.get("audio") else None
has_audio = audio_file and os.path.isfile(audio_file) and os.path.getsize(audio_file) > 1000

def run(cmd):
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)

n = 0
concat = []
for c in plan["clips"]:
    n += 1
    src = os.path.join(raw, c["file"])
    dst = os.path.join(work, f"{n:02d}-{c['id']}.mp4")
    dur = c["duration"]
    start = c["start"]
    # Video filters: optional punch-in on the hook, even dimensions, constant fps.
    vf = [f"fps={fps}", "scale=1920:1080:flags=lanczos", "setsar=1"]
    if c.get("zoom", 1) > 1.01:
        z = c["zoom"]
        # Zoom toward the lower-middle third (the battlefield, under the HUD).
        vf = [
            f"scale=1920*{z}:1080*{z}:flags=lanczos",
            f"crop=1920:1080:(in_w-1920)/2:(in_h-1080)*0.62",
            f"fps={fps}",
            "setsar=1",
        ]
    vfilter = ",".join(vf)
    # Cut the matching game-audio slice when we have it (gameplay.webm only).
    use_audio = has_audio and c["file"].startswith("gameplay")
    cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src]
    if use_audio:
        astart = max(0, start - offset)
        cmd += ["-ss", f"{astart:.3f}", "-t", f"{dur:.3f}", "-i", audio_file]
        cmd += ["-vf", vfilter, "-af", "aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,apad"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "18",
                "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-t", f"{dur:.3f}", dst]
    else:
        # Silent clip; a light generated bed is mixed later.
        cmd += ["-vf", vfilter, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-profile:v", "high", "-crf", "18", "-preset", "medium", dst]
    run(cmd)
    concat.append(dst)

open(os.path.join(work, "concat.txt"), "w").write("".join(f"file '{p}'\n" for p in concat))
print("concat n=", len(concat), "has_game_audio=", has_audio)
open(os.path.join(work, "has_audio"), "w").write("1" if has_audio else "0")
PY

# Title cards from a captured still (prefer the hook crater; fall back in order).
BG=""
for c in still-hook-blast.png still-hook.png still-napalm.png still-battlefield.png still-win.png still-shop.png; do
  if [[ -f "$RAW/$c" ]]; then BG="$RAW/$c"; break; fi
done
if [[ -z "$BG" ]]; then
  echo "no stills in $RAW" >&2
  exit 1
fi
python3 "$ROOT/tools/trailer/titlecard.py" --bg "$BG" --icon "$ICON" \
  --out "$WORKDIR/title-1080.png" --portrait-out "$WORKDIR/title-1080x1920.png"

# 4.2s title card, fade in.
ffmpeg -y -loop 1 -framerate "$FPS" -t 4.2 -i "$WORKDIR/title-1080.png" \
  -vf "fade=t=in:st=0:d=0.4,fps=${FPS},format=yuv420p,setsar=1" \
  "${VCODEC[@]}" -an "$WORKDIR/99-title.mp4"

{
  cat "$WORKDIR/concat.txt"
  echo "file '$WORKDIR/99-title.mp4'"
} > "$WORKDIR/concat-all.txt"

ffmpeg -y -f concat -safe 0 -i "$WORKDIR/concat-all.txt" -an -c:v libx264 -pix_fmt yuv420p -r 30 -crf 18 -preset medium -movflags +faststart "$WORKDIR/picture.mp4"

# Audio: mix captured game SFX (if any) with a short, original low drone so
# silent stretches (shop, lobby, title) are not dead quiet. The drone is
# generated here (sine + filtered noise) — not a third-party track.
DRONE="$WORKDIR/drone.wav"
ffmpeg -y -f lavfi -i "sine=frequency=46:sample_rate=48000:duration=40" \
  -f lavfi -i "anoisesrc=color=brown:sample_rate=48000:amplitude=0.15:duration=40" \
  -filter_complex "[0]volume=0.18[a];[1]lowpass=f=180,volume=0.08[b];[a][b]amix=inputs=2:duration=longest,volume=0.7,afade=t=in:d=0.6,afade=t=out:st=35:d=4" \
  -t 40 "$DRONE"

# Rebuild a continuous audio timeline from the cut clips (they already carry
# game audio when it was captured) plus the drone underneath, then fade out.
# picture.mp4 from concat -c copy may lack a consistent audio track if some
# clips were silent, so we re-extract per-clip audio and pad.
python3 - "$WORKDIR" "$DRONE" "$OUT" "$FPS" << 'PY'
import json, os, subprocess, sys
work, drone, out, fps = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
plan = json.load(open(os.path.join(work, "clips.json")))

def probe_has_audio(path):
    try:
        r = subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "a",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", path
        ], text=True)
        return "audio" in r
    except subprocess.CalledProcessError:
        return False

def duration(path):
    return float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", path
    ], text=True).strip())

segs = []
idx = 0
for c in plan["clips"]:
    idx += 1
    path = os.path.join(work, f"{idx:02d}-{c['id']}.mp4")
    wav = os.path.join(work, f"{idx:02d}-{c['id']}.wav")
    dur = c["duration"]
    if probe_has_audio(path):
        subprocess.check_call(["ffmpeg", "-y", "-i", path, "-vn", "-ac", "2", "-ar", "48000", wav])
    else:
        subprocess.check_call([
            "ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo", "-t", f"{dur:.3f}", wav
        ])
    segs.append(wav)

# title is silent
title_dur = duration(os.path.join(work, "99-title.mp4"))
title_wav = os.path.join(work, "99-title.wav")
subprocess.check_call([
    "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{title_dur:.3f}", title_wav
])
segs.append(title_wav)

# concat audio, mix drone at low level, limiter, fade out on the last 1.2s
lst = os.path.join(work, "audio-concat.txt")
open(lst, "w").write("".join(f"file '{p}'\n" for p in segs))
bed = os.path.join(work, "bed.wav")
subprocess.check_call(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "pcm_s16le", bed])
total = duration(bed)
fade = min(1.3, max(0.6, total - 0.4))
mix = os.path.join(work, "mix.wav")
# Drone sits under the SFX; game audio (when present) stays in front.
subprocess.check_call([
    "ffmpeg", "-y", "-i", bed, "-i", drone,
    "-filter_complex",
    f"[1]volume=0.22,atrim=0:{total:.3f},asetpts=PTS-STARTPTS[d];"
    f"[0][d]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95,afade=t=out:st={total-fade:.3f}:d={fade:.3f}",
    "-ar", "48000", "-ac", "2", mix
])

picture = os.path.join(work, "picture.mp4")
final = os.path.join(out, "scorched-trailer-30s.mp4")
subprocess.check_call([
    "ffmpeg", "-y", "-i", picture, "-i", mix,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    "-crf", "18", "-preset", "medium", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", f"{duration(picture):.3f}", final
])
print("wrote", final, "duration", duration(final))
open(os.path.join(work, "total_duration"), "w").write(str(duration(final)))
PY

# Vertical 9:16 cut: blurred cover background + 16:9 gameplay letterboxed,
# then a full-frame portrait title card.
LAND="$OUT/scorched-trailer-30s.mp4"
LAND_DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$LAND")"
TITLE_D=4.2
PLAY_D="$(python3 -c "print(max(0.5, $LAND_DUR - $TITLE_D))")"

ffmpeg -y -i "$LAND" -i "$WORKDIR/title-1080x1920.png" -filter_complex "
[0:v]trim=0:${PLAY_D},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=22:8,setsar=1[bg];
[0:v]trim=0:${PLAY_D},setpts=PTS-STARTPTS,scale=1080:608:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2-160,fps=${FPS},format=yuv420p,setsar=1[play];
[1:v]loop=loop=-1:size=1:start=0,trim=duration=${TITLE_D},fps=${FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=0.35[title];
[play][title]concat=n=2:v=1:a=0[v]
" -map "[v]" -map 0:a? -t "$(python3 -c "print($PLAY_D + $TITLE_D)")" \
  "${VCODEC[@]}" -c:a aac -b:a 192k -ar 48000 -ac 2 -shortest \
  "$OUT/scorched-trailer-30s-vertical.mp4"

# Review stills (3–4 PNGs) from the finished landscape cut + the title card.
python3 - "$LAND" "$WORKDIR/title-1080.png" "$OUT/frames" "$LAND_DUR" << 'PY'
import os, subprocess, sys
land, title, dest, dur = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
# pick three moments in the live portion, plus the title card
# hook blast, MIRV impacts, lobby (just before the title card)
times = [3.6, 6.5, min(dur - 4.4, 23.5)]
names = ["01-hook.png", "02-mirv.png", "03-lobby.png"]
for t, name in zip(times, names):
    out = os.path.join(dest, name)
    subprocess.check_call([
        "ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", land, "-frames:v", "1", "-q:v", "2", out
    ])
    print("frame", out, "t", t)
subprocess.check_call(["cp", title, os.path.join(dest, "04-title.png")])
print("frame", os.path.join(dest, "04-title.png"))
PY

echo
echo "======= outputs ======="
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,codec_type,avg_frame_rate,pix_fmt,sample_rate -of default "$OUT/scorched-trailer-30s.mp4"
echo "--- vertical ---"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,codec_type,avg_frame_rate,pix_fmt -of default "$OUT/scorched-trailer-30s-vertical.mp4" || true
ls -lh "$OUT/scorched-trailer-30s.mp4" "$OUT/scorched-trailer-30s-vertical.mp4" "$OUT/frames"
