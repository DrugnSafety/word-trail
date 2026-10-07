# YouTube Chapter metadata

## Current coverage

On 2026-10-06, `scripts/refresh-youtube-chapters.mjs` queried all 84 catalog video URLs with `yt-dlp` using public YouTube metadata. The bounded run used six concurrent requests, a 20-second per-video timeout, no retries, and no authenticated session.

- 50 videos returned a valid, continuous YouTube chapter array and are stored as `youtube-metadata-verified`.
- The 34 extractor misses were checked in separate, agent-owned Chrome tabs. Pizza Girls (`video-03`) visibly exposed six entries under `자동 생성된 챕터입니다.` and is stored as `browser-visible-youtube-auto-chapters`.
- The other 33 extractor misses showed no visible chapter button in that browser session.
- 0 requests failed.
- The generated catalog contains 284 study chapters across 84 videos.

`video-01` Faceytalk returned `chapters: null` from the public metadata request and showed no visible chapter button in the logged-in Chrome check. Its two previously confirmed sections and the `목차 확인 중` remainder remain explicitly labeled as partial user-confirmed data. They are not promoted to YouTube-verified chapters.

## Data contract

`content/chapter-metadata.json` is the checked-in source. A verified entry stores the YouTube video ID, title, duration, fetch time, expected chapter count, and each title/start/end boundary. Generated chapter objects use:

- `source: youtube-chapter`
- `provenance: youtube-player-metadata-via-yt-dlp`
- `coverage: youtube-metadata-boundary`

Browser-visible automatic chapters use a distinct contract:

- `source: youtube-auto-chapter`
- `provenance: browser-visible-youtube-auto-chapters`
- `coverage: browser-visible-auto-boundary`

Pizza Girls visibly showed `The pizza shop game` 0:00, `Fixing the car` 1:43, `Electric car troubles` 2:11, `Driving in the park` 3:28, `Charging and chaos` 4:11, and `Making fast deliveries` 5:22. The checked-in source boundaries are 0, 103, 131, 208, 251, and 322 seconds. Generated playback boundaries may move a few seconds earlier when a captured caption straddles a marker; the exact visible marker remains in `markerStart` and the adjustment is labeled `chapter-boundary-snapped-to-caption`.

The catalog builder gives these entries priority over headings inferred from local Markdown transcripts. When YouTube has no chapter metadata, local script headings remain study-section fallbacks; a video without either source gets one whole-video study section. Empty source chapters outside captured transcript coverage are omitted rather than shown without learnable scenes.

The content version is `2026.10.06-1`. The bump prevents stored chapter progress from being joined to newly assigned chapter IDs from the older catalog.

## Refresh command

Preview without changing files:

```sh
npm run chapters:refresh -- --concurrency 6 --timeout-ms 20000
```

Refresh checked-in metadata:

```sh
npm run chapters:refresh -- --write --concurrency 6 --timeout-ms 20000
```

For a bounded single-video check, add `--video video-02`. Failed requests preserve existing metadata. A successful response with no chapters removes only a previously fetched `youtube-metadata-verified` entry. Browser-visible entries such as Pizza Girls and manually sourced entries such as Faceytalk are preserved.

## Evidence boundary

The stored values prove what the public extractor or visible Chrome interface returned at the recorded check time. They do not prove that YouTube will keep the same chapters or that chapters are available in every region or account. Re-run the refresh command and repeat the visible-browser check to update time-sensitive metadata.
