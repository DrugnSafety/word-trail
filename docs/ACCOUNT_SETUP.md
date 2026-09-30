# 계정·진도 저장 설정

Word Trail은 설정값이 없을 때 `wordtrail:guest:v1` 로컬 저장소를 쓰며, 이를 공개 계정 기능 완료로 표시하지 않는다. Supabase를 연결하면 이메일은 부모 계정에만 사용하고 학습자 정보는 기본 별칭 `학습자1`만 저장한다. 아동 이메일·생년월일·음성은 이 스키마에 없다.

## Supabase 준비

1. **새 무료 프로젝트**는 SQL Editor에서 `supabase/schema.sql`을 한 번 실행한다. 기존 Word Trail 스키마를 이미 설치한 프로젝트는 bootstrap을 다시 실행하지 않고 `supabase/migrations/202609250001_add_dictations.sql`, `supabase/migrations/202609250002_selected_vocabulary.sql` 순서로 migration 이력에 기록하며 각각 한 번만 적용한다. 첫 migration은 기존 `s001`과 새 cue 구간 `c0001`을 함께 허용하고 받아쓰기 테이블·RLS·CAS RPC를 추가한다. 기존 복합 record CHECK는 유지하고 단일 `scene_id` CHECK만 교체한다. 두 번째 migration은 테이블·정책·보안 제약을 삭제하지 않고 받아쓰기 검증 함수만 교체해 선택 단어와 연습 이력을 지원한다.
2. Auth의 Site URL과 Redirect URLs에 실제 서비스 주소와 로컬 개발 주소를 등록한다. 이메일 확인 링크가 돌아오면 앱은 URL의 token/code를 세션으로 채택하지 않고 즉시 제거한다. `auth.confirmationStatus`가 `returned`이면 “메일 확인 후 로그인해 주세요”, `error`이면 “확인 링크가 만료되었거나 올바르지 않습니다. 확인 메일을 다시 요청해 주세요”처럼 일반 안내를 표시한다. 외부 URL의 오류 문구는 그대로 출력하지 않는다. 확인을 마친 부모가 이메일·비밀번호로 다시 로그인해야 세션을 만든다. 이 방식은 URL에서 다른 계정 세션을 주입하는 login CSRF를 피하기 위한 첫 버전 계약이다.
3. 브라우저의 `public/config.js`에는 project URL과 **publishable/anon key만** 넣는다. service-role key를 브라우저·저장소·정적 배포물에 넣지 않는다.
4. `supabase functions deploy delete-account`로 계정 삭제 함수를 배포한다. Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 환경 변수를 함수에서만 사용한다. 함수는 호출자 access token을 먼저 검증하고 해당 Auth user만 삭제한다. 연결된 개인 행은 FK cascade로 삭제된다.
5. 공개 가입 전 custom SMTP와 확인 메일 발송을 설정하고 실제 전달·redirect를 검사한다. Supabase 기본 메일 발송은 개발용 제한이 작으므로 공개 서비스의 이메일 전달을 보장하지 않는다.

설정 형태:

```js
window.WORD_TRAIL_CONFIG = {
  supabaseUrl: 'https://PROJECT.supabase.co',
  supabaseAnonKey: 'PUBLIC_ANON_OR_PUBLISHABLE_KEY'
};
```

## 저장 계약

- 게스트와 로그인 계정 기록은 자동 병합하지 않는다.
- 가입 직후 메일을 확인한 뒤 명시적으로 로그인한다. 확인 링크의 fragment나 임의 JWT로 기존 브라우저 세션을 바꾸지 않는다.
- 로그인 계정의 서버 쓰기가 실패하면 로컬 성공으로 바꾸지 않고 오류를 반환한다.
- 계정별 브라우저 캐시는 `wordtrail:cloud:<user-id>:v1`로 분리되며 서버가 정본이다.
- 같은 구간은 날짜가 달라도 무료로 재개한다. 처음 시작하는 구간만 UTC 날짜별 한도에 포함한다. 로그인 상태에서는 클라이언트 카운터가 아닌 `start_learning` RPC가 원자적으로 결정한다.
- 진도는 `start_learning`이 승인해 원장에 있는 구간에만 저장된다. 첫 버전은 `default` 학습자 하나, 구간당 최대 5개 진도 행, 진도 JSON 8KB 이하를 서버에서 강제한다. 영상·구간·표현·콘텐츠 버전 식별자도 카탈로그 형식과 길이로 제한한다.
- 기존 진도 수정은 마지막으로 받은 `updatedAt`과 저장 시작 시점의 scope를 `saveProgress(record, expectedUpdatedAt, expectedScope)`에 전달한다. scope는 게스트면 `guest`, 로그인 상태면 user ID다. context를 확인하는 동안 계정이 바뀌면 네트워크·로컬 쓰기 전에 거절한다. 서버 시간이 다르면 충돌로 거절하며, 화면은 최신 진도를 다시 불러온 뒤 재시도한다. 신규 진도만 예상 시간 `null`을 사용한다.
- 문장 받아쓰기는 `saveDictation(record, expectedUpdatedAt, expectedScope)`으로 저장하며 같은 scope 검사를 적용한다. 문장·답안은 각 2,000자, 실수 단어는 200개, 전체 JSON은 64KB, 구간별 콘텐츠 버전은 최대 5개다. 실수 단어의 `lastAnswer`는 `extra` 연습의 교정 문장까지 담을 수 있도록 2,000자까지 허용한다. 직접 insert/update는 막고 승인된 학습 구간 FK와 CAS RPC를 사용한다.
- 받아쓰기 기록은 선택한 단어의 canonical key를 `selectedKeys`에 중복 없이 최대 200개 저장할 수 있다. `selectedKeys`가 있는 새 형식에서는 모든 단어 key가 NFKC·소문자·apostrophe 정규화를 거친 `word:<term>`과 일치해야 하고, 정규화된 term은 중복될 수 없으며 선택 key는 같은 기록의 단어를 가리켜야 한다. 단어에는 전체 출현 위치 `sourceIndexes`, 최초 등록 시각, 한국어 뜻(300자 이하), 마지막 연습 시각과 철자·빈칸·뜻·오디오·읽기별 누적 정답 수를 선택적으로 저장한다. 수동 선택 단어는 `kind: 'manual'`을 사용한다. 독립 읽기 복습 일정은 `review: {step, dueAt, lastReviewedDate}`에 저장하며 step은 0~3이다. 횟수 값은 32-bit signed integer 범위를 넘지 않고 정답 수는 시도 수를 넘지 않는다. `selectedKeys`가 없는 기존 기록은 기존 key 형식 그대로 계속 읽고 다시 저장할 수 있다.
- `resetProgress()`는 별칭·Auth 계정·사용량 원장을 남기고 표현 진도와 받아쓰기 기록을 지운다. 사용자가 초기화로 일일 제한을 우회할 수 없게 시작 원장의 직접 insert/update/delete 권한을 막는다. `deleteAccount()`는 Edge Function을 통해 Auth 계정과 cascade 대상 데이터를 삭제한다.

## 아직 외부 환경에서 확인할 항목

로컬 mock 계약 테스트는 요청 모양, 실패 전파, 계정 전환 감지, 게스트 제한, 받아쓰기 CAS와 export/reset 포함 여부를 검사한다. 실제 프로젝트를 만든 뒤에는 migration 실행, 별도 계정 A/B의 RLS 차단, 승인되지 않은 구간 저장 거절, 동시에 11개 구간을 시작했을 때의 원자성, 구간당 여섯 번째 받아쓰기 버전 거절, refresh·이메일 확인 redirect, 교차 기기 동기화, export/reset/delete cascade를 확인해야 한다. 현재 저장소의 테스트가 실제 Supabase 실행을 대신하지 않는다.
