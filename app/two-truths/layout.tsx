import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Two Truths & a Lie | Daniel & Huaiyao',
  description: 'Can you spot the lie? Take turns trying to fool each other!',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
