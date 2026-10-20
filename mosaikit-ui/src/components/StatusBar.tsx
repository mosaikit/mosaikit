interface StatusBarProps {
  user: string
  msg: string
  onLogout: () => void
}

export default function StatusBar({ user, msg, onLogout }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="st-user">👤 {user}</span>
      <span className="st-msg">{msg}</span>
      <button type="button" className="btn ghost small" onClick={onLogout}>
        Esci
      </button>
    </footer>
  )
}
