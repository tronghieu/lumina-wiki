type DesktopTitleBarProps = {
  libraryLabel: string;
  readOnly: boolean;
};

export function DesktopTitleBar({ libraryLabel, readOnly }: DesktopTitleBarProps) {
  return (
    <header className="desktop-title-bar" data-wails-drag>
      <div className="desktop-title-identity">
        <span className="desktop-mark" aria-hidden="true">LW</span>
        <strong>Lumina</strong>
        <span className="desktop-workspace-name">{libraryLabel}</span>
      </div>
      <span className="connection-state connected">
        {readOnly ? 'Read-only library' : 'Library ready'}
      </span>
    </header>
  );
}
