import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';

const PRIORITY_LABEL: Record<TaskLineValue['priority'], string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

const ORDER: TaskLineValue['priority'][] = ['must', 'should', 'could'];

function line(task: TaskLineValue): string {
  const category = task.categoryName ? ` · ${task.categoryName}` : '';
  return `• *${PRIORITY_LABEL[task.priority]}* ${task.title}${category}`;
}

function section(title: string, tasks: TaskLineValue[]): unknown[] {
  if (tasks.length === 0) return [];
  const ordered = [...tasks].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${ordered.map(line).join('\n')}` } },
  ];
}

/** Slack Block Kit. Empty sections are omitted rather than rendered as headings. */
export function renderSlack(payload: ReminderPayloadValue): unknown {
  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `Todos for ${payload.date}` } },
      ...section('Overdue', payload.overdue),
      ...section('Due today', payload.dueToday),
      ...section('Repeating today', payload.repeatsToday),
      ...section('Completed yesterday', payload.completedYesterday),
      ...(payload.missedYesterday.length > 0
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Missed yesterday*\n${payload.missedYesterday.map((t) => `• ${t}`).join('\n')}`,
              },
            },
          ]
        : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: payload.timezone }] },
    ],
  };
}
