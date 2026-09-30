# 구현·검증 계획

> 이전 개정의 기록입니다. 현재 학습 단위와 단어 선택 흐름은 [학습실 개편](WORKSPACE_REDESIGN.md) 및 [PRD 1.2](PRD.md)를 따릅니다. 아래의 이전 구간 구성·별도 오답 단계는 대체되었습니다.


> 문장 단위 학습과 받아쓰기 변경은 [SENTENCE_REVISION.md](SENTENCE_REVISION.md)가 우선한다. 아래 초기 20초 묶음·타깃이 있는 구간만 선택하는 계약은 해당 변경으로 대체했다.

모드: 인터뷰 종료 → 직접 계획 → 독립 리뷰 → 기존 요청에 따른 로컬 구현. 일부 설치된 architect/researcher 모델이 현재 계정에서 지원되지 않아 해당 합의 검토 완료를 주장하지 않는다. `critic` 검토로 계획의 누락을 확인하며 실제 승인 증거를 따로 기록한다.

## 설계 원칙

1. 읽기와 철자/듣기 결과를 구분한다.
2. 준비된 84개 콘텐츠 전체를 다루고 출처를 보존한다.
3. 기본 학습은 유료/실시간 모델에 의존하지 않는다.
4. 계정 진도는 격리하고 외부 검증 공백을 숨기지 않는다.
5. 한 번에 읽을 대상 하나를 강조한다.

## 구조와 담당 경계

- `content/expressions.json`: 원본 교육용 표현은행. term, aliases, ipa, meaningKo, explanationKo, dialogues[2]를 갖춘다.
- `scripts/build-catalog.mjs`: 원본/정리본 파싱, 구간 분리, 출처 정합성/매칭, `public/data/catalog.json`, `public/data/expressions.json`, `public/data/videos/<id>.json` 생성. 품질 보고 `docs/CATALOG_REPORT.json`.
- `public/index.html`, `public/styles.css`, `public/app.js`: 영상 목록과 학습실, 단계별 연습, 키보드/터치 추적, 계정 UI.
- `public/lib/player.js`: 공식 IFrame API와 구간 제어, 오류/배속 상태. 타이머 정리 및 자동 재생 거부 안내.
- `public/lib/learning.js`: 정답 정규화, 복습 일정, 표현 연결. 네트워크 없는 단위 테스트.
- `public/lib/workbook.js`: 독립 HTML과 카드/퀴즈 생성. 외부 텍스트 이스케이프.
- `public/lib/store.js`, `public/lib/auth.js`: 게스트 저장과 Supabase 세션/진도. 게스트는 공개 계정의 대체 완료로 간주하지 않음.
- `supabase/schema.sql`: RLS, 최소 프로필/리뷰/학습일 기록, 원자적 무료 제한, 삭제 정책.
- `public/config.js`, `wrangler.jsonc`: 공개 환경 설정/정적 배포. 비밀 값 없음.
- `scripts/serve.mjs`, `tests/*.test.mjs`: Node 기본 모듈로 실행/검증. 추가 앱 패키지 없음.

## 공통 콘텐츠 계약

표현은행 파일은 배열: `{id, term, aliases:[], ipa, meaningKo, explanationKo, dialogues:[{titleKo, lines:[{speaker,en,ko}]}]}`. 정확히 2개 dialogue, 각각 최소 2발화. 서로 다른 상황의 새 예문.

카탈로그: `{version, generatedAt, videos:[{id,number,title,duration,captionType,sourceUrl,sceneCount,expressionCount,qualityFlags}]}`.

영상: `{id,title,duration,captionType,sourceUrl,sourceFiles,qualityFlags,scenes:[{id,title,start,end,cues:[{id,start,end,text,originalText,qualityFlags}],targets:[{expressionId,cueId,quote,start,end,matchStart,matchEnd}]}]}`. target start/end는 재생 초, matchStart/End는 quote 내 JS 문자열 인덱스. 모든 타깃은 실제 quote 부분 문자열과 은행 term/alias가 대응. 표현 정보는 공통 은행에서 조회.

### 검토 후 확정한 실행 계약

- 각 cue는 원본과 시간이 겹치는 모든 `originalCueRefs: [{id,start,end,text}]`를 보존한다. 0초 cue는 겹치는 원본의 양수 구간으로 보정하며 불가능하면 제외한다. `originalText`는 편의용 결합문이고 일대일 정렬을 의미하지 않는다.
- 구간은 cue 순서로 구성한다. 20초 이상에서 문장 종결 또는 3초 이상 공백을 만나면 종료하고 60초를 목표, 90초를 상한으로 한다. 개별 cue가 상한을 넘는 경우 플래그를 남긴다. 마지막 짧은 구간은 상한을 지킬 수 있을 때만 이전 구간에 합친다.
- 표현은 대소문자/곧은·굽은 apostrophe를 정규화하여 단어 경계로 일치시킨다. 다단어 우선 → 쉬운 난도 → 먼저 나온 위치 → ID 순으로 정렬하고 구간당 최대 5개, 동일 표현은 한 번 선택한다. 최소 1개 매칭이 있는 구간만 기본 학습 목록에 포함한다. 미매칭 구간은 원문 접근용으로 보존하고 타깃을 지어내지 않는다. 영상별 최소 1개 학습 구간을 빌드 검증하며 실패하면 표현은행 보강 후 재생성한다.
- 표현의 `difficulty`는 `starter | everyday`이며 starter는 짧은 고빈도 단어/2~3단어 생활 표현이다. 생성 자료는 `generationMethod: editorial-bank+deterministic-match`, `sourceStatus: captured-not-audio-verified`, `reviewStatus: unreviewed`, `contentVersion`을 포함한다. 새 대화는 `original-editorial`로 표시한다.
- 진도 레코드: `{learnerId,videoId,sceneId,expressionId,contentVersion,spelling:{attempts,correct,hints,lastAnswer},reading:{result,lastCheckedAt},review:{step,dueAt,lastReviewedDate},updatedAt}`. 읽기 result는 `independent | helped | null`. 계정 owner ID는 인증 서버가 결정한다. 기본 별칭 학습자 하나를 지원하며 다른 계정의 별칭/진도를 공유하지 않는다.
- 게스트는 `wordtrail:guest:v1`, 계정은 서버 RLS 레코드로 구분한다. 클라우드 쓰기 실패는 성공으로 표시하지 않으며 재시도할 수 있게 안내한다. 게스트 기록을 로그인 계정에 자동 병합하지 않는다.
- `start_learning(video_id,scene_id)` RPC는 auth.uid()에 묶인 UTC 날짜별 카운터를 원자적으로 갱신한다. 이미 시작한 구간은 재개로 취급하고 다시 차감하지 않는다. 기본 한도 10은 서버 설정 테이블 값이다. 클라이언트는 거절/네트워크 실패 시 새 구간 시작을 승인하지 않는다.
- 본인 데이터 export는 RLS 아래 프로필/진도/사용 기록을 JSON으로 제공한다. 진도 초기화는 본인 학습 데이터만 삭제한다. 계정 삭제는 사용자 토큰을 검증하는 별도 Supabase Edge Function이 service-role로 Auth user를 삭제하며 FK cascade로 개인 데이터를 삭제한다. service-role은 브라우저에 절대 제공하지 않는다.

### 프런트엔드 모듈 인터페이스

- `learning.js`: `normalizeAnswer(text)`, `checkAnswer(input,expected)`, `nextReview(previous,independent,now)`, `isDue(record,now)`, `escapeHtml(text)`, `speak(text,onStatus)`.
- `player.js`: `createPlayer(element,onStatus)` → `{load(videoId,start,end),play(),pause(),setLoop(bool),setRate(number),destroy()}`. load는 사용자가 재생을 누를 때 호출하며 Promise 반환. 상태 콜백 `{type,message}`.
- `workbook.js`: `buildWorkbook({title,video,scene,expressions})` HTML 문자열, `downloadWorkbook(args)`, `downloadCards(args)`.
- `auth.js`: `createAuth(config)` → `{configured,confirmationStatus,getSession(),subscribe(fn),signUp(email,password),signIn(email,password),signOut(),deleteAccount()}`. getSession/계정변경은 async, subscribe는 해제함수 반환. session은 null 또는 `{user:{id,email},access_token}`. 오류는 throw. 확인 링크의 token/code를 세션으로 채택하지 않으며, 확인 후 이메일·비밀번호로 명시적으로 로그인한다. `confirmationStatus`는 `returned | error | null` 일반 안내용이다.
- `store.js`: `createStore(auth)` → `{load(),saveProgress(record,expectedUpdatedAt=null),startLearning(videoId,sceneId),exportData(),resetProgress(),setNickname(name)}`. 모두 async. load 반환 `{nickname,progress:[...],mode:'guest'|'cloud'}`; startLearning 반환 `{allowed,remaining,reason?}`. 기본 learnerId는 `default`. 저장은 새 `updatedAt`을 포함한 레코드를 반환하며, 화면은 반환값을 다음 저장에 사용한다. 동일 표현 변경은 화면에서 직렬화하고 서버의 `save_progress` RPC가 예상 수정 시간 비교로 오래된 덮어쓰기를 거절한다.
- `config.js`: `window.WORD_TRAIL_CONFIG={supabaseUrl:'',supabaseAnonKey:''}`. 공개 환경 값만 포함.

독립 critic 검토(2026-09-25)의 REVISE 5항목을 위 계약과 별도 AC 테스트 매트릭스로 반영한 뒤 APPROVE를 받았다. 전체 ralplan 합의 검토를 수행한 것은 아니다.

### 구현에서 추가로 확정한 사항

- 76개 표현의 `aliases`는 모두 빈 배열이다. 원문 표기와 학습할 철자·IPA가 달라지지 않도록 동의어·굴절형을 같은 답으로 치환하지 않는다.
- 보정한 cue를 시작 시간과 원본 순서로 안정 정렬한 뒤 구간을 만든다. 원본 겹침이 없는 cue는 보존하되 학습 타깃에서 제외한다.
- YouTube 출처는 HTTPS 공식 호스트, 허용 경로, 정확한 11자리 ID를 검사하고 정리본·원본의 영상 ID도 비교한다.
- 클라우드 진도 직접 INSERT/UPDATE는 허용하지 않는다. 학습 시작 원장, 기본 학습자, 구간당 최대 5개 기록, JSON 8KB 제한과 저장 충돌 검사를 서버에서 적용한다.
- `schema.sql`은 새 프로젝트 최초 설치용이다. 기존 DB 업그레이드에는 별도 migration이 필요하다. 실제 DB/RLS 동작은 외부 환경 검증 항목으로 남긴다.

## 순서

1. PRD/근거/인터뷰 산출물을 작성하고 계획 리뷰. 수정 후 구현 시작.
2. 콘텐츠, 화면, 계정/저장을 분리해 병렬 작업. 동일 파일 소유권 중복 금지.
3. 부모 에이전트가 플레이어·복습·내보내기 통합. 소규모 데모가 아닌 84개 전체 입력 생성.
4. 파서/콘텐츠 스키마/매칭/정답/복습/HTML escaping/계정 전환 단위·통합 테스트.
5. 실제 로컬 웹앱을 데스크톱/iPad 크기로 열어 목록→듣기→읽기→빈칸→대화→카드→복습→교재 다운로드 점검.
6. 독립 코드 리뷰 후 수정·관련 테스트. README 실행법과 배포/미검증 항목 정리.

## 실패 시나리오와 검증

| 시나리오 | 방어 | 확인 |
|---|---|---|
| 모델/API 한도 소진 | 준비된 기본 자료 계속 사용 | 모델 없이 전체 카탈로그 학습 테스트 |
| 원문 오류/잘못된 시간 | 원본 보존, 타깃 검증, 플래그/제외 | 전 입력 통계, 0초/역순/초과 fixture |
| 계정 A 진도가 B에게 표시 | 사용자별 저장/RLS/전환 정리 | 계약 테스트 + 실제 Supabase 두 계정 테스트(설정 후) |
| YouTube 임베드 불가 | 오류 표시, 원본 링크, 자료 학습 유지 | 오류 이벤트/네트워크 거부 시뮬레이션 |
| 앱 없는 HTML에 스크립트 삽입 | 문자열 escape, 데이터 안전 직렬화 | `</script>`, quote, HTML payload fixture |
| 과도한 반복으로 복습 일정 건너뛰기 | 같은 날짜/카드 중복 완료 방지 | 고정 시계/타임존/동일일 테스트 |

미설정 외부 서비스의 테스트는 `미검증`으로 보고한다. 공개 URL, SMTP 가입, 실제 RLS, 교차 기기 클라우드 동기화, 콘텐츠 공개권/아동 데이터 출시 검토는 외부 조건 완료 전 성공으로 기록하지 않는다.

## 화면 설계 토큰

하늘 `#eaf4fb`, 종이 `#ffffff`, 잉크 `#193449`, 바다 `#267395`, 강조 노랑 `#ffd769`, 보조 초록 `#367567`. 영문 제목/단어는 둥근 시스템 서체(Trebuchet MS 계열), 본문은 시스템 한국어 서체, 시간은 고정폭. 1120px 폭 학습실, 큰 단어와 노란 추적 표시가 고유 요소. 주변 장식/애니메이션은 절제.

```
상단: Word Trail                 오늘의 복습 · 교재 · 부모 계정
목록: 이어서 학습 [영상 검색] / 짧은 영상 · 모음 / 전체 84개
학습: [영상 + 구간 목록] | [듣기 → 짚기 → 빈칸 → 표현]
                         [한 줄 큰 글씨 / 현재 단어 강조]
하단: 이전 구간 / 교재 저장 / 카드 복습 / 다음 구간
```

태블릿은 위아래 배치. 공개 브랜드/아동 프로필 사진/성취 경쟁 순위 없이 표현과 진도에 집중한다.
