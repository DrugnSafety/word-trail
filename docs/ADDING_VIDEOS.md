# 주소만 보내고 영상 준비하기

사이트의 **Codex에 전달할 목록 만들기**에 YouTube 주소를 한 줄에 하나씩 넣고, 선택 사항인 주제와 요청 메모를 더해 목록을 복사하거나 내려받을 수 있다. 그 목록을 Codex chat에 그대로 보내면 된다. 시간 대본을 이미 가진 사용자를 위한 고급 직접 입력 폼도 남아 있지만, 일반적인 영상 추가는 주소 목록을 전달하는 흐름을 사용한다.

Codex prepares each requested video before publication:

1. Confirm the exact YouTube video and review channel or playlist candidates before preparing a batch.
2. Retrieve real English captions and record their caption type. If captions are unavailable, ask for a transcript or prepare one from accessible audio and retain that provenance. Never fabricate dialogue.
3. Capture visible YouTube chapters when present. Otherwise, use verified transcript boundaries or an explicitly labeled whole-video fallback.
4. Produce a complete record in `content/additional-videos.json`, then run the build and tests.
5. Review the generated catalog/video JSON and verify the deployed page after publication.

The manifest has version 1 and a `videos` array. Each prepared record contains:

```json
{
  "id": "video:rKgtm81yi94",
  "youtubeId": "rKgtm81yi94",
  "url": "https://www.youtube.com/watch?v=rKgtm81yi94",
  "title": "Verified YouTube title",
  "durationSeconds": 60,
  "topics": ["Science"],
  "tags": ["movement"],
  "transcript": "0:00 First real caption.\n0:05 Next real caption.",
  "chapters": [{ "title": "Introduction", "startSeconds": 0 }],
  "createdAt": "2026-10-06T00:00:00Z",
  "updatedAt": "2026-10-06T00:00:00Z",
  "captionType": "YouTube English captions (human-made)",
  "transcriptProvenance": "YouTube English caption track",
  "chapterProvenance": "visible YouTube chapter markers"
}
```

`captionType`, `transcriptProvenance`, and `chapterProvenance` retain the source detail used during Codex preparation. Generated chapter rows are labeled `codex-prepared` rather than user-provided. Publication labels the generated data unreviewed and not audio-verified unless a separate review supplies stronger evidence.

The build runs `scripts/build-catalog.mjs` first, then `scripts/build-additional-videos.mjs`, then the remaining generated-data steps. The additional-video builder validates the entire manifest before writing. It rejects incomplete records and duplicate prepared IDs, preserves base catalog metadata, and skips a YouTube ID already in the generated catalog. Re-running the build is therefore idempotent.

After preparation, run the targeted test plus the normal test/build/check suite. For a remote release, verify the public catalog, the generated `custom-<youtubeId>.json`, the study flow, and the actual YouTube playback. A channel or playlist URL is an intake source for candidate review; it does not automatically publish every contained video.

There are no requested URLs in the current change, so `content/additional-videos.json` intentionally starts with an empty `videos` list.
