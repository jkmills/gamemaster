export default function Home() {
  return (
    <main className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Choose a surface to get started.
      </p>
      <div className="flex gap-4">
        <a href="/table" className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500">Table</a>
        <a href="/mobile" className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500">Mobile</a>
      </div>
    </main>
  );
}
