import './globals.css';
import type { Metadata } from 'next';
import { Notifications } from "../components/Notifications";

export const metadata: Metadata = {
  title: 'Gamemaster MVP',
  description: 'Single-app MVP with Socket.IO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Notifications>
          <div className="container">
            <header className="mb-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h1 className="text-2xl font-semibold">Gamemaster MVP</h1>
            </header>
            {children}
          </div>
        </Notifications>
      </body>
    </html>
  );
}
