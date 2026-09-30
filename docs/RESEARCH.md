# 조사 근거와 적용 범위

확인일 2026-09-25. 학습 원칙과 이 제품의 효과를 구분한다. 사용자 자료의 구조는 참고하되 브랜드·교재 디자인·해리포터 문장을 복제하지 않는다.

| 근거 | 확인한 내용 | 제품 적용 / 한계 |
|---|---|---|
| [IES 기초 읽기 지침](https://ies.ed.gov/ncee/wwc/PracticeGuide/21) | 말소리와 글자 연결, 해독과 단어 읽고 쓰기를 명시적으로 지도 | 짚어 읽기·소리 연결. 대상은 K–3 지침이며 정확한 학년 미확정; 이 앱의 효과 입증 아님. |
| [IES 영어 학습자 지침](https://ies.ed.gov/ncee/wwc/PracticeGuide/19) | 소수 어휘를 여러 날 다양한 활동으로 지도, 구어와 문어 연결 | 장면·빈칸·새 대화·읽기 복습을 같은 표현 ID로 연결. 권고 전체를 단일 앱이 대체하지 않음. |
| [Cepeda 등, 2006](https://pubmed.ncbi.nlm.nih.gov/16719566/) | 분산 연습과 기억 유지 간격의 관계 | 복습 제공 근거. 1/3/7/14일은 검증된 보편 최적값이 아니라 초기 설정. |
| [Winke 등, 2010](https://www.lltjournal.org/item/10125-44203/) | 외국어 영상 자막의 학습 활용 연구 | 자막 단계 전환 참고. 성인/수업 연구를 이 아동에게 그대로 일반화하지 않음. 본문 정밀 검토 전 효과량 주장 없음. |
| [Dollim 공식 App Store 설명](https://apps.apple.com/us/app/dollim-english-shadowing/id6765796915) | 구간 반복, 빈칸, 녹음 비교, 저장 구간 복습 기능 소개 | 반복·스크랩·복습 참고. 실제 앱 실험은 하지 않았고 마케팅 설명을 학습 효과 증거로 삼지 않음. |
| 로컬 SORITUNE PDF | 49페이지; 문장/뜻/선택적 사용 설명/5단계 체크/자기 문장/한국어 회상 페이지 | HTML의 체크와 회상 구조 참고. 대표 페이지 시각 확인 및 일부 페이지 텍스트 분석. |
| [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [파라미터](https://developers.google.com/youtube/player_parameters) | 재생, seek, 시작/끝, 가용 배속 제어 | 시작 시점 keyframe 오차 가능, seek 뒤 endSeconds 효력 주의. 브라우저 상태/광고/네트워크 영향으로 무오차 루프 보장 불가. |
| [YouTube 정책](https://developers.google.com/youtube/terms/developer-policies) | 다운로드/저장 제약, 아동 대상 API 클라이언트 조건 | 임베드 스트리밍. 아동 대상 정책과 공개 권한은 출시 확인 항목. |
| [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) | 아동 대상 서비스의 수집·부모 통지/동의 조건 | 최소 수집. 부모 계정만으로 충족된다고 판단하지 않음. 실제 출시 데이터 흐름 기준 재검토. |

원래 Clien 링크는 도구에서 접근되지 않았고, `ZIjMebx_PBM` 영상도 가져오기 실패였다. 영상을 보았다고 주장하지 않는다. 초기 콘텐츠는 사용자 인터뷰에 따라 기존 시즌 3 대본 84개로 확정되어 추가 Minisodes 목록은 제외한다.

## 무료 운영 결정

- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): 정적 파일 요청 무료/무제한; 파일 수·파일 크기 제약은 배포 시 재확인.
- [Supabase 요금](https://supabase.com/pricing), [일시 중지](https://supabase.com/docs/guides/platform/free-project-pausing): 무료 프로젝트의 DB·전송·활성 사용자 한도와 휴면 정지를 고려. 무제한 운영을 약속하지 않는다.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API 키](https://supabase.com/docs/guides/getting-started/api-keys): 공개용 키와 RLS가 브라우저 접근 경계; 서버 비밀 키는 브라우저 금지.
- [인증 rate limits](https://supabase.com/docs/guides/auth/rate-limits): 기본 이메일 발송은 공개 운영에 부족하므로 실제 SMTP 설정과 전달 테스트가 출시 조건.
- [Data REST API](https://supabase.com/docs/guides/api): 네이티브 fetch 사용 가능. 토큰 refresh와 계정 전환을 테스트하며 자체 암호 인증 서버는 만들지 않는다.
- [Ollama Qwen3](https://ollama.com/library/qwen3/tags): 로컬 선택적 배치 생성. 이 환경에 8B 모델이 있으나 생성 품질/속도는 별도 검증. 모델 라이선스는 영상 저작권 허가와 다르다.

채택: 고정 카탈로그를 미리 준비하여 정적으로 제공하고 계정/진도만 관리형 서비스에 저장. Workers/D1+외부 인증 대안은 JWT/권한 코드가 늘어 채택하지 않음. 무료 티어 정책은 변할 수 있으므로 공개 전 재확인한다.
