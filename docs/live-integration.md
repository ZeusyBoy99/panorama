# Next step: inspect the actual timing link

Stage 1 has **no live adapter and no invented endpoint**. A timing URL is checked only for syntax. It is never requested, persisted, connected, or rendered as HTML. The app is useful with classification-only input; GPS or sector crossings must be demonstrated by the provider.

When the owner supplies the real URL, first inspect the source and document:

1. Whether it offers supported JSON, SSE, WebSocket, polling or only HTML; source terms/permissions, authentication, session/event identifiers, reconnect/resync facilities and update/heartbeat cadence.
2. Source timestamps and units; classification and lap deficits; measured versus derived laps/sectors/positions; whether sectors are durations or real timestamped crossings; current driver/pit support and freshness per entry.
3. Browser access and CORS restrictions, credentials, redirect behaviour, and whether a server adapter is necessary. Do not bypass access restrictions or assume a public page grants unrestricted automated access.
4. Payload validation, missing-field semantics, dropped updates, sequence identity, source outages, partial-entry updates, authoritative nulls, and full snapshot recovery.

The likely flow is:

```text
Supported timing URL → explicit provider resolver → server adapter if required
                    → validated normalised snapshots/events → SSE / WS / polling → TimingProvider
```

Choose the transport after examining the real source. A provider offering classification without position anchors should select classification mode. Valid lap or sector anchors enable labelled estimates; genuine timestamped coordinates/progress enable reported positions. Do not infer official overtakes from map estimates.

If server-side fetching is required, implement explicit provider allowlists and validate scheme/hostname/port/path and redirects. Reject private/local destinations and credential-bearing URLs; revalidate every redirected destination. The resolver must not become an unrestricted fetch proxy. Keep secrets on the server, remove query-string secrets from logs/persistence, and treat all names/messages as untrusted text. Never render provider HTML in the client.

Share server-side upstream connections among viewers if permission allows. Respect provider cadence/rate limits. Use bounded exponential backoff with jitter (for example 1, 2, 4, 8, 16, then 30 seconds), cancel retries on disconnect/source switch, and reconnect through a full source snapshot before deltas resume. Heartbeats establish transport health, not car freshness. Bound histories and queues and monitor entry observation age.

Implement `TimingProvider` from `src/providers/contract.ts`; run all input through `snapshotSchema`. If the upstream sends deltas, assemble them into authoritative full snapshots inside the adapter. Preserve stable source entry IDs across driver changes and rank changes. Give a new upstream session/epoch a new stream identity, including when sequence resets.

Verify using captured, permitted fixtures: stale/partial cars, null invalidation, duplicated/out-of-order updates, changing sessions, reconnect resync, unsupported positions/pits, provider error/schema changes and real browser suspension. Add provider-specific contract tests without changing the UI or importing simulator truth.

Useful references: [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [PWA background/offline constraints](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation). No push notifications or browser notification permission is part of Stage 1.
