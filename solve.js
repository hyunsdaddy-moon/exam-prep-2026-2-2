/*
 * 시험 준비 웹앱 — 문제 풀이 · 채점 · 결과 (docs/시험준비탭개발계획서.md §6, 2단계)
 *
 *   #/s/<과목>/practice          연습: 한 문제씩, 고르면 바로 채점과 해설
 *   #/s/<과목>/exam              실전: 시험지 전체 + 타이머, 다 풀고 한 번에 채점
 *   #/s/<과목>/result/<묶음 id>   결과: 점수, 틀린 문제, 서술형 스스로 채점, 실수 유형 표시
 *
 * 채점 계산은 grade.mjs, 기록 저장은 store.js 가 맡는다. 여기는 화면만 그린다.
 * 입력이 있는 화면(실전)은 통째로 다시 그리지 않고 바뀐 곳만 고친다 — 쓰던 답이 날아가지 않게.
 */

import { el, newId, CIRCLED, plainStem, versioned, showBlankAlert } from './dom.js?v=20261125-1815';
import { renderMarkdown } from './markdown.js?v=20261125-1815';
import { explainButton } from './explain.js?v=20261125-1815';
import { inkTools } from './ink.js?v=20261125-1815';
import { saveRecords, loadRecords, getCurrentLearner } from './store.js?v=20261125-1815';
import { loadPaper } from './study.js?v=20261125-1815';
import { buildHistories, wrongNotes, localDay } from './progress.mjs?v=20261125-1815';
import {
  CONFIDENCE_LABEL,
  ERROR_LABEL,
  gradeChoice,
  gradeEssayByChecks,
  canCheckRubric,
  mergeRecords,
  mergeRecordsForLearner,
  recordLearner,
  summarize,
  listSessions,
  formatDuration,
  formatClock,
  round1,
} from './grade.mjs?v=20261125-1815';

const MODE_LABEL = { practice: '연습', exam: '실전', review: '복습', assess: '평가' };
const STATE_MARK = { correct: '○', wrong: '×', partial: '△', pending: '…', blank: '–' };
const STATE_LABEL = { correct: '맞음', wrong: '틀림', partial: '부분 점수', pending: '채점 전', blank: '안 풂' };

/** 마크다운 조각을 그린다. 답 쓰는 밑줄(____)은 화면에서 따로 받으므로 지운다. */
export function md(text, cls = 'md') {
  const box = el(`div.${cls}`);
  renderMarkdown(String(text || '').replace(/_{6,}/g, ''), box, { breaks: true });
  return box;
}

const pts = (n) => `${round1(n)}점`;
export const answerText = (list) => (list && list.length ? list.map((n) => CIRCLED[n - 1] || n).join(', ') : '–');

/** 문제 머리(번호·배점)와 지문 */
function questionHead(q) {
  return el('div.q-head', {}, el('span.q-no', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }), el('span.q-points', { text: pts(q.points) }));
}

/** 여러 문제가 함께 쓰는 지문. 길어서 접을 수 있게 한다. */
export function contextBlock(group, open = true) {
  if (!group || !group.context) return null;
  return el('details.q-context', { open }, el('summary', { text: group.title }), md(group.context));
}

/* ── 교과서 본문 — 「Unit 8A …의 내용으로」처럼 단원 본문을 묻는 영어 문제에 붙인다 ── */
let passagesPromise = null;
function loadPassages() {
  if (!passagesPromise) {
    passagesPromise = fetch(versioned('data/passages.json')).then((r) => (r.ok ? r.json() : { units: {} })).catch(() => {
      passagesPromise = null;
      return { units: {} };
    });
  }
  return passagesPromise;
}
const unitRefsFromStem = (q) => {
  if (!q || q.subject !== '영어') return [];
  const text = String(q.stem || '');
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(/Unit\s*(\d+)\s*([AB])(?:\s*(?:&|and|,|·)\s*(?:Unit\s*)?(\d+)?\s*([AB]))?/g)) {
    const first = `${m[1]}${m[2]}`;
    if (!seen.has(first)) {
      seen.add(first);
      out.push({ unit: first });
    }
    if (m[4]) {
      const second = `${m[3] || m[1]}${m[4]}`;
      if (!seen.has(second)) {
        seen.add(second);
        out.push({ unit: second });
      }
    }
  }
  return out;
};

const passageSpecsOf = (q) => {
  if (!q) return [];
  if (q.passageRef) {
    const list = Array.isArray(q.passageRef) ? q.passageRef : [q.passageRef];
    return list.map((x) => (typeof x === 'string' ? { unit: x } : x)).filter((x) => x && x.unit);
  }
  return unitRefsFromStem(q);
};

/** 문제가 가리키는 본문·자료를 접이식으로 보여 준다. defaultOpen 이 null 이면 문항의 open 설정을 따른다. */
export function passageBlock(q, defaultOpen = false) {
  const specs = passageSpecsOf(q);
  if (!specs.length) return null;
  const boxes = specs.map((spec) => {
    const isOpen = defaultOpen === null ? !!spec.open : (spec.open ?? defaultOpen);
    const summary = el('summary', { text: '📖 관련 지문 보기' });
    const box = el('details.q-context.q-passage', { open: isOpen }, summary, el('p.meta', { text: '지문을 불러오는 중…' }));
    void loadPassages().then((d) => {
      const u = d.units?.[spec.unit];
      if (!u) return box.remove();
      const paraPrefix = u.paraPrefix !== undefined ? u.paraPrefix : 'Paragraph ';
      const paraTag = spec.paras?.length ? ` · ${paraPrefix}${spec.paras.join('·')}` : '';
      const pages = u.pages ? ` (${u.pages})` : '';
      const head = u.label || (u.unit ? `Unit ${u.unit} ${u.title}` : u.title);
      summary.textContent = `📖 ${head}${paraTag}${pages}`;
      let text = '';
      if (u.markdown) {
        text = u.markdown;
      } else {
        const list = spec.paras?.length ? (u.paragraphs || []).filter((p) => spec.paras.includes(p.label)) : (u.paragraphs || []);
        const paras = list.length ? list : (u.paragraphs || []);
        text = paras.map((p) => {
          if (p.heading) return `**${p.label} ${p.heading}**\n\n${p.text}`;
          return p.label && p.label !== 'Caption' ? `**${p.label}** ${p.text}` : p.text;
        }).join('\n\n');
      }
      box.lastChild.replaceWith(md(text, 'md passage-text'));
    });
    return box;
  });
  return boxes.length === 1 ? boxes[0] : el('div.q-passages', {}, boxes);
}

/** 선지 버튼들. onPick(번호) 로 알린다. 돌려준 set(…) 으로 겉모습을 바꾼다. */
export function choiceList(q, onPick) {
  const buttons = q.choices.map((text, i) =>
    el('button.choice', { type: 'button', 'aria-pressed': 'false', onclick: () => onPick(i + 1) },
      el('span.choice-no', { text: CIRCLED[i] }),
      // 표로 적힌 선지는 지문의 표에 내용이 있으므로 버튼에는 줄여 적는다
      md(text, 'md choice-text')
    )
  );
  const list = el(`div.choices${q.choiceTable ? '.compact' : ''}`, {}, buttons);
  return {
    node: list,
    /** picked: 고른 번호들, reveal: 채점 뒤 정답 번호들(없으면 채점 전) */
    set(picked, reveal) {
      buttons.forEach((b, i) => {
        const n = i + 1;
        const on = picked.includes(n);
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('on', on);
        b.classList.toggle('right', !!reveal && reveal.includes(n));
        b.classList.toggle('miss', !!reveal && on && !reveal.includes(n));
        b.disabled = !!reveal;
      });
    },
  };
}

/** 확신도 고르기 — 확신·애매·찍음 */
function confidencePicker(value, onChange, small = false) {
  const wrap = el(`div.segment${small ? '.small' : ''}`, { role: 'group', 'aria-label': '얼마나 확신하나요' });
  const buttons = Object.entries(CONFIDENCE_LABEL).map(([key, label]) =>
    el('button', { type: 'button', text: label, 'aria-pressed': String(value === key), onclick: () => {
      value = value === key ? null : key;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(CONFIDENCE_LABEL)[i] === value)));
      onChange(value);
    } })
  );
  wrap.append(...buttons);
  return wrap;
}

/** 틀린 까닭 고르기. 고르면 기록에 덧붙인다. */
function errorPicker(attemptId, current, onSaved) {
  const wrap = el('div.error-pick', {}, el('p.hint', { text: '왜 틀렸나요? 하나 골라 두면 나중에 약한 곳을 찾는 데 씁니다.' }));
  const row = el('div.chips');
  const buttons = Object.entries(ERROR_LABEL).map(([key, label]) =>
    el('button.chip.pick', { type: 'button', text: label, 'aria-pressed': String(current === key), onclick: async () => {
      current = current === key ? null : key;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(ERROR_LABEL)[i] === current)));
      const result = await saveRecords([{ type: 'tag', attempt: attemptId, errorType: current }]);
      onSaved?.(current, result);
    } })
  );
  row.append(...buttons);
  wrap.append(row);
  return wrap;
}

function saveWarning(result) {
  return result.ok ? null : el('p.save-warn', { text: '기록을 서버에 저장하지 못해 이 브라우저에 잠시 보관했습니다. 다음에 열 때 다시 보냅니다.' });
}

/* ── 연습 ─────────────────────────────────────────── */
async function renderPractice(ctx, subject, mode = 'practice') {
  const paper = await loadPaper(ctx, subject);
  const groups = paper.groups;
  let questions = paper.questions;
  if (!questions.length) return ctx.renderMissing('이 과목에는 가져온 문제가 없습니다.');
  const label = MODE_LABEL[mode];
  document.title = `${subject.subject} ${label} — 시험 준비`;
  ctx.setNav(subject.code);

  if (mode === 'review') {
    // 복습: 오답 노트에서 오늘 다시 풀 차례인 문제만
    const loaded = await loadRecords();
    const due = new Set(wrongNotes(questions, buildHistories(mergeRecordsForLearner(loaded.records, getCurrentLearner()).attempts), localDay(new Date())).filter((n) => n.status === 'due').map((n) => n.question.id));
    questions = questions.filter((q) => due.has(q.id));
    if (!questions.length) {
      ctx.show(
        el('section.hero', {},
          el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
          el('h1', { text: '오늘 복습할 문제가 없습니다' }),
          el('p.sub', { text: '틀린 문제는 오답 노트에 모이고, 다시 풀 차례가 되면 여기에 나옵니다.' }),
          el('div.hero-actions', {}, el('a.pill', { href: `#/s/${subject.code}/notes`, text: '오답 노트 보기' }))
        )
      );
      return;
    }
  }

  const session = newId(mode === 'review' ? 'r' : 'p');
  const startedAt = Date.now();
  const learner = getCurrentLearner(); // 시작할 때의 응시자로 고정
  let index = 0;
  let done = 0;

  const bar = el('div.reader-bar');
  const stage = el('div.wrap.solve');
  ctx.show(bar, stage);

  const finish = async () => {
    if (!done) {
      location.hash = `#/s/${subject.code}`;
      return;
    }
    await saveRecords([{ type: 'session', learner, session, mode, subject: subject.code, round: questions[0].round, seconds: (Date.now() - startedAt) / 1000, count: done }]);
    location.hash = `#/s/${subject.code}/result/${session}`;
  };

  const showQuestion = () => {
    const q = questions[index];
    const shownAt = Date.now();
    const last = index === questions.length - 1;
    bar.replaceChildren(
      el('div.wrap', {},
        el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
        el('div.title', { text: `${label} · ${index + 1} / ${questions.length}` }),
        el('button.link', { type: 'button', text: '그만하고 결과 보기', onclick: () => void finish() })
      ),
      el('div.progress', {}, el('i', { style: `width:${(index / questions.length) * 100}%` }))
    );

    const card = el('article.q-card');
    const foot = el('div.q-foot');
    const feedback = el('div.feedback', { 'aria-live': 'polite' });
    const next = el('button.pill', { type: 'button', text: last ? '결과 보기' : '다음 문제', onclick: () => {
      if (last) void finish();
      else {
        index++;
        showQuestion();
        window.scrollTo(0, 0);
      }
    } });
    const skip = el('button.pill.ghost', { type: 'button', text: last ? '건너뛰고 결과 보기' : '건너뛰기', onclick: () => next.click() });

    card.append(contextBlock(groups.get(q.group)) || '', questionHead(q), passageBlock(q, null) || '', md(q.stem, 'md q-stem'));
    inkTools(card, `${mode}.${subject.code}`).add(card, q.id); // 연필·지우개

    if (q.type === 'choice') {
      let picked = [];
      let confidence = null;
      const check = el('button.pill', { type: 'button', text: '채점하기', disabled: true });
      const choices = choiceList(q, (n) => {
        picked = picked.includes(n) ? [] : [n];
        choices.set(picked, null);
        check.disabled = !picked.length;
      });
      const conf = el('div.conf-row', {}, el('span.hint', { text: '얼마나 확신하나요?' }), confidencePicker(null, (v) => (confidence = v)));
      check.addEventListener('click', async () => {
        const g = gradeChoice(q, picked);
        const id = newId('a');
        choices.set(picked, q.answer);
        conf.remove();
        done++;
        feedback.append(
          el(`p.verdict.${g.correct ? 'good' : 'bad'}`, { text: g.correct ? `맞았습니다 · ${pts(q.points)}` : `틀렸습니다 · 정답 ${answerText(q.answer)}` }),
          q.explanation ? md(q.explanation, 'md explain') : ''
        );
        foot.replaceChildren(next);
        next.focus();
        const result = await saveRecords([{ type: 'attempt', learner, id, session, mode, subject: subject.code, q: q.id, qtype: 'choice', picked, correct: g.correct, points: q.points, earned: g.earned, seconds: (Date.now() - shownAt) / 1000, confidence }]);
        feedback.append(saveWarning(result) || '');
        if (!g.correct) feedback.append(errorPicker(id, null));
      });
      card.append(choices.node, conf, feedback);
      foot.append(check, skip);
    } else {
      const input = el('textarea.essay-input', { rows: 6, placeholder: '여기에 답을 쓰세요. 종이에 썼다면 비워 두고 모범 답안을 봐도 됩니다.' });
      const reveal = el('button.pill', { type: 'button', text: '모범 답안 보고 채점하기' });
      reveal.addEventListener('click', async () => {
        const id = newId('a');
        input.readOnly = true;
        done++;
        foot.replaceChildren(next);
        const result = await saveRecords([{ type: 'attempt', learner, id, session, mode, subject: subject.code, q: q.id, qtype: 'essay', points: q.points, seconds: (Date.now() - shownAt) / 1000, text: input.value.trim() || '(종이에 씀)' }]);
        feedback.append(saveWarning(result) || '', essayGrader(q, id, null));
      });
      card.append(input, feedback);
      foot.append(reveal, skip);
    }
    card.append(foot);
    stage.replaceChildren(card);
  };
  showQuestion();
}

/**
 * 서술형 스스로 채점 — 모범 답안과 채점 항목을 보여주고 점수를 받는다.
 * 항목의 점수 합이 배점과 맞으면 항목별 체크, 아니면 점수를 직접 고른다.
 */
function essayGrader(q, attemptId, attempt, onSaved) {
  const box = el('div.grader');
  box.append(el('h4', { text: '모범 답안과 채점 기준' }), md(q.modelAnswer, 'md explain'));
  const total = el('strong.grader-score');
  const save = el('button.pill', { type: 'button', text: '이 점수로 저장' });
  const status = el('span.hint');
  let read;
  if (canCheckRubric(q)) {
    const checks = q.rubric.map((_, i) => !!(attempt && attempt.checks && attempt.checks[i]));
    const refresh = () => (total.textContent = `${pts(gradeEssayByChecks(q, checks))} / ${pts(q.points)}`);
    box.append(
      el('p.hint', { text: '내 답에 들어 있는 것만 체크하세요.' }),
      el('div.rubric', {}, q.rubric.map((r, i) =>
        el('label', {},
          el('input', { type: 'checkbox', checked: checks[i], onchange: (e) => {
            checks[i] = e.target.checked;
            refresh();
          } }),
          md(r.point, 'md rubric-text'),
          el('span.rubric-score', { text: pts(r.score) })
        )
      ))
    );
    refresh();
    read = () => ({ earned: gradeEssayByChecks(q, checks), checks });
  } else {
    // 항목을 가르지 못한 문제 — 모범 답안을 보고 점수를 직접 정한다
    const input = el('input.score-input', { type: 'number', min: 0, max: q.points, step: 0.5, value: attempt && typeof attempt.earned === 'number' ? attempt.earned : 0, 'aria-label': '내 점수' });
    const refresh = () => (total.textContent = `/ ${pts(q.points)}`);
    box.append(el('p.hint', { text: q.rubricNote ? '이 문제는 채점 항목을 자동으로 나누지 못했습니다. 위 채점 기준을 보고 점수를 직접 적으세요.' : '위 채점 기준을 보고 점수를 직접 적으세요.' }), el('div.score-row', {}, input));
    refresh();
    read = () => ({ earned: Math.min(Math.max(Number(input.value) || 0, 0), q.points), checks: [] });
  }
  save.addEventListener('click', async () => {
    const value = read();
    save.disabled = true;
    const result = await saveRecords([{ type: 'grade', attempt: attemptId, ...value }]);
    save.disabled = false;
    status.textContent = result.ok ? `저장했습니다 · ${pts(value.earned)}` : '서버에 저장하지 못해 이 브라우저에 보관했습니다.';
    onSaved?.(value);
  });
  box.append(el('div.grader-foot', {}, total, save, status));
  return box;
}

/* ── 실전 ─────────────────────────────────────────── */
const examKey = (code) => `examprep.exam.${getCurrentLearner()}.${code}`;

export function readExamState(code, key = examKey(code)) {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || 'null');
    return v && typeof v === 'object' && typeof v.session === 'string' && typeof v.startedAt === 'number' && v.answers && typeof v.answers === 'object' ? v : null;
  } catch {
    return null;
  }
}

async function renderExam(ctx, subject) {
  const [{ questions, groups }, loaded] = await Promise.all([loadPaper(ctx, subject), loadRecords()]);
  if (!questions.length) return ctx.renderMissing('이 과목에는 가져온 문제가 없습니다.');
  document.title = `${subject.subject} 실전 — 시험 준비`;
  ctx.setNav(subject.code);
  const paper = (subject.papers && subject.papers[0]) || {};
  const limit = (paper.minutes || 45) * 60;
  const total = round1(questions.reduce((a, q) => a + (q.points || 0), 0));
  const saved = readExamState(subject.code);
  const tries = [...mergeRecordsForLearner(loaded.records, getCurrentLearner()).sessions.values()]
    .filter((s) => s.mode === 'exam' && s.subject === subject.code).length;

  const begin = (state) => runExam(ctx, subject, questions, groups, limit, state);
  const fresh = () => begin({ session: newId('e'), startedAt: Date.now(), answers: {} });

  ctx.show(
    el('section.hero', {},
      el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
      el('h1', { text: '실전 풀이' }),
      el('p.sub', { text: `${questions.length}문항 · ${total}점 · ${Math.round(limit / 60)}분${tries ? ` · ${tries}차 응시 완료` : ''}` }),
      el('p.scope', { text: '시작을 누르면 시간이 흐릅니다. 모든 문제를 풀어야 제출할 수 있고, 제출하면 한 번에 채점합니다. 풀기 전에 정답과 해설은 보이지 않습니다.' }),
      el('div.hero-actions', {},
        saved ? el('button.pill', { type: 'button', text: '풀던 시험 이어서', onclick: () => begin(saved) }) : null,
        el(`button.pill${saved ? '.ghost' : ''}`, { type: 'button', text: saved ? '처음부터 새로' : tries ? `${tries + 1}차 재시험 시도` : '시작', onclick: fresh })
      )
    )
  );
}

/**
 * opts (평가에서 다시 쓸 때): { mode, key, round, title, resultHref(session) }
 */
export function runExam(ctx, subject, questions, groups, limit, state, opts = {}) {
  const mode = opts.mode || 'exam';
  const storeKey = opts.key || examKey(subject.code);
  const resultHref = opts.resultHref || ((sid) => `#/s/${subject.code}/result/${sid}`);
  const answers = state.answers; // { [문제 id]: { picked, confidence, text } }
  // 응시자는 시작할 때 정한다. 푸는 도중 다른 탭에서 참여자를 바꿔도 기록의 이름은 바뀌지 않는다
  state.learner ||= getCurrentLearner();
  const learner = state.learner;
  const persist = () => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      // 저장 공간을 못 쓰면 새로 고침 때만 잃는다
    }
  };
  persist();
  const answerOf = (q) => (answers[q.id] ??= { picked: [], confidence: null, text: '' });
  const isAnswered = (q) => (q.type === 'choice' ? answerOf(q).picked.length > 0 : answerOf(q).text.trim().length > 0);

  const clock = el('span.clock');
  const count = el('span.step');
  const submit = el('button.pill', { type: 'button', text: '제출' });
  const reset = el('button.pill.ghost', { type: 'button', text: '다시 풀기', title: '고른 답을 모두 지우고 시간도 처음부터 다시 잽니다' });
  const bar = el('div.reader-bar', {}, el('div.wrap', {}, el('div.title', {}, `${learner} · ${opts.title || `${subject.subject} 실전`} · `, clock), count, reset, submit));
  const omr = el('nav.omr', { 'aria-label': '답안 표시판' }, el('p', { text: '답안' }));
  const omrCells = new Map();
  const qBlocks = new Map();
  const sheet = el('div.exam-sheet');
  const ink = inkTools(sheet, opts.inkScope || `${mode}.${subject.code}`); // 연필·지우개

  const refresh = (q) => {
    const cell = omrCells.get(q.id);
    const a = answerOf(q);
    cell.classList.toggle('on', isAnswered(q));
    cell.lastChild.textContent = q.type === 'choice' ? (a.picked.length ? answerText(a.picked) : '') : isAnswered(q) ? '✓' : '';
    count.textContent = `${questions.filter(isAnswered).length} / ${questions.length} 풂`;
  };

  const addCell = (q, block) => {
    const cell = el('a', { href: `#q-${q.id}`, onclick: (e) => {
      e.preventDefault(); // 주소의 # 은 화면 주소로 쓴다
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } }, el('b', { text: q.type === 'essay' ? `서${q.no}` : String(q.no) }), el('span'));
    omrCells.set(q.id, cell);
    qBlocks.set(q.id, block);
    omr.append(cell);
  };

  // 평가는 학교 시험지처럼 흰 종이 2단에 그린다 (인쇄용 문제지와 같은 모양, 선지를 눌러 표시)
  const onPaper = !!opts.paper;
  const flow = onPaper ? el('div.cols') : sheet;
  if (onPaper) {
    const p = opts.paper;
    const today = new Date().toLocaleDateString('ko-KR');
    const field = (label, value) => el('div', {}, el('span', { text: label }), el('i', { text: value || '' }));
    sheet.className = 'sheet exam-paper';
    sheet.append(
      el('header.sheet-head', {},
        el('div.sheet-title', {}, el('small', { text: p.kicker || '' }), el('h1', {}, subject.subject, el('span', { text: ` ${p.kind || '평가'}` }))),
        p.note ? el('p.sheet-note', { text: p.note }) : null,
        el('div.sheet-fields', {}, field('과목', subject.subject), field('이름', learner), field('날짜', today), field('점수', '제출 후'))
      ),
      flow
    );
  }

  let shownGroup = null;
  for (const q of questions) {
    const group = groups.get(q.group);
    if (group && group.id !== shownGroup) {
      shownGroup = group.id;
      if (onPaper) flow.append(group.context ? el('section.p-context', {}, el('h3', { text: group.title }), md(group.context)) : el('h3.p-group', { text: group.title }));
      else sheet.append(group.context ? contextBlock(group) : el('h3.exam-group', { text: group.title }));
    }
    const a = answerOf(q);
    if (onPaper) {
      const block = el(`article.p-q.p-solve${q.type === 'essay' ? '.essay' : ''}`, { id: `q-${q.id}` },
        el('div.p-stem', {}, el('b.p-no', { text: `${q.type === 'essay' ? `서술형 ${q.no}` : q.no}.` }), md(q.stem, 'md p-text'), el('span.p-points', { text: `[${pts(q.points)}]` })),
        passageBlock(q, null) || ''
      );
      if (q.type === 'choice') {
        const items = q.choices.map((c, i) => el('li', {},
          el('button.p-pick', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${i + 1}번 고르기`, onclick: () => {
            a.picked = a.picked.includes(i + 1) ? [] : [i + 1];
            mark();
            persist();
            refresh(q);
          } }, el('span.p-mark', { text: CIRCLED[i] }), md(c, 'md p-text'))
        ));
        const mark = () => items.forEach((li, i) => {
          const on = a.picked.includes(i + 1);
          li.firstChild.setAttribute('aria-pressed', String(on));
          li.classList.toggle('on', on);
          li.querySelector('.p-mark').textContent = on ? String(i + 1) : CIRCLED[i]; // 칠한 동그라미 안에 번호
        });
        block.append(el(`ol.p-choices.p-choose${q.choiceTable ? '.compact' : ''}`, {}, items)); // 풀이 해설은 제출한 뒤 결과 화면에서만
        mark();
      } else {
        const input = el('textarea.p-write', { rows: 5, placeholder: '여기에 답을 쓰세요.' });
        input.value = a.text;
        input.addEventListener('input', () => {
          a.text = input.value;
          persist();
          refresh(q);
        });
        block.append(input);
      }
      flow.append(block);
      ink.add(block, q.id);
      addCell(q, block);
      continue;
    }
    const block = el('article.q-card', { id: `q-${q.id}` }, questionHead(q), passageBlock(q, null) || '', md(q.stem, 'md q-stem'));
    if (q.type === 'choice') {
      const choices = choiceList(q, (n) => {
        a.picked = a.picked.includes(n) ? [] : [n];
        choices.set(a.picked, null);
        persist();
        refresh(q);
      });
      choices.set(a.picked, null);
      block.append(choices.node, el('div.conf-row', {}, confidencePicker(a.confidence, (v) => {
        a.confidence = v;
        persist();
      }, true)));
    } else {
      const input = el('textarea.essay-input', { rows: 6, placeholder: '답을 쓰세요.' });
      input.value = a.text;
      input.addEventListener('input', () => {
        a.text = input.value;
        persist();
        refresh(q);
      });
      block.append(input);
    }
    sheet.append(block);
    ink.add(block, q.id);
    addCell(q, block);
  }

  let finished = false;
  const finish = async (timedOut) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    submit.disabled = true;
    submit.textContent = '채점 중…';
    const seconds = Math.min((Date.now() - state.startedAt) / 1000, limit);
    const records = [];
    for (const q of questions) {
      if (!isAnswered(q)) continue;
      const a = answerOf(q);
      if (q.type === 'choice') {
        const g = gradeChoice(q, a.picked);
        records.push({ type: 'attempt', learner, id: newId('a'), session: state.session, mode, subject: subject.code, q: q.id, qtype: 'choice', picked: a.picked, correct: g.correct, points: q.points, earned: g.earned, confidence: a.confidence });
      } else {
        records.push({ type: 'attempt', learner, id: newId('a'), session: state.session, mode, subject: subject.code, q: q.id, qtype: 'essay', points: q.points, text: a.text.trim() });
      }
    }
    records.push({ type: 'session', learner, session: state.session, mode, subject: subject.code, round: opts.round ?? questions[0].round, seconds, limit, count: records.length, timedOut });
    await saveRecords(records);
    sessionStorage.removeItem(storeKey);
    location.hash = resultHref(state.session);
  };

  submit.addEventListener('click', () => {
    if (finished) return;
    // 모든 문제를 풀어야 제출된다 — 안 푼 문제 번호를 팝업으로 알려 주고 그 문제로 데려간다
    const blanks = questions.filter((q) => !isAnswered(q));
    if (blanks.length) {
      showBlankAlert(blanks.map((q) => ({
        label: q.type === 'essay' ? `서술형 ${q.no}번` : `${q.no}번`,
        go: () => {
          const b = qBlocks.get(q.id);
          if (!b) return;
          b.scrollIntoView({ behavior: 'smooth', block: 'start' });
          b.classList.add('blank-flash');
          setTimeout(() => b.classList.remove('blank-flash'), 2500);
        },
      })));
      return;
    }
    void finish(false);
  });

  // 다시 풀기 — 실수로 눌러도 답이 날아가지 않게 한 번 더 눌러야 지운다
  let resetArmed = false;
  let resetTimer = null;
  reset.addEventListener('click', () => {
    if (finished) return;
    if (!resetArmed && questions.some(isAnswered)) {
      resetArmed = true;
      reset.textContent = '답을 모두 지울까요? 한 번 더 누르기';
      resetTimer = setTimeout(() => {
        resetArmed = false;
        reset.textContent = '다시 풀기';
      }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    finished = true; // 이 화면의 시계·제출을 멈춘다
    clearInterval(timer);
    const prefix = String(state.session || 'x').split('-')[0] || 'x';
    window.scrollTo({ top: 0 });
    runExam(ctx, subject, questions, groups, limit, { session: newId(prefix), startedAt: Date.now(), answers: {}, learner }, opts);
  });

  const tick = () => {
    const left = limit - (Date.now() - state.startedAt) / 1000;
    clock.textContent = formatClock(left);
    clock.classList.toggle('low', left <= 300);
    if (left <= 0) void finish(true);
  };
  const timer = setInterval(tick, 500);
  ctx.onLeave(() => clearInterval(timer));

  ctx.show(bar, onPaper ? el('div.paper-stage', {}, el('div.wrap.exam.on-paper', {}, sheet, omr)) : el('div.wrap.exam', {}, sheet, omr));
  for (const q of questions) refresh(q);
  tick();
}

/* ── 결과 ─────────────────────────────────────────── */
/**
 * opts (평가에서 다시 쓸 때): { paper, title, backHref, backText, actions: () => [노드] }
 */
export async function renderResult(ctx, subject, sessionId, opts = {}) {
  const [{ questions, groups }, loaded] = await Promise.all([opts.paper ? Promise.resolve(opts.paper) : loadPaper(ctx, subject), loadRecords()]);
  const merged = mergeRecords(loaded.records);
  const session = merged.sessions.get(sessionId);
  const attempts = merged.attempts.filter((a) => a.session === sessionId);
  if (!session && !attempts.length) return ctx.renderMissing('이 풀이 기록을 찾지 못했습니다.');
  const owner = recordLearner(session || attempts[0]);
  const mode = session?.mode || attempts[0]?.mode || 'practice';
  document.title = `${subject.subject} ${MODE_LABEL[mode]} 결과 — 시험 준비`;
  ctx.setNav(subject.code);

  const examTries = [...merged.sessions.values()]
    .filter((s) => s.mode === 'exam' && s.subject === subject.code && recordLearner(s) === owner).length;
  const buildActions = () =>
    opts.actions
      ? opts.actions()
      : mode === 'exam'
        ? [
            el('a.pill', { href: `#/s/${subject.code}/exam`, text: `${(examTries || 1) + 1}차 재시험 시도` }),
            el('a.pill.ghost', { href: `#/s/${subject.code}/notes`, text: '오답 노트 보기' }),
            el('a.pill.ghost', { href: `#/s/${subject.code}/practice`, text: '연습으로 다시 풀기' }),
            el('a.pill.ghost', { href: `#/s/${subject.code}`, text: `${subject.subject}(으)로 돌아가기` }),
          ]
        : [
            el('a.pill', { href: `#/s/${subject.code}/notes`, text: '오답 노트 보기' }),
            el('a.pill.ghost', { href: `#/s/${subject.code}/practice`, text: '연습으로 다시 풀기' }),
            el('a.pill.ghost', { href: `#/s/${subject.code}/exam`, text: examTries ? `${examTries + 1}차 실전 재시험 시도` : '실전으로 풀기' }),
            el('a.pill.ghost', { href: `#/s/${subject.code}`, text: `${subject.subject}(으)로 돌아가기` }),
          ];

  const root = el('div');
  ctx.show(root);

  const draw = (list) => {
    // 연습은 푼 문제만 채점표에 올린다(건너뛴 문제를 0점으로 세지 않는다)
    const scope = mode !== 'exam' && mode !== 'assess' ? questions.filter((q) => list.some((a) => a.q === q.id)) : questions;
    const sum = summarize(scope, list);
    const wrong = sum.rows.filter((r) => r.state === 'wrong' || r.state === 'partial');
    const pending = sum.rows.filter((r) => r.state === 'pending');

    const row = (r) => {
      const q = r.question;
      const a = r.attempt;
      const body = el('div.result-body');
      body.append(contextBlock(groups.get(q.group), false) || '', passageBlock(q) || '', md(q.stem, 'md q-stem'));
      if (q.type === 'choice') {
        const choices = choiceList(q, () => {});
        choices.set(a ? a.picked || [] : [], q.answer);
        body.append(choices.node, el('p.verdict-line', { text: `내 답 ${answerText(a ? a.picked : [])} · 정답 ${answerText(q.answer)}${a && a.confidence ? ` · ${CONFIDENCE_LABEL[a.confidence]}` : ''}` }), q.explanation ? md(q.explanation, 'md explain') : '');
        if (r.state === 'wrong' && a) body.append(errorPicker(a.id, a.errorType));
      } else {
        if (a && a.text) body.append(el('h4', { text: '내가 쓴 답' }), el('p.my-answer', { text: a.text }));
        if (a) body.append(essayGrader(q, a.id, a, (value) => {
          a.earned = value.earned;
          a.checks = value.checks;
          a.graded = true;
          draw(list); // 점수가 바뀌었으니 채점표를 다시 그린다
        }));
        else body.append(el('h4', { text: '모범 답안과 채점 기준' }), md(q.modelAnswer, 'md explain'));
      }
      // 풀이 해설(풀이 영상 포함)은 제출한 뒤인 이 결과 화면에서만 볼 수 있다
      body.append(explainButton(q, { label: q.type === 'essay' ? `서술형 ${q.no}번` : `${q.no}번` }));
      return el(`details.result-row.${r.state}`, { open: r.state === 'pending' },
        el('summary', {},
          el('span.mark', { text: STATE_MARK[r.state], 'aria-label': STATE_LABEL[r.state] }),
          el('span.result-no', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }),
          el('span.result-stem', { text: plainStem(q.stem) }),
          el('span.result-points', { text: r.state === 'pending' ? `채점 전 / ${pts(q.points)}` : `${pts(r.earned)} / ${pts(q.points)}` })
        ),
        body
      );
    };

    const section = (title, note, rows) =>
      rows.length ? el('section.section', {}, el('div.section-head', {}, el('h2', { text: title }), note ? el('p', { text: note }) : null), el('div.result-list', {}, rows.map(row))) : null;

    root.replaceChildren(
      el('section.hero', {},
        el('a.back', { href: opts.backHref || `#/s/${subject.code}`, text: opts.backText || subject.subject }),
        el('p.eyebrow', { text: `${owner} · ${opts.title || MODE_LABEL[mode]} 결과${session?.timedOut ? ' · 시간 초과로 자동 제출' : ''}` }),
        el('h1.score', {}, String(sum.earned), el('small', { text: ` / ${sum.max}점` })),
        sum.pending ? el('p.sub', { text: `서술형 ${sum.pending}문제를 아직 채점하지 않아 잠정 점수입니다.` }) : null,
        !loaded.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null,
        el('div.hero-actions', {}, buildActions())
      ),
      el('div.wrap', {},
        el('div.tiles', {},
          resultTile(`${sum.choice.correct} / ${sum.choice.count}`, `선택형 · ${sum.choice.earned} / ${sum.choice.max}점`),
          sum.essay.count ? resultTile(`${sum.essay.earned} / ${sum.essay.max}`, sum.pending ? `서술형 · ${sum.pending}문제 채점 전` : '서술형 점수') : null,
          session && typeof session.seconds === 'number' ? resultTile(formatDuration(session.seconds), session.limit ? `걸린 시간 · 제한 ${Math.round(session.limit / 60)}분` : '걸린 시간') : null,
          resultTile(String(sum.sureWrong), '확신했는데 틀림'),
          sum.blank ? resultTile(String(sum.blank), '안 푼 문제') : null
        ),
        sum.negativeWrong ? el('p.note', { text: `틀린 문제 중 ${sum.negativeWrong}개는 「옳지 않은 것 · 아닌 것」을 고르는 문제였습니다. 문제 끝의 묻는 말에 표시하고 푸세요.` }) : null,
        opts.extra ? opts.extra(sum) : null,
        section('서술형 채점하기', '모범 답안과 비교해 스스로 채점하면 총점이 완성됩니다.', pending),
        section('틀린 문제', '열어서 해설을 읽고, 왜 틀렸는지 하나씩 골라 두세요.', wrong),
        section('전체 문제', null, sum.rows.filter((r) => !pending.includes(r) && !wrong.includes(r))),
        el('section.section', {},
          el('div.hero-actions.left', {}, buildActions())
        )
      )
    );
  };
  draw(attempts);
}

function resultTile(value, label) {
  return el('div.tile', {}, el('div.num.small', { text: value }), el('div.label', { text: label }));
}

/* ── 과목 화면에 넣는 것 ─────────────────────────────────────────── */

/** 과목 화면의 「문제」 칸: 풀기 버튼과 지난 풀이 목록 */
export async function renderHistory(ctx, subject, container) {
  const list = el('div.history');
  container.append(list);
  let paper;
  let loaded;
  try {
    [paper, loaded] = await Promise.all([loadPaper(ctx, subject), loadRecords()]);
  } catch {
    list.append(el('p.note', { text: '풀이 기록을 불러오지 못했습니다.' }));
    return;
  }
  const sessions = listSessions(mergeRecordsForLearner(loaded.records, getCurrentLearner()), subject.code).filter((s) => s.mode !== 'assess');
  if (!sessions.length) {
    list.append(el('p.note', { text: '아직 푼 기록이 없습니다.' }));
    return;
  }
  list.append(
    el('h3', { text: '지난 풀이' }),
    el('div.result-list', {}, sessions.slice(0, 8).map((s) => {
      const scope = s.mode !== 'exam' ? paper.questions.filter((q) => s.attempts.some((a) => a.q === q.id)) : paper.questions;
      const sum = summarize(scope, s.attempts);
      const when = new Date(s.at);
      return el('a.history-row', { href: `#/s/${subject.code}/result/${s.session}` },
        el('span.badge', { text: MODE_LABEL[s.mode] || s.mode }),
        el('span.history-when', { text: Number.isNaN(when.getTime()) ? '' : when.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
        el('span.history-score', { text: `${sum.earned} / ${sum.max}점${sum.pending ? ' (서술형 채점 전)' : ''}` }),
        el('span.history-meta', { text: `${scope.length}문제 · ${formatDuration(s.seconds)}` })
      );
    }))
  );
  if (!loaded.ok) list.append(el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다.' }));
}

export function renderSolveRoute(ctx, subject, parts) {
  if (parts[0] === 'practice' && parts.length === 1) return renderPractice(ctx, subject);
  if (parts[0] === 'review' && parts.length === 1) return renderPractice(ctx, subject, 'review');
  if (parts[0] === 'exam' && parts.length === 1) return renderExam(ctx, subject);
  if (parts[0] === 'result' && parts.length === 2) return renderResult(ctx, subject, parts[1]);
  return null;
}
