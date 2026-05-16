# `ixora health`

Ping the AgentOS `/health` endpoint of the resolved system. Reports status, uptime, and latency. Exits non-zero when unhealthy — handy in scripts and monitoring.

```bash
ixora health
ixora --system prod health
ixora health --json
```

---

## Output

Table form (default in a TTY):

```
$ ixora health

✓ default  (http://localhost:18000)
  status:  ok
  uptime:  3h 42m  (since 2026-05-15T08:11:04Z)
  latency: 18ms
```

The leading `✓` / `✗` reflects success:

- `✓` — status is `ok`. Exit code `0`.
- `✗` — any other status. Exit code `1`.

JSON form (`--json` or non-TTY):

```json
{
  "ok": true,
  "status": "ok",
  "url": "http://localhost:18000",
  "system_id": "default",
  "instantiated_at": "2026-05-15T08:11:04Z",
  "uptime_seconds": 13340,
  "latency_ms": 18
}
```

---

## Exit codes

| Condition | Exit code |
|---|---|
| `status == "ok"` | `0` |
| anything else | `1` |
| HTTP/network error reaching the endpoint | `1` (via the standard error handler) |

So you can chain:

```bash
ixora --system prod health && echo "prod is healthy"
ixora --system prod health > /dev/null || pagerduty-trigger ...
```

---

## Periodic check

```bash
# Quick liveness loop
while :; do
  date
  ixora --system prod health --json | jq -r '.status,.latency_ms'
  sleep 30
done
```

Or wire into your existing monitoring stack — the JSON output is stable across versions.

---

## See also

- [`status.md`](status.md) — fuller resource overview (agents, databases, interfaces)
- [`../troubleshooting.md`](../troubleshooting.md) — what to check when `health` fails
