import { CONFIG_ERROR_TEXT } from './env';

export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main>
      <h1>{CONFIG_ERROR_TEXT.title}</h1>
      <p role="alert">{CONFIG_ERROR_TEXT.intro}</p>
      <details>
        <summary>{CONFIG_ERROR_TEXT.detailsLabel}</summary>
        <ul>
          {problems.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
