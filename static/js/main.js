(() => {
  "use strict";

  const SEV_ORDER = ["HIGH", "MEDIUM", "LOW", "NONE"];
  const T_LABELS = ["t-3", "t-2", "t-1", "t"];
  const MODELS = [
    { key: "qwen3_vl_8b", name: "Qwen3-VL-8B (zero-shot)", color: "var(--m-qwen)" },
    { key: "sft", name: "SFT baseline", color: "var(--m-sft)" },
    { key: "hazard_reasoner", name: "Hazard-Reasoner (ours)", color: "var(--m-hr)" },
  ];
  const CASE_TABS = {
    case1: "Hazard detection",
    case2: "Reasoning quality",
    case3: "Severity judgment",
    case4: "Failure cases",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sevBadge = (s) => (s ? `<span class="sev sev-${esc(s)}">${esc(s)}</span>` : "");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ player
   * 4-frame player: cross-fades t-3 … t, loops, pauses when off-screen. */
  const players = new Set();
  function createPlayer(container, { overlay = "" } = {}) {
    container.innerHTML = "";
    const root = el("div", { class: "player" });
    const imgs = T_LABELS.map((t, i) => {
      const img = el("img", { alt: `frame ${t}`, decoding: "async" });
      root.appendChild(img);
      return img;
    });
    const ov = el("div", { class: "player-overlay" }, overlay);
    const bar = el("div", { class: "player-bar" });
    const btn = el("button", { type: "button", "aria-label": "Pause" });
    const ticks = el("div", { class: "ticks" });
    const tickBtns = T_LABELS.map((t, i) => {
      const b = el("button", { class: "tick", type: "button", "aria-label": `Show frame ${t}` }, t);
      b.addEventListener("click", () => { pause(); show(i); });
      ticks.appendChild(b);
      return b;
    });
    bar.append(btn, ticks);
    root.append(ov, bar);
    container.appendChild(root);

    const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2v12l10-6z"/></svg>';
    const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>';
    let idx = 0, timer = null, playing = !reduceMotion, visible = true;

    function show(i) {
      idx = i;
      imgs.forEach((im, j) => im.classList.toggle("on", j === i));
      tickBtns.forEach((b, j) => b.classList.toggle("on", j === i));
    }
    function tick() { show((idx + 1) % 4); }
    function sync() {
      clearInterval(timer);
      timer = playing && visible ? setInterval(tick, idx === 3 ? 900 : 650) : null;
      btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    function pause() { playing = false; sync(); }
    btn.addEventListener("click", () => { playing = !playing; sync(); });

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });
    io.observe(root);

    const api = {
      load(frames, overlayHtml) {
        frames.forEach((src, i) => { imgs[i].src = src; });
        if (overlayHtml !== undefined) ov.innerHTML = overlayHtml;
        show(reduceMotion ? 3 : 0);
        sync();
      },
    };
    players.add(api);
    return api;
  }

  const fmt = (n) => n.toLocaleString("en-US");

  /* ------------------------------------------------------------------ stats */
  async function initStats() {
    const s = await (await fetch("static/data/stats.json")).json();
    $("#split-train").textContent = fmt(s.splits.train);
    $("#split-val").textContent = fmt(s.splits.val);
    $("#split-test").textContent = fmt(s.splits.test);

    $("#sev-legend").innerHTML = SEV_ORDER
      .map((v) => `<span><i style="background:var(--sev-${v})"></i>${v}</span>`).join("");

    const chart = $("#dist-chart");
    const order = [...s.hazard_order].sort((a, b) => s.hazard_total[b] - s.hazard_total[a]);
    const max = s.hazard_total[order[0]];
    for (const h of order) {
      const total = s.hazard_total[h];
      const bar = el("div", { class: "bar" });
      bar.style.width = `${(100 * total) / max}%`;
      for (const v of SEV_ORDER) {
        const n = s.crosstab[`${h}|${v}`] || 0;
        if (!n) continue;
        const seg = el("span", { title: `${h} · ${v}: ${fmt(n)}` });
        seg.style.width = `${(100 * n) / total}%`;
        seg.style.background = `var(--sev-${v})`;
        bar.appendChild(seg);
      }
      const track = el("div");
      track.appendChild(bar);
      chart.append(el("div", { class: "lbl" }, esc(h)), track, el("div", { class: "num" }, fmt(total)));
    }
  }

  /* ------------------------------------------------------------------ samples */
  function annoHtml(gt) {
    return `
      <div class="anno">
        <div class="anno-block"><div class="anno-k">Environment perception</div><p>${esc(gt.environment_perception)}</p></div>
        <div class="anno-block"><div class="anno-k">Hazard reasoning</div><p>${esc(gt.hazard_reasoning)}</p></div>
        <div class="anno-block anno-answer">
          <div class="anno-k">Answer</div>
          <div class="answer-line"><code>${esc(gt.hazard_type)}</code>${sevBadge(gt.severity_level)}</div>
          <div class="answer-warn">${esc(gt.warning_content)}</div>
        </div>
      </div>`;
  }

  async function initSamples() {
    const samples = await (await fetch("static/data/samples.json")).json();
    const chips = $("#sample-chips");
    const view = $("#sample-view");
    const left = el("div");
    const right = el("div");
    view.append(left, right);
    const player = createPlayer(left);

    const select = (i) => {
      const s = samples[i];
      [...chips.children].forEach((c, j) => c.classList.toggle("on", j === i));
      player.load(s.frames);
      right.innerHTML = annoHtml(s.gt);
    };
    samples.forEach((s, i) => {
      const c = el("button", { class: "chip", type: "button" }, esc(s.gt.hazard_type));
      c.addEventListener("click", () => select(i));
      chips.appendChild(c);
    });
    select(0);
  }

  /* ------------------------------------------------------------------ demo */
  function modelCard(m, out, gt) {
    const typeOk = out.hazard_type === gt.hazard_type;
    const sevOk = out.severity_level === gt.severity_level;
    const mark = (ok) => (ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
    const card = el("div", { class: "mcard" });
    card.style.setProperty("--c", m.color);
    const empty = !out.hazard_type;
    card.innerHTML = `
      <div class="mcard-head">
        <span class="mcard-name">${m.name}</span>
        <span class="mcard-pred">
          ${empty ? '<span class="bad">no parsable answer</span>'
                  : `<code>${esc(out.hazard_type)}</code>${mark(typeOk)} ${sevBadge(out.severity_level)}${mark(sevOk)}`}
          ${out.truncated ? '<span class="trunc">output truncated</span>' : ""}
        </span>
      </div>
      ${out.warning_content ? `<div class="warnline"><em>warning</em>“${esc(out.warning_content)}”</div>` : ""}
      <details ${m.key === "hazard_reasoner" ? "open" : ""}>
        <summary>Reasoning</summary>
        <div class="body">
          ${out.environment_perception ? `<p><b>Perception.</b> ${esc(out.environment_perception)}</p>` : ""}
          ${out.hazard_reasoning ? `<p><b>Reasoning.</b> ${esc(out.hazard_reasoning)}</p>` : ""}
          ${!out.environment_perception && !out.hazard_reasoning ? "<p>(no reasoning produced)</p>" : ""}
        </div>
      </details>`;
    return card;
  }

  async function initDemo(teaserPlayer) {
    const data = await (await fetch("static/data/demos.json")).json();
    const tabs = $("#case-tabs");
    const thumbs = $("#demo-thumbs");
    const player = createPlayer($("#demo-player"));
    const gtBox = $("#demo-gt");
    const models = $("#demo-models");
    let current = null;

    function selectSample(s) {
      current = s;
      [...thumbs.children].forEach((t) => t.classList.toggle("on", t.dataset.id === s.id));
      player.load(s.frames);
      const gt = s.ground_truth;
      gtBox.innerHTML = `
        <div class="anno-k">Ground truth</div>
        <div class="answer-line"><code>${esc(gt.hazard_type)}</code>${sevBadge(gt.severity_level)}
          <span style="color:var(--ink-2)">“${esc(gt.warning_content)}”</span></div>
        <p>${esc(gt.hazard_reasoning)}</p>`;
      models.innerHTML = "";
      for (const m of MODELS) models.appendChild(modelCard(m, s[m.key], gt));
    }

    function selectCase(cid) {
      [...tabs.children].forEach((t) => {
        const on = t.dataset.case === cid;
        t.classList.toggle("on", on);
        t.setAttribute("aria-selected", on);
      });
      $("#case-desc").textContent = data.cases[cid].description;
      thumbs.innerHTML = "";
      const list = data.samples.filter((s) => s.case === cid);
      for (const s of list) {
        const b = el("button", { class: "thumb", type: "button", "data-id": s.id,
                                 "aria-label": `${s.ground_truth.hazard_type}, ${s.ground_truth.severity_level}` });
        b.innerHTML = `<img src="${s.frames[3]}" alt="" loading="lazy"><span>${esc(s.ground_truth.hazard_type)}</span>`;
        b.addEventListener("click", () => selectSample(s));
        thumbs.appendChild(b);
      }
      selectSample(list[0]);
    }

    for (const cid of Object.keys(data.cases)) {
      const n = data.samples.filter((s) => s.case === cid).length;
      const t = el("button", { class: "tab", type: "button", role: "tab", "data-case": cid },
                   `${CASE_TABS[cid] || cid}<small>${n}</small>`);
      t.addEventListener("click", () => selectCase(cid));
      tabs.appendChild(t);
    }
    selectCase(Object.keys(data.cases)[0]);

    // Teaser: a HIGH-severity case where Hazard-Reasoner is right on both fields.
    const pick = data.samples.find((s) => s.case === "case3"
      && s.hazard_reasoner.hazard_type === s.ground_truth.hazard_type
      && s.hazard_reasoner.severity_level === "HIGH" && s.ground_truth.severity_level === "HIGH")
      || data.samples[0];
    const hr = pick.hazard_reasoner;
    teaserPlayer.load(pick.frames, `
      <span class="pill">Hazard-Reasoner</span>
      <span class="pill"><code style="background:none;padding:0">${esc(hr.hazard_type)}</code></span>
      ${sevBadge(hr.severity_level)}
      ${hr.warning_content ? `<span class="pill warn">“${esc(hr.warning_content)}”</span>` : ""}`);
  }

  /* ------------------------------------------------------------------ misc */
  function initLinks() {
    // Buttons whose target is not public yet are greyed out with a "soon" tag.
    document.querySelectorAll("[data-todo]").forEach((a) => {
      if (a.getAttribute("href") === "#") {
        a.classList.add("soon");
        a.addEventListener("click", (e) => e.preventDefault());
      }
    });
    $("#copy-bib").addEventListener("click", async (e) => {
      const txt = $("#bibtex").innerText;
      try {
        await navigator.clipboard.writeText(txt);
        e.target.textContent = "Copied";
      } catch {
        const r = document.createRange();
        r.selectNodeContents($("#bibtex"));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        e.target.textContent = "Selected";
      }
      setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
    });
  }

  initLinks();
  const teaser = createPlayer($("#teaser-player"));
  Promise.all([initStats(), initSamples(), initDemo(teaser)]).catch((err) => {
    console.error(err);
    if (location.protocol === "file:") {
      document.body.insertAdjacentHTML("afterbegin",
        '<p style="background:#fff3cd;padding:10px;text-align:center;margin:0">Open this page through a local server (e.g. <code>python -m http.server</code>); browsers block data loading from file://.</p>');
    }
  });
})();
