# 구현 검증 기록

## 2026-10-06 · v1.1.0 철자쓰기 기억 소리

글자별 고정 음높이와 효과 켜기·끄기, A/B/C 샘플을 추가했다. 전체 테스트 257/257, JavaScript 65개 구문 검사, 새 브라우저 검사 8개와 기존 학습 회귀 검사 23개를 통과했다. 독립 리뷰에서 취소·지연 재생·설정 저장의 구체적 차단 사항은 없었다. 실제 Chrome 운영 화면과 공개 파일 일치를 확인했다. 상세 기능, Vercel 배포 ID, 검증의 범위는 [별도 v1.1.0 기록](releases/v1.1.0.md)에 남겼다. 청취 품질·기억 향상 실험·실제 iPad Safari는 미검증이다.

## 2026-10-06 · 학습 오류 7건 수정

새 받아쓰기 시도는 저장된 정답을 입력란으로 복원하지 않는다. 현재 시도의 초안은 화면 재표시에서 유지하고 새 대화·새 시도에서는 비운다. 반복 구간 종료 뒤 늦게 도착한 YouTube 정지 이벤트가 새 반복 감시를 끊지 않게 수정했다. 로컬 실제 Chrome에서 Dragon 대화 1(0–7초)은 30초 이상 재생 중에도 7초 이내로 돌아왔으며 일시 정지 뒤 받아쓰기 값이 빈 문자열이었다.

GPT-5.4 한 응답으로 영어 뜻·한국어 뜻·예문 및 해석·관련어를 받는다. 화면을 네 영역으로 구분하고 제공자 문구를 제거했다. 관련어는 어형 변화·파생어·관련어로 구분한다. `dragon` 실호출에서 `dragons`, `draconic`, `monster`, `creature`를 받았다. 현재와 다음 두 단어를 최대 두 요청으로 미리 조회하며 화면 조회와 진행 중 요청을 공유한다. 계정 전환 시 취소·세대 검증을 적용한다. 이전 뜻풀이 전용 캐시와 새 패키지는 서버 cache v2로 분리하며 기존 토큰 원장은 유지한다.

철자쓰기 A는 공개 도메인 /eɪ/ 녹음 MP3로 재생하며 다른 글자 음성과 직렬화·취소·오래된 이벤트 차단을 유지한다. 녹음 파일 출처와 SHA-256은 [audio README](../public/audio/README.md)에 기록했다. 실제 사용자 스피커에서 청취한 평가는 아니다. 연습 순서는 철자 → 소리 퀴즈 → 빈칸으로 변경했다.

- 전체 테스트 252/252 통과, 실패·건너뜀 0.
- JavaScript 62개 구문 검사 및 84개 영상 빌드 통과. 별도 lint/typecheck 도구는 설치되어 있지 않다.
- 실제 새 지식 패키지 2개 생성: 합계 1,394토큰. 같은 요청 재조회 시 추가 토큰 0. 기존 사용량을 보존했다.
- 공개 코드·서버·API 118개 파일에 전달받은 API 키가 포함되지 않음을 검사했다.

주요 변경 파일: `public/app.js`, `public/lib/learning.js`, `public/lib/player.js`, `public/lib/practice.js`, `public/lib/knowledge-loader.js`, `public/lib/lexicon.js`, `public/lib/vocabulary.js`, `public/lib/word-families.js`, `public/styles.css`, `public/audio/letter-a.mp3`, `server/ai-service.mjs`, `scripts/serve.mjs`, `scripts/qa-revision.mjs` 및 관련 테스트. 사전 조회를 공유하는 작은 큐를 추가하고 제공자 표시·별도 관련어 대기 문구를 제거했다. 새 npm 의존성은 없다.

공개 Chrome에서도 대화 1은 약 42초의 관찰 동안 7초 끝 → 다시 4.38초 → 다시 0.47초로 반복되었다. 앱 정지 후 실제 HTML video가 paused였으며, 저장된 답이 있는 문장의 새 받아쓰기 값은 빈 문자열이었다. [실제 Chrome 기록](../tmp/vercel-learning-fixes-chrome.json), [빈 입력란 화면](../tmp/vercel-learning-fixes-dictation-chrome.png). 기존 5개 등록 단어와 학습 완료 이력을 보존했다.

증거: [전체 테스트](../tmp/learning-fixes-tests.log), [실제 지식 응답과 원장 집계](../tmp/learning-fixes-live-ai.json). 브라우저 회귀 검사 23개 통과, JavaScript·console 오류 0. 1440px·390px 가로 넘침 없음. 다음 단어는 이동 전에 호출되었으며 선택한 단어별 API 요청은 각각 한 번이었다. YouTube·음성·AI 등 외부 응답은 결정적 mock이며 위 실제 호출·Chrome 증거와 구분한다. [브라우저 결과](../tmp/qa-revision/results.json). Vercel production 배포 `dpl_GBjq7f54jhCGoC8nNrDGg8HMqvfw` READY, 기존 공개 주소에 alias 완료. 변경 파일 10개(앱·학습 라이브러리·A 녹음·스타일)의 공개 바이트가 로컬과 일치했다. 실제 공개 API에서 dragon과 once upon a time 전체 패키지 응답 200 및 캐시 재조회 추가 토큰 0을 확인했다. Chrome 공개 화면에서 dragon 뜻·예문·관련어와 family 복습, A 입력 재생 표시를 확인했다. 배포 증거: [로그](../tmp/vercel-learning-fixes-deploy.log), [공개 API·파일 비교](../tmp/vercel-learning-fixes-live.json), [사용량 원장](../tmp/vercel-learning-fixes-usage.json), [뜻 화면](../tmp/vercel-learning-fixes-meaning-chrome.png), [관련어 복습 화면](../tmp/vercel-learning-fixes-family-chrome.png). iPad Safari와 실제 사용자 청취 검증은 포함하지 않는다.

---

## 2026-10-06 · 복수 표현 추가와 GPT-5.4 운영 연결

‘내 표현 만들기’의 생성 동작을 선택 토글과 분리했다. 첫 표현 뒤 두 번째 표현을 추가할 때 두 선택을 보존하고 입력 단어 선택을 초기화한다. 같은 표현 재생성은 선택을 해제하지 않는다. 겹치는 별도 표현도 유지하며 학습 시작 때 선택한 표현을 함께 저장한다.

사전 성공은 기존 결과를 사용하고 사전 누락·실패는 서버의 GPT-5.4로 영어·한국어 뜻, 품사, 예문을 보완한다. 정상 키 2개만 Vercel 비밀 환경변수에 저장했으며 나머지 2개는 실제 시험의 credit_balance_exhausted 오류로 제외했다. 비공개 Blob 원장에 사용·예약 토큰과 키 순번을 기록한다. New York 날짜 기준 키마다 하루 100만 토큰, 동시 요청 CAS 예약, 원장 장애·손상 시 호출 중단, IP 해시별 30/분·1000/일을 적용한다. 다른 앱의 같은 키 사용량은 집계되지 않는다. [계약과 유지보수](OPENAI_API.md).

실제 GPT-5.4에서 ‘once upon a time’와 ‘break the ice’ 뜻을 받았다. 각 키의 초기 시험 22토큰을 포함해 key-1 213, key-2 215토큰이 누적됐고 예약은 모두 0이었다. 같은 표현의 캐시 조회는 추가 토큰 0이었다. 실제 Blob 최신 읽기·조건부 쓰기·오래된 ETag 거절을 확인했다. 압축 응답의 약한 ETag 문제를 실조회에서 발견해 identity 인코딩과 강한 ETag 검증으로 보완했다. [API 실응답](../tmp/ai-live-meaning.json), [Blob 검증](../tmp/ai-live-storage.json).

자동 테스트 241개 통과, JavaScript 구문 검사 60개 통과, 빌드 영상 84개·학습 구간 3230개. 브라우저 회귀 검사 20개 통과, JavaScript·console 오류 0, 1440·390px 가로 넘침 없음. 이 브라우저 회귀 검사의 YouTube·음성·사전·AI·번역·사용량은 mock이다. [자동 검사](../tmp/ai-tests.log), [브라우저 회귀](../tmp/qa-revision/results.json).

운영 주소 https://word-trail-three.vercel.app 으로 배포했다. deployment dpl_7fPQqvQNvk2kwwMaR4zMC4TYc8F9, READY. 인증 없는 운영 API 뜻풀이·사용량 응답과 공개 파일 4개의 로컬 해시 일치를 별도로 확인했다. 독립 코드 검토의 남은 차단 이슈는 0건이며 LSP/lint/typecheck 도구 대신 계약 테스트와 구문 검사를 수행했다. Supabase 계정 연결과 실제 iPad 검증은 기존 미연결·미검증 상태다. [배포](../tmp/vercel-ai-deploy.log), [운영 API와 파일 비교](../tmp/vercel-ai-live.json). 실제 사용자 Chrome에서 Dragon 첫 대화의 Once upon a time을 만든 뒤 set off를 추가해 두 표현이 함께 저장된 연습 목록을 확인했다. 실제 사전 누락 후 GPT-5.4 영어 뜻·한국어 뜻·출처 표시와 부모 계정의 키별 사용량 213·215를 읽어 확인했다. 원본 영상 시청 완료를 검증한 것은 아니다. [Chrome 확인](../tmp/vercel-ai-chrome.json), [실제 뜻풀이 화면](../tmp/vercel-ai-meaning-chrome.png).

---

## 2026-10-06 · 주소 목록으로 영상 준비 요청

영상 추가의 기본 화면을 영상·채널·재생목록 주소 목록 입력으로 변경했다. 선택 주제를 더해 Codex 전달문을 복사하거나 TXT 파일로 내려받는다. 사이트에서 자동 전송하거나 준비되지 않은 영상을 생성하지 않는다. 사용자가 이 채팅에 주소만 바로 보내도 된다. 기존 시간 대본 직접 입력은 접힌 고급 화면에 유지했다. 입력 수정과 계정 전환 때 오래된 전달문을 지우며, 일반·짧은 주소·Shorts·라이브 다시보기 주소를 정규화하고 중복 주소를 합친다.

Codex가 실제 원본 대본·챕터를 확인한 자료는 `content/additional-videos.json`에 기록하고 `build-catalog → build-additional-videos → build-examples` 순서로 게시한다. 모든 항목을 먼저 검증하며 불완전한 자료가 있으면 기록하지 않는다. 채널·재생목록은 영상 후보를 확인하고 선택한 항목만 준비한다. 실제 추가 주소가 아직 제공되지 않아 manifest는 비어 있으며 기존 84개 영상을 유지했다. [영상 추가 안내](ADDING_VIDEOS.md).

로컬 검증: 전체 테스트 199개 통과, JavaScript 구문 검사 49개 통과, 브라우저 흐름 18개 통과 및 console·JavaScript 오류 0. 비어 있지 않은 추가 영상 manifest의 병합, 최종 카탈로그 비교, 제거한 custom JSON 정리, 오류 시 기존 자료 보존을 검증했다. 실제 브라우저 다운로드의 파일명과 내용 일치를 확인했다. 1440px·390px 화면을 검사했다. QA의 YouTube·음성·사전·번역·클립보드 응답은 mock이며 원본 자료 수집이나 실제 클립보드 환경을 입증하지 않는다. [테스트](../tmp/video-list-tests.log), [빌드](../tmp/video-list-build.log), [로컬 브라우저 증거](../tmp/video-list-local/results.json).

운영 주소 **https://word-trail-three.vercel.app**에서 동일 브라우저 검사 18개 통과, 오류 0을 확인했다. 변경된 공개 파일 5개의 HTTP 200과 로컬 SHA-256 일치를 확인했다. 별도 실제 사용자 Chrome에서도 채널 주소 하나로 전달문을 생성하고 복사 버튼의 결과가 실제 클립보드와 일치함을 확인했다. 테스트 주소는 요청란에서 지웠으며 실제 새 영상은 추가하지 않았다. [공개 파일 비교](../tmp/vercel-video-list-files.json), [운영 브라우저 증거](../tmp/vercel-video-list-qa/results.json), [실제 Chrome 확인](../tmp/vercel-video-list-chrome.json), [배포 로그](../tmp/vercel-video-list-deploy.log).

최종 deployment는 `dpl_QyhL7X2YQHWKA5vhTQQQbbGYRnd7`, 상태 `READY`다. 독립 코드 재검토에서 비어 있지 않은 manifest의 테스트 비교와 생성 파일 정리 범위를 보완했으며 최종 판정은 승인이다. 생성 파일 정리는 정확히 `custom-`와 11자리 YouTube ID인 파일에만 적용해 다른 custom 파일을 보존한다.

---

## 2026-10-06 · Vercel 운영 배포 완료

사용자의 Chrome Vercel 로그인 후 실제 계정을 확인하고 `mingyu9/word-trail`을 생성했다. 기존 Math Atlas 프로젝트는 변경하지 않았다. `npx vercel deploy --prod --yes --scope mingyu9` 결과 `READY`와 운영 별칭 **https://word-trail-three.vercel.app**을 받았다. deployment ID는 `dpl_5UczkMdbpsDozfMicYgC1PTZLRzu`다. 업로드 제외 목록에 로컬 환경변수·에이전트/클라우드 설정·로그·별도 PDF 자료를 명시했다. CLI가 만든 `.env.local`은 배포 대상에서 제외되며 내용이나 인증 토큰을 기록하지 않는다.

인증 없는 공개 URL에서 HTTP 200을 확인했다. `index.html`, `app.js`, `styles.css`, `lib/lexicon.js`, `lib/library.js`, `data/catalog.json`, `data/videos/video-03.json`, `config.js` 8개의 SHA-256이 로컬 자료와 일치했다. 카탈로그는 버전 `2026.10.06-1`, 영상 84개, Chapter 284개, 학습 구간 3,230개다. 공개 주소에서 새 기능 QA 14개가 통과했고 JavaScript·console 오류는 0이었다. 데스크톱 1440px와 390px에서 가로 넘침을 확인했다. 이 QA의 외부 재생·음성·사전·번역은 mock이다.

별도 사용자 Chrome 탭에서 실제 공개 앱을 열어 Pizza Girls의 챕터 6개를 확인했다. 실제 YouTube iframe이 로드되어 지원 속도 0.5/0.75/1과 재생 안내를 표시했고 앱의 일시정지 버튼으로 정지 상태를 확인했다. 챕터 전체 끝까지 시청하거나 실제 iPad에서 검사한 결과는 아니다.

영어 사전과 번역을 별도로 실조회해 `goal`의 영어 뜻풀이와 자동 한국어 번역 응답을 받았다. 이는 이전 `route`의 HTTP 522/시간 초과를 없었던 것으로 취급하지 않으며, 외부 서비스의 상시 가용성을 보장하지 않는다. 뜻풀이는 자동 번역임을 앱에 표시한다.

배포 증거: [배포 로그](../tmp/vercel-production-deploy.log), [공개 파일 비교](../tmp/vercel-public-files.json), [공개 주소 QA](../tmp/vercel-qa-revision/results.json), [실제 사전 응답](../tmp/vercel-live-dictionary.json).

남은 연결: Supabase 공개 설정·운영 SQL·인증 redirect가 미연결이므로 실제 실행은 게스트 모드다. 계정별 서버 동기화·메일 인증은 이번 Vercel 배포 성공과 별개의 미검증 항목이다. localhost 게스트 이력은 새 공개 주소로 자동 이전되지 않는다.

---

## 2026-10-06 · 단어 학습·개인 라이브러리 수정

철자 입력과 설정 샘플은 `A → ay`, `M → em`, `W → double you` 등 일반 글자 이름을 사용하며 `capital`·`letter`를 붙이지 않는다. 기존 취소·직렬 재생·정지 엔진 복구를 유지했다. 변용 복습을 혼자 읽기 바로 앞에 추가해 전체 8단계로 구성했다. 확인된 원형으로 학습하고 원문 활용형으로 빈칸을 채점한다. 기존 학습 이력을 원형으로 이전할 때 등록 시각·읽기 성공·복습 일정·종류별 연습 횟수를 보존한다.

영어 사전 뜻풀이를 먼저 표시하고 내장 한국어 설명이 없으면 뜻풀이의 자동 한국어 번역을 표시한다. 취소된 화면에는 응답을 반영하지 않으며 일시 오류를 영구적인 뜻 없음으로 캐시하지 않는다. 영상 확대, 한 문장의 여러 표현 등록, 개인 영상·채널 저장, 주제·제목·길이·최근 추가 정렬을 연결했다. 개인 영상은 URL뿐 아니라 길이와 시각이 있는 대본을 입력해야 한다. 채널 추가는 개인 목록 등록이며 채널의 모든 영상을 자동 수집하지 않는다.

계정 전환 도중 이전 계정의 읽기·쓰기 결과가 새 계정에 적용되지 않게 범위를 검증한다. 개인 라이브러리용 Supabase RLS·CAS SQL을 추가했으며 공유 콘텐츠를 수정하는 관리자 화면은 만들지 않았다. `public/config.js`의 Supabase 연결 값은 비어 있으므로 현재 실제 실행은 게스트 저장이다. 운영 DB 마이그레이션, 실제 계정 간 클라우드 동기화와 인증 메일은 검증하지 않았다.

| 실행 | 결과 |
|---|---|
| `npm test` | 189개 통과, 실패·건너뜀 0 |
| `npm run check` | JavaScript 45개 구문 검사 통과 |
| 기존 학습 브라우저 QA | 25개 통과, JavaScript 오류 0 |
| 새 기능 브라우저 QA | 14개 통과, JavaScript·console 오류 0; 1440px·390px 가로 넘침 없음 |
| 실제 Chrome 음성 | Samantha, 1배, 11개 발화 완료; 발음·스피커 출력 청취 평가는 미실시 |
| 마지막 영어 사전 실조회 | `route` 요청 시간 초과; 별도 HTTP 조회 522. 외부 서비스 가용성 한계 |
| Vercel | 빌드 설정·공개 키 검증·배포 ZIP 준비; 브라우저 로그인 화면과 CLI 미인증으로 업로드 미완료 |

브라우저 학습 QA의 YouTube·TTS·DictionaryAPI·MyMemory 응답은 결정적인 mock이며 실제 원본 영상 음성이나 외부 사전의 상시 가용성을 입증하지 않는다. 실제 Chrome 음성 검사는 별도로 수행했다. lint/typecheck 도구는 설치되어 있지 않아 구문 검사와 계약 테스트를 수행했다. iPad Safari 검증은 포함하지 않는다.

증거: [새 기능 결과](../tmp/qa-revision/results.json), [기존 학습 결과](../tmp/qa-short-dialogue-audio/results.json), [실제 음성 결과](../tmp/qa-voices/results.json), [테스트 로그](../tmp/revision-tests.log). 배포 조건과 SQL은 [HOSTING.md](HOSTING.md), [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md)에 기록했다.

---

## 2026-10-06 · YouTube 원본 Chapter 메타데이터 반영

공개 YouTube 메타데이터를 84개 카탈로그 URL에 영상당 20초·재시도 없음·동시 6개 제한으로 조회했다. 50개 영상에서 연속된 Chapter 제목·시작·끝 경계를 확인했고 34개는 Chapter 배열이 없었으며 요청 오류는 0개였다. 추출기가 놓친 34개는 별도 Chrome 탭에서 모두 다시 확인했다. Pizza Girls 한 편에서만 `자동 생성된 챕터입니다.`와 6개 경계를 확인했고, 나머지 33개는 표시되는 Chapter 버튼이 없었다. 생성 카탈로그의 Chapter는 총 284개다. 기존 대본 제목은 YouTube Chapter가 없는 영상의 학습 구간으로만 사용한다.

Faceytalk 단일 영상은 공개 조회에서 `chapters: null`이었고 Chrome에서도 Chapter 버튼이 없었다. 기존에 확인된 두 구간과 104초 이후 `목차 확인 중` 표시는 유지하며, 이를 YouTube 원본 Chapter로 표시하지 않는다. 콘텐츠 버전은 `2026.10.06-1`로 올려 이전 Chapter ID의 학습 기록이 새 구간에 연결되지 않게 했다. 수집 계약·명령·한계는 [CHAPTER_METADATA.md](CHAPTER_METADATA.md)에 기록했다.

| 실행 | 결과 |
|---|---|
| `npm run chapters:refresh -- --write --concurrency 6 --timeout-ms 20000` | 84개 조회, 50개 Chapter 있음, 34개 없음, 오류 0 |
| Chrome 표시 확인 | 추출기 미수집 34개 중 Pizza Girls 1개 자동 Chapter 확인, Faceytalk 포함 33개 버튼 없음 |
| `npm run build` | 영상 84개, Chapter 284개, 선택 가능한 학습 구간 3,230개 |
| Chapter 대상 테스트 | 22개 통과, 실패 0 |
| `npm test` | 189개 통과, 실패·건너뜀 0 |
| `npm run check` | JavaScript 45개 구문 검사 통과 |

---

## 2026-10-05 · 음성 재생 취소·정지 상태·빠른 입력 재수정

사용자가 목소리 선택 후에도 소리가 이상하다고 보고해 실제 재생 경로를 다시 수정했다. 이전 검증은 음성 엔진 시작·완료 이벤트 중심이었으며 사용자 기기의 발음·음질 정상 여부를 입증하지 않았다.

단어 클릭 경로에서 작업이 없는 반복·글자 컨트롤러도 전체 음성을 취소하던 동작을 제거했다. 각 컨트롤러는 자신이 소유한 활성 발화만 취소하며, 별도 `cancelWordSpeech()`로 화면 변경과 글자 입력 시 단어 발화를 중지한다. 단어 발화 객체를 끝까지 보존하고 취소된 이전 발화의 늦은 이벤트는 무시한다. 알파벳은 한 번에 하나씩 재생하며 빠른 타이핑은 현재 발화와 최신 대기 글자 최대 3개만 유지해 긴 지연을 막는다.

단어·알파벳·반복·설정 샘플 속도를 기본 **1배**, pitch와 volume을 **1**로 맞췄다. 발화 직후 음성 엔진에 `resume()`을 호출해 일시정지 상태에서 풀어 준다. 브라우저의 `paused` 값만 확인하지 않는다. 관련 근거는 [MDN resume](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/resume)와 [Chromium의 공유 TTS 정지 상태 보고](https://issues.chromium.org/41281349)다. 이 보고와 사용자 증상이 같은 원인이라고 확정하는 것은 아니다.

실제 Chrome 검사에 강제 일시정지 후 글자 입력과 단어 연속 클릭을 추가했다. 첫 시도에서는 마지막 단어 발화가 20초 안에 완료되지 않았다. 수정 후에는 샘플 2개, A·B·C·M·W·Z 6개, 연속 단어 요청 3개 **총 11개**를 확인했고 글자·마지막 단어의 타임아웃은 모두 false였다. 연속 클릭의 앞선 2개 발화는 새 요청으로 의도적으로 중단되고 마지막 발화는 시작·완료됐다. 모두 Samantha·기본 속도 1배였다.

자동 테스트 **155개 통과**, JavaScript **35개** 구문 검사 통과, 학습 흐름 브라우저 검사 **25개 통과**·JavaScript 오류 0. 회귀 테스트는 정지된 엔진 재개, 불필요한 취소 방지, 빠른 입력의 대기열 제한, 취소된 이벤트의 무시와 기존 학습 흐름을 포함한다. 브라우저 검사에서는 문장 반복 재시작의 비동기 재생 상태를 기다리도록 보정했다.

증거: [실제 음성 재생 결과](../tmp/qa-voices/results.json), [자동 테스트 로그](../tmp/speech-runtime-tests.log), [학습 흐름 검사 결과](../tmp/qa-short-dialogue-audio/results.json).

변경 파일: `public/lib/learning.js`, `public/lib/voice-settings.js`, `public/app.js`, 음성 관련 테스트와 두 QA 스크립트. 목소리 선택·기존 학습 기록·표현 묶기는 유지한다. 실제 스피커 출력을 청취하거나 사용자의 기기에서 같은 증상이 사라졌는지 확인한 결과는 아니다. iPad Safari 검증도 포함하지 않는다.

---

## 2026-10-03 · 영어 목소리 선택과 직접 표현 만들기

알파벳은 별도의 기기 기본 음성, 단어는 첫 번째 영어 음성을 사용하던 경로를 하나의 선택 설정으로 통합했다. 임의의 `cee`·`em` 철자 대신 실제 알파벳 대문자를 전달하며 입력 표시는 사용자가 입력한 대소문자를 유지한다. 일반 영어 목소리를 우선하고 알려진 효과음 목소리는 대안이 있을 때 제외한다. ‘음성 설정’에서 지역별 목소리의 단어·알파벳 샘플을 비교하고 전체 영어 목록에서 선택할 수 있다. 샘플 듣기는 설정을 저장하지 않으며 실제 선택만 기기 브라우저에 저장한다. 늦게 로드된 목소리 목록 변경, 이전 목소리 부재, 저장·재생 실패도 처리한다.

‘내 표현 만들기’를 추가했다. 같은 문장 안의 이어진 단어를 위치별 버튼으로 골라 미리 보고 묶는다. 추천 표현에 없는 항목도 생성 가능하며 반복되는 단어의 특정 위치를 선택할 수 있다. 떨어진 단어·문장 경계를 넘는 조합은 생성 전에 안내한다. 겹치는 단어의 개별 선택은 해제해 중복 학습을 줄인다. 학습 진입 시 기존 표현 저장 계약으로 저장하며 빈칸·철자·단어장·교재 내보내기·새로고침 복원에 함께 적용한다. 뜻·IPA·예문은 새로 만들어내지 않는다. 기존 진도와 콘텐츠 버전은 유지하며 신규 의존성·DB 변경은 없다.

| 실행 | 결과 |
|---|---|
| `npm test` | **152개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **35개** 구문 검사 통과 |
| `scripts/qa-practice.mjs` | 격리된 Chrome의 **25개 브라우저 검사 통과**, JavaScript 오류 0 |
| `scripts/qa-voices.mjs` | 실제 Chrome 영어 목소리 **25개** 확인, Samantha 샘플 2개와 개별 알파벳 A·B·C·M·W·Z **총 8개**의 시작·완료 이벤트 확인 |

브라우저 검사는 샘플과 선택 저장의 분리, 선택 후 새로고침 복원, 저장 실패 시 이전 선택 복구, 선택한 음성의 알파벳 적용을 포함한다. 새 표현은 테스트 저장소 직접 주입 대신 실제 선택 버튼으로 `can we do`를 만들어 빈칸·채점·저장·다운로드·복원을 확인했다. 기본 학습 흐름과 1440·820·390px 배치도 다시 검사했다. 별도 코드 검토에서 반복 단어 선택과 표현의 겹침, 음성 저장 실패 시 표시 불일치를 발견해 수정했다.

증거: [브라우저 결과](../tmp/qa-short-dialogue-audio/results.json), [표현 만들기 화면](../tmp/qa-short-dialogue-audio/custom-phrase.png), [실제 음성 이벤트](../tmp/qa-voices/results.json), [음성 설정 화면](../tmp/qa-voices/settings.png), [자동 테스트 로그](../tmp/voice-phrase-tests.log).

외부 지침: 선택 버튼은 [W3C APG 버튼 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/button/)의 `aria-pressed` 상태를 사용한다. 목소리 목록과 지연 로딩은 [MDN getVoices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices), [voiceschanged](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event)를 참고했다.

검증 한계: 실제 음성 엔진의 시작·완료를 관찰했으며 스피커 출력의 발음·음질을 청취 평가한 결과는 아니다. 목소리 목록은 기기마다 다르다. YouTube 원본 음성, iPad Safari·가상 키보드, 운영 Supabase와 미확인 Chapter 경계는 이번 검증 대상에 포함하지 않았다. 아래 2026-09-29의 수동 표현 UI 삭제 기록은 당시 버전의 이력이며 이번 요청으로 직접 선택 UI를 다시 제공한다.

---

## 2026-10-03 · 로컬 실행과 최신 학습 흐름 브라우저 검증

이전 작업의 미완료 항목인 최신 버전 브라우저 검증을 진행했다. 콘텐츠 버전은 `2026.09.30-1`을 유지하며 앱 기능과 콘텐츠는 변경하지 않았다. 사용자 앱은 `http://localhost:4173`, 검증은 별도 `http://localhost:4174`와 격리된 Chrome 컨텍스트에서 실행해 기존 진도를 보존했다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 영상 **84개**, 선택 가능한 구간 **3,216개**, HTML/SVG 예제 생성 성공 |
| `npm test` | **143개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **32개** 구문 검사 통과 |
| `scripts/qa-practice.mjs` | Chrome 브라우저 **23개 항목 통과**, JavaScript 오류 0 |
| 로컬 접속 | 메인 페이지와 catalog.json HTTP **200** |

브라우저에서 Chapter 1의 26–65초 전체 범위 요청과 완료 후 대화 학습 전환, 지원 속도 구분, 받아쓰기 후 단어 선택, Mum·Please의 7단계 자동 진행, 완료 목록 새로고침 복원, 영상 복귀와 답안 보존을 확인했다. 기존 표현의 빈칸·채점·저장·교재 다운로드, 저장 실패 시 입력과 반복 버튼 복구, 탭 이탈 시 음성·문장 재생 취소, 모션 줄이기, 1440·820·390px에서 문서 가로 넘침과 입력 버튼 배치도 확인했다.

검사 스크립트에서 속도 option의 `disabled` 속성을 직접 확인하도록 보정하고, 자동 진행 체크박스를 현재 보이는 학습 화면으로 한정해 숨겨진 단어장 화면과의 선택자 중복을 해소했다. 새 의존성은 추가하지 않았고 기존 Playwright 설치와 Chrome을 사용했다.

증거: [브라우저 결과 JSON](../tmp/qa-short-dialogue-audio/results.json), [390px 화면](../tmp/qa-short-dialogue-audio/layout-390.png), [820px 화면](../tmp/qa-short-dialogue-audio/layout-820.png), [1440px 화면](../tmp/qa-short-dialogue-audio/layout-1440.png), [다운로드 교재](../tmp/qa-short-dialogue-audio/phrase-workbook.html), [자동 테스트 로그](../tmp/local-continuation-tests.log), [구문 검사 로그](../tmp/local-continuation-check.log).

검증 한계: YouTube와 TTS는 테스트 대역으로 요청·상태 전환을 확인했다. 실제 영상 시간 진행과 스피커 출력, iPad Safari·가상 키보드, 운영 Supabase·HTTPS 호스팅은 검증하지 않았다. Faceytalk Chapter 2의 실제 끝과 나머지 5개 Chapter 제목·시각도 여전히 미확인이다. 아래 과거의 브라우저 실행 제한 기록은 당시 환경의 결과다.

---

## 2026-09-30 · Chapter 우선 시청·속도·초기 재생 수정

현재 콘텐츠 버전은 `2026.09.30-1`이다. 84개 영상과 선택 가능한 학습 구간 3,216개를 생성했다. Faceytalk은 Chapter 1 `Facey talk initiates` 26–65초의 대화 6개와 Chapter 2 `Sharing struggles` 65–104초의 확인된 대화 5개를 반영한다. 104초 이후는 번호 없는 `목차 확인 중`이며, Chapter 2의 실제 끝과 남은 5개 Chapter 제목·시각을 확인한 상태로 표시하지 않는다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 영상 **84개**, 선택 가능한 구간 **3,216개**, 콘텐츠 버전 `2026.09.30-1` 생성 성공 |
| `npm test` | **143개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **32개** 구문 검사 통과 |
| Chapter 계약 테스트 | Chapter 1·2 경계와 대화 수, 104초 이후 미확인 영역, 전체 범위 비반복 재생과 종료 상태 확인 |
| 속도 계약 테스트 | 0.25배 제거, 0.5–1.2배 요청과 YouTube 실제 지원 속도의 분리, 적용 속도 이벤트 확인 |
| 브라우저 QA 시도 | Playwright 브라우저가 실행 중 종료되고 브라우저 UI 제어도 정책상 허용되지 않아 실제 화면·음성·오버레이 확인 **미실행** |

Chapter를 열면 해당 범위를 먼저 끊김 없이 재생하고, 종료 시 대화별 듣기·받아쓰기·단어 연습으로 전환한다. `시청했어요 · 대화 학습 시작`으로 명시적으로 완료할 수도 있고 학습 중 `Chapter 전체 다시 보기`로 돌아갈 수 있다. 플레이어는 사용자가 재생을 누를 때 영상을 불러와 초기의 불필요한 cue/일시정지 전환을 제거했다.

요청 속도는 0.5부터 1.2까지 제공하고 YouTube가 지원한다고 보고하면 0.75배를 보조 옵션으로 추가한다. YouTube IFrame API가 영상에서 지원한다고 반환한 값만 활성화한다. 0.6배 같은 세분 속도는 해당 영상에서 지원되지 않으면 사용할 수 없다.

초기 재생 경로 변경은 `동영상 더보기` 같은 YouTube 자체 오버레이 노출을 줄일 수 있지만 완전 제거를 보장하지 않는다. 앱이 YouTube iframe 내부 UI를 숨기지 않으며 `rel=0`은 관련 영상을 없애는 옵션이 아니다. [재생속도 API](https://developers.google.com/youtube/iframe_api_reference#getAvailablePlaybackRates), [플레이어 매개변수](https://developers.google.com/youtube/player_parameters#rel).

실제 YouTube 시간 진행, 음성 출력, 초기 오버레이, 데스크톱·iPad·휴대폰 배치는 이번 환경에서 확인하지 못했다. 아래 기록은 각 날짜 당시 버전에 대한 검증이며 현재 버전의 브라우저 증거로 재사용하지 않는다.

---

## 2026-09-29 · 짧은 구문·빈칸 원본 음성 재수정

현재 콘텐츠 버전은 `2026.09.29-2`다. 사용자 피드백에 따라 15–30초 묶음을 약 5–15초로 줄이고, 빈칸 단계는 해당 문장 전체의 YouTube 원본 음성을 반복하도록 변경했다. 소리 퀴즈의 단어 TTS는 유지한다. 상세 계약과 확인되지 않은 목차 범위는 [SHORT_DIALOGUE_AUDIO.md](SHORT_DIALOGUE_AUDIO.md)에 있다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 영상 **84개**, 선택 가능한 구간 **3,218개**, 독립 HTML/SVG 예제 생성 성공 |
| `npm test` | **127개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **29개** 구문 검사 통과 |
| 독립 코드 검토 | **OKAY**. 구간·부분 목차·문장 음성·취소 경합·버전 안내 재검토 완료 |
| 브라우저 QA 시도 | 서버 `listen EPERM`, Chrome `SIGABRT`/`kill EPERM`으로 시작 실패. 앱 흐름 검증 **미실행** |

구간 중앙값은 7초, 최대 15초다. 3,165개가 5–15초이고 명시된 문장과 경계 조각 53개가 5초 미만이다. Faceytalk 첫 네 구간은 26–34/33–37/37–41/41–49초로 각각 유지한다. 첫 두 구간의 1초 겹침은 원본 캡처의 `Uss!` 범위를 포함하기 위한 것으로 음성 정렬 완료를 뜻하지 않는다.

7개 Chapter 전체 구분은 완료되지 않았다. 확인된 `Facey talk initiates`의 첫 네 구간만 반영하고, 49초 이후는 번호 없는 ‘목차 확인 중’으로 표시한다. `confirmed-excerpt`, `expectedChapterCount: 7`, `partial-user-confirmed`를 보존하며 Chapter 1이 49초에 끝난다고 단정하지 않는다. 나머지 6개 제목·시각은 사용자에게 요청한 상태다. 생성물의 126개 목차 노드는 전체 영상·도입부·미확인 영역도 포함한다.

회귀 검증은 원본 cue 무분할·무중복, 명시 구간 독립 유지, 정확한 문장/버전/영상 매칭, 문장 전체 범위 재생, 로딩 중 멈춤, 오래된 비동기 결과 무시, 수동 재시작, 동기 재생 차단·오류 상태를 포함한다. [전체 테스트 로그](../tmp/short-dialogue-tests.log), [브라우저 실행 실패 로그](../tmp/short-dialogue-browser.log).

실제 영상 시간 진행·음성 출력·반응형 화면은 이번 환경에서 확인하지 못했다. 갱신한 브라우저 QA 스크립트의 통과를 주장하지 않으며 아래 이전 버전의 검증 기록을 현재 버전의 증거로 재사용하지 않는다. 새로운 의존성과 DB 마이그레이션은 없다.

---

## 2026-09-29 · 대화 구간·입력·재생·완료 목록

콘텐츠 버전 `2026.09.29-1`. 대본 목차 아래 대화 단위로 구간을 묶고 재생 범위와 받아쓰기 대상을 일치시켰다. 단어 선택 자동 스크롤, 수동 표현 묶기 UI 삭제, 알파벳 이름 음성·입력 대소문자 보존, 입력/확인 버튼 정렬, 명시적 구간 재생과 세분화한 속도, 저장된 독립 읽기 기반 완료 목록을 반영했다. 신규 의존성과 DB 마이그레이션은 없다. 상세 계약은 [LEARNING_REVISION.md](LEARNING_REVISION.md)에 있다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 영상 **84개**, 목차 **125개**, 선택 가능한 대화 **1,412개**, 예제 HTML/SVG 생성 성공 |
| `npm test` | **117개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **27개** 구문 검사 통과 |
| 독립 최종 코드 검토 | **OKAY**. 재생·속도·레이아웃 구조·완료 조건·목차 제목 보정 검토 완료 |
| 브라우저 QA | **미실행**. 현재 세션의 로컬 서버 포트 열기와 Chrome 실행 제한 |

대화 길이의 중앙값은 17초, 최대 30초다. 1,265개는 15–30초이며 나머지 147개는 목차·쉼·비음성 경계 등에서 짧게 남았다. 6개 영상의 대본 에피소드 제목 41개를 사용하고, 나머지 영상에는 전체 영상 아래 대화를 표시한다. 목차 시각이 원본 자막 중간에 걸친 5곳은 자막 시작으로 1–4초 앞당겼으며 원래 시각과 사유를 보존했다.

독립 검토에서 발견한 `Cubby` 대본의 `Puppy` 제목 오류는 영상 제목에 따라 교정하고 원래 표기·시각·보정 이유를 보존했다. 해당 제목과 출처 기록에 대한 회귀 검증을 추가했다.

회귀 검증에는 원문 참조 보존과 목차 경계, 대기 중인 재생 취소, 구간 처음부터 재생, 플레이어 준비 전 선택 속도 보존, 알파벳 이름과 대소문자 상태, 저장 후 완료 목록 복원, 과거 콘텐츠 기록의 분리가 포함된다. 테스트 출력은 [revision-tests.log](../tmp/revision-tests.log)에 있다. 구문 검사는 lint/정적 타입 검사를 대체하지 않는다.

`scripts/qa-practice.mjs`에는 목차·긴 대화·선택 스크롤·소문자 표시·완료 목록·화면 크기별 입력 버튼 위치 검사를 갱신했다. Chrome 실행이 종료되며 `kill EPERM`이 보고되어 실제 브라우저 검증은 수행하지 못했다. 실제 TTS 소리, YouTube 시간 진행, 화면 배치와 모바일 키보드 검증은 남아 있다. 아래 2026-09-28의 브라우저 통과·서버 응답 기록은 이전 버전에 대한 기록이며 이번 수정의 검증 근거로 사용하지 않는다.

---

## 2026-09-28 · 단어 연습 고도화

뜻·표현 → 짚어 읽기 → 철자 쓰기 → 빈칸 → 소리 퀴즈 → 뜻 퀴즈 → 혼자 읽기로 안내 순서를 개편했다. 정답 저장 후 자동 진행, 여러 단어의 순차 연습, 연속 표현 묶기, 영상 일시정지와 복귀, 반복 음성, 입력 확대 효과, IPA 강세 표시, 관련어 39개 묶음을 구현했다. 신규 npm 의존성과 DB 마이그레이션은 없다. 상세 동작과 학습 근거는 [PRACTICE_UPGRADE.md](PRACTICE_UPGRADE.md)에 있다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 영상 84개·학습 구간 8,901개, 관련어 자료, HTML/SVG 예제 생성 성공 |
| `npm test` | **104개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **27개** 구문 검사 통과 |
| `scripts/qa-practice.mjs` | Chrome 브라우저 점검 **17개 항목 통과**, JavaScript 오류 0 |
| 독립 코드 재검토 | **OKAY**. 저장 실패 후 반복 버튼 상태와 예문 번역의 지적 사항 해소 |
| 앱 서버 | `http://localhost:4173/` HTTP **200** 확인 |

브라우저에서는 Mum과 Please를 각각 7단계 끝까지 진행해 다음 단어 전환과 완료 화면, 읽기 복습 저장을 확인했다. 오답 재시도, 자동 진행 끄기, 이동 후 남은 타이머 취소, 영상 복귀 시 답안 보존, 빈칸·소리 반복, 탭 이탈과 복귀도 검사했다. `can we do`를 한 표현으로 묶어 빈칸·채점·저장·교재 다운로드·새로고침 복원을 확인했다. 철자·빈칸·소리 퀴즈의 저장 실패에서는 입력 복구와 반복 음성 버튼의 문구/ARIA/실제 재시작 동작을 확인했다. 모션 줄이기 설정과 너비 820px·390px에서 가로 넘침 없는 화면을 확인했다. 관련어 자료는 39개 묶음·131개 예시 항목이며 원본과 공개 자료가 바이트 단위로 같다.

검증 자료는 [결과 JSON](../tmp/qa-practice/results.json), [데스크톱 화면](../tmp/qa-practice/01-meaning-desktop.png), [820px 화면](../tmp/qa-practice/layout-820.png), [390px 화면](../tmp/qa-practice/layout-390.png), [다운로드 교재](../tmp/qa-practice/phrase-workbook.html)에 있다. 격리된 브라우저 컨텍스트와 localhost:4174를 사용해 사용자의 진도를 초기화하지 않았다.

검증 한계: 위 흐름 테스트의 YouTube·TTS는 제어 가능한 대역으로 재생·중지 호출을 검증했다. 별도 실제 Chrome에서는 YouTube iframe 준비와 OS 영어 음성을 확인했으나 실제 영상 시간 진행은 확인하지 못했다(`paused=true`, `readyState=0`). 스피커 출력·음질, 실제 iPad Safari와 가상 키보드, 운영 Supabase는 이번 검증에 포함하지 않았다. 구문 검사는 lint/타입 검사와 같지 않다. 아래 기록은 이전 개편의 이력이다.

---

2026-09-25 · 통합 학습실 개편 · 콘텐츠 버전 `2026.09.25-3`

## 결과

독립 critic 검토 후 학습 흐름을 **듣기 → 받아쓰기·단어 선택 → 선택 단어 학습**으로 개편했다. 별도 오답 선택 단계를 제거하고, 같은 공간에서 선택 단어와 연습 종류를 바꾼다. 현재 답안의 오답과 누적 단어장을 분리했다. 유료 API와 신규 npm 의존성은 추가하지 않았다.

| 실행 | 결과 |
|---|---|
| `npm run build` | 84개 영상, 학습 구간 8,901개, 예제 HTML·SVG 생성 성공 |
| `npm test` | **86개 통과**, 실패·건너뜀 0 |
| `npm run check` | JavaScript **22개** 구문 검사 통과 |
| 독립 코드 리뷰 | **APPROVE**. 검토 범위 내 CRITICAL/HIGH/MEDIUM 잔여 이슈 0 |
| 기존 앱 서버 | `http://localhost:4173/` HTTP 200 확인 |

구문 검사는 lint나 전체 애플리케이션 정적 타입 검사를 대체하지 않는다. 계정 테스트는 mock·계약 테스트이며 실제 PostgreSQL 실행 결과가 아니다.

## 콘텐츠와 문장 단위

- 원본/정리본 84쌍을 처리했다. 원본 cue 8,942개에서 명시적 묶음을 반영한 구간 8,938개를 구성하고 비음성 구간 37개를 선택 목록에서 제외했다.
- 기본 구간은 원본 캡처 파일의 cue 경계를 따른다. 사용자가 제시한 Faceytalk 첫 세 묶음은 별도 manifest로 보존했다.
- 첫 세 구간은 **26–34초, 33–37초, 37–41초**다. 첫 묶음의 `Uss!` 원본 종료 시각까지 포함해 첫 두 구간이 1초 겹친다. 영상 음성과의 정밀 대조 완료로 표시하지 않는다.
- 원본 참조와 수정문 출처를 보존한다. 수정문이 원본 cue 전체를 정확히 덮을 때만 정리본을 사용하고, 그렇지 않으면 원본 대사를 사용한다.
- 118개 구간에서 화자·음악 등 비발화 주석을 제거했다. 선택 가능한 문장에 대괄호 주석이 남지 않는지 전체 자료를 검사했다.
- Faceytalk 학습 단어를 모두 포함하는 내장 어휘 271개에 뜻·학습용 미국 영어 IPA·설명을 제공한다. 비표준 어린이 말과 가상 단어는 별도로 설명한다.
- 기존 표현은행 76개는 각각 새 대화 두 세트를 가진다. 선택 단어에 정확히 연결되는 표현에만 해당 대화를 표시한다.
- 콘텐츠 버전이 달라진 기존 학습 기록은 보존하되 구간 번호만으로 새 대본에 연결하지 않는다.

상세 수치는 [CATALOG_REPORT.json](CATALOG_REPORT.json), 묶음 결정은 [WORKSPACE_REDESIGN.md](WORKSPACE_REDESIGN.md)에 있다.

## 실제 브라우저 확인

Chrome의 별도 QA 주소 `localhost:4174`에서 확인했다. 사용자가 쓰는 `localhost:4173`의 진도를 테스트 초기화에 사용하지 않았다.

| 항목 | 관찰 |
|---|---|
| 현재 오답 선택 | 첫 문장에서 `Mom`으로 쓰고 `with`를 누락하면 원문 `Mum`, `with`만 자동 선택 |
| 추가 선택 | 원문의 `Please` 등을 직접 눌러 선택·해제하고 확정한 단어로 연습 진입 |
| 정답 재제출 | 문장 전체 정답 시 ‘문장의 단어를 모두 맞혔어요’, 자동 선택 0개. 과거 등록 단어는 단어장에 유지 |
| 저장 후 복원 | 새로고침 후 선택 단어·연습 결과 유지. ‘단어 다시 고르기’에서 저장 답안·비교 결과·선택 버튼 즉시 복원 |
| 같은 공간 이동 | Faceytalk/Please 사이 이전·다음 이동, 7가지 연습 종류 표시, 다음 문장은 33초 구간의 듣기로 이동 |
| 철자 입력 | 실제 키 입력 `please`에서 마지막 글자 `E`를 크게 표시. 삭제는 새 글자 읽기로 처리하지 않음 |
| 뜻 퀴즈 | Mum에 `mom` 오답, 재시도 `mum` 정답. with 뜻 퀴즈 정답과 횟수 저장 |
| 소리 퀴즈 | with 정답·횟수 저장. 답안 전 단어 제목·원문·영상 제목의 접근성 이름까지 가림 |
| 뜻·표현 | Please의 IPA·뜻·설명·새 대화 두 세트 표시 |
| 단어장 | 등록일·원본 영상·전체 연습 횟수·종류별 정답/시도 표시, 목록 전체의 이전·다음 단어 이동 |
| 읽기 확인 | Please 독립 읽기 평가 후 다음 날 복습 일정 저장 |
| 반응형 | CSS 1440×1000 및 820×1180에서 가로 넘침 없음. 긴 설명도 패널 내부에서 스크롤하며 연습 메뉴·이동 영역의 문서상 위치 유지 |
| HTML 교재 | 브라우저에서 받은 최신 파일을 확인. 카드 제목이 현재 선택한 **Faceytalk, Please 두 개**와 일치 |
| 오류 | 최종 QA 탭의 error/warn 로그 0개 |

철자 음성은 순차 TTS 호출과 취소 동작을 자동 테스트로 검증했다. 실제 기기에서 들리는 음량·발음 품질은 별도 확인이 필요하다. 화면 크기 검증은 Chrome 시뮬레이션이며 실제 iPad Safari/가상 키보드 검증이 아니다. YouTube 실제 재생은 이전 버전에서 확인했고, 이번에는 반복 구간 로직의 회귀 테스트와 새 구간 링크를 확인했다.

## 자동 회귀 검증과 리뷰 수정

- 철자·누락·추가 단어를 정렬해 비교하고, 불필요하게 추가한 입력 단어를 학습 후보에서 제외한다.
- 같은 단어의 반복 출현을 하나의 선택 항목으로 묶고 전체 원문 위치를 보존한다.
- 현재 선택 초기화, 최초 등록일 유지, 연습 종류별 횟수, 읽기 복습 일정을 검사한다.
- 기존 형식의 미학습 단어와 연습 횟수를 유지한다. 뜻에 영어 정답이 그대로 포함된 경우 뜻 퀴즈에서 답을 노출하지 않는다.
- 읽기 평가를 연속으로 누르거나 이전 단어 저장이 늦게 끝나도 중복 횟수·다른 단어의 결과 노출을 막는다.
- 저장·학습 시작·내보내기·닉네임·초기화 요청은 시작 당시 계정 범위를 검사한다. 계정 A→B, 게스트→로그인 경쟁 조건에서 잘못된 계정으로 요청하거나 로컬 자료를 변경하지 않는지 검사했다.
- 초기화 후 선택 단어·답안 DOM·재개 정보도 제거한다. 기존 자료의 등록일이 없으면 날짜를 만들어내지 않는다.
- DB의 선택 key/단어 key 정합성, 데이터 크기·횟수 경계, CAS·계정 격리 계약과 기존 보안 제약 보존을 검사한다.
- 교재 퀴즈 코드는 네트워크 없이 실행해 입력 판정을 확인했다. HTML/SVG 삽입 문자열 이스케이프도 검사했다.

## 교재와 카드

[예제 HTML](../examples/faceytalk-first-scene.html)과 [예제 SVG](../examples/faceytalk-first-scene.svg)는 빌드로 생성한다. 예제는 첫 구간의 표현은행 항목 두 개를 사용하며, 앱의 내보내기는 사용자가 확정한 선택 단어를 사용한다.

이번 브라우저 HTML 다운로드는 실제 생성 파일 내용까지 확인했다. SVG는 생성 코드·예제·테스트를 확인했으나 브라우저 다운로드 완료는 확인하지 못했다. 교재는 외부 자산 없이 열 수 있고 영상 링크에는 인터넷이 필요하다. 교재에서 푼 결과는 앱 진도에 동기화되지 않는다.

## 남은 외부 검증

- 실제 iPad Safari의 터치·가상 키보드·TTS·YouTube 재생.
- 전체 캡처 대본과 실제 영상 음성의 일치, 특히 Faceytalk 첫 두 묶음의 겹친 시각.
- 실제 Supabase의 RLS·동시 요청·메일·계정 삭제·기기 간 동기화. 새 프로젝트는 bootstrap, 기존 프로젝트는 `202609250001_add_dictations.sql` 다음 `202609250002_selected_vocabulary.sql` 순서로 적용한다. 이 세션에서는 운영 DB에 적용하지 않았다.
- 공개 HTTPS 호스팅. 현재 서버는 Mac의 localhost이며 실제 iPad 접속 경로가 아니다.

설정은 [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md), 학습 근거와 한계는 [RESEARCH.md](RESEARCH.md)에 있다. 이 기록은 소프트웨어 동작 검증이며 학습 효과를 입증한 결과가 아니다.
