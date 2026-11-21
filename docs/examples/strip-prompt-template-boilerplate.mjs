#!/usr/bin/env node
// `now-sdk transform` re-adds sys_metadata boilerplate fields (currently
// `sys_customer_update: 'false'`, `sys_replace_on_upgrade: 'false'`, and
// `survey_overwrite: 'false'`) to a `.now.ts` file's `data` object on every
// pull -- they're real sys_metadata fields on the underlying table, but not
// settable through that table's current Fluent schema, so the build fails
// with a TS2353 "does not exist in type 'Data<...>'" error until they're
// stripped back out. Not limited to one table or one directory: transform
// has re-added these to `sys_app_module` (src/fluent/nav/application_menu.now.ts),
// `sys_ui_related_list` (src/fluent/generated/user-interface/related-list/),
// and the original x_snc_kb_refinery_prompt_template_* data records --
// so this walks the whole src/fluent tree rather than one fixed location.
//
// Run from the project root after every `now-sdk transform`:
//   node docs/examples/strip-prompt-template-boilerplate.mjs

import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const FLUENT_DIR = join(process.cwd(), 'src/fluent');
const LINES_TO_STRIP = [
  /^\s*sys_customer_update:\s*['"]false['"],?\s*$/,
  /^\s*sys_replace_on_upgrade:\s*['"]false['"],?\s*$/,
  /^\s*survey_overwrite:\s*['"]false['"],?\s*$/
];

let filesChanged = 0;

for (const entry of readdirSync(FLUENT_DIR, {recursive: true})) {
  if (!entry.endsWith('.now.ts')) continue;

  const filePath = join(FLUENT_DIR, entry);
  const original = readFileSync(filePath, 'utf8');
  const lines = original.split('\n');
  const kept = lines.filter(
    line => !LINES_TO_STRIP.some(pattern => pattern.test(line))
  );

  if (kept.length === lines.length) continue;

  writeFileSync(filePath, kept.join('\n'));
  filesChanged++;
  console.log(`Stripped boilerplate fields from ${entry}`);
}

console.log(
  filesChanged
    ? `Done — ${filesChanged} file(s) updated.`
    : 'Nothing to strip — no boilerplate fields found.'
);
