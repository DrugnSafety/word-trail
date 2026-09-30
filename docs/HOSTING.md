# Word Trail 웹 호스팅

현재 앱은 정적 HTML/CSS/JavaScript와 JSON 자료로 실행된다. YouTube 영상은 임베드하며 업로드 파일에 동영상을 포함하지 않는다. 별도 앱 개발이나 Node 서버 운영은 필요하지 않다.

## 준비된 배포 파일

- ZIP: `deployment/word-trail-web.zip`
- 포함 파일 목록: `deployment/files.txt`
- 다시 생성: 프로젝트 폴더에서 `npm run package:hosting`

ZIP의 최상위에 `index.html`, `app.js`, `config.js`, `styles.css`, `_headers`, `lib/`, `data/`가 있다. `public/`의 앱 자료만 포함하며, 프로젝트의 `.env`, 학습 이력, 개발 로그, 원본 `resource/` 폴더는 업로드하지 않는다. `data/`에는 앱이 사용하는 공개 대상 대본 자료가 포함된다. `config.js`는 현재 빈 Supabase 설정이라 게스트 모드로 동작한다.

## GitHub Pages에서 배포

GitHub 소스 저장소와 웹사이트에 게시할 파일은 구분한다. 소스에는 `public/`, `content/`, `scripts/`, `tests/`, `docs/`, `examples/`, `supabase/`와 빌드에 필요한 `resource/Bluey_Season3_Scripts/`를 포함한다. `resource/etc/`의 별도 PDF, `.env`, `.omx/`, `.gstack/`, `.codex/`, `.agents/`, `.aws/`, `tmp/`, `deployment/`는 포함하지 않는다. 웹사이트에는 이 중 `public/`의 파일만 게시한다.

1. GitHub 저장소에 소스를 업로드한다. 무료 GitHub 계정의 Pages는 공개 저장소에서 사용할 수 있다. 비공개 저장소에서 Pages를 이용하려면 이를 지원하는 GitHub 유료 플랜이 필요하다.
2. 저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택한다.
3. `.github/workflows/pages.yml`이 `main` 브랜치 업데이트 때 실행된다. 첫 설정 뒤에는 **Actions → Deploy Word Trail to GitHub Pages → Run workflow**로 실행한다.
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

업로드 파일 준비 단계이며 실제 호스팅 주소는 아직 발급되지 않았다. 이 세션에는 Cloudflare 로그인 정보가 없고 `api.cloudflare.com` DNS 조회도 실패했다. 배포 성공이나 모바일 작동을 검증했다고 표시하지 않는다.

주소 발급 뒤에는 앱 진입과 자료 로딩, 첫 네 구간의 26·33·37·41초 구분, 빈칸에서 문장 영상 재생, 완료 목록 저장·새로고침, 휴대폰·아이패드 키보드와 확인 버튼을 점검한다. 전체 7개 Chapter 중 나머지 제목·시각 확인 작업은 호스팅과 별개의 미완료 항목이다.
