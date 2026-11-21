"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LiveNumber, useBump } from "@/components/live-number";
import type { PaneData, PathStage, RefiningPath } from "@/lib/pipeline/path";
import "./pipeline-hero.css";

/** Ring widths as a percentage of the square stage. One source of truth for the geometry. */
const RING_DIAMETER: Record<number, number> = { 1: 88, 2: 70, 3: 54, 4: 39 };
/** The dot ripens from grey at the rim to green at the core. */
const RING_TINT: Record<number, { body: string; tint: string }> = {
  1: { body: "#cfcecb", tint: "207, 206, 203" },
  2: { body: "#b6c4c1", tint: "182, 196, 193" },
  3: { body: "#4fb8ae", tint: "79, 184, 174" },
  4: { body: "#00b271", tint: "0, 178, 113" },
};
const REFRESH_MS = 5000;
const ordinal = (n: number) => String(n).padStart(2, "0");

/** One hairline ring. It pings softly when its count changes. */
function Ring({ stage, active }: { stage: PathStage; active: boolean }) {
  const bumps = useBump(stage.count);
  const d = RING_DIAMETER[stage.ringIndex ?? 1];
  return (
    <>
      <div className={`ph-ring ph-ring-${stage.ringIndex} ${active ? "ph-ring-active" : ""}`} style={{ "--d": `${d}cqw` } as React.CSSProperties}>
        {bumps > 0 && <span key={bumps} className="ph-ring-ping" />}
      </div>
      <span className={`ph-tick ${active ? "ph-tick-active" : ""}`} style={{ "--inset": `${(100 - d) / 2}cqw` } as React.CSSProperties} aria-hidden="true">
        {ordinal(stage.ringIndex ?? 0)}
      </span>
    </>
  );
}

/** The dot that rides the selected ring. A new key restarts it at twelve o'clock on the new ring. */
function OrbitDot({ stage }: { stage: PathStage | null }) {
  if (!stage || stage.kind !== "ring" || !stage.ringIndex) return null;
  const tint = RING_TINT[stage.ringIndex];
  return <span key={stage.id} className="ph-orbit" aria-hidden="true" style={{ "--r": `${RING_DIAMETER[stage.ringIndex] / 2}cqw`, "--body": tint.body, "--tint": tint.tint } as React.CSSProperties} />;
}

/** One row in the state list. Flashes when its count changes. */
function StateRow({ stage, index, onPick }: { stage: PathStage; index: number; onPick: () => void }) {
  const bumps = useBump(stage.count);
  const tint = stage.ringIndex ? RING_TINT[stage.ringIndex].body : "#00b271";
  return (
    <li>
      <button type="button" onClick={onPick} className={`ph-row ${stage.kind === "core" ? "ph-row-core" : ""}`}>
        {bumps > 0 && <span key={bumps} className="ph-row-flash" aria-hidden="true" />}
        <span className="ph-row-n">{ordinal(index + 1)}</span>
        <span className="ph-row-dot" style={{ background: tint }} aria-hidden="true" />
        <span className="ph-row-text">
          <span className="ph-row-name">{stage.name}</span>
          <span className="ph-row-sub">{stage.sub}</span>
        </span>
        <LiveNumber value={stage.count} className="ph-row-count" />
        <svg aria-hidden="true" width="8" height="12" viewBox="0 0 8 12" className="ph-row-chev"><path d="m1.5 1.5 4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </li>
  );
}

/** One side of a stage's example. */
function Pane({ pane }: { pane: PaneData }) {
  return (
    <div className="ph-pane">
      <div className="ph-pane-label">{pane.label}</div>
      <div className="ph-pane-caption">{pane.caption}</div>
      {pane.kind === "code" ? (
        <pre className="ph-code" tabIndex={0}>{pane.text || "(empty)"}</pre>
      ) : (
        <dl className="ph-list">
          {pane.items?.map((it, i) => (
            <div key={i}>
              <dt>{it.label}</dt>
              <dd>{it.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** A single state in full: what it does, and one real article's input and output. */
function StageDetail({ stage, index, next, onBack, onNext }: { stage: PathStage; index: number; next: PathStage | null; onBack: () => void; onNext: () => void }) {
  return (
    <div className="ph-detail">
      <div className="ph-detail-nav">
        <button type="button" onClick={onBack} className="ph-link">‹ All states</button>
        {next && <button type="button" onClick={onNext} className="ph-link">Next · {next.name} ›</button>}
      </div>
      <div className="ph-kicker">{ordinal(index + 1)} · {stage.sub}</div>
      <h2 className="ph-title">{stage.name}</h2>
      <p className="ph-count-line"><LiveNumber value={stage.count} /> {stage.count === 1 ? "article" : "articles"} in this state</p>
      <p className="ph-desc">{stage.desc}</p>
      {stage.example ? (
        <div className="ph-panes">
          <Pane pane={stage.example.in} />
          <Pane pane={stage.example.out} />
        </div>
      ) : (
        <p className="ph-empty">{stage.emptyMessage}</p>
      )}
    </div>
  );
}

/**
 * The refining path as concentric rings narrowing to an AI-ready core.
 * At rest it lists the five states. Pick one and the rings narrow, and its real input and output appear.
 * While the worker is busy, the page refreshes itself and every changed number animates.
 */
export function PipelineHero({ data }: { data: RefiningPath }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ring = data.stages.filter((s) => s.kind === "ring");
  const core = data.stages.find((s) => s.kind === "core");
  const path = core ? [...ring, core] : ring;
  const focusedIndex = path.findIndex((s) => s.id === selectedId);
  const focused = focusedIndex >= 0 ? path[focusedIndex] : null;
  const coreBumps = useBump(core?.count ?? 0);
  const articleBumps = useBump(data.selectedArticleId);

  useEffect(() => {
    if (!data.live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [data.live, router]);

  const track = [
    { label: "Rim", value: data.scoreTrack.raw, tone: "raw" },
    { label: "Ring 02", value: data.scoreTrack.converted, tone: "mid" },
    { label: "Core", value: data.scoreTrack.enriched, tone: "final" },
  ];

  return (
    <section className="ph-hero" aria-label="Refining path">
      <div className="ph-controls">
        {data.articles.length > 0 && (
          <label className="ph-select">
            <span className="ph-mini">KB article</span>
            <select value={data.selectedArticleId} onChange={(e) => router.replace(`/pipeline?article=${encodeURIComponent(e.target.value)}`)}>
              {data.articles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </label>
        )}
        <div className="ph-pill">
          <span className="ph-mini">On the path</span>
          <LiveNumber value={data.stats.onPath} className="ph-pill-value" />
        </div>
      </div>

      <div className="ph-row-layout">
        <div className={`ph-source ${focused ? "ph-source-hidden" : ""}`} aria-hidden={focused ? true : undefined}>
          <svg aria-hidden="true" width="86" height="56" viewBox="0 0 86 56" className="ph-doc"><rect x="10" y="6" width="68" height="44" rx="4" fill="#f3f2ef" /><rect x="4" y="2" width="68" height="44" rx="4" fill="#fff" stroke="#e3e2df" /><path d="M14 14h30M14 22h48M14 30h40" stroke="#d6d5d1" strokeWidth="3" strokeLinecap="round" /></svg>
          <div className="ph-mini">Source</div>
          <div className="ph-source-name">Original KB</div>
          <p className="ph-source-desc">Authored content, written for people</p>
          <div className="ph-source-count"><LiveNumber value={data.sourceCount.toLocaleString()} /> <span>articles</span></div>
        </div>

        <div className={`ph-zone ${focused ? "ph-zone-compact" : ""}`}>
          <div className="ph-stage">
            <div className="ph-bloom" />
            {ring.map((s) => <Ring key={s.id} stage={s} active={selectedId === s.id} />)}
            <div className="ph-aura" />
            <div className={`ph-core ${selectedId === core?.id ? "ph-core-active" : ""}`}>
              {coreBumps > 0 && <span key={coreBumps} className="ph-core-ping" aria-hidden="true" />}
              <span className="ph-core-label">AI-ready KB</span>
              <LiveNumber value={core?.count ?? 0} className="ph-core-num" />
              <span className="ph-core-unit">articles</span>
            </div>
            <OrbitDot stage={focused} />
          </div>
        </div>

        <div className="ph-side">
          <div key={focused ? focused.id : `all-${articleBumps}`} className="ph-side-body">
            {focused ? (
              <StageDetail stage={focused} index={focusedIndex} next={path[focusedIndex + 1] ?? null} onBack={() => setSelectedId(null)} onNext={() => setSelectedId(path[focusedIndex + 1].id)} />
            ) : (
              <>
                <ol className="ph-rows" aria-label="Refining states">
                  {path.map((s, i) => <StateRow key={s.id} stage={s} index={i} onPick={() => setSelectedId(s.id)} />)}
                </ol>
                <ul className="ph-exits" aria-label="Left the path">
                  {data.exits.map((e) => (
                    <li key={e.id}><span>{e.name}</span><LiveNumber value={e.count} /></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ph-track">
        {track.map((t, i) => (
          <span key={t.label} className="ph-track-step">
            {i > 0 && <span className="ph-track-arrow" aria-hidden="true">→</span>}
            <span className="ph-mini">{t.label}</span>
            <LiveNumber value={t.value ?? "–"} className={`ph-track-value ph-track-${t.tone}`} />
          </span>
        ))}
        <span className="ph-track-note">One mechanical score, computed the same way at every stage, so the progression compares like with like.</span>
      </div>
    </section>
  );
}
