/*
 * 시험 준비 웹앱 — 참여자 비밀번호 (숫자 4자리)
 *
 * PROTECTED 에 적힌 참여자로 들어가려면 비밀번호를 넣어야 한다. 처음 비밀번호는 0000.
 * 바꾼 비밀번호는 기록(records)에 type 'pin' 으로 덧붙인다 — 마지막 것이 이긴다. 모든 기기에 바로 통한다.
 * 숫자 그대로가 아니라 SHA-256 으로 바꾼 값만 저장한다.
 * 한 번 들어온 기기는 다른 참여자로 바꾸기 전까지 다시 묻지 않는다.
 */

import { el } from './dom.js?v=20261125-2155';
import { loadRecords, saveRecords, getCurrentLearner, setCurrentLearner, normalizeLearner, DEFAULT_LEARNER } from './store.js?v=20261125-2155';
import { recordLearner } from './grade.mjs?v=20261125-2155';

export const PROTECTED = ['문종배', '문현', '오은미'];
const DEFAULT_PIN = '0000';
const UNLOCKED_KEY = 'examprep.unlocked';

export const isProtected = (name) => PROTECTED.includes(normalizeLearner(name));

function getUnlocked() {
  try {
    return localStorage.getItem(UNLOCKED_KEY) || '';
  } catch {
    return '';
  }
}
function setUnlocked(name) {
  try {
    localStorage.setItem(UNLOCKED_KEY, name);
  } catch {
    // 저장 공간을 못 쓰는 브라우저
  }
}

/** 지금 참여자가 비밀번호를 아직 넣지 않았는가 (처음 여는 기기 등) */
export const needsUnlock = () => isProtected(getCurrentLearner()) && getUnlocked() !== getCurrentLearner();

async function hashPin(name, pin) {
  const bytes = new TextEncoder().encode(`examprep-pin:${name}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 그 참여자의 지금 비밀번호(해시). 바꾼 적이 없으면 0000 */
async function currentHash(name) {
  const { records } = await loadRecords();
  const mine = records
    .filter((r) => r && r.type === 'pin' && recordLearner(r) === name && /^[0-9a-f]{64}$/.test(r.hash || ''))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return mine.length ? mine[mine.length - 1].hash : hashPin(name, DEFAULT_PIN);
}

async function checkPin(name, pin) {
  return (await hashPin(name, pin)) === (await currentHash(name));
}

/** 숫자 4자리 입력 칸 */
function pinField(label) {
  const input = el('input.pin-input', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', placeholder: '••••', 'aria-label': label });
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
  });
  return { input, row: el('label.pin-row', {}, el('span', { text: label }), input) };
}

/** 비밀번호 창을 띄운다. onSubmit 이 오류 글을 돌려주면 창에 보여 주고, null 이면 닫는다 → true */
function pinDialog({ title, desc, labels, submit, onSubmit }) {
  return new Promise((resolve) => {
    const fields = labels.map(pinField);
    const msg = el('p.pin-msg', { 'aria-live': 'polite' });
    const ok = el('button.pill.small', { type: 'submit', text: submit });
    let done = false;
    const form = el('form.pin-form', {},
      el('h2', { text: title }),
      desc ? el('p.pin-desc', { text: desc }) : null,
      fields.map((f) => f.row),
      msg,
      el('div.pin-actions', {}, el('button.pill.small.ghost', { type: 'button', text: '취소', onclick: () => dialog.close() }), ok)
    );
    const dialog = el('dialog.pin-dialog', {}, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = fields.map((f) => f.input.value);
      const bad = values.findIndex((v) => !/^\d{4}$/.test(v));
      if (bad >= 0) {
        msg.textContent = '숫자 4자리를 넣어 주세요.';
        fields[bad].input.focus();
        return;
      }
      ok.disabled = true;
      let error;
      try {
        error = await onSubmit(values);
      } catch {
        error = '확인하지 못했습니다. 잠시 뒤 다시 해 보세요.';
      }
      ok.disabled = false;
      if (error) {
        msg.textContent = error.text || error;
        const at = fields[error.field || 0].input;
        at.value = '';
        at.focus();
        return;
      }
      done = true;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(done);
    });
    document.body.append(dialog);
    dialog.showModal();
    fields[0].input.focus();
  });
}

/** 비밀번호를 물어 맞으면 true */
export function askPin(name) {
  return pinDialog({
    title: `${name} 비밀번호`,
    desc: '숫자 4자리를 넣어 주세요. (처음 비밀번호는 0000)',
    labels: ['비밀번호'],
    submit: '들어가기',
    onSubmit: async ([pin]) => ((await checkPin(name, pin)) ? null : '비밀번호가 다릅니다.'),
  });
}

/** 참여자를 바꾼다. 비밀번호가 걸린 참여자는 먼저 묻는다. 바뀌었으면 true */
export async function enterLearner(raw) {
  const name = normalizeLearner(raw) || DEFAULT_LEARNER;
  if (name === getCurrentLearner() && !needsUnlock()) return true;
  if (isProtected(name) && !(await askPin(name))) return false;
  setCurrentLearner(name);
  setUnlocked(name);
  return true;
}

/** 지금 참여자의 비밀번호를 바꾼다. 바꿨으면 true */
export function changePin() {
  const name = getCurrentLearner();
  if (!isProtected(name)) return Promise.resolve(false);
  return pinDialog({
    title: `${name} 비밀번호 변경`,
    desc: '새 비밀번호도 숫자 4자리입니다.',
    labels: ['지금 비밀번호', '새 비밀번호', '새 비밀번호 한 번 더'],
    submit: '바꾸기',
    onSubmit: async ([now, next, again]) => {
      if (!(await checkPin(name, now))) return { text: '지금 비밀번호가 다릅니다.', field: 0 };
      if (next !== again) return { text: '새 비밀번호 두 칸이 서로 다릅니다.', field: 2 };
      if (next === now) return { text: '지금과 다른 번호로 정해 주세요.', field: 1 };
      await saveRecords([{ type: 'pin', hash: await hashPin(name, next) }]);
      return null;
    },
  });
}

/** 비밀번호를 아직 넣지 않은 기기에 보여 주는 잠금 화면 */
export function renderLock(ctx, onDone) {
  const name = getCurrentLearner();
  document.title = '비밀번호 — 시험 준비';
  const open = async () => {
    if (await enterLearner(name)) onDone();
  };
  const guest = () => {
    setCurrentLearner(DEFAULT_LEARNER);
    setUnlocked('');
    onDone();
  };
  ctx.show(
    el('div.empty.lock-screen', {},
      el('h1', { text: `🔒 ${name}` }),
      el('p', { text: '들어가려면 비밀번호(숫자 4자리)를 넣어 주세요.' }),
      el('p', {}, el('button.pill', { type: 'button', text: '비밀번호 넣기', onclick: () => void open() })),
      el('p', {}, el('button.link', { type: 'button', text: `다른 사람이면 「${DEFAULT_LEARNER}」(으)로 들어가기`, onclick: guest }))
    )
  );
  if (!document.querySelector('dialog.pin-dialog')) void open(); // 화면을 다시 그려도 창은 하나만
}
