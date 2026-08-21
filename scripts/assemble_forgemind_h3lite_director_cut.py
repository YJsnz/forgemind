import json
import subprocess
from pathlib import Path


FFMPEG = Path(r"D:\Minimax\ffmpeg\ffmpeg-9.0.1-full_build-shared\bin\ffmpeg.exe")
OUTPUT_ROOT = Path(r"D:\Minimax\ComfyUI\output")
ROOT = Path(__file__).resolve().parents[1]
FINAL = ROOT / "video" / "ForgeMind-H3Lite-Director-Cut.mp4"


def new(name):
    return OUTPUT_ROOT / "forgemind_dc" / f"{name}_00001_.mp4"


def old(name):
    return OUTPUT_ROOT / name


FILES = [
    old("v5_shot0_unfold2_00001_.mp4"),
    new("DC-S01-OPEN"),
    new("DC-S02-BUILD"),
    old("v4_shot03_define_00001_.mp4"),
    new("DC-S03-FLOW"),
    old("v5_seg3_run_v2_00001_.mp4"),
    new("DC-S04-ROBOT"),
    new("DC-S04-AGV"),
    old("v5_seg6_final_v2_00001_.mp4"),
    old("v5_seg4_anomaly_v2_00001_.mp4"),
    new("DC-S05-ANOMALY"),
    new("DC-S06-FIND"),
    old("v5_seg5_ai_v2_00001_.mp4"),
    new("DC-S07-FIX"),
    new("DC-S08-QUALITY"),
    new("DC-S08-ASK"),
    new("DC-S09-THINK"),
    old("v5_ending_00001_.mp4"),
]

NO_AUDIO_DURATION = {
    0: 3.0,
    len(FILES) - 1: 5.0,
}


def main():
    missing = [str(path) for path in FILES if not path.exists()]
    if missing:
        raise SystemExit("missing inputs:\n" + "\n".join(missing))
    inputs = []
    filters = []
    for index, path in enumerate(FILES):
        inputs += ["-i", str(path)]
        audio_filter = (
            f"anullsrc=r=32000:cl=stereo,atrim=duration={NO_AUDIO_DURATION[index]}[a{index}]"
            if index in NO_AUDIO_DURATION
            else f"[{index}:a]aresample=32000,aformat=sample_fmts=fltp:sample_rates=32000:channel_layouts=stereo[a{index}]"
        )
        filters.append(
            f"[{index}:v]scale=1280:704:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,"
            f"format=yuv420p,setsar=1,fps=24[v{index}];"
            f"{audio_filter}"
        )
    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(FILES)))
    filters.append(f"{concat_inputs}concat=n={len(FILES)}:v=1:a=1[outv][outa]")
    cmd = [
        str(FFMPEG), "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        str(FINAL),
    ]
    print(json.dumps({"output": str(FINAL), "inputs": [str(p) for p in FILES]}, ensure_ascii=False, indent=2))
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
