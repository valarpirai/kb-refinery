"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ScoreRow {
  stage: string;
  mechanical: number | null;
  model: number | null;
}

/** Grouped bars: the mechanical and model score at each content stage. */
export function ScoreChart({ rows }: { rows: ScoreRow[] }) {
  return (
    <div role="img" aria-label={`Scores by stage. ${rows.map((r) => `${r.stage}: mechanical ${r.mechanical ?? "none"}, model ${r.model ?? "none"}`).join("; ")}`} className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="stage" />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Legend />
          <Bar dataKey="mechanical" name="Mechanical" fill="#2563eb" />
          <Bar dataKey="model" name="Model" fill="#d97706" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
