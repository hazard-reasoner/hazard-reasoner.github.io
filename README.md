# hazard-reasoner.github.io

Project page for **Hazard-Reasoner** and the **DRAMA-Reasoning** annotations.
Live at <https://hazard-reasoner.github.io>.

```
index.html               the page (no build step; tabs: Dataset, Download, Method & results, Demo)
static/css, static/js    styles and page logic
static/data/site-data.js dataset stats, class examples and demo outputs (generated)
static/scenes/           example frames + animated previews (DRAMA, © Honda Research Institute USA; illustration only)
static/images/           paper figures and the project icon
dataset/                 annotation release (jsonl, no images) + README
tools/build_assets.py    regenerates static/data, static/scenes and dataset/ from the project files
```

Local preview:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

Driving frames belong to the DRAMA dataset (Honda Research Institute USA) and are not redistributed
as part of DRAMA-Reasoning. Request DRAMA at <https://usa.honda-ri.com/drama>.
