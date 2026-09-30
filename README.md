# Word Trail / 워드 트레일

부모와 초등학생이 영상의 소리에서 글자로 이어서 공부하는 웹앱입니다. 준비된 시즌 3 캡처 대본 84개를 활용해 **듣기 → 받아쓰기와 단어 선택 → 선택 단어 학습**으로 진행합니다. 단어 연습은 뜻·표현 → 짚기 → 철자 → 빈칸 → 소리 퀴즈 → 뜻 퀴즈 → 혼자 읽기 순서로 이어지고, 정답을 저장하면 다음 단계와 다음 단어로 자동 이동합니다. 원하는 연습을 직접 고를 수도 있습니다.

## 로컬 실행

Node 20 이상이 필요합니다. 앱 패키지 설치나 유료 API 키가 필요하지 않습니다.

Mac에서는 Finder에서 **[Word Trail 실행.command](<Word Trail 실행.command>)**를 더블클릭하면 서버가 준비된 뒤 브라우저가 열립니다. 이미 같은 앱이 실행 중이면 기존 서버와 같은 주소를 사용합니다. 다른 프로그램이 포트를 사용 중이면 해당 프로그램을 종료하지 않고 안내를 표시합니다. 앱을 사용하는 동안 서버를 처음 실행한 터미널 창을 유지해 주세요. 그 창을 닫거나 컴퓨터를 재시작한 뒤 접속되지 않으면 실행 파일을 다시 열면 됩니다.

터미널에서 직접 실행하려면:

```sh
npm run build
npm test
npm run check
npm start
```

브라우저에서 **http://localhost:4173**을 엽니다. 포트 변경: `PORT=4174 npm start`. MacBook과 같은 컴퓨터에서 접속하는 기본 서버이며 외부 네트워크에 공개하지 않습니다. 실제 iPad 접속은 HTTPS 호스팅 설정 후 확인합니다.

## 사용할 수 있는 흐름

- 영상 검색과 원본 캡처 묶음 기준 구간 선택, YouTube 구간 반복·속도 조절
- 대본 목차 → 대화 단위 탐색, 대부분 5–15초인 대화 구간, 0.25–2배속 선택
- 문장 전체 받아쓰기와 단어 단위 비교: 철자 오류·누락·추가 표시
- 이번 오답만 자동 선택하고 원문에서 추가 단어 선택, 등록한 단어 이력과 분리
- 등록일·영상 출처·연습 횟수와 종류별 결과를 보여주는 단어장
- 한 단어씩 클릭/터치/방향키로 짚기, 기기의 영어 음성으로 듣기
- 단어·준비된 표현을 한 항목으로 선택, 왼쪽 목록에서 순서 확인과 영상 복귀
- 선택한 단어의 빈칸과 철자 연습, 글자 이름 읽기와 입력 확대 효과
- 빈칸은 해당 문장의 YouTube 원본 음성 반복, 소리 퀴즈는 단어 음성 반복, 정답 저장 후 자동 진행
- 한국어 뜻을 보고 쓰기와 발음을 듣고 쓰는 독립 퀴즈
- 한국어 뜻·학습용 IPA와 강세 표시·표현별 새 일상 대화 두 세트
- 준비된 관련어 39개 묶음: 품사·어형·진행형 구문과 예문
- 부모가 확인한 읽기 결과와 1/3/7/14일 기본 복습 일정
- 독립 읽기를 마친 단어를 별도로 모은 공부 완료 목록
- 앱 없이 열 수 있는 HTML 교재와 SVG 표현 카드 저장
- 게스트 진도 저장, 부모 계정 연결 시 진도 저장·내보내기·초기화·계정 삭제

선택한 모든 단어는 원문과 철자로 연습할 수 있습니다. Faceytalk의 내장 단어 자료와 기존 표현은행에서 뜻·IPA를 가져오고, 없는 뜻은 부모가 입력해 뜻 퀴즈에 사용할 수 있습니다. 새 대화 두 세트는 기존 표현은행과 일치하는 표현에 연결합니다.

IPA/기기 음성은 학습용이며 영상의 호주 영어 발음과 다를 수 있습니다. YouTube CC는 영상 플레이어에서 직접 끕니다. 기기 읽어주기는 브라우저 음성 지원에 따라 달라집니다. HTML 교재 입력은 앱 진도와 동기화되지 않습니다.

바로 열어 볼 자료: [첫 구간 HTML 교재](examples/faceytalk-first-scene.html), [표현 카드 SVG](examples/faceytalk-first-scene.svg). `npm run build`가 두 파일도 함께 갱신합니다.

## 무료 서비스 연결

현재 `public/config.js`는 비어 있어 **게스트 모드**로 실행됩니다. 클라우드 기능은 Supabase 무료 프로젝트와 공개 키를 설정하면 연결됩니다. 비밀번호는 Supabase Auth가 처리합니다. 브라우저 코드에 service-role 키를 넣으면 안 됩니다.

[계정 설정](docs/ACCOUNT_SETUP.md)에 SQL, 인증 redirect/메일, 계정 삭제 함수, 실제 검증 절차가 있습니다. 공개 가입에는 기본 개발용 메일 한도를 넘는 메일 전송 설정이 필요합니다. 사용량 초과 시 자동 결제 전환 코드는 없습니다.

Cloudflare Workers Static Assets 배포 구성은 `wrangler.jsonc`에 있습니다. 프로젝트 계정과 콘텐츠 공개 조건을 준비한 뒤 Cloudflare 도구로 `public/`을 배포합니다. `resource/`, `.omx/`, 부모 계정 데이터는 정적 배포 대상이 아닙니다. 이 저장소 작성만으로 공개 URL이나 실제 클라우드 검증이 완료된 것은 아닙니다.

Cloudflare Pages 화면에서 바로 올릴 ZIP은 `npm run package:hosting`으로 만듭니다. 결과는 `deployment/word-trail-web.zip`이며 `public/`의 앱 파일만 포함합니다. 로그인·업로드·업데이트 방법은 [웹 호스팅 안내](docs/HOSTING.md)에 있습니다.

GitHub Pages로 배포할 때는 저장소의 **Settings → Pages → Source: GitHub Actions**를 선택합니다. 준비된 [배포 워크플로](.github/workflows/pages.yml)가 `main` 업데이트 때 자료를 빌드하고 테스트·구문 검사를 통과한 `public/`만 게시합니다. 처음 설정한 뒤에는 **Actions → Deploy Word Trail to GitHub Pages → Run workflow**로 실행할 수 있습니다. 업로드할 소스와 공개 사이트 파일의 차이는 [GitHub 배포 안내](docs/HOSTING.md#github-pages에서-배포)에 있습니다.

## 콘텐츠 자동 준비

`content/expressions.json`은 한국어 설명·IPA·원본 창작 대화를 가진 표현은행입니다. `scripts/build-catalog.mjs`가 캡처 대본의 실제 문자열과 일치하는 표현을 골라 학습자료를 만듭니다. 준비된 콘텐츠를 재사용하므로 사용자마다 생성 비용이 들지 않습니다. 규칙으로 구분한 **학습 구간**이며 원작 에피소드의 의미 경계를 완벽히 판정하지 않습니다.

84개 영상의 자막을 3,218개 대화 구간으로 묶었습니다(중앙값 7초, 최대 15초). 대본 목차가 있는 6개 영상은 에피소드 제목을 사용하며, 없는 영상은 전체 영상 아래 대화를 표시합니다. Faceytalk은 사용자가 제공한 첫 Chapter의 네 구간만 반영했고 나머지 목차 제목·시각은 확인 중입니다. 콘텐츠 버전은 `2026.09.29-2`이며 이전 단어 이력은 보존됩니다.

- 원본: `resource/Bluey_Season3_Scripts/txt_2_youtube_original/`
- 정리본: `resource/Bluey_Season3_Scripts/txt_1_shadowing/`
- 생성물: `public/data/catalog.json`, `public/data/videos/`, `public/data/expressions.json`
- 품질 보고: `docs/CATALOG_REPORT.json`

타임스탬프, 원본 cue 참조, 보정/제외 이유를 보존합니다. 캡처 대본을 음성 검증 완료 자료로 취급하지 않습니다. 공개 YouTube 영상이라는 사실이 자막 전체의 재배포 권한을 의미하지 않으므로 공개 배포 전 해당 권한을 확인해야 합니다. Bluey 공식 서비스가 아닙니다.

## 문서

- [기획과 PRD](docs/PRD.md)
- [학습 방법·기술 근거와 한계](docs/RESEARCH.md)
- [구현 계약·검증 계획](docs/IMPLEMENTATION_PLAN.md)
- [문장 받아쓰기 수정 계약](docs/SENTENCE_REVISION.md)
- [학습실 critic 검토와 개편 결정](docs/WORKSPACE_REDESIGN.md)
- [단어 연습 고도화와 학습 순서](docs/PRACTICE_UPGRADE.md)
- [대화 구간·재생·완료 목록과 모바일 사용 방식](docs/LEARNING_REVISION.md)
- [5–15초 구문·빈칸 원본 문장 음성과 Chapter 확인 상태](docs/SHORT_DIALOGUE_AUDIO.md)
- [검증 결과와 남은 조건](docs/VERIFICATION.md)

자동 테스트는 Node 내장 테스트 러너를 사용합니다. 별도 lint/typecheck 패키지 없이 JavaScript 구문 검사와 계약 테스트를 수행합니다. 외부 Supabase의 RLS·메일·실제 iPad Safari 동작은 mock 테스트로 검증했다고 주장하지 않습니다.
