import { escapeHtml } from './learning.js';

const time = value => `${Math.floor(Number(value || 0) / 60)}:${String(Math.floor(Number(value || 0) % 60)).padStart(2, '0')}`;
const sourceLink = (video, start) => {
  let id = video?.id || '';
  if (!/^[\w-]{11}$/.test(id)) {
    try {
      const url = new URL(video?.sourceUrl || '');
      if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname)) id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    } catch { return ''; }
  }
  return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(start || 0))}s` : '';
};

function dialogueMarkup(expression) {
  return (expression.dialogues || []).slice(0, 2).map((dialogue, index) => `<section class="dialogue"><h3>새로운 대화 ${index + 1} · ${escapeHtml(dialogue.titleKo)}</h3>${dialogue.lines.map(line => `<p><b>${escapeHtml(line.speaker)}</b> <span lang="en">${escapeHtml(line.en)}</span><small>${escapeHtml(line.ko)}</small></p>`).join('')}</section>`).join('');
}

export function buildWorkbook({ title = '오늘의 표현', video = {}, scene = {}, expressions = [] } = {}) {
  const url = sourceLink(video, scene.start);
  const entries = expressions.map((expression, index) => {
    const target = (scene.targets || []).find(item => item.expressionId === expression.id);
    const quote = target?.quote || expression.term;
    const from = target?.matchStart ?? 0;
    const to = target?.matchEnd ?? quote.length;
    const answer = quote.slice(from, to);
    const prompt = `${escapeHtml(quote.slice(0, from))}<span class="blank" aria-label="빈칸">________</span>${escapeHtml(quote.slice(to))}`;
    return `<article class="expression" id="expression-${index + 1}">
      <p class="eyebrow">${String(index + 1).padStart(2, '0')} · 읽고, 말하고, 다시 떠올려요</p>
      <h2 class="english" lang="en">${escapeHtml(expression.term)}</h2>
      <p class="ipa english" lang="en">${escapeHtml(expression.ipa)}</p>
      <p class="meaning">${escapeHtml(expression.meaningKo)}</p>
      <p>${escapeHtml(expression.explanationKo)}</p>
      <div class="source"><span>${target ? '영상에서 나온 문장 · 캡처 대본, 음성 미검증' : '표현 읽기'}</span><p class="english" lang="en">${escapeHtml(quote)}</p>${url ? `<a href="${sourceLink(video, target?.start ?? scene.start)}" target="_blank" rel="noopener noreferrer">${time(target?.start ?? scene.start)} 원본 듣기 ↗</a>` : ''}</div>
      <fieldset class="practice"><legend>오늘의 연습</legend>${['글자 없이 듣기', '짚으며 읽기', '함께 따라 말하기', '영어 가리고 떠올리기', '도움 없이 읽기'].map(label => `<label><input type="checkbox"> ${label}</label>`).join('')}</fieldset>
      <section class="quiz"><h3>빈칸을 채워요</h3><p class="question" lang="en">${prompt}</p><form data-answer="${escapeHtml(answer)}"><label>빠진 표현 <input name="answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button type="submit">확인</button><p class="feedback" aria-live="polite"></p></form><details><summary>도움 / 정답 보기</summary><p lang="en">${escapeHtml(answer)}</p><small>도움을 봐도 괜찮아요. 읽기 성공과 철자 정답은 따로 확인해요.</small></details></section>
      ${dialogueMarkup(expression)}
      <label class="own">내 상황에 맞는 한 문장 <textarea rows="2" placeholder="말로 먼저 만든 뒤 적어도 좋아요."></textarea></label>
      <fieldset class="check"><legend>부모와 읽기 확인</legend><label><input type="radio" name="read-${index}"> 혼자 읽었어요</label> <label><input type="radio" name="read-${index}"> 도움이 필요해요</label><label>다음 복습 날짜 <input type="date"></label></fieldset>
    </article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · Word Trail 교재</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eaf4fb;color:#193449;font:17px/1.7 system-ui,-apple-system,sans-serif}main{max-width:850px;margin:auto;padding:36px 24px}header{padding:24px 0}h1{font-size:32px;line-height:1.25}h2{font:700 38px/1.3 'Trebuchet MS',sans-serif;margin:12px 0}h3{font-size:18px}p{margin:8px 0}.eyebrow{font-size:13px;letter-spacing:.1em;color:#267395;font-weight:700}.expression{background:white;border:1px solid #d7e4eb;border-radius:20px;padding:32px;margin:28px 0;break-inside:avoid}.ipa{font-size:18px}.meaning{font-size:23px;font-weight:650}.source{border-left:4px solid #ffd769;background:#fffbeb;padding:14px 18px;margin:20px 0}.source span,small{font-size:13px;color:#476577}small{display:block}.question{font:25px/1.8 'Trebuchet MS',sans-serif}.blank{color:#267395;background:#eaf4fb}fieldset{border:1px solid #cbdbe4;border-radius:12px;margin:20px 0;padding:16px}legend{padding:0 8px;font-weight:700}label{display:block;margin:8px 0}.practice label,.check label{display:inline-block;margin-right:18px}input[type=checkbox],input[type=radio]{width:20px;height:20px;vertical-align:middle}button,summary{cursor:pointer;min-height:44px}button{border:0;border-radius:9px;background:#267395;color:white;padding:10px 18px;font:inherit}input[type=text],textarea,input[type=date]{font:inherit;max-width:100%;padding:10px;border:1px solid #98b3c3;border-radius:8px}textarea{display:block;width:100%}.dialogue{padding:12px 0;border-bottom:1px solid #dde7ed}.dialogue b{display:inline-block;min-width:24px}.dialogue small{margin-left:28px}.toolbar{display:flex;gap:10px;flex-wrap:wrap}.toolbar button{background:white;color:#193449;border:1px solid #b7ccd8}.hide-english .english{visibility:hidden}a{color:#176484}.feedback{min-height:1.7em;color:#265e46}footer{font-size:13px;color:#476577}input:focus-visible,textarea:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #267395;outline-offset:3px}@media(max-width:600px){main{padding:16px}.expression{padding:22px}h2{font-size:32px}}@media print{body{background:white;font-size:11pt}main{padding:0;max-width:none}.toolbar,form button{display:none}.expression{border:1px solid #aaa;margin:10mm 0;padding:8mm;break-inside:avoid}h2{font-size:25pt}h1{font-size:23pt}textarea{min-height:20mm}a{color:inherit}.hide-english .english{visibility:visible}footer{font-size:9pt}}
</style></head><body><main><header><p class="eyebrow">WORD TRAIL · 소리에서 글자로</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(video.title || '')}</p><p>한 번에 조금씩, 부모와 함께 읽어요. 새 대화는 영상 원문과 다른 학습용 예문입니다.</p><div class="toolbar"><button id="print" type="button">인쇄 / PDF 저장</button><button id="toggle" type="button" aria-pressed="false">영어 가리고 떠올리기</button></div><p><small>인터넷 없이 읽기·퀴즈가 가능합니다. 원본 영상은 인터넷 연결이 필요합니다. 이 파일의 체크·입력은 창을 닫으면 초기화되며 앱 진도에 동기화되지 않습니다.</small></p></header>
${entries || '<p>선택된 표현이 없어요.</p>'}
<footer>Word Trail · 표현 ${expressions.length}개 · 자료 버전 ${escapeHtml(video.contentVersion || '1.0.0')}<br>IPA는 학습용 사전 발음입니다. 영상의 호주 영어 발음과 차이가 있을 수 있습니다. 자료 출처와 음성 정확도는 별도로 확인해 주세요. 학습 효과나 진단을 판정하는 자료가 아닙니다.</footer>
</main><script>
const normalize=text=>String(text).normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/g,"'").trim().replace(/\\s+/g,' ').replace(/[.!?,;:]+$/g,'').trim();
document.querySelectorAll('form[data-answer]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const value=normalize(form.elements.answer.value);form.querySelector('.feedback').textContent=value&&value===normalize(form.dataset.answer)?'잘 떠올렸어요! 이번에는 소리 내어 읽어 보세요.':'다시 듣거나 도움을 펼쳐 보세요. 천천히 해도 괜찮아요.';}));
document.querySelector('#print').addEventListener('click',()=>window.print());
document.querySelector('#toggle').addEventListener('click',event=>{const hidden=document.body.classList.toggle('hide-english');event.currentTarget.setAttribute('aria-pressed',String(hidden));event.currentTarget.textContent=hidden?'영어 다시 보기':'영어 가리고 떠올리기';});
</script></body></html>`;
}

function download(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = title => String(title || 'word-trail').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 70).trim() || 'word-trail';
export function downloadWorkbook(args) {
  download(buildWorkbook(args), 'text/html;charset=utf-8', `${safeName(args?.title)}-교재.html`);
}

function wrapText(value, maximum) {
  const words = String(value || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > maximum) { lines.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

export function buildCardSVG({ title = '오늘의 표현', expressions = [] } = {}) {
  const titleLines = wrapText(title, 42);
  const cardTop = 120 + Math.max(0, titleLines.length - 1) * 36;
  const height = cardTop + 50 + expressions.length * 400;
  const cards = expressions.map((expression, index) => {
    const y = cardTop + index * 400;
    const explanation = wrapText(expression.explanationKo, 35).slice(0, 3);
    return `<g transform="translate(36 ${y})"><rect width="728" height="372" rx="24" fill="#fff"/><text x="32" y="44" font-size="15" fill="#267395">${String(index + 1).padStart(2, '0')} · 소리에서 글자로</text><rect x="28" y="66" width="670" height="76" rx="12" fill="#fff4c8"/><text x="42" y="115" font-size="${expression.term.length > 22 ? 31 : 40}" font-weight="700">${escapeHtml(expression.term)}</text><text x="36" y="177" font-size="21">${escapeHtml(expression.ipa)}</text><text x="36" y="218" font-size="25" font-weight="600">${escapeHtml(expression.meaningKo)}</text>${explanation.map((line, i) => `<text x="36" y="${258 + i * 27}" font-size="18">${escapeHtml(line)}</text>`).join('')}<text x="36" y="346" font-size="15" fill="#476577">뜻을 가리고 읽기 → 소리 내어 말하기 → 내일 다시 보기</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-label="Word Trail 표현 카드"><rect width="100%" height="100%" fill="#eaf4fb"/><g font-family="Arial, Apple SD Gothic Neo, sans-serif" fill="#193449"><text x="40" y="48" font-size="14" fill="#267395">WORD TRAIL</text>${titleLines.map((line, index) => `<text x="40" y="${88 + index * 36}" font-size="29" font-weight="700">${escapeHtml(line)}</text>`).join('')}${cards}<text x="40" y="${height - 24}" font-size="12">부모와 함께, 하루에 조금씩 · 학습용 발음기호 / 영상 발음과 차이가 있을 수 있어요</text></g></svg>`;
}

export function downloadCards(args) {
  download(buildCardSVG(args), 'image/svg+xml;charset=utf-8', `${safeName(args?.title)}-카드.svg`);
}
