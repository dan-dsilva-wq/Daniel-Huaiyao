export type SchedulerBoard = {
  slug: 'murder-mystery';
  title: string;
  shortTitle: string;
  icon: string;
  href: string;
  summary: string;
  eyebrow: string;
  heroTitle: string;
  heroDescription: string;
  steps: string[];
};

export const schedulerBoards: SchedulerBoard[] = [
  {
    slug: 'murder-mystery',
    title: 'The Great Gatsby Murder Mystery',
    shortTitle: 'Gatsby Mystery',
    icon: '🕯️',
    href: '/the-manor',
    summary: 'Find the one evening the full cast can make.',
    eyebrow: 'West Egg Guest List',
    heroTitle: 'Find the one night every guest can arrive in style.',
    heroDescription:
      'Jazz, champagne, and one suspiciously inconvenient death. Add your name, mark the evenings you can attend, and the guest list will reveal the best night for our Great Gatsby murder mystery.',
    steps: [
      'Sign the guest list with your name.',
      'Mark every evening you can attend.',
      'Save your dates and return with the same name if your alibi changes.',
    ],
  },
];

export function getSchedulerBoard(slug: string): SchedulerBoard | null {
  return schedulerBoards.find((board) => board.slug === slug) ?? null;
}
