import {
  compareIsoDates,
  getScheduleWindow,
  isIsoDate,
  toIsoDate,
} from '@/lib/scheduler/date-utils';

const MAX_NAME_LENGTH = 48;
const MAX_SELECTED_DATES = 220;

export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Please add your name.');
  }

  const name = value.trim().replace(/\s+/g, ' ');

  if (!name) {
    throw new Error('Please add your name.');
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Keep names under ${MAX_NAME_LENGTH} characters.`);
  }

  return name;
}

export function normalizeDates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Please send dates as an array.');
  }

  const dates = [...new Set(value)]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .sort(compareIsoDates);

  if (dates.some((date) => !isIsoDate(date))) {
    throw new Error('One or more selected dates are invalid.');
  }

  if (dates.length > MAX_SELECTED_DATES) {
    throw new Error('That selection is larger than this board allows.');
  }

  const window = getScheduleWindow();
  const min = toIsoDate(window.start);
  const max = toIsoDate(window.end);

  if (
    dates.some(
      (date) =>
        compareIsoDates(date, min) < 0 || compareIsoDates(date, max) > 0
    )
  ) {
    throw new Error(`Please keep dates between ${min} and ${max}.`);
  }

  return dates;
}

export function normalizeParticipantId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('That participant id is invalid.');
  }

  const participantId = value.trim();

  if (!/^[a-f0-9-]{20,}$/i.test(participantId)) {
    throw new Error('That participant id is invalid.');
  }

  return participantId;
}

export function normalizeEditorToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('That private edit token is invalid.');
  }

  const editorToken = value.trim();

  if (editorToken.length < 16) {
    throw new Error('That private edit token is invalid.');
  }

  return editorToken;
}
