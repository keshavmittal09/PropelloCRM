export function DuplicateAlert({ isDuplicate }: { isDuplicate: boolean }) {
  if (!isDuplicate) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-8 py-3 flex items-center gap-3">
      <div className="text-amber-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-amber-800">Returning Caller Detected</h4>
        <p className="text-xs text-amber-700 mt-0.5">This lead was recognized from an existing phone number and their information was automatically merged.</p>
      </div>
    </div>
  )
}
