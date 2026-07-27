type DesktopTitleBarProps = {
  workspaceLabel: string;
  connected: boolean;
};

export function DesktopTitleBar({ workspaceLabel, connected }: DesktopTitleBarProps) {
  return (
    <header className="desktop-title-bar" data-wails-drag>
      <div className="desktop-title-identity">
        <span className="desktop-mark" aria-hidden="true">LW</span>
        <strong>Lumina</strong>
        {workspaceLabel && <span className="desktop-workspace-name">{workspaceLabel}</span>}
      </div>
      <span className={connected ? 'connection-state connected' : 'connection-state'}>
        Workspace {connected ? 'connected' : 'not connected'}
      </span>
    </header>
  );
}
