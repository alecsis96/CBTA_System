# Sync API Contract (Phase 1)

This app keeps local offline queue behavior and pushes operations over internet when online.

## Request

`POST {VITE_SYNC_API_URL}`

Required header:

- `x-api-key: {VITE_SYNC_API_KEY}`

Body (JSON):

```json
{
  "id": "uuid",
  "type": "STUDENT_CREATE",
  "entityId": "uuid",
  "deviceId": "uuid",
  "payload": {
    "studentId": "uuid"
  },
  "createdAt": "2026-05-15T20:00:00.000Z"
}
```

`type` values:

- `STUDENT_CREATE`
- `STUDENT_UPDATE`
- `RECEIPT_CREATE`
- `RECEIPT_REPRINT`

## Response

- `2xx`: operation is considered synced and removed from local queue.
- non-`2xx`: operation remains pending for retry.

Recommended response body:

```json
{
  "ok": true,
  "operationId": "uuid",
  "receivedAt": "2026-05-15T20:00:00.000Z"
}
```

Error responses:

- `401` when `x-api-key` is missing or invalid.
- `400` when payload shape/type is invalid.

## Notes

- The app currently performs **push only** (pending local ops -> server).
- Pull/reconciliation from server is planned for the next phase.
- Queue is stored in browser localStorage keys:
  - `cbta-sync-pending-ops`
  - `cbta-sync-device-id`

## Internet Deployment Notes

- Backend endpoint should be publicly reachable from each office through HTTPS.
- Configure firewall/NAT or reverse proxy so offices can reach `/api/sync/op`.
- Keep `SYNC_API_KEY` secret in backend environment and use same value as `VITE_SYNC_API_KEY` in the desktop app environment.
- This endpoint is stateless except for in-memory process-lifetime dedupe by operation `id`.

## Required Environment Variables

Frontend (Electron + Vite):

- `VITE_SYNC_API_URL` (example: `https://sync.example.com/api/sync/op`)
- `VITE_SYNC_API_KEY` (must match backend key)

Backend (Express sync service):

- `SYNC_API_KEY`
- `SYNC_SERVER_PORT` (default `8787`)

## Quick Test (curl)

```bash
curl -X POST "http://localhost:8787/api/sync/op" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-sync-key" \
  -d '{"id":"op-1","type":"STUDENT_CREATE","entityId":"student-1","deviceId":"device-1","payload":{"studentId":"student-1"},"createdAt":"2026-05-15T20:00:00.000Z"}'
```
