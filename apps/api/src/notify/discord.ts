import type { ReminderPayloadValue, TaskLineValue } from '@simple-todos/shared';

const PRIORITY_LABEL: Record<TaskLineValue['priority'], string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

const ORDER: TaskLineValue['priority'][] = ['must', 'should', 'could'];

function line(task: TaskLineValue): string {
  const category = task.categoryName ? ` · ${task.categoryName}` : '';
  return `• **${PRIORITY_LABEL[task.priority]}** ${task.title}${category}`;
}

function section(title: string, tasks: TaskLineValue[]): { name: string; value: string }[] {
  if (tasks.length === 0) return [];
  const ordered = [...tasks].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
  return [{ name: title, value: ordered.map(line).join('\n') }];
}

/** Discord embed. Empty sections are omitted rather than rendered as headings. */
export function renderDiscord(payload: ReminderPayloadValue): unknown {
  const fields = [
    ...section('Overdue', payload.overdue),
    ...section('Due today', payload.dueToday),
    ...section('Repeating today', payload.repeatsToday),
    ...section('Completed yesterday', payload.completedYesterday),
    ...(payload.missedYesterday.length > 0
      ? [{ name: 'Missed yesterday', value: payload.missedYesterday.map((t) => `• ${t}`).join('\n') }]
      : []),
  ];

  return {
    embeds: [
      {
        title: `Todos for ${payload.date}`,
        ...(fields.length === 0 ? { description: 'Nothing scheduled. Enjoy the quiet.' } : {}),
        fields,
        footer: { text: payload.timezone },
      },
    ],
  };
}
