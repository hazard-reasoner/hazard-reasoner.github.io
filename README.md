# hazard-reasoner.github.io

Project page for **Hazard-Reasoner** and the **DRAMA-Reasoning** dataset.

```
index.html              single-page site (no build step)
static/css, static/js   styles + frame player / charts / demo
static/images           paper figures
static/frames           demo frames (resized, from DRAMA)
static/data             stats.json, samples.json, demos.json
dataset/                annotation release (jsonl) + README
tools/build_assets.py   regenerates static/data, static/frames, dataset/ from the project files
```

Local preview (`fetch` does not work from `file://`):

```bash
python -m http.server 8000   # open http://localhost:8000
```

Regenerate assets after changing data or figures:

```bash
python tools/build_assets.py
```
