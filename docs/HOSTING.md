# Word Trail 웹 호스팅

기본 학습은 정적 HTML/CSS/JavaScript와 JSON 자료로 실행된다. GPT-5.4 뜻풀이 보완은 Vercel 서버 함수와 비공개 토큰 원장을 사용한다. [AI 서버 설정](OPENAI_API.md). YouTube 영상은 임베드하며 업로드 파일에 동영상을 포함하지 않는다. 별도 앱 개발이나 Node 서버 운영은 필요하지 않다.

## 준비된 배포 파일

- ZIP: `deployment/word-trail-web.zip`
- 포함 파일 목록: `deployment/files.txt`
- 다시 생성: 프로젝트 폴더에서 `npm run package:hosting`

ZIP의 최상위에 `index.html`, `app.js`, `config.js`, `styles.css`, `_headers`, `lib/`, `data/`가 있다. `public/`의 앱 자료만 포함하며, 프로젝트의 `.env`, 학습 이력, 개발 로그, 원본 `resource/` 폴더는 업로드하지 않는다. `data/`에는 앱이 사용하는 공개 대상 대본 자료가 포함된다. `config.js`는 현재 빈 Supabase 설정이라 게스트 모드로 동작한다.

## GitHub Pages에서 배포

현재 운영 사이트는 [Vercel](https://word-trail-three.vercel.app)이고 소스 저장소는 [DrugnSafety/word-trail](https://github.com/DrugnSafety/word-trail)이다. GitHub Actions는 main 변경마다 빌드·테스트·구문 검사를 실행한다. Pages 게시는 아래 설정을 마친 뒤 선택적으로 활성화한다.

소스에는 `public/`, `content/`, `scripts/`, `tests/`, `docs/`, `examples/`, `supabase/`, `server/`, `api/`와 빌드에 필요한 `resource/Bluey_Season3_Scripts/`를 포함한다. `resource/etc/`의 별도 PDF, `.env`, `.omx/`, `.gstack/`, `.codex/`, `.agents/`, `.aws/`, `tmp/`, `deployment/`는 포함하지 않는다. Pages에는 `public/`의 파일만 게시한다. 서버의 GPT-5.4 기능은 Vercel 배포에서 사용한다.

1. GitHub 저장소에 소스를 업로드한다. 무료 GitHub 계정의 Pages는 공개 저장소에서 사용할 수 있다. 비공개 저장소에서 Pages를 이용하려면 이를 지원하는 GitHub 유료 플랜이 필요하다.
2. 저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택한다.
3. **Settings → Secrets and variables → Actions → Variables**에 `DEPLOY_GITHUB_PAGES=true`를 추가한다. `.github/workflows/pages.yml`이 `main` 브랜치 업데이트 때 실행된다. 첫 설정 뒤에는 **Actions → Validate Word Trail and optional GitHub Pages → Run workflow**로 실행한다. 변수가 없으면 검증만 실행하고 Pages 단계는 건너뛴다.
4. 워크플로는 `npm run build`, `npm test`, `npm run check`를 실행한 뒤 `public/`을 배포한다. 외부 npm 패키지 의존성이 없어 패키지 설치 단계는 필요하지 않다.
5. Actions의 배포 결과 또는 **Settings → Pages**에서 실제 게시 주소를 확인한다. 저장소 생성·소스 업로드만으로 Pages 배포 성공을 뜻하지는 않는다.

HTML과 자료 요청은 상대 경로를 사용하므로 프로젝트 이름이 붙는 `https://계정.github.io/저장소/` 형태를 지원하도록 구성되어 있다. 실제 주소에서 YouTube와 기기 음성·학습 저장 동작은 배포 후 확인한다. Cloudflare 전용 `_headers`는 GitHub Pages의 헤더 설정으로 적용되지 않는다.

[GitHub 공식 워크플로 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Cloudflare Pages에서 업로드

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 로그인한다.
2. **Workers & Pages → Create application → Get started → Drag and drop your files**로 이동한다. Pages의 파일 업로드 방식을 선택한다.
3. 프로젝트 이름을 정한다. 예: `word-trail`. 이름이 이미 사용 중이면 다른 이름 또는 Cloudflare가 제안하는 이름을 사용한다.
4. `deployment/word-trail-web.zip`을 올리고 **Deploy site**를 누른다.
5. Cloudflare가 실제 발급한 `https://…pages.dev` 주소를 Mac·휴대폰·아이패드에서 연다.

ZIP을 포함하는 프로젝트 폴더 전체를 올리는 것이 아니라 ZIP 자체를 업로드한다. Direct Upload는 ZIP 또는 폴더를 지원하며 1,000개 파일, 파일당 25 MiB 한도다. 이 방식으로 만든 프로젝트는 나중에 Git 연동 방식으로 직접 전환할 수 없지만 같은 프로젝트에 화면 업로드나 Wrangler로 업데이트할 수 있다. [Cloudflare 공식 안내](https://developers.cloudflare.com/pages/get-started/direct-upload/)

다음 수정에서는 `npm run package:hosting`으로 ZIP을 다시 만들고 기존 프로젝트의 **Create a new deployment**에서 업로드한다. `public/_headers`는 기존 파일 이름에 대한 캐시 재검증과 YouTube에 필요한 referrer 정책을 설정한다. [헤더 설정 문서](https://developers.cloudflare.com/pages/configuration/headers/)

기존 `wrangler.jsonc`는 Cloudflare **Workers Static Assets**용 설정이다. 이번 ZIP은 **Pages Direct Upload**용이며 CLI 설정이나 앱 의존성을 추가하지 않았다. Workers 경로를 선택하는 경우에는 기존 설정을 사용해 별도로 배포할 수 있다.

## 저장과 접속

- 게스트 진도는 각 브라우저에 저장된다. Mac의 `localhost` 진도는 새 웹주소나 아이패드로 자동 이동하지 않는다.
- 여러 기기에서 진도를 동기화하려면 별도 [Supabase 계정 설정](ACCOUNT_SETUP.md)이 필요하다.
- 위 Pages 업로드 방식의 사이트는 주소를 가진 사람이 접속할 수 있다. 가족 전용 로그인 제한은 별도 접근 설정이다.
- YouTube 영상·문장 재생에는 인터넷 연결이 필요하다. 모바일에서 자동 재생이 차단되면 영상 안의 재생 버튼으로 시작한다.

## 현재 상태와 배포 후 확인

Vercel 운영 배포 주소는 https://word-trail-three.vercel.app 이다(2026-10-06). Cloudflare 업로드는 실행하지 않았다. Mac Chrome의 공개 주소와 390px 반응형 브라우저 QA를 확인했으며 실제 iPad Safari 검증은 포함하지 않는다.

주소 발급 뒤에는 앱 진입과 콘텐츠 버전 `2026.10.06-1` 자료 로딩, YouTube Chapter가 확인된 합본 영상의 구간 선택·재생 종료·대화 학습 전환, Chapter 다시 보기, 실제 지원 속도 활성화, 빈칸 문장 영상 재생, 완료 목록 저장·새로고침을 점검한다. Faceytalk은 Chapter 1 26–65초와 Chapter 2의 확인 범위 65–104초도 별도로 점검한다. YouTube의 `동영상 더보기`·관련 영상 안내는 자체 iframe UI이므로 완전 비노출을 배포 합격 조건으로 두지 않는다. 휴대폰·아이패드에서는 키보드와 확인 버튼 잘림도 확인한다. Faceytalk의 공개 메타데이터에는 Chapter 배열이 없으므로 Chapter 2의 실제 끝과 전체 7개 중 남은 5개 제목·시각 확인은 호스팅과 별개의 미완료 항목이다.

## Vercel 배포 (2026-10-06)

`vercel.json`은 `public/`을 배포 결과로 지정하고, 기존 자료 빌드 뒤 공개 계정 설정을 생성합니다. [Vercel 파일 설정](https://vercel.com/docs/project-configuration), [CLI 배포](https://vercel.com/docs/cli/deploy)를 사용합니다.

연결된 계정에서 `npx vercel login` 후 이 폴더에서 `npx vercel link`로 실제 Word Trail 프로젝트를 선택하고 `npx vercel --prod`로 배포합니다. 이 폴더는 Git 저장소가 아니므로 Git 연결이 필수인 배포 흐름은 사용하지 않습니다. 프로젝트가 이미 있으면 기존 프로젝트를 선택합니다.

계정 동기화를 사용하려면 프로젝트 환경변수 `SUPABASE_URL`과 공개 `SUPABASE_ANON_KEY`(anon 또는 publishable 키)를 설정합니다. `scripts/build-public-config.mjs`는 secret/service-role 키의 공개를 거부합니다. 설정이 없으면 기존 `public/config.js`를 유지합니다. Vercel 호스팅만으로 Supabase DB·메일 인증이 생기지는 않습니다. [계정 설정](ACCOUNT_SETUP.md)의 SQL과 인증 redirect를 먼저 적용해야 합니다.

2026-10-06 Chrome 로그인 뒤 CLI `whoami`에서 `drugnsafety-8650`을 확인하고 `mingyu9/word-trail` 프로젝트를 만들었습니다. 운영 배포는 **https://word-trail-three.vercel.app**, deployment ID는 `dpl_5UczkMdbpsDozfMicYgC1PTZLRzu`, 상태는 `READY`입니다.

인증 없는 HTTP 조회에서 200과 설정된 보안·캐시 헤더를 확인했고, 주요 공개 파일 8개의 SHA-256이 로컬 수정본과 일치했습니다. 공개 주소의 브라우저 QA 14개를 통과했습니다. 이 QA의 YouTube·음성·사전·번역은 mock이며 실제 Chrome에서 Pizza Girls 챕터 6개와 YouTube 재생·일시정지를 따로 확인했습니다. [배포 검사 결과](../tmp/vercel-public-files.json), [브라우저 결과](../tmp/vercel-qa-revision/results.json).

Supabase 공개 연결 값은 여전히 비어 있어 계정 간 클라우드 동기화는 미연결 상태입니다. Vercel 로그인은 Word Trail 학습 계정 로그인을 대신하지 않습니다. 로컬 게스트 이력도 새 공개 주소로 자동 이전되지 않습니다.
