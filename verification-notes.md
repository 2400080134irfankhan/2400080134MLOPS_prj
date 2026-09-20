# Verification notes

The preview was checked at desktop size across `/`, `/transactions`, `/pipeline`, `/monitoring`, `/models`, `/alerts`, and `/settings`.

The dashboard presents a restrained enterprise layout with a dark navigation rail, compact KPI cards, data-dense tables, and blue/green/amber/rose status colors. The transaction feed shows live-style records, search/filter controls, pagination, risk probability bars, and model decisions. Pipeline controls and model/alert/settings actions are rendered and wired to typed procedures.

One first-pass screenshot revealed an implausible synthetic fraud distribution and an invalid recall calculation. The generator was recalibrated and now uses a hidden synthetic ground-truth label for bounded precision and recall. A follow-up preview showed approximately 1.6% fraud flagged in the initial processed stream, which is appropriate for a rare-event operational demo. Monitoring can show a skeleton briefly while its query loads; the route itself renders successfully after data arrives.

Validation completed:

- `pnpm check` passed.
- `pnpm test` passed: 2 files, 4 tests.
- `pnpm build` passed.
