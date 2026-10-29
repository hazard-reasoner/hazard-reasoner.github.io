# DRAMA-Reasoning

Annotations for **Hazard-Reasoner**: 12,522 ego-view driving scenes from [DRAMA](https://usa.honda-ri.com/drama) re-annotated for warning-oriented hazard perception.

| Split | Records | File |
|---|---:|---|
| train | 10,084 | `drama_reasoning_train.jsonl` |
| val | 1,388 | `drama_reasoning_val.jsonl` |
| test | 1,050 | `drama_reasoning_test.jsonl` |

`prompt.txt` is the instruction prompt used for training and evaluation. In the model input it comes after the four `<image>` tokens.

## Images

**Images are not included** (DRAMA video and frames © Honda Research Institute USA; distributed only by HRI). Request DRAMA access from Honda Research Institute at <https://usa.honda-ri.com/drama> (university email required; non-commercial research use).

Each sample uses 4 sequential front-camera frames, `t-3, t-2, t-1, t`, spaced 0.5 s apart and ending at the annotated DRAMA frame. The `source` field identifies the DRAMA clip:

- `subset: "drama"`: `scenario` is the DRAMA recording id (e.g. `2020-0210-101957`) and `frame` is the annotated frame id.
- `subset: "titan"`: `scenario` is the TITAN-derived clip (e.g. `clip_1251`) and `frame` is the annotated frame id.

`frames` lists the file names we used, which the training loader expects.

<!-- TODO: link a frame-extraction script once released -->

## Schema

```json
{
  "id": "test_00001",
  "split": "test",
  "clip_key": "2020-0210-101957_009831_movie",
  "source": {"subset": "drama", "scenario": "2020-0210-101957", "frame": "009831"},
  "frames": ["2020-0210-101957_009831_movie_t-3.jpg", "...", "...", "2020-0210-101957_009831_movie_t.jpg"],
  "hazard_type": "crossing_pedestrian",
  "severity_level": "LOW",
  "warning_content": "Yield to the pedestrian",
  "environment_perception": "An urban two-way street ...",
  "hazard_reasoning": "There is a pedestrian ..."
}
```

| Field | Values |
|---|---|
| `hazard_type` | `crossing_pedestrian`, `roadside_pedestrian`, `cyclist`, `motorcyclist`, `stopped_vehicle`, `deceleration_vehicle`, `lane_change_merge`, `making_turn_vehicle`, `oncoming_vehicle`, `parked_vehicle`, `road_construction`, `no_hazard` |
| `severity_level` | `HIGH`, `MEDIUM`, `LOW`, `NONE` (`NONE` if and only if `no_hazard`) |
| `warning_content` | short driver warning, usually 3–8 words |
| `environment_perception` | scene description (road, traffic, relevant agents) |
| `hazard_reasoning` | why the selected agent is the main hazard and how the driver should respond |

Target output format for training:

```
<think>
Environment_Perception: {environment_perception}
Hazard_Reasoning: {hazard_reasoning}
</think>

<answer>
hazard_type: {hazard_type}
severity_level: {severity_level}
warning_content: "{warning_content}"
</answer>
```

## License

The annotations are released under CC BY-NC 4.0 <!-- TODO: confirm -->. Use of the underlying images must follow the DRAMA license.

## Citation

See the citation section of the [project page](https://hazard-reasoner.github.io/#citation), and please also cite DRAMA (Malla et al., WACV 2023).
