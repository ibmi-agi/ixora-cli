#!/usr/bin/env python3
"""Render a self-contained HTML report from a comprehension-eval results.json.

Usage:
    python3 render_report.py <results.json> [out.html]

The results.json schema (produced by run-eval.workflow.js, persisted by the
orchestrator) is:

{
  "meta": {
    "iteration": 1,
    "timestamp": "2026-06-01T12:00:00Z",   # stamped by the caller
    "skill": "build-ibmi-agent",
    "versions": ["baseline", "candidate"],
    "questionCount": 16,
    "model": "..."                          # optional, informational
  },
  "questions": [
    {"id": "...", "category": "in-scope|out-of-scope|ambiguity-probe",
     "question": "...", "rubric": "..."}
  ],
  "results": [
    {"questionId": "...", "version": "baseline|candidate",
     "answer": "...", "score": 0-3, "maxScore": 3, "passed": true,
     "evidence": "...",
     "flags": {"hallucinated": false, "recognizedOutOfScope": true,
               "citedCorrectReference": true}}
  ]
}

This script does no grading — it only aggregates and renders, so the same JSON
always renders the same report. Re-run the workflow -> new results.json -> diff.
"""
from __future__ import annotations

import html
import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Any


def _load(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    for key in ("meta", "questions", "results"):
        if key not in data:
            raise SystemExit(f"results.json missing required key: {key!r}")
    return data


def _index_results(results: list[dict]) -> dict[tuple[str, str], dict]:
    """(questionId, version) -> result row."""
    out: dict[tuple[str, str], dict] = {}
    for r in results:
        out[(r["questionId"], r["version"])] = r
    return out


def _norm(score: float, max_score: float) -> float:
    return (score / max_score) if max_score else 0.0


def _agg(rows: list[dict]) -> dict[str, Any]:
    if not rows:
        return {"n": 0, "score_pct": 0.0, "pass_rate": 0.0, "stddev": 0.0}
    norms = [_norm(r["score"], r.get("maxScore", 3)) for r in rows]
    passes = [1.0 if r.get("passed") else 0.0 for r in rows]
    return {
        "n": len(rows),
        "score_pct": round(mean(norms) * 100, 1),
        "pass_rate": round(mean(passes) * 100, 1),
        "stddev": round(pstdev(norms) * 100, 1) if len(norms) > 1 else 0.0,
    }


def _delta_class(delta: float) -> str:
    if delta > 0.5:
        return "up"
    if delta < -0.5:
        return "down"
    return "flat"


def _flag_chips(flags: dict[str, Any]) -> str:
    if not flags:
        return ""
    chips = []
    labels = {
        "hallucinated": "hallucinated",
        "recognizedOutOfScope": "recognized OOS",
        "citedCorrectReference": "cited ref",
    }
    for key, label in labels.items():
        if key in flags:
            val = flags[key]
            # hallucinated=true is bad; the others true is good
            cls = (
                "chip-bad"
                if (key == "hallucinated" and val)
                else ("chip-good" if val else "chip-muted")
            )
            mark = "yes" if val else "no"
            chips.append(f'<span class="chip {cls}">{label}: {mark}</span>')
    return " ".join(chips)


def _cell(r: dict | None) -> str:
    if r is None:
        return '<td class="score na">—</td>'
    score = r.get("score", 0)
    mx = r.get("maxScore", 3)
    pct = _norm(score, mx)
    tier = "s-hi" if pct >= 0.8 else ("s-mid" if pct >= 0.5 else "s-lo")
    ans = html.escape((r.get("answer") or "").strip())
    ev = html.escape((r.get("evidence") or "").strip())
    flags = _flag_chips(r.get("flags") or {})
    detail = (
        f'<details><summary>{score}/{mx}</summary>'
        f'<div class="detail">'
        f'<div class="lab">judge evidence</div><div class="ev">{ev or "—"}</div>'
        f'{("<div class=lab>flags</div><div>" + flags + "</div>") if flags else ""}'
        f'<div class="lab">agent answer</div><pre class="ans">{ans or "—"}</pre>'
        f"</div></details>"
    )
    return f'<td class="score {tier}">{detail}</td>'


CSS = """
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--muted:#8b949e;
--hi:#2ea043;--mid:#d29922;--lo:#f85149;--accent:#58a6ff;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px;}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;color:var(--accent)}
.sub{color:var(--muted);margin:0 0 24px;font-size:13px}
.cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:16px 20px;min-width:170px}
.card .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.card .v{font-size:26px;font-weight:600;margin-top:4px}
.card .d{font-size:13px;margin-top:2px}
.up{color:var(--hi)}.down{color:var(--lo)}.flat{color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--panel);
border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:8px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#1c2230;color:var(--muted);font-size:12px;text-transform:uppercase;
letter-spacing:.03em;position:sticky;top:0}
td.q{max-width:520px}
.qtext{font-weight:500}.rubric{color:var(--muted);font-size:12px;margin-top:4px}
.cat{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;
border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.cat.in-scope{color:#7ee787;border-color:#2ea04366}
.cat.out-of-scope{color:#ff9bce;border-color:#bc4b9966}
.cat.ambiguity-probe{color:#d2a8ff;border-color:#8957e566}
td.score{text-align:center;font-variant-numeric:tabular-nums;min-width:74px}
.s-hi summary{color:var(--hi)}.s-mid summary{color:var(--mid)}.s-lo summary{color:var(--lo)}
.score.na{color:var(--muted)}
td.dlt{text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
details summary{cursor:pointer;font-weight:600;font-size:15px;list-style:none}
details summary::-webkit-details-marker{display:none}
.detail{text-align:left;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);
font-weight:400;font-size:12px;width:360px}
.detail .lab{color:var(--muted);text-transform:uppercase;font-size:10px;
letter-spacing:.05em;margin-top:8px}
.ev{color:var(--fg)}
pre.ans{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);
border-radius:6px;padding:8px;max-height:260px;overflow:auto;font-size:11.5px}
.chip{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:20px;
border:1px solid var(--line);margin:2px 2px 0 0}
.chip-good{color:#7ee787;border-color:#2ea04366}
.chip-bad{color:#ff7b72;border-color:#f8514966}
.chip-muted{color:var(--muted)}
.legend{color:var(--muted);font-size:12px;margin-top:10px}
.catrow{margin-top:6px}
"""


def render(data: dict[str, Any]) -> str:
    meta = data["meta"]
    questions = data["questions"]
    idx = _index_results(data["results"])
    versions = meta.get("versions") or ["baseline", "candidate"]
    base_v, cand_v = (versions + versions)[:2]

    # by-version + by-category aggregates
    by_version: dict[str, list[dict]] = defaultdict(list)
    by_cat: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in data["results"]:
        by_version[r["version"]].append(r)
    for q in questions:
        for v in versions:
            r = idx.get((q["id"], v))
            if r:
                by_cat[(q["category"], v)].append(r)

    base_agg = _agg(by_version.get(base_v, []))
    cand_agg = _agg(by_version.get(cand_v, []))
    score_delta = round(cand_agg["score_pct"] - base_agg["score_pct"], 1)
    pass_delta = round(cand_agg["pass_rate"] - base_agg["pass_rate"], 1)

    # summary cards
    cards = [
        ("Overall score · " + base_v, f'{base_agg["score_pct"]}%', "", "flat"),
        ("Overall score · " + cand_v, f'{cand_agg["score_pct"]}%',
         f'{"+" if score_delta >= 0 else ""}{score_delta} pts',
         _delta_class(score_delta)),
        ("Pass rate · " + base_v, f'{base_agg["pass_rate"]}%', "", "flat"),
        ("Pass rate · " + cand_v, f'{cand_agg["pass_rate"]}%',
         f'{"+" if pass_delta >= 0 else ""}{pass_delta} pts',
         _delta_class(pass_delta)),
    ]
    card_html = "".join(
        f'<div class="card"><div class="k">{html.escape(k)}</div>'
        f'<div class="v">{v}</div>'
        f'<div class="d {cls}">{html.escape(d)}</div></div>'
        for k, v, d, cls in cards
    )

    # per-category breakdown
    cats = sorted({q["category"] for q in questions})
    cat_rows = ""
    for c in cats:
        b = _agg(by_cat.get((c, base_v), []))
        cd = _agg(by_cat.get((c, cand_v), []))
        d = round(cd["score_pct"] - b["score_pct"], 1)
        cat_rows += (
            f'<tr><td><span class="cat {c}">{c}</span> '
            f'<span class="rubric">({b["n"]} q)</span></td>'
            f'<td class="score">{b["score_pct"]}%</td>'
            f'<td class="score">{cd["score_pct"]}%</td>'
            f'<td class="dlt {_delta_class(d)}">{"+" if d >= 0 else ""}{d}</td></tr>'
        )

    # per-question rows
    q_rows = ""
    for q in questions:
        rb = idx.get((q["id"], base_v))
        rc = idx.get((q["id"], cand_v))
        bn = _norm(rb["score"], rb.get("maxScore", 3)) if rb else 0
        cn = _norm(rc["score"], rc.get("maxScore", 3)) if rc else 0
        d = round((cn - bn) * 3, 2)  # delta on the 0-3 scale
        q_rows += (
            f"<tr>"
            f'<td class="q"><div class="qtext">{html.escape(q["question"])}</div>'
            f'<div class="catrow"><span class="cat {q["category"]}">{q["category"]}</span></div>'
            f'<div class="rubric">rubric: {html.escape(q.get("rubric", ""))}</div></td>'
            f"{_cell(rb)}{_cell(rc)}"
            f'<td class="dlt {_delta_class(d)}">{"+" if d >= 0 else ""}{d}</td>'
            f"</tr>"
        )

    title = f'{meta.get("skill", "skill")} · comprehension eval · iteration {meta.get("iteration", "?")}'
    subt = (
        f'{meta.get("timestamp", "")} · {meta.get("questionCount", len(questions))} questions '
        f'· {base_v} vs {cand_v}'
        + (f' · model {meta["model"]}' if meta.get("model") else "")
    )

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>{CSS}</style></head>
<body>
<h1>{html.escape(title)}</h1>
<p class="sub">{html.escape(subt)}</p>
<div class="cards">{card_html}</div>
<p class="legend">Score = mean of per-question normalized judge scores (0&ndash;3). A
question "passes" when the judge marks it passed. Click a score to expand the judge's
evidence and the agent's full answer. Delta = candidate &minus; baseline.</p>

<h2>By category</h2>
<table><thead><tr><th>Category</th><th>{html.escape(base_v)}</th>
<th>{html.escape(cand_v)}</th><th>&Delta;</th></tr></thead>
<tbody>{cat_rows}</tbody></table>

<h2>Per question</h2>
<table><thead><tr><th>Question</th><th>{html.escape(base_v)}</th>
<th>{html.escape(cand_v)}</th><th>&Delta;</th></tr></thead>
<tbody>{q_rows}</tbody></table>
</body></html>"""


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1]).expanduser()
    out = Path(sys.argv[2]).expanduser() if len(sys.argv) > 2 else src.with_suffix(".html")
    data = _load(src)
    out.write_text(render(data))
    agg_b = _agg([r for r in data["results"] if r["version"] == data["meta"]["versions"][0]])
    agg_c = _agg([r for r in data["results"] if r["version"] == data["meta"]["versions"][-1]])
    print(json.dumps({
        "ok": True,
        "report": str(out),
        "baseline_score_pct": agg_b["score_pct"],
        "candidate_score_pct": agg_c["score_pct"],
        "delta_pts": round(agg_c["score_pct"] - agg_b["score_pct"], 1),
    }, indent=2))


if __name__ == "__main__":
    main()
