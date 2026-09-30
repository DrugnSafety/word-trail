import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildWorkbook, buildCardSVG } from '../public/lib/workbook.js';

const expression = { id: 'thank-you', term: 'thank you', ipa: '/ˈθæŋk juː/', meaningKo: '고마워', explanationKo: '도움을 받았을 때 말해요.', dialogues: [
  { titleKo: '연필 빌리기', lines: [{ speaker: 'A', en: 'Here is a pencil.', ko: '여기 연필이야.' }, { speaker: 'B', en: 'Thank you!', ko: '고마워!' }] },
  { titleKo: '문 열어 주기', lines: [{ speaker: 'A', en: 'I can open it.', ko: '내가 열어 줄게.' }, { speaker: 'B', en: 'Thank you.', ko: '고마워.' }] }
] };
const args = { title: '오늘의 말', video: { id: 'kx8_wF9HOX8', title: 'Video' }, scene: { start: 30, targets: [{ expressionId: 'thank-you', quote: 'Oh, thank you!', start: 32, matchStart: 4, matchEnd: 13 }] }, expressions: [expression] };

test('standalone workbook has source range, 2 dialogues, quiz and no remote assets', () => {
  const html = buildWorkbook(args);
  assert.equal((html.match(/class="dialogue"/g) || []).length, 2);
  assert.match(html, /watch\?v=kx8_wF9HOX8&t=32s/);
  assert.match(html, /data-answer="thank you"/);
  assert.match(html, /Oh, <span class="blank"/);
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(?:src|href)=/);
  assert.match(html, /동기화되지 않습니다/);
});

test('workbook and SVG escape data instead of executing markup', () => {
  const payload = '</script><img src=x onerror="alert(1)">';
  const malicious = { ...args, title: payload, video: { id: 'javascript:alert(1)', title: payload }, expressions: [{ ...expression, term: payload, explanationKo: payload }] };
  const html = buildWorkbook(malicious);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;\/script&gt;/);
  const svg = buildCardSVG(malicious);
  assert.doesNotMatch(svg, /<img|<script/);
  assert.match(svg, /&lt;\/script&gt;/);
});

test('downloaded workbook quiz code executes offline and checks learner input', () => {
  const html = buildWorkbook(args);
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let submit;
  const feedback = { textContent: '' };
  const form = { dataset: { answer: 'thank you' }, elements: { answer: { value: 'THANK   YOU!' } }, querySelector: () => feedback, addEventListener: (_, fn) => { submit = fn; } };
  const doc = { querySelectorAll: () => [form], querySelector: () => ({ addEventListener() {} }) };
  vm.runInNewContext(code, { document: doc });
  submit({ preventDefault() {} });
  assert.match(feedback.textContent, /잘 떠올렸어요/);
  form.elements.answer.value = 'thanks';
  submit({ preventDefault() {} });
  assert.match(feedback.textContent, /다시 듣거나/);
});
