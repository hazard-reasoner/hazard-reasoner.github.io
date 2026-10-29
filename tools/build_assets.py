"""Build website assets + dataset release for hazard-reasoner.github.io.

Reads project files (read-only) and writes:
  static/images/*              paper figures
  static/scenes/<id>/f{0-3}.jpg  the 4 input frames (t-3 .. t) for the viewer
  static/scenes/<id>/anim.webp   looping preview at the real 0.5 s frame spacing
  static/data/site-data.js     stats, hazard catalog and model comparison (window.HR_DATA)
  dataset/drama_reasoning_{train,val,test}.jsonl  annotation release (no images)

Run:  python tools/build_assets.py
"""
import collections
import json
import re
import shutil
from pathlib import Path

from PIL import Image

SITE = Path(__file__).resolve().parents[1]
PROJ = Path("/home/zixuan/Project")
PAPER = PROJ / "hazard-r1-paper"
TOTAL = PAPER / "data_analysis/hazard_total_dataset.jsonl"
STATS = PAPER / "data_analysis/total_dataset_stats.json"
TEST = PROJ / "ms-swift-grpo/data/benchmark_20260408/test_target_80.jsonl"
GALLERY = PAPER / "paper_assets/qualitative_finalists/figure_designs/gallery_samples.json"
TASK_SAMPLES = PAPER / "paper_assets/task_formulation_samples"
FIGS = {
    "framework.png": PAPER / "paper_assets/draft/ChatGPT Image May 27, 2026 at 08_17_10 PM.png",
    "per_class_f1.png": PAPER / "paper_assets/figures/fig4_per_class_f1.png",
    "severity_confusion.png": PAPER / "paper_assets/figures/fig5_severity_confusion_matrix.png",
}

# Scenes shown on the page. Kept small on purpose: DRAMA frames are licensed by HRI.
CATALOG_EXTRA = {"cyclist": 206, "no_hazard": 12}  # test-set rows for classes without a task sample
QUAL = PAPER / "paper_assets/qualitative_finalists"
ACCEPT = QUAL / "selected_samples/accept.json"            # curated qualitative samples
QWEN_FIX = QUAL / "qwen_reextracted_10.json"              # complete Qwen outputs where the original was cut off
# Demo groups and samples, following final_candidates_0603_v2.pdf.
DEMO_GROUPS = {
    "vehicles": "Finds the hazard: vehicles",
    "pedestrians": "Finds the hazard: pedestrians",
    "vru": "Finds the hazard: cyclists and motorcyclists",
    "severity": "Rates severity",
    "hard": "Hard cases",
}
DEMO_PICKS = [  # (group, idx, public note)
    ("vehicles", 10003, "Qwen locks onto a sidewalk pedestrian. Both tuned models pick the slowing lead car."),
    ("vehicles", 10005, "Qwen reports a pedestrian; the tuned models report the slowing hatchback in the ego lane."),
    ("vehicles", 149, "Only Hazard-Reasoner reads the cones and narrowed lane as road construction. SFT picks an oncoming sedan."),
    ("pedestrians", 5, "Both baselines escalate to crossing_pedestrian. Hazard-Reasoner keeps the pedestrian at the roadside."),
    ("pedestrians", 598, "Qwen reports no hazard. Both tuned models find the pedestrian at the road edge."),
    ("vru", 296, "Qwen sees the cyclist in the ego lane but calls the scene safe."),
    ("vru", 297, "Qwen describes two cyclists ahead but reports no hazard."),
    ("vru", 519, "All three find the cyclist at HIGH. Compare how specific each explanation is."),
    ("vru", 984, "Qwen misses the motorcycle changing lanes just ahead."),
    ("severity", 660, "Three different answers: Qwen sees no hazard, SFT rates MEDIUM, Hazard-Reasoner rates HIGH."),
    ("severity", 111, "A pedestrian walks in the ego lane. SFT under-rates it as MEDIUM."),
    ("severity", 477, "A pedestrian crosses directly ahead. Qwen under-rates it as MEDIUM."),
    ("hard", 89, "A small pedestrian far ahead in harsh light. Hazard-Reasoner picks the wrong pedestrian class."),
    ("hard", 314, "Hazard-Reasoner rates MEDIUM against a HIGH label. The cyclist rides away from the car, so the label is debatable."),
    ("hard", 242, "Hazard-Reasoner rates MEDIUM against a HIGH label that rests on a phone-distracted pedestrian, hard to see in four frames."),
]
DEFAULT_DEMO = 660
VIEW_W, ANIM_W = 720, 400
T_HOLD_MS = [500, 500, 500, 1300]  # real 0.5 s spacing, longer hold on frame t before looping


# ---------------------------------------------------------------- text repair
# ~18% of records lost a multi-byte char (’ or non-breaking hyphen) together with
# the following byte, leaving "??": "car?? pace" -> "car's pace",
# "same??irection" -> "same-direction" (missing letter recovered from vocabulary).
def build_vocab():
    words, compounds = collections.Counter(), collections.Counter()
    for line in open(TOTAL):
        t = json.loads(line)["messages"][-1]["content"].lower()
        words.update(re.findall(r"[a-z]+", t))
        compounds.update(re.findall(r"(?=\b([a-z]+-[a-z]+))", t))
    return words, compounds


WORDS, COMPOUNDS = build_vocab()
unresolved = collections.Counter()


def _fix(m):
    left, right = m.group(1), m.group(2)
    if not right:
        return f"{left}'s"
    last = left.lower().split("-")[-1]
    best, score = None, 0
    for c in "abcdefghijklmnopqrstuvwxyz":
        w = (c + right).lower()
        s = COMPOUNDS[f"{last}-{w}"] * 1000 + WORDS[w]
        if s > score:
            best, score = c, s
    if best is None:
        unresolved[m.group(0)] += 1
        return f"{left}-{right}"
    return f"{left}-{best}{right}"


def clean(text):
    if not text:
        return text
    # "?????" is the Japanese road marking 止まれ ("stop"), unrecoverable bytes
    text = re.sub(r"\?{4,6}", '"止まれ" ', text).replace('"止まれ" stop', '"止まれ" (stop)')
    for _ in range(3):  # adjacent losses ("stop??and??o") need repeated passes
        text = re.sub(r"([A-Za-z0-9-]*[A-Za-z0-9])\?{2,3}([A-Za-z0-9]*)", _fix, text)
    return text.replace("�", "'")


# ---------------------------------------------------------------- parsing
def parse_output(text):
    def grab(pat):
        m = re.search(pat, text, re.S)
        return clean(m.group(1).strip()) if m else ""

    return {
        "hazard_type": grab(r"hazard_type:\s*([a-z_]+)"),
        "severity_level": grab(r"severity_level:\s*([A-Z]+)"),
        "warning_content": grab(r"warning_content:\s*([^\n]*)").replace("\\n", "").strip('" '),
        "environment_perception": grab(r"Environment_Perception:\s*(.*?)\n\s*Hazard_Reasoning:"),
        "hazard_reasoning": grab(r"Hazard_Reasoning:\s*(.*?)(?:\n\s*Driver_Warning:|\n?</think>)"),
    }


def clip_key(img_path):
    return re.sub(r"_t(-\d)?\.jpg$", "", Path(img_path).name)


def drama_ref(key):
    k = key.removesuffix("_movie")
    m = re.match(r"titan_clip_(\d+)_(\d+)$", k)
    if m:
        return {"subset": "titan", "scenario": f"clip_{m.group(1)}", "frame": m.group(2)}
    m = re.match(r"(\d{4}-\d{4}-\d{6})_(\d+)$", k)
    if m:
        return {"subset": "drama", "scenario": m.group(1), "frame": m.group(2)}
    return {"subset": "unknown", "scenario": k, "frame": ""}


def save_scene(uid, paths):
    d = SITE / "static/scenes" / uid
    d.mkdir(parents=True, exist_ok=True)
    ims = [Image.open(p).convert("RGB") for p in paths]
    for i, im in enumerate(ims):
        im.resize((VIEW_W, round(im.height * VIEW_W / im.width)), Image.LANCZOS) \
          .save(d / f"f{i}.jpg", quality=78, optimize=True, progressive=True)
    small = [im.resize((ANIM_W, round(im.height * ANIM_W / im.width)), Image.LANCZOS) for im in ims]
    small[0].save(d / "anim.webp", save_all=True, append_images=small[1:], duration=T_HOLD_MS,
                  loop=0, quality=62, method=6)
    base = f"static/scenes/{uid}"
    return {"frames": [f"{base}/f{i}.jpg" for i in range(4)], "anim": f"{base}/anim.webp"}


# ---------------------------------------------------------------- builders
def build_figures():
    d = SITE / "static/images"
    d.mkdir(parents=True, exist_ok=True)
    for name, src in FIGS.items():
        shutil.copy(src, d / name)
    # WebP is ~5x smaller than these PNGs at no visible loss
    for name in FIGS:  # only the paper figures; static/images also holds icon.png
        png = d / name
        Image.open(png).convert("RGB").save(png.with_suffix(".webp"), quality=88, method=6)
        png.unlink()


def build_release():
    d = SITE / "dataset"
    d.mkdir(exist_ok=True)
    files = {s: open(d / f"drama_reasoning_{s}.jsonl", "w") for s in ("train", "val", "test")}
    counters = collections.Counter()
    for line in open(TOTAL):
        r = json.loads(line)
        split = r["split"]
        counters[split] += 1
        key = clip_key(r["images"][-1])
        rec = {
            "id": f"{split}_{counters[split]:05d}",
            "split": split,
            "clip_key": key,
            "source": drama_ref(key),
            "frames": [Path(p).name for p in r["images"]],
            **parse_output(r["messages"][-1]["content"]),
        }
        files[split].write(json.dumps(rec, ensure_ascii=False) + "\n")
    for f in files.values():
        f.close()
    prompt = json.loads(open(TOTAL).readline())["messages"][0]["content"]
    (d / "prompt.txt").write_text(prompt.replace("<image>\n", "") + "\n")
    print("release:", dict(counters))


def build_stats():
    s = json.load(open(STATS))
    return {
        "total": s["total"],
        "splits": s["per_split_counts"],
        "hazard_total": s["haz_total"],
        "crosstab": s["crosstab"],
    }


def build_catalog():
    """One scene per hazard class, sorted by class size."""
    scenes = {}
    for folder in sorted(p for p in TASK_SAMPLES.iterdir() if p.is_dir()):
        meta = json.loads((folder / "meta.json").read_text())
        gt = parse_output((folder / "ground_truth.txt").read_text())
        scenes[gt["hazard_type"]] = {"id": f"cat_{gt['hazard_type']}", "gt": gt,
                                     "paths": [folder / f for f in meta["frames"]]}
    rows = open(TEST).readlines()
    for cls, row in CATALOG_EXTRA.items():
        r = json.loads(rows[row])
        scenes[cls] = {"id": f"cat_{cls}", "gt": parse_output(r["messages"][-1]["content"]),
                       "paths": r["images"]}
    out = []
    for cls, sc in scenes.items():
        assert sc["gt"]["hazard_type"] == cls, cls
        out.append({"cls": cls, "id": sc["id"], "gt": sc["gt"], **save_scene(sc["id"], sc["paths"])})
    print("catalog:", len(out))
    return out


def build_demos():
    accept = json.load(open(ACCEPT))
    qwen_fix = json.load(open(QWEN_FIX))
    fields = ("hazard_type", "severity_level", "warning_content",
              "environment_perception", "hazard_reasoning")
    demos = []
    for group, idx, note in DEMO_PICKS:
        s = accept[str(idx)]
        uid = f"demo_{idx}"
        entry = {"id": uid, "case": group, "note": note, "default": idx == DEFAULT_DEMO,
                 **save_scene(uid, s["images"])}
        for model in ("ground_truth", "qwen3_vl_8b", "sft", "hazard_reasoner"):
            src = dict(s[model])
            truncated = bool(src.get("qwen_output_truncated"))
            if model == "qwen3_vl_8b" and str(idx) in qwen_fix:
                src.update({k: v for k, v in qwen_fix[str(idx)].items() if k in fields and v})
                truncated = False
            out = {k: clean(src.get(k, "")) for k in fields}
            # zero-shot Qwen sometimes ran out of tokens before the answer block
            if out["warning_content"].startswith("Environment_Perception"):
                out["warning_content"] = ""
                truncated = True
            out["truncated"] = truncated
            entry[model] = out
        demos.append(entry)
    cases = {g: {"title": t} for g, t in DEMO_GROUPS.items()}
    print("demos:", len(demos))
    return cases, demos


if __name__ == "__main__":
    shutil.rmtree(SITE / "static/scenes", ignore_errors=True)
    (SITE / "static/data").mkdir(parents=True, exist_ok=True)
    build_figures()
    cases, demos = build_demos()
    data = {"stats": build_stats(), "catalog": build_catalog(), "cases": cases, "demos": demos}
    (SITE / "static/data/site-data.js").write_text(
        "// generated by tools/build_assets.py\nwindow.HR_DATA = "
        + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    build_release()
    print("unresolved '??' patterns:", sum(unresolved.values()), unresolved.most_common(10))
