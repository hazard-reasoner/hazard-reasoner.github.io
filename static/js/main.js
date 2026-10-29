(() => {
  "use strict";

  const D = window.HR_DATA;
  const SEVS = ["NONE", "LOW", "MEDIUM", "HIGH"];
  const TIMES = [["t-3", "-1.5 s"], ["t-2", "-1.0 s"], ["t-1", "-0.5 s"], ["t", "0.0 s"]];
  const STEP_MS = 500;   // frames are 0.5 s apart in DRAMA-Reasoning
  const HOLD_MS = 1200;  // pause on frame t before looping
  const TABS = ["dataset", "download", "method", "demo"];
  const MODELS = [
    { key: "qwen3_vl_8b", name: "Qwen3-VL-8B", note: "zero-shot", color: "var(--m-qwen)" },
    { key: "sft", name: "SFT only", note: "", color: "var(--m-sft)" },
    { key: "hazard_reasoner", name: "Hazard-Reasoner", note: "SFT + GRPO", color: "var(--m-hr)", ours: true },
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");
  const chip = (s) => (s ? `<span class="sev" data-sev="${esc(s)}">${esc(s)}</span>` : "");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12l10-6z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>';

  /* ---------------------------------------------------------------- tabs (hash-routed) */
  function showTab(name, focus = false) {
    if (!TABS.includes(name)) name = "dataset";
    for (const t of TABS) {
      const on = t === name;
      $(`#${t}`).hidden = !on;
      const btn = $(`#tab-${t}`);
      btn.setAttribute("aria-selected", on);
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    }
  }
  function routeFromHash() {
    const id = location.hash.slice(1);
    if (TABS.includes(id)) return showTab(id);
    if (id === "citation") { showTab("download"); $("#citation").scrollIntoView(); return; }
    showTab("dataset");
  }
  $$(".tabs [role=tab]").forEach((b, i, all) => {
    b.addEventListener("click", () => { history.replaceState(null, "", `#${b.dataset.tab}`); showTab(b.dataset.tab); });
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const next = all[(i + d + all.length) % all.length];
      history.replaceState(null, "", `#${next.dataset.tab}`);
      showTab(next.dataset.tab, true);
    });
  });
  // in-page links to a tab (header buttons) switch the tab and bring it into view
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    if (!TABS.includes(id)) return;
    e.preventDefault();
    history.replaceState(null, "", `#${id}`);
    showTab(id);
    $(".tabbar").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }));
  addEventListener("hashchange", routeFromHash);

  /* ---------------------------------------------------------------- frame player */
  function Player(container) {
    const root = document.createElement("div");
    root.className = "player";
    root.innerHTML = `
      <div class="screen">${TIMES.map(() => '<img alt="" decoding="async">').join("")}<span class="frame-tag"></span></div>
      <div class="controls">
        <button class="play" type="button" aria-label="Pause">${ICON_PAUSE}</button>
        <div class="ticks">${TIMES.map(([t, s], i) =>
          `<button class="tick" type="button" data-i="${i}" aria-label="Show frame ${t}"><b>${t}</b>${s}</button>`).join("")}</div>
      </div>`;
    container.replaceChildren(root);
    const imgs = $$(".screen img", root);
    const tag = $(".frame-tag", root);
    const playBtn = $(".play", root);
    const ticks = $$(".tick", root);
    let idx = 0, timer = null, playing = !reduceMotion, visible = false;

    function show(i) {
      idx = i;
      imgs.forEach((im, j) => im.classList.toggle("on", j === i));
      ticks.forEach((b, j) => b.classList.toggle("on", j === i));
      tag.textContent = `${TIMES[i][0]} · ${TIMES[i][1]}`;
    }
    function schedule() {
      clearTimeout(timer);
      playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      if (!playing || !visible) return;
      timer = setTimeout(() => { show((idx + 1) % 4); schedule(); }, idx === 3 ? HOLD_MS : STEP_MS);
    }
    playBtn.addEventListener("click", () => { playing = !playing; schedule(); });
    ticks.forEach((b) => b.addEventListener("click", () => { playing = false; show(+b.dataset.i); schedule(); }));
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); }).observe(root);

    return {
      load(scene, alt) {
        scene.frames.forEach((src, i) => { imgs[i].src = src; imgs[i].alt = i === 3 ? alt : ""; });
        show(reduceMotion ? 3 : 0);
        schedule();
      },
    };
  }

  /* ---------------------------------------------------------------- tooltip for [data-tip] */
  const tip = $("#tooltip");
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener("pointermove", (e) => {
    if (tip.hidden) return;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  document.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });

  /* ---------------------------------------------------------------- dataset */
  function initDataset() {
    const st = D.stats;
    const n = (cls, s) => st.crosstab[`${cls}|${s}`] || 0;
    const pct = (a, b) => (100 * a / b).toFixed(1);

    $("#sev-legend").innerHTML = SEVS.map((s) => `<span><i style="background:var(--sev-${s})"></i>${s}</span>`).join("");
    $("#splitbar").innerHTML = [["train", "Train"], ["val", "Val"], ["test", "Test"]].map(([k, lbl]) =>
      `<div style="flex:${st.splits[k]}" data-tip="${lbl}: ${fmt(st.splits[k])} scenes (${pct(st.splits[k], st.total)}%)"><b>${lbl}</b>${fmt(st.splits[k])}</div>`).join("");

    const items = [...D.catalog].sort((a, b) => st.hazard_total[b.cls] - st.hazard_total[a.cls]);
    const player = Player($("#inspector-player"));
    const anno = $("#inspector-anno");
    const tiles = $("#tiles");

    function select(item, scroll) {
      $$(".tile", tiles).forEach((t) => t.setAttribute("aria-pressed", t.dataset.cls === item.cls));
      const g = item.gt;
      player.load(item, `Example ${item.cls} scene, frame t`);
      anno.innerHTML = `
        <div class="anno-head"><h3>${esc(item.cls)}</h3><span>${fmt(st.hazard_total[item.cls])} scenes · ${pct(st.hazard_total[item.cls], st.total)}%</span></div>
        <div class="field"><p class="field-k">Environment perception</p><p>${esc(g.environment_perception)}</p></div>
        <div class="field"><p class="field-k">Hazard reasoning</p><p>${esc(g.hazard_reasoning)}</p></div>
        <div class="field"><p class="field-k">Answer</p>
          <div class="answer-row"><code>${esc(g.hazard_type)}</code>${chip(g.severity_level)}</div>
          <p class="warn-text">“${esc(g.warning_content)}”</p></div>`;
      if (scroll) {
        // overview sits below the tiles: bring it up if it is not mostly on screen
        const r = $(".inspector").getBoundingClientRect();
        if (r.top < 100 || r.top > innerHeight * 0.55) $(".inspector").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
    }

    for (const item of items) {
      const total = st.hazard_total[item.cls];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.dataset.cls = item.cls;
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", `${item.cls}, ${fmt(total)} scenes`);
      b.innerHTML = `
        <img src="${item.anim}" alt="" width="400" height="250">
        <div class="tile-body">
          <span class="tile-name">${esc(item.cls)}</span>
          <span class="tile-count">${fmt(total)} · ${pct(total, st.total)}%</span>
          <div class="mix">${SEVS.filter((s) => n(item.cls, s)).map((s) =>
            `<span style="flex:${n(item.cls, s)};background:var(--sev-${s})" data-tip="${item.cls} · ${s}: ${fmt(n(item.cls, s))} (${pct(n(item.cls, s), total)}%)"></span>`).join("")}</div>
        </div>`;
      b.addEventListener("click", () => select(item, true));
      tiles.appendChild(b);
    }
    select(items.find((i) => i.cls === "crossing_pedestrian") || items[0], false);

    const order = Object.keys(st.hazard_total).sort((a, b) => st.hazard_total[b] - st.hazard_total[a]);
    $("#crosstab").innerHTML = `
      <thead><tr><th>Hazard type</th>${SEVS.map((s) => `<th class="r">${s}</th>`).join("")}<th class="r">Total</th></tr></thead>
      <tbody>${order.map((c) => `<tr><td><code>${esc(c)}</code></td>${SEVS.map((s) =>
        `<td class="r">${n(c, s) ? fmt(n(c, s)) : '<span class="na">-</span>'}</td>`).join("")}<td class="r">${fmt(st.hazard_total[c])}</td></tr>`).join("")}</tbody>`;
  }

  /* ---------------------------------------------------------------- demo */
  function gauge(pred, gt) {
    const p = SEVS.indexOf(pred), g = SEVS.indexOf(gt);
    let verdict = "";
    if (p >= 0 && g >= 0) {
      const d = p - g;
      verdict = d === 0 ? '<p class="verdict match">Severity matches the label</p>'
        : d < 0 ? `<p class="verdict under">Rated ${-d} level${d < -1 ? "s" : ""} too low</p>`
        : `<p class="verdict">Rated ${d} level${d > 1 ? "s" : ""} too high</p>`;
    }
    return `<div class="gauge" role="img" aria-label="Predicted severity ${esc(pred || "none")}, labeled ${esc(gt)}">
      <div class="gauge-track">${g >= 0 ? `<span class="gauge-mark" style="left:${g * 25}%">LABEL</span>` : ""}${SEVS.map((s, i) =>
        `<span class="seg ${p >= 0 && i <= p ? `f-${pred}` : ""}"></span>`).join("")}</div>
      <div class="gauge-scale">${SEVS.map((s) => `<span>${s === "MEDIUM" ? "MED" : s}</span>`).join("")}</div>
      ${verdict}</div>`;
  }

  function answerCard(m, out, gt) {
    const has = !!out.hazard_type;
    return `<article class="answer${m.ours ? " ours" : ""}" style="--c:${m.color}">
      <div class="answer-head">
        <span class="who"><i></i>${m.name}${m.note ? `<small>${m.note}</small>` : ""}</span>
        <span class="pred">${has
          ? `<code>${esc(out.hazard_type)}</code>${out.hazard_type === gt.hazard_type ? '<span class="ok" aria-label="correct hazard type">✓</span>' : '<span class="bad" aria-label="wrong hazard type">✗</span>'}`
          : '<span class="bad">no parsable answer</span>'}${out.truncated ? '<span class="trunc">output cut off</span>' : ""}</span>
      </div>
      ${out.warning_content ? `<p class="answer-warn">“${esc(out.warning_content)}”</p>` : ""}
      ${gauge(out.severity_level, gt.severity_level)}
      ${out.environment_perception || out.hazard_reasoning ? `<details${m.ours ? " open" : ""}><summary>Reasoning</summary>
        ${out.environment_perception ? `<p><b>Perception.</b> ${esc(out.environment_perception)}</p>` : ""}
        ${out.hazard_reasoning ? `<p><b>Reasoning.</b> ${esc(out.hazard_reasoning)}</p>` : ""}</details>` : ""}
    </article>`;
  }

  function initDemo() {
    const picker = $("#picker");
    const player = Player($("#arena-player"));
    const label = $("#arena-label");
    const answers = $("#arena-answers");

    function select(d) {
      $$(".shot", picker).forEach((s) => s.setAttribute("aria-pressed", s.dataset.id === d.id));
      const gt = d.ground_truth;
      player.load(d, `Test scene with ${gt.hazard_type}, frame t`);
      label.innerHTML = `
        <p class="field-k">Label</p>
        <div class="answer-row"><code>${esc(gt.hazard_type)}</code>${chip(gt.severity_level)}<span class="answer-warn">“${esc(gt.warning_content)}”</span></div>
        <p>${esc(gt.hazard_reasoning)}</p>
        ${d.note ? `<p class="case">${esc(d.note)}</p>` : ""}`;
      answers.innerHTML = MODELS.map((m) => answerCard(m, d[m.key], gt)).join("");
    }

    for (const cid of Object.keys(D.cases)) {
      const list = D.demos.filter((d) => d.case === cid);
      if (!list.length) continue;
      const g = document.createElement("div");
      g.className = `group${cid === "hard" ? " fail" : ""}`;
      g.innerHTML = `<p class="group-name">${esc(D.cases[cid].title)}</p><div class="pair"></div>`;
      for (const d of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "shot";
        b.dataset.id = d.id;
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-label", `${D.cases[cid].title}: ${d.ground_truth.hazard_type}, ${d.ground_truth.severity_level}`);
        b.innerHTML = `<img src="${d.anim}" alt="" loading="lazy" width="400" height="250">`;
        b.addEventListener("click", () => select(d));
        $(".pair", g).appendChild(b);
      }
      picker.appendChild(g);
    }
    select(D.demos.find((d) => d.default) || D.demos[0]);
  }

  /* ---------------------------------------------------------------- results: SFT -> SFT + GRPO */
  function initDumbbell() {
    const rows = [
      ["Hazard accuracy", 84.48, 90.33, true],
      ["Severity accuracy", 67.43, 84.81, true],
      ["HIGH-severity recall", 41.25, 72.50, true],
      ["HIGH rated too low", 53.75, 25.00, false],
      ["Missed hazards (FNR)", 3.80, 3.13, false],
    ];
    $("#dumbbell").innerHTML = `
      <div class="db-legend"><span><i style="background:var(--m-sft)"></i>SFT only</span><span><i style="background:var(--m-hr)"></i>SFT + GRPO (Hazard-Reasoner)</span></div>
      ${rows.map(([name, a, b, up]) => {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const val = (v, side, strong) => `<span class="db-val ${side}" style="left:${v}%;color:var(${strong ? "--ink" : "--ink-3"})">${v.toFixed(2)}</span>`;
        const labels = hi - lo < 8
          ? `<span class="db-val right" style="left:${hi}%"><span style="color:var(--ink-3)">${a.toFixed(2)}</span> → ${b.toFixed(2)}</span>`
          : b > a ? val(a, "left", false) + val(b, "right", true) : val(b, "left", true) + val(a, "right", false);
        return `<div class="db-row">
          <div class="db-name">${name}<small>${up ? "higher is better" : "lower is better"}</small></div>
          <div class="db-track">
            <span class="db-line${(up ? b > a : b < a) ? " good" : ""}" style="left:${lo}%;width:${hi - lo}%"></span>
            <span class="db-dot" style="left:${a}%;background:var(--m-sft)" data-tip="${name}, SFT only: ${a.toFixed(2)}%"></span>
            <span class="db-dot" style="left:${b}%;background:var(--m-hr)" data-tip="${name}, SFT + GRPO: ${b.toFixed(2)}%"></span>
            ${labels}
          </div></div>`;
      }).join("")}
      <div class="db-row axis"><div></div><div class="db-track">${[0, 25, 50, 75, 100].map((v) =>
        `<span class="db-tick" style="left:${v}%">${v}%</span>`).join("")}</div></div>`;
  }

  /* ---------------------------------------------------------------- misc */
  $$("[data-todo]").forEach((a) => {
    if (a.getAttribute("href") !== "#") return;
    a.classList.add("soon");
    a.setAttribute("aria-disabled", "true");
    a.addEventListener("click", (e) => e.preventDefault());
  });
  $("#copy-bib").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText($("#bibtex").innerText);
      e.target.textContent = "Copied";
    } catch {
      const r = document.createRange();
      r.selectNodeContents($("#bibtex"));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      e.target.textContent = "Selected";
    }
    setTimeout(() => { e.target.textContent = "Copy"; }, 1600);
  });

  initDataset();
  initDemo();
  initDumbbell();
  routeFromHash();
})();
