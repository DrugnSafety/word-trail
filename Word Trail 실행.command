#!/bin/bash
set -eu

cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 20 이상이 필요합니다. 설치 후 이 파일을 다시 실행해 주세요.'
  read -r -p 'Enter를 누르면 종료합니다. '
  exit 1
fi

echo 'Word Trail 로컬 학습 앱을 엽니다. 이미 실행 중이면 기존 앱을 사용합니다.'
if [ -f 'GitHub 업로드.command' ]; then
  echo 'GitHub에 파일을 올리려면 같은 폴더의 GitHub 업로드.command를 실행하세요.'
fi
echo '새 서버가 시작된 경우 이 터미널 창을 열어 두세요. 종료: Ctrl+C'
exec node scripts/serve.mjs --open
