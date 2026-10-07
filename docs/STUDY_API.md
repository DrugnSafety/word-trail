# 손글씨 인식·학습 가이드 API

두 API는 GPT-5.4 Responses API의 strict JSON schema 출력을 사용한다. 브라우저에 API 키를 노출하지 않으며 기존 뜻풀이와 같은 비공개 원장, 키 순환, 키별 하루 1,000,000토큰 한도와 클라이언트 요청 제한을 공유한다. 공급자 오류 본문은 공개 응답에 포함하지 않는다.

## `POST /api/handwriting`

요청 본문은 `{ "image": "data:image/png;base64,...", "mode": "letter" }` 형식이다. `mode`는 `letter` 또는 `word`다. 실제 PNG·JPEG 헤더가 있는 data URL만 받으며 가로·세로는 각각 최대 4,096픽셀, 디코딩한 이미지는 최대 350KiB, HTTP JSON 본문은 최대 512KiB다.

응답은 다음 형식이다.

```json
{ "text": "rain", "confidence": "high", "candidates": ["ram"] }
```

`confidence`는 `high`, `medium`, `low` 중 하나다. 인식 가능한 문자는 라틴 문자, 공백, 아포스트로피와 하이픈이며 최대 160자다. 빈 화면이나 확신할 수 없는 필기는 `{ "text": "", "confidence": "low", "candidates": [] }`로 반환할 수 있다. 서버는 정답이나 예상 단어를 모델에 전달하지 않으며 철자를 교정하거나 완성하도록 요청하지 않는다. 이미지와 인식 결과는 영구 저장하거나 공유 캐시에 넣지 않는다.

## `POST /api/study-guide`

단어 요청은 `{ "kind": "word", "text": "rain", "context": "optional" }` 형식이다. `text`는 최대 160자이며 라틴 문자, 공백, 아포스트로피와 하이픈을 허용한다. 응답 형식은 다음과 같다.

```json
{
  "kind": "word",
  "text": "rain",
  "ipa": "/reɪn/",
  "syllables": ["rain"],
  "stressIndex": 0,
  "segments": [{ "text": "r", "ipa": "/r/" }, { "text": "ai", "ipa": "/eɪ/" }, { "text": "n", "ipa": "/n/" }],
  "noteKo": "ai가 하나의 소리 묶음을 만들어요."
}
```

`stressIndex`는 0부터 시작한다. `syllables`와 모든 `segments[].text`는 각각 순서대로 붙였을 때 원문 `text`와 대소문자 구분 없이 같아야 한다. IPA는 화면 표시용이며 그대로 음성 합성에 전달하지 않는다.

문장 요청은 `{ "kind": "sentence", "text": "I can't wait to see you.", "context": "optional" }` 형식이며 문장은 최대 500자, context는 두 종류 모두 최대 1,000자다. 응답 형식은 다음과 같다.

```json
{
  "kind": "sentence",
  "text": "I can't wait to see you.",
  "definitionEn": "The speaker is very excited about meeting someone.",
  "meaningKo": "너를 빨리 보고 싶어.",
  "situationKo": "만남을 기대할 때 사용해요.",
  "patternEn": "can't wait to + verb",
  "patternKo": "어떤 일을 몹시 기대한다는 뜻이에요.",
  "chunks": ["I can't wait ", "to see you."],
  "examples": [{ "text": "I can't wait to go.", "meaningKo": "빨리 가고 싶어." }, { "text": "I can't wait to try it.", "meaningKo": "빨리 해 보고 싶어." }],
  "topic": "anticipation"
}
```

`text`는 원문과 완전히 같고 `chunks`를 그대로 붙인 값도 원문과 같아야 한다. 예문은 정확히 두 개다. 성공한 학습 가이드는 `study-v1` 이름공간으로 문장 종류·원문·문맥별 공유 캐시에 저장한다. 손글씨 이미지에는 캐시를 사용하지 않는다.

공통 오류는 `400 invalid_request`, `403 forbidden`, `405 method_not_allowed`, `429 rate_limit` 또는 `daily_limit`, `503 temporarily_unavailable`이다. 성공·오류 응답 모두 `Cache-Control: no-store`를 사용한다.

공식 근거: [OpenAI 이미지·비전 입력](https://developers.openai.com/api/docs/guides/images-vision), [Responses Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
