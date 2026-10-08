---
title: Metrics
description: Expose Praxrr internals as Prometheus metrics from GET /api/v1/metrics.
---

Praxrr can expose its internal state as **Prometheus text exposition format
(0.0.4)** at:

```
https://<your-praxrr-host>/api/v1/metrics
```

The endpoint is **off by default**. Enable it with:

```env
METRICS_ENABLED=true
```

Accepted truthy values are `1`, `true`, `yes`, and `on`. Any other value
(including unset) keeps the endpoint disabled, and requests to it return
**404**.

## Authentication

`/api/v1/metrics` uses the same auth as the rest of `/api/v1`:

- Under `AUTH=on`, send your API key as the `X-Api-Key` header or the
  `?apikey=` query parameter, or use an authenticated session. Unauthenticated
  requests return **401**.
- Under `AUTH=oidc`, API keys are not accepted; only a browser session works,
  which a scraper cannot keep, so scraping is not supported in this mode yet.
- Under `AUTH=off`, or under `AUTH=local` from a local IP, the endpoint is
  open like the rest of the API.

## Prometheus scrape config

Send the API key in the `X-Api-Key` header. Prometheus supports custom headers
through `http_headers`; `files` reads the key from a file so it stays out of the
config and is hidden on the Prometheus configuration page:

```yaml
scrape_configs:
  - job_name: 'praxrr'
    static_configs:
      - targets: ['praxrr:6868']
    metrics_path: /api/v1/metrics
    http_headers:
      X-Api-Key:
        files: ['/etc/prometheus/praxrr-api-key']
```

If your scraper cannot set headers, pass the key as a query parameter instead:

```yaml
params:
  apikey: ['<your Praxrr API key>']
```

With `params`, the key becomes part of the request URL and can end up in access
logs (reverse proxy or Praxrr request logs). Use the header form when you can,
and restrict access to those logs.

## Metric reference

| Metric                              | Type      | Labels                                               | Notes                                                                                                       |
| ----------------------------------- | --------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `praxrr_build_info`                 | gauge     | `version`                                            | Always `1`; carries the app version                                                                         |
| `praxrr_process_start_time_seconds` | gauge     | —                                                    | Process start time as a Unix timestamp                                                                      |
| `praxrr_job_runs_total`             | counter   | `job_type`, `status`                                 | Finished job runs by type and status                                                                        |
| `praxrr_job_run_duration_seconds`   | histogram | `job_type`                                           | Finished job durations; buckets `0.1,0.5,1,5,15,60,300,900`                                                 |
| `praxrr_sync_runs_total`            | counter   | `instance_id`, `instance_name`, `arr_type`, `status` | Sync runs; `status` is `success`, `partial`, `failed`, or `skipped`                                         |
| `praxrr_drift_instance_status`      | gauge     | `instance_id`, `arr_type`, `status`                  | `1` for the current per-instance drift state (`in-sync`, `drifted`, `unreachable`, `unauthorized`, `error`) |
| `praxrr_drift_items`                | gauge     | `instance_id`, `arr_type`, `kind`                    | Item counts; `kind` is `drifted`, `missing`, or `unmanaged`                                                 |
| `praxrr_config_health_score`        | gauge     | `instance_id`, `instance_name`, `arr_type`           | Latest config-health snapshot score per instance                                                            |
| `praxrr_config_health_band`         | gauge     | `instance_id`, `instance_name`, `arr_type`, `band`   | `1` for the instance's current band                                                                         |
| `praxrr_security_posture_score`     | gauge     | —                                                    | Latest security-posture score (cached 60s in-process)                                                       |
| `praxrr_security_posture_band`      | gauge     | `band`                                               | `1` for the current band                                                                                    |
| `praxrr_parser_up`                  | gauge     | —                                                    | `1` when the parser service is reachable, else `0`                                                          |
| `praxrr_notifications_total`        | counter   | `service_id`, `status`                               | Notification deliveries; `status` is `success` or `failed`                                                  |
| `praxrr_pcd_cache_built`            | gauge     | `database_id`                                        | `1` when the database cache compiled, else `0`                                                              |
| `praxrr_metrics_collector_up`       | gauge     | `collector`                                          | `1` per healthy collector, `0` when a collector failed                                                      |

Labels never include URLs, API keys, or secrets. `instance_name` is
user-supplied text from instance settings.

### Counters and history retention

The counters (`praxrr_job_runs_total`, `praxrr_sync_runs_total`,
`praxrr_notifications_total`) are derived from history tables, so they drop
when history-retention pruning deletes old rows. A prune looks like a counter
reset: query them with `rate()` or `increase()` (Prometheus handles resets),
and avoid alerting on raw counter decreases. Values reflect only the rows still
inside the retention window, and a prune can briefly inflate `increase()` over
the window that contains it; keep alert windows short (for example `15m`).

## Example alert rules

```yaml
groups:
  - name: praxrr
    rules:
      - alert: PraxrrParserDown
        expr: praxrr_parser_up == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Praxrr parser service is unreachable'

      - alert: PraxrrSyncFailures
        expr: sum by (instance_name) (increase(praxrr_sync_runs_total{status="failed"}[15m])) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Praxrr sync failures on {{ $labels.instance_name }}'

      - alert: PraxrrDriftDetected
        expr: praxrr_drift_instance_status{status="drifted"} == 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: 'Praxrr drift detected on {{ $labels.instance_id }}'

      - alert: PraxrrConfigHealthLow
        expr: praxrr_config_health_score < 70
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: 'Praxrr config health low on {{ $labels.instance_name }}'

      - alert: PraxrrCollectorFailing
        expr: praxrr_metrics_collector_up == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Praxrr metrics collector {{ $labels.collector }} is failing'
```

Adjust the `praxrr_config_health_score` threshold to match what counts as
healthy in your setup.

## Example Grafana dashboard

A minimal dashboard using the metrics above. Import it via Dashboards →
Import → paste JSON:

```json
{
  "title": "Praxrr",
  "uid": "praxrr-overview",
  "schemaVersion": 39,
  "version": 1,
  "panels": [
    {
      "title": "Sync runs (15m)",
      "type": "timeseries",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [
        {
          "expr": "sum by (status) (increase(praxrr_sync_runs_total[15m]))",
          "legendFormat": "{{status}}"
        }
      ]
    },
    {
      "title": "Drift status",
      "type": "stat",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [
        {
          "expr": "praxrr_drift_instance_status",
          "legendFormat": "{{instance_id}} {{status}}"
        }
      ]
    },
    {
      "title": "Config health score",
      "type": "gauge",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [
        {
          "expr": "praxrr_config_health_score",
          "legendFormat": "{{instance_name}}"
        }
      ]
    },
    {
      "title": "Job duration p95",
      "type": "timeseries",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum by (job_type, le) (rate(praxrr_job_run_duration_seconds_bucket[15m])))",
          "legendFormat": "{{job_type}}"
        }
      ]
    },
    {
      "title": "Parser up",
      "type": "stat",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [{ "expr": "praxrr_parser_up" }]
    },
    {
      "title": "Collector health",
      "type": "stat",
      "datasource": "${DS_PROMETHEUS}",
      "targets": [
        {
          "expr": "praxrr_metrics_collector_up",
          "legendFormat": "{{collector}}"
        }
      ]
    }
  ]
}
```
