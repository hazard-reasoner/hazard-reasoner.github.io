"""Build website assets + dataset release for hazard-reasoner.github.io.

Reads project files (read-only) and writes:
  static/images/*        paper figures
  static/frames/*        resized demo frames
  static/data/demos.json qualitative comparison cases (Qwen3-VL / SFT / Hazard-Reasoner)
  static/data/samples.json  one dataset sample per hazard class
  static/data/stats.json    dataset statistics
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
GALLERY = PAPER / "paper_assets/qualitative_finalists/figure_designs/gallery_samples.json"
TASK_SAMPLES = PAPER / "paper_assets/task_formulation_samples"
FIGS = {
    "framework.png": PAPER / "paper_assets/draft/ChatGPT Image May 27, 2026 at 08_17_10 PM.png",
    "task_formulation.png": PAPER / "paper_assets/figures/ChatGPT Image May 30, 2026, 08_06_00 PM.png",
    "per_class_f1.png": PAPER / "paper_assets/figures/fig4_per_class_f1.png",
    "severity_confusion.png": PAPER / "paper_assets/figures/fig5_severity_confusion_matrix.png",
    "grpo_impact.png": PAPER / "paper_assets/figures/fig_grpo_impact.png",
}
FRAME_W = 640


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


def save_frame(src, name):
    out = SITE / "static/frames" / name
    if not out.exists():
        im = Image.open(src).convert("RGB")
        im = im.resize((FRAME_W, round(im.height * FRAME_W / im.width)), Image.LANCZOS)
        im.save(out, quality=80, optimize=True)
    return f"static/frames/{name}"


# ---------------------------------------------------------------- builders
def build_figures():
    d = SITE / "static/images"
    d.mkdir(parents=True, exist_ok=True)
    for name, src in FIGS.items():
        shutil.copy(src, d / name)
    # drop the baked-in "Fig. X." caption strip
    im = Image.open(d / "task_formulation.png")
    im.crop((0, 0, im.width, 850)).save(d / "task_formulation.png", optimize=True)


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
    out = {
        "total": s["total"],
        "splits": s["per_split_counts"],
        "hazard_order": s["hazard_order"],
        "severity_order": s["severity_order"],
        "hazard_total": s["haz_total"],
        "severity_total": s["sev_total"],
        "crosstab": s["crosstab"],
    }
    json.dump(out, open(SITE / "static/data/stats.json", "w"), indent=1)


def build_samples():
    samples = []
    for folder in sorted(p for p in TASK_SAMPLES.iterdir() if p.is_dir()):
        meta = json.loads((folder / "meta.json").read_text())
        gt = parse_output((folder / "ground_truth.txt").read_text())
        frames = [save_frame(folder / f"frame_{t}.jpg", f"s_{folder.name[:2]}_{t}.jpg")
                  for t in ("t-3", "t-2", "t-1", "t")]
        samples.append({"name": folder.name, "frames": frames, "gt": gt,
                        "clip_key": meta.get("clip", meta.get("clip_id", ""))})
    json.dump(samples, open(SITE / "static/data/samples.json", "w"), indent=1, ensure_ascii=False)
    print("samples:", len(samples))


def build_demos():
    g = json.load(open(GALLERY))
    fields = ("hazard_type", "severity_level", "warning_content",
              "environment_perception", "hazard_reasoning")
    cases = []
    for cid, case in g["cases"].items():
        for s in case["samples"]:
            uid = f"{s['source']}_{s['idx'] if s['idx'] is not None else s['demo_idx']}"
            frames = [save_frame(p, f"d_{uid}_{t}.jpg")
                      for p, t in zip(s["images"], ("t-3", "t-2", "t-1", "t"))]
            entry = {"id": uid, "case": cid, "frames": frames, "note": s.get("user_note", "")}
            for model in ("ground_truth", "qwen3_vl_8b", "sft", "hazard_reasoner"):
                out = {k: clean(s[model].get(k, "")) for k in fields}
                # zero-shot Qwen sometimes ran out of tokens before the answer block
                if out["warning_content"].startswith("Environment_Perception"):
                    out["warning_content"] = ""
                out["truncated"] = bool(s[model].get("qwen_output_truncated"))
                entry[model] = out
            cases.append(entry)
    meta = {cid: {"title": c["title"], "description": c["description"]}
            for cid, c in g["cases"].items()}
    json.dump({"cases": meta, "samples": cases},
              open(SITE / "static/data/demos.json", "w"), indent=1, ensure_ascii=False)
    print("demos:", len(cases))


if __name__ == "__main__":
    (SITE / "static/frames").mkdir(parents=True, exist_ok=True)
    (SITE / "static/data").mkdir(parents=True, exist_ok=True)
    build_figures()
    build_stats()
    build_samples()
    build_demos()
    build_release()
    print("unresolved '??' patterns:", sum(unresolved.values()), unresolved.most_common(10))
