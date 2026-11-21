"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LiveNumber, useBump } from "@/components/live-number";
import type { PaneData, PathStage, RefiningPath, StepState } from "@/lib/pipeline/path";
import "./pipeline-hero.css";

/** Ring widths as a percentage of the square stage. One source of truth for the geometry. */
const RING_DIAMETER: Record<number, number> = { 1: 88, 2: 70, 3: 54, 4: 39 };
/** One color per stage, the same ones the pipeline view uses: slate, sky, violet, amber. The core is green. */
const RING_TINT: Record<number, { body: string; tint: string }> = {
  1: { body: "#64748b", tint: "100, 116, 139" },
  2: { body: "#0ea5e9", tint: "14, 165, 233" },
  3: { body: "#8b5cf6", tint: "139, 92, 246" },
  4: { body: "#f59e0b", tint: "245, 158, 11" },
};
const REFRESH_MS = 5000;
/** The arc is drawn at this radius in a 0 to 100 box, so its length is fixed and the offset is the unfilled part. */
const ARC_RADIUS = 46;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;
const ordinal = (n: number) => String(n).padStart(2, "0");
const STEP_LABEL: Record<StepState, string> = { done: "Done", active: "In progress", queued: "Queued", failed: "Failed", skipped: "Not needed", waiting: "Waiting" };
/** How much of a ring's arc one article fills. A step in progress is half full. */
const STEP_FILL: Record<StepState, number> = { done: 1, active: 0.5, queued: 0.12, failed: 0.5, skipped: 0, waiting: 0 };

const EXIT_COLOR: Record<string, string> = { no_gaps: "#94a3b8", failed: "#be0003" };
const CORE_GREEN = { body: "#00b271", rgb: "0, 178, 113" };

/**
 * One or more arcs on a ring, laid end to end from twelve o'clock, clockwise.
 * @param segments each a share of the whole (0 to 1) and a color
 */
function Arc({ segments }: { segments: { share: number; color: string }[] }) {
  let start = 0;
  return (
    <svg className="ph-arc" viewBox="0 0 100 100" aria-hidden="true">
      {segments.map((seg, i) => {
        const share = Math.max(0, Math.min(1, seg.share));
        const node = (
          <circle key={i} className="ph-arc-fill" cx="50" cy="50" r={ARC_RADIUS} style={{ stroke: seg.color, strokeDasharray: `${ARC_LENGTH * share} ${ARC_LENGTH}`, strokeDashoffset: -ARC_LENGTH * start }} />
        );
        start += share;
        return node;
      })}
    </svg>
  );
}

/** The ring around the core: AI-ready articles as a share of all refined ones. */
function CoreRing({ share }: { share: number }) {
  return (
    <div className="ph-ring" style={{ "--d": "33cqw", "--c-rgb": CORE_GREEN.rgb } as React.CSSProperties}>
      <Arc segments={[{ share, color: CORE_GREEN.body }]} />
    </div>
  );
}

/** The thin outer ring: articles that left the path early, split by how. */
function ExitRing({ exits }: { exits: RefiningPath["exits"] }) {
  return (
    <div className="ph-ring" style={{ "--d": "97cqw", "--c-rgb": "148, 163, 184" } as React.CSSProperties}>
      <Arc segments={exits.map((e) => ({ share: e.share, color: EXIT_COLOR[e.id] ?? "#94a3b8" }))} />
    </div>
  );
}

/** One hairline ring. Its arc is the stage's share of refined articles, and its tick shows the count. It pings softly when the count changes. */
function Ring({ stage, active, step }: { stage: PathStage; active: boolean; step?: StepState }) {
  const bumps = useBump(stage.count);
  const d = RING_DIAMETER[stage.ringIndex ?? 1];
  return (
    <>
      <div className={`ph-ring ph-ring-${stage.ringIndex} ${active ? "ph-ring-active" : ""}`} style={{ "--d": `${d}cqw`, "--c-rgb": RING_TINT[stage.ringIndex ?? 1].tint } as React.CSSProperties}>
        <Arc segments={[{ share: step ? STEP_FILL[step] : stage.progress, color: step === "failed" ? "#be0003" : RING_TINT[stage.ringIndex ?? 1].body }]} />
        {bumps > 0 && !step && <span key={bumps} className="ph-ring-ping" />}
      </div>
      <span className={`ph-tick ${active ? "ph-tick-active" : ""}`} style={{ "--inset": `${(100 - d) / 2}cqw`, "--c-rgb": RING_TINT[stage.ringIndex ?? 1].tint } as React.CSSProperties} aria-hidden="true">
        {ordinal(stage.ringIndex ?? 0)}
        {!step && <LiveNumber value={stage.count} className="ph-tick-count" />}
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
function StateRow({ stage, index, here, step, onPick }: { stage: PathStage; index: number; here: boolean; step?: StepState; onPick: () => void }) {
  const bumps = useBump(stage.count);
  const tint = stage.ringIndex ? RING_TINT[stage.ringIndex].body : "#00b271";
  return (
    <li>
      <button type="button" onClick={onPick} className={`ph-row ${stage.kind === "core" ? "ph-row-core" : ""} ${here ? "ph-row-here" : ""}`}>
        {bumps > 0 && !step && <span key={bumps} className="ph-row-flash" aria-hidden="true" />}
        <span className="ph-row-n">{ordinal(index + 1)}</span>
        <span className="ph-row-dot" style={{ background: tint }} aria-hidden="true" />
        <span className="ph-row-text">
          <span className="ph-row-name">{stage.name}{here && <span className="ph-here-tag">this article</span>}</span>
          <span className="ph-row-sub">{stage.sub}</span>
        </span>
        {step ? <LiveNumber value={STEP_LABEL[step]} className={`ph-step ph-step-${step}`} /> : <LiveNumber value={stage.count} className="ph-row-count" />}
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
function StageDetail({ stage, index, next, here, step, onBack, onNext }: { stage: PathStage; index: number; next: PathStage | null; here: boolean; step?: StepState; onBack: () => void; onNext: () => void }) {
  return (
    <div className="ph-detail">
      <div className="ph-detail-nav">
        <button type="button" onClick={onBack} className="ph-link">‹ All states</button>
        {next && <button type="button" onClick={onNext} className="ph-link">Next · {next.name} ›</button>}
      </div>
      <div className="ph-kicker">{ordinal(index + 1)} · {stage.sub}</div>
      <h2 className="ph-title">{stage.name}{here && <span className="ph-here-tag">this article is here</span>}</h2>
      {step ? (
        <p className="ph-count-line">This article: <LiveNumber value={STEP_LABEL[step]} className={`ph-step ph-step-${step}`} /></p>
      ) : (
        <p className="ph-count-line"><LiveNumber value={stage.count} /> {stage.count === 1 ? "article" : "articles"} in this state</p>
      )}
      <p className="ph-desc">{stage.desc}</p>
      {stage.example ? (
        <div className="ph-panes">
          <Pane pane={stage.example.in} />
          <Pane pane={stage.example.out} />
        </div>
      ) : (
        <p className="ph-empty">{step ? stage.emptyMessage : "Pick an article above to see its real input and output here."}</p>
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
  const here = data.here;
  const hereRing = ring.find((s) => s.id === here?.stage) ?? null;
  const hereStep = path.findIndex((s) => s.id === here?.stage);
  const steps = data.steps;
  const coreStep = steps?.ready;
  const coreWord = coreStep === "done" ? "AI-ready" : coreStep === "skipped" ? "No gaps" : coreStep === "failed" ? "Failed" : "Not yet";
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
            <select value={data.selectedArticleId} onChange={(e) => router.replace(e.target.value ? `/?article=${encodeURIComponent(e.target.value)}` : "/", { scroll: false })}>
              <option value="">All articles · counts</option>
              {data.articles.map((a) => <option key={a.id} value={a.id}>{a.title} · {a.label}</option>)}
            </select>
          </label>
        )}
        {here ? (
          <div className="ph-pill" aria-live="polite">
            <span className="ph-mini">This article{hereStep >= 0 ? ` · step ${hereStep + 1} of ${path.length}` : ""}</span>
            <LiveNumber value={here.label} className="ph-here-value" />
          </div>
        ) : (
          <div className="ph-pill">
            <span className="ph-mini">On the path</span>
            <LiveNumber value={data.stats.onPath} className="ph-pill-value" />
          </div>
        )}
      </div>

      <div className="ph-row-layout">
        <div className={`ph-source ${focused ? "ph-source-hidden" : ""} ${here?.stage === "source" ? "ph-source-here" : ""}`} aria-hidden={focused ? true : undefined}>
          <svg aria-hidden="true" width="86" height="56" viewBox="0 0 86 56" className="ph-doc"><rect x="10" y="6" width="68" height="44" rx="4" fill="#f3f2ef" /><rect x="4" y="2" width="68" height="44" rx="4" fill="#fff" stroke="#e3e2df" /><path d="M14 14h30M14 22h48M14 30h40" stroke="#d6d5d1" strokeWidth="3" strokeLinecap="round" /></svg>
          <div className="ph-mini">Source</div>
          <div className="ph-source-name">Original KB</div>
          <p className="ph-source-desc">Authored content, written for people</p>
          {data.article ? (
            <div className="ph-source-article">{data.article.title}</div>
          ) : (
            <>
              <div className="ph-source-count"><LiveNumber value={data.sourceCount.toLocaleString()} /> <span>articles</span></div>
              {data.notRefined > 0 && <p className="ph-source-waiting"><LiveNumber value={data.notRefined.toLocaleString()} /> not refined yet</p>}
            </>
          )}
        </div>

        <div className={`ph-zone ${focused ? "ph-zone-compact" : ""}`}>
          <div className="ph-stage">
            <div className="ph-bloom" />
            {!steps && <ExitRing exits={data.exits} />}
            {ring.map((s) => <Ring key={s.id} stage={s} active={selectedId === s.id} step={steps?.[s.id]} />)}
            <CoreRing share={steps ? STEP_FILL[coreStep ?? "waiting"] : core?.progress ?? 0} />
            <div className="ph-aura" />
            <div className={`ph-core ${selectedId === core?.id || (!focused && here?.stage === "ready") ? "ph-core-active" : ""}`}>
              {coreBumps > 0 && !steps && <span key={coreBumps} className="ph-core-ping" aria-hidden="true" />}
              {steps ? (
                <>
                  <span className="ph-core-label">This article</span>
                  <LiveNumber value={coreWord} className="ph-core-word" />
                  <span className="ph-core-unit">{coreStep === "done" || coreStep === "skipped" ? "published" : here?.label}</span>
                </>
              ) : (
                <>
                  <span className="ph-core-label">AI-ready KB</span>
                  <LiveNumber value={core?.count ?? 0} className="ph-core-num" />
                  <span className="ph-core-unit">articles</span>
                </>
              )}
            </div>
            <OrbitDot stage={focused ?? hereRing} />
          </div>
        </div>

        <div className="ph-side">
          <div key={focused ? focused.id : `all-${articleBumps}`} className="ph-side-body">
            {focused ? (
              <StageDetail stage={focused} index={focusedIndex} next={path[focusedIndex + 1] ?? null} here={here?.stage === focused.id} step={steps?.[focused.id]} onBack={() => setSelectedId(null)} onNext={() => setSelectedId(path[focusedIndex + 1].id)} />
            ) : (
              <>
                <ol className="ph-rows" aria-label="Refining states">
                  {path.map((s, i) => <StateRow key={s.id} stage={s} index={i} here={here?.stage === s.id} step={steps?.[s.id]} onPick={() => setSelectedId(s.id)} />)}
                </ol>
                <ul className="ph-exits" aria-label="Left the path">
                  {data.exits.filter((e) => !steps || here?.stage === e.id).map((e) => (
                    <li key={e.id} className={here?.stage === e.id ? "ph-exit-here" : undefined}>
                      <span className="ph-exit-dot" style={{ background: EXIT_COLOR[e.id] }} aria-hidden="true" />
                      <span>{e.name}</span>
                      {!steps && <LiveNumber value={e.count} />}
                      {here?.stage === e.id && <span className="ph-here-tag">this article</span>}
                    </li>
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
        <span className="ph-track-note">{steps ? "This article's mechanical score at each version." : "Average mechanical score at each version, across all articles."} One score, computed the same way every time, so the steps compare like with like.</span>
      </div>
    </section>
  );
}
