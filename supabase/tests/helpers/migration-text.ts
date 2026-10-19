/** Text-level checks on migration files (WP2-19). Returns findings; empty means clean. */

/** Removes -- line comments and slash-star block comments so that prose cannot trigger a rule. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

export function lintMigrationText(name: string, sql: string): string[] {
  const text = stripSqlComments(sql);
  const findings: string[] = [];

  // "into public.x" does not match: \b before "to" fails inside "into", and "public." is a schema prefix.
  if (/\bto\s+public\b(?!\s*\.)/i.test(text)) findings.push(`${name}: grant or policy "to public"`);
  for (const stmt of text.split(';')) {
    if (/^\s*grant\b/i.test(stmt) && /\bto\b[^]*\bpublic\b(?!\s*\.)/i.test(stmt)) {
      findings.push(`${name}: grant that includes PUBLIC`);
    }
  }
  if (/using\s*\(\s*true\s*\)/i.test(text)) findings.push(`${name}: policy "using (true)"`);
  if (/with\s+check\s*\(\s*true\s*\)/i.test(text)) findings.push(`${name}: policy "with check (true)"`);
  if (/service_role/i.test(text)) findings.push(`${name}: mentions service_role`);
  return findings;
}
