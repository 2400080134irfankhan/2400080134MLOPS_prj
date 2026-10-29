import { AlertTriangle, CheckCircle2, CircleHelp, Info, ShieldAlert } from "lucide-react";

export type EvidenceTone = "positive" | "warning" | "danger" | "neutral";

export function VerdictBanner({ verdict, title, description, tone = "warning" }: { verdict: string; title: string; description: string; tone?: EvidenceTone }) {
  const styles = {
    positive: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    danger: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    neutral: "border-blue-400/20 bg-blue-400/10 text-blue-200",
  }[tone];
  return <div className={`rounded-xl border p-4 ${styles}`}><div className="flex items-start gap-3"><ShieldAlert size={20} className="mt-0.5 shrink-0" /><div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">{verdict}</div><h3 className="mt-1 text-lg font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 opacity-80">{description}</p></div></div></div>;
}

export function RiskScoreCard({ score, label = "Rule-based risk estimate" }: { score: number | null; label?: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Risk score</span><span className="text-[10px] text-slate-500">{score === null ? "Unavailable" : `${score}/100`}</span></div>{score === null ? <p className="mt-3 text-xs text-slate-400">Insufficient verification data to calculate a meaningful score.</p> : <><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${score >= 70 ? "bg-rose-400" : score >= 30 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${score}%` }} /></div><p className="mt-2 text-[10px] text-slate-500">{label} — not a calibrated probability.</p></>}</div>;
}

export function EvidenceList({ items, title = "Evidence observed" }: { items: Array<{ label: string; detail: string; tone: EvidenceTone }>; title?: string }) {
  return <section className="mt-5"><h4 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h4><div className="space-y-2">{items.map(item => <div key={`${item.label}-${item.detail}`} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">{item.tone === "positive" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : item.tone === "danger" ? <ShieldAlert size={15} className="mt-0.5 shrink-0 text-rose-400" /> : item.tone === "warning" ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" /> : <CircleHelp size={15} className="mt-0.5 shrink-0 text-slate-400" />}<div><div className="text-xs font-medium text-slate-200">{item.label}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{item.detail}</div></div></div>)}</div></section>;
}

export function RecommendationPanel({ title = "Recommended action", children }: { title?: string; children: React.ReactNode }) {
  return <div className="mt-5 rounded-lg border border-blue-400/20 bg-blue-400/[0.06] p-4"><div className="flex gap-2 text-xs font-semibold text-blue-200"><Info size={15} />{title}</div><p className="mt-2 text-xs leading-5 text-slate-300">{children}</p></div>;
}
