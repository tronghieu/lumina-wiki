import { STRINGS, severityName } from '../lib/strings.mjs';

const SEVERITIES = ['error', 'warning', 'info'];

// Finding text comes from wiki files: it is rendered as React children only.
export function FindingList({ findings, showFile = false }) {
  return (
    <ul className="finding-list">
      {findings.map((f, i) => {
        const s = SEVERITIES.includes(f.severity) ? f.severity : 'info';
        return (
          <li key={i} className={'finding is-' + s}>
            <span className="finding-id">{f.id}</span>{' '}
            <span className="finding-severity">
              {severityName(f.severity)}
            </span>{' '}
            <span className="finding-message">{f.message}</span>
            {showFile && typeof f.file === 'string' && <>{' '}<span className="finding-file">{f.file}</span></>}
            {Number.isInteger(f.line) && <>{' '}<span className="finding-line">{STRINGS.findingLine} {f.line}</span></>}
          </li>
        );
      })}
    </ul>
  );
}
