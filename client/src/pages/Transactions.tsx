import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Globe2,
  Laptop,
  MapPin,
  Search,
  ShieldAlert,
  UserRound,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { SectionHeader } from "@/components/DashboardLayout";
import { TransactionTable } from "@/pages/Home";

const filters = [
  "ALL",
  "FRAUD",
  "LEGITIMATE",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;
const datasetNames = [
  "01_paysim_style",
  "02_credit_card_style",
  "03_ieee_cis_style",
] as const;
type DatasetName = (typeof datasetNames)[number];
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value
  );

export default function Transactions() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("ALL");
  const [page, setPage] = useState(1);
  const [predictionInput, setPredictionInput] = useState({
    amount: 240,
    paymentMethod: "Card",
    isNewDevice: false,
    isInternational: false,
    velocity1h: 2,
    failedAttempts: 0,
    datasetName: "01_paysim_style" as DatasetName,
  });
  const { data, isLoading } = trpc.transactions.list.useQuery({
    search,
    filter,
    page,
    pageSize: 12,
  });
  const { data: datasets } = trpc.datasets.list.useQuery();
  const prediction = trpc.transactions.predict.useMutation();
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 12));
  return (
    <div className="mx-auto max-w-[1440px]">
      <SectionHeader
        eyebrow="TRANSACTION MONITOR"
        title="Live transaction feed"
        description="Review model decisions and investigate risk signals across the production stream."
        action={
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{" "}
            Stream connected
          </div>
        }
      />
      <div className="panel mb-5 overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Score a transaction
              </h3>
              <p className="mt-1 text-[11px] text-slate-500">
                Enter transaction signals to run the production model and
                classify risk.
              </p>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-semibold text-blue-700">
              Dataset model
              <select
                value={predictionInput.datasetName}
                onChange={event =>
                  setPredictionInput({
                    ...predictionInput,
                    datasetName: event.target.value as DatasetName,
                  })
                }
                className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 outline-none"
              >
                {datasets?.map(dataset => (
                  <option key={dataset.name} value={dataset.name}>
                    {dataset.sourceStyle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="field-label">Transaction amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                $
              </span>
              <input
                type="number"
                min="1"
                value={predictionInput.amount}
                onChange={event =>
                  setPredictionInput({
                    ...predictionInput,
                    amount: Number(event.target.value),
                  })
                }
                className="field-input pl-7"
              />
            </div>
          </div>
          <div>
            <label className="field-label">Payment method</label>
            <select
              value={predictionInput.paymentMethod}
              onChange={event =>
                setPredictionInput({
                  ...predictionInput,
                  paymentMethod: event.target.value,
                })
              }
              className="field-input"
            >
              <option>Card</option>
              <option>Digital wallet</option>
              <option>Bank transfer</option>
              <option>Virtual card</option>
            </select>
          </div>
          <div>
            <label className="field-label">Transactions in last hour</label>
            <input
              type="number"
              min="0"
              max="100"
              value={predictionInput.velocity1h}
              onChange={event =>
                setPredictionInput({
                  ...predictionInput,
                  velocity1h: Number(event.target.value),
                })
              }
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Failed attempts</label>
            <input
              type="number"
              min="0"
              max="20"
              value={predictionInput.failedAttempts}
              onChange={event =>
                setPredictionInput({
                  ...predictionInput,
                  failedAttempts: Number(event.target.value),
                })
              }
              className="field-input"
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={predictionInput.isNewDevice}
              onChange={event =>
                setPredictionInput({
                  ...predictionInput,
                  isNewDevice: event.target.checked,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />{" "}
            New device
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={predictionInput.isInternational}
              onChange={event =>
                setPredictionInput({
                  ...predictionInput,
                  isInternational: event.target.checked,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />{" "}
            International transaction
          </label>
          <div className="flex items-end lg:col-span-3">
            <button
              onClick={() => prediction.mutate(predictionInput)}
              disabled={prediction.isPending || predictionInput.amount <= 0}
              className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prediction.isPending
                ? "Scoring transaction…"
                : "Predict fraud risk"}
            </button>
          </div>
          {prediction.data && (
            <div
              className="rounded-lg border p-4 lg:col-span-3"
              style={{
                borderColor:
                  prediction.data.riskLevel === "HIGH"
                    ? "#fecdd3"
                    : prediction.data.riskLevel === "MEDIUM"
                      ? "#fde68a"
                      : "#bbf7d0",
                background:
                  prediction.data.riskLevel === "HIGH"
                    ? "#fff1f2"
                    : prediction.data.riskLevel === "MEDIUM"
                      ? "#fffbeb"
                      : "#f0fdf4",
              }}
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div className="flex items-center gap-3">
                  {prediction.data.prediction === "FRAUD" ? (
                    <XCircle className="text-rose-600" size={25} />
                  ) : (
                    <CheckCircle2 className="text-emerald-600" size={25} />
                  )}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Prediction result
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {prediction.data.prediction}{" "}
                      <span className="ml-2 text-sm font-medium text-slate-500">
                        · {prediction.data.riskLevel} risk
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-slate-400">
                      {prediction.data.dataset} · {prediction.data.modelArtifact}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                      Fraud probability
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {pct(prediction.data.probability)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                      Inference
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-slate-700">
                      {prediction.data.processingTimeMs} ms
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {prediction.data.topRiskFactors.map(factor => (
                  <span
                    key={factor}
                    className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm"
                  >
                    {factor}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="panel mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search transaction, customer, or merchant"
              className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map(item => (
              <button
                key={item}
                onClick={() => {
                  setFilter(item);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${filter === item ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
              >
                {item === "ALL" ? "All" : item[0] + item.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="panel overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        ) : (
          <TransactionTable
            rows={data?.rows ?? []}
            onSelect={id => setLocation(`/transactions/${id}`)}
          />
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            Showing {data?.rows.length ?? 0} of {data?.total ?? 0} transactions
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(value => Math.max(1, value - 1))}
              className="rounded border border-slate-200 p-1.5 text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[11px] font-medium text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(value => Math.min(totalPages, value + 1))}
              className="rounded border border-slate-200 p-1.5 text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransactionDetails() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/transactions/:id");
  const { data, isLoading } = trpc.transactions.get.useQuery({
    id: params?.id ?? "",
  });
  if (isLoading || !data)
    return (
      <div className="mx-auto max-w-[1100px] animate-pulse">
        <div className="mb-6 h-10 w-64 rounded bg-slate-200" />
        <div className="h-[480px] rounded-lg bg-slate-200" />
      </div>
    );
  const featureRows = Object.entries(data.features);
  return (
    <div className="mx-auto max-w-[1200px]">
      <button
        onClick={() => setLocation("/transactions")}
        className="mb-5 flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={15} /> Back to transactions
      </button>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">
            TRANSACTION INVESTIGATION
          </div>
          <h2 className="font-mono text-[24px] font-semibold tracking-tight text-slate-900">
            {data.id}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Received {new Date(data.timestamp).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${data.prediction === "FRAUD" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
          >
            {data.prediction}
          </span>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${data.riskLevel === "HIGH" ? "bg-rose-50 text-rose-700" : data.riskLevel === "MEDIUM" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
          >
            {data.riskLevel} RISK
          </span>
        </div>
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="panel border-l-4 border-l-rose-500 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Fraud probability
          </div>
          <div className="mt-2 text-[32px] font-semibold tracking-tight text-slate-900">
            {pct(data.fraudProbability)}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-rose-500"
              style={{ width: `${data.fraudProbability * 100}%` }}
            />
          </div>
        </div>
        <div className="panel p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Top risk factors
          </div>
          <div className="mt-3 space-y-2">
            {data.riskFactors.map(factor => (
              <div
                key={factor}
                className="flex items-center gap-2 text-xs text-slate-700"
              >
                <ShieldAlert size={14} className="text-rose-500" /> {factor}
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Inference
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Model</span>
              <span className="font-mono text-slate-700">
                {data.modelVersion}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Latency</span>
              <span className="font-mono text-slate-700">
                {data.processingTimeMs} ms
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Risk score</span>
              <span className="font-mono text-slate-700">
                {data.riskScore.toFixed(3)}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <DetailCard
            title="Transaction information"
            icon={<CreditCardIcon />}
            rows={[
              ["Amount", money(data.amount)],
              ["Merchant", data.merchantName],
              ["Category", data.merchantCategory],
              ["Payment method", data.paymentMethod],
              ["International", data.isInternational ? "Yes" : "No"],
            ]}
          />
          <DetailCard
            title="Customer & device"
            icon={<UserRound size={16} />}
            rows={[
              ["Customer ID", data.customerId],
              ["Customer age", `${data.customerAge} years`],
              ["Account age", `${data.accountAgeDays} days`],
              ["Device", `${data.deviceType} · ${data.deviceId}`],
              ["New device", data.isNewDevice ? "Yes" : "No"],
            ]}
          />
          <DetailCard
            title="Location"
            icon={<MapPin size={16} />}
            rows={[
              ["Customer location", data.customerLocation],
              ["Merchant location", data.merchantLocation],
              ["Distance from home", `${data.distanceFromHome} km`],
            ]}
          />
        </div>
        <div className="space-y-6">
          <div className="panel p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Fingerprint size={16} className="text-blue-600" /> Engineered
              features
            </h3>
            <div className="mt-4 divide-y divide-slate-100">
              {featureRows.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-2.5 text-xs"
                >
                  <span className="font-mono text-slate-500">{key}</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {typeof value === "number" ? value.toFixed(3) : value}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Clock3 size={16} className="text-blue-600" /> Processing timeline
            </h3>
            <div className="mt-4 space-y-4">
              {[
                "Transaction received",
                "Schema validated",
                "Features generated",
                "Model inference completed",
                "Risk decision generated",
                "Stored in database",
              ].map((event, index) => (
                <div key={event} className="flex items-start gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span
                      className={`h-2 w-2 rounded-full ${index === 3 ? "bg-blue-600" : "bg-emerald-500"}`}
                    />
                    {index < 5 && <span className="h-5 w-px bg-slate-200" />}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-700">
                      {event}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                      12:03:1{index}.0{index + 2}1
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: [string, string][];
}) {
  return (
    <div className="panel p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        {icon} {title}
      </h3>
      <div className="mt-3 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between py-2.5 text-xs"
          >
            <span className="text-slate-500">{label}</span>
            <span className="max-w-[60%] text-right font-medium text-slate-700">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function CreditCardIcon() {
  return (
    <span className="text-blue-600">
      <Laptop size={16} />
    </span>
  );
}
