import { ArrowRight, Circle, CreditCard, Gauge, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";

const quickActions = [
  { title: "Find a fraud signal", subtitle: "Search transactions", icon: CreditCard },
  { title: "Risk review", subtitle: "Assess flagged events", icon: ShieldCheck },
  { title: "Model health", subtitle: "Track coverage", icon: Gauge },
  { title: "AI guidance", subtitle: "Get decision support", icon: Sparkles },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1460px]">
      <section className="hero-glow rounded-[30px] border border-white/10 bg-[#0a1017]/90 p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.08),0_25px_80px_rgba(2,6,23,0.85)] md:p-8 xl:p-10">
        <div className="mb-8 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
              <ShieldCheck size={16} className="text-sky-300" />
            </span>
            <span>Fraud Sentinel</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            workspace ready
          </div>
        </div>

        <div className="grid items-center gap-10 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.28em] text-slate-400">
              Real-time fraud intelligence
            </p>
            <h1 className="max-w-[700px] text-5xl font-medium leading-[0.9] tracking-[-0.07em] text-white md:text-7xl">
              Fraud intelligence,<br />
              built for trust.
            </h1>

            <p className="mt-6 max-w-[620px] text-lg leading-8 text-slate-300">
              Detect suspicious payment behavior, monitor model performance, and act on risk decisions
              with a single fraud operations cockpit built for modern teams.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white text-sm font-medium text-slate-900 px-5 py-3 shadow-lg shadow-slate-950/20 hover:bg-slate-100">
                Analyze transactions
                <ArrowRight size={16} />
              </button>
              <button className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10">
                View model status
              </button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Real-time scoring</span>
              <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-400" /> Drift monitoring</span>
              <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet-400" /> Model governance</span>
            </div>
          </div>

          <div className="relative flex min-h-[360px] items-center justify-center">
            <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] shadow-[inset_0_0_55px_rgba(148,163,184,0.08)]">
              <div className="absolute inset-5 rounded-full border border-dashed border-sky-300/20" />
              <div className="relative flex h-32 w-32 items-center justify-center rounded-[2rem] border border-white/15 bg-[#f7f7f7] text-slate-900 shadow-[0_0_60px_rgba(255,255,255,0.16)]">
                <ShieldCheck size={54} strokeWidth={1.5} />
              </div>
              <div className="absolute -bottom-5 rounded-full border border-white/10 bg-[#101a25] px-5 py-2 text-[10px] font-medium uppercase tracking-[0.24em] text-slate-300 shadow-xl">
                Fraud Sentinel
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
              Your mission
            </p>
            <h2 className="text-3xl font-medium tracking-[-0.05em] text-white">What would you like to explore today?</h2>
          </div>
          <button className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-300 md:inline-flex">
            See all capabilities <ArrowRight size={14} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map(({ title, subtitle, icon: Icon }) => (
            <div key={title} className="rounded-[22px] border border-white/10 bg-white/3 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] hover:bg-white/[0.04]">
              <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-100">
                <Icon size={18} />
              </div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                Discover
              </div>
              <h3 className="text-2xl font-medium tracking-[-0.04em] text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="rounded-[24px] border border-white/10 bg-[#0a1017]/90 p-5">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-emerald-300">
            <Circle size={8} fill="currentColor" className="text-emerald-300" /> model health
          </div>
          <div className="text-3xl font-semibold tracking-[-0.06em] text-white">98.6%</div>
          <p className="mt-2 text-sm text-slate-400">Production model accuracy remains above target across the latest transaction window.</p>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[#0a1017]/90 p-5">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-sky-300">
            <TrendingUp size={12} /> anomaly detection
          </div>
          <div className="text-3xl font-semibold tracking-[-0.06em] text-white">4.8x</div>
          <p className="mt-2 text-sm text-slate-400">Faster detection compared to manual review workflows and delayed analyst escalation.</p>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[#0a1017]/90 p-5">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-violet-300">
            <Zap size={12} /> workflow coverage
          </div>
          <div className="text-3xl font-semibold tracking-[-0.06em] text-white">24/7</div>
          <p className="mt-2 text-sm text-slate-400">Always-on detection and monitoring support for continuous payment stream protection.</p>
        </div>
      </section>
    </div>
  );
}

type TransactionRow = {
  id: string;
  prediction: string;
  riskLevel: string;
  amount: number;
  merchantName: string;
  merchantCategory?: string;
  customerId?: string;
  paymentMethod?: string;
  timestamp: string;
};

export function TransactionTable({
  rows,
  onSelect,
}: {
  rows: TransactionRow[];
  onSelect: (id: string) => void;
}) {
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs text-slate-700">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Transaction</th>
            <th className="px-5 py-3 font-medium">Customer</th>
            <th className="px-5 py-3 font-medium">Merchant</th>
            <th className="px-5 py-3 font-medium">Amount</th>
            <th className="px-5 py-3 font-medium">Risk</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                No transactions match the current filter.
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
              >
                <td className="px-5 py-3 align-middle">
                  <div className="font-medium text-slate-800">{row.id}</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400">
                    {new Date(row.timestamp).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-5 py-3 align-middle">
                  <div className="font-medium text-slate-700">{row.customerId ?? "—"}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{row.paymentMethod ?? "Card"}</div>
                </td>
                <td className="px-5 py-3 align-middle">
                  <div className="font-medium text-slate-700">{row.merchantName}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{row.merchantCategory ?? "General"}</div>
                </td>
                <td className="px-5 py-3 align-middle font-medium text-slate-800">
                  {money(row.amount)}
                </td>
                <td className="px-5 py-3 align-middle">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      row.riskLevel === "HIGH"
                        ? "bg-rose-50 text-rose-700"
                        : row.riskLevel === "MEDIUM"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.riskLevel}
                  </span>
                </td>
                <td className="px-5 py-3 align-middle">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      row.prediction === "FRAUD"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.prediction}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
