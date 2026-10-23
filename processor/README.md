# Film processor

Offline tools that turn match video into data the **Film** tab plays back.
Everything runs on your own machine; no footage or data is uploaded.

## Setup (once)

```bash
python -m venv --system-site-packages processor/.venv
processor/.venv/Scripts/python -m pip install -r processor/requirements.txt
```

(On macOS/Linux the Python path is `processor/.venv/bin/python`.)

## 1. Follow the camera

Veo's downloads follow the play by panning and zooming, so the tools need to
know where the camera was looking at every moment.

1. In the Film tab, **Open video…** and pause on a frame where several pitch
   lines are clear.
2. **Mark reference points**: click a line crossing on the video, then the same
   spot on the pitch map. Mark 4–6 spots spread across the picture. Check the
   drawn lines sit on the painted ones.
3. **Save film file**, then run:

```bash
processor/.venv/Scripts/python processor/follow.py path/to/clip.mp4 path/to/clip.film.json
```

4. **Open film file…** with the updated file. Scrub the clip: the drawn pitch
   lines should stay on the real markings as the camera pans.

If the lines drift in part of the clip, add another reference frame there and
run it again; each moment uses its nearest reference frame.

Takes about a minute per minute of footage.
