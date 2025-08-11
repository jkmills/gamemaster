import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Gamemaster MVP',
  description: 'Single-app MVP with Socket.IO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="mb-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h1 className="text-2xl font-semibold">Gamemaster MVP</h1>
            <nav className="mt-2 flex gap-4 text-blue-600">
              <Link href="/">Home</Link>
              <Link href="/table">Table</Link>
              <Link href="/mobile">Mobile</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
