#!/usr/bin/env node
// One-time local script: reads one or more "KB Article Queries" export CSVs
// (columns: Query, KB Article, KB Title, Feedback, Feedback Text -- KB Article
// is a ';'-separated list of KB numbers) and uploads them in batches to the
// Eval Question Upload REST API, which resolves each KB number to the latest
// active/published kb_knowledge record and inserts into
// x_snc_kb_refinery_eval_question (skipping rows where none resolve).
//
// Usage:
//   node upload.mjs --instance https://<instance>.service-now.com [options] [file1.csv file2.csv ...]
//
// Options:
//   --instance <url>     Instance base URL (required; or set INSTANCE_URL env var)
//   --batch-size <n>      Questions per POST request (default: 200)
//   --dry-run             Parse/dedupe/filter only -- don't call the API
//
// If no CSV file paths are given, defaults to the two files this script was
// originally written for (see DEFAULT_FILES below) -- pass explicit paths to
// override.

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const DEFAULT_FILES = [
    // '/Users/gilad.darshan/Downloads/KB_Article_Queries_June2026.csv',
    // '/Users/gilad.darshan/Downloads/KB_Article_Queries_August2026.csv',
];

function parseArgs(argv) {
    const opts = { instance: process.env.INSTANCE_URL || null, batchSize: 200, dryRun: false, files: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--instance') {
            opts.instance = argv[++i];
        } else if (arg === '--batch-size') {
            opts.batchSize = parseInt(argv[++i], 10);
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            opts.files.push(arg);
        }
    }
    if (!opts.files.length) opts.files = DEFAULT_FILES;
    return opts;
}

function loadRows(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    return parse(raw, { columns: true, bom: true, skip_empty_lines: true, relax_quotes: true });
}

function toEvalQuestion(row) {
    const query = (row['Query'] || '').trim();
    const kbNumbers = (row['KB Article'] || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    return {
        query,
        kbNumbers,
        kbTitle: row['KB Title'] || '',
        feedback: row['Feedback'] || '',
        feedbackText: row['Feedback Text'] || '',
    };
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function postBatch(instance, batch) {
    const url = `${instance.replace(/\/$/, '')}/api/x_snc_kb_refinery/eval_question_upload/batch`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: batch }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return JSON.parse(text);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.dryRun && !opts.instance) {
        throw new Error('Missing --instance <url> (or INSTANCE_URL env var).');
    }

    console.log(`Reading ${opts.files.length} file(s):`);
    opts.files.forEach((f) => console.log(`  - ${f}`));

    let allRows = [];
    for (const file of opts.files) {
        const rows = loadRows(file);
        console.log(`  ${file}: ${rows.length} rows`);
        allRows = allRows.concat(rows);
    }
    console.log(`Total rows loaded: ${allRows.length}`);

    let questions = allRows.map(toEvalQuestion);

    // Skip rows with no query text or no KB number referenced at all --
    // before dedup/batching, per the upload contract.
    const beforeFilter = questions.length;
    questions = questions.filter((q) => q.query && q.kbNumbers.length);
    console.log(`Skipped (no query or no KB Article reference): ${beforeFilter - questions.length}`);

    // Dedupe by exact query text, keeping the first occurrence seen.
    const seen = new Set();
    const deduped = [];
    for (const q of questions) {
        if (seen.has(q.query)) continue;
        seen.add(q.query);
        deduped.push(q);
    }
    console.log(`Duplicate queries removed: ${questions.length - deduped.length}`);
    console.log(`Questions to upload: ${deduped.length}`);

    if (opts.dryRun) {
        console.log('Dry run -- not calling the API.');
        return;
    }

    const batches = chunk(deduped, opts.batchSize);
    console.log(`Uploading in ${batches.length} batch(es) of up to ${opts.batchSize}...`);

    let totalInserted = 0;
    let totalSkipped = 0;
    const skipReasons = {};

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
            const result = await postBatch(opts.instance, batch);
            totalInserted += result.inserted;
            totalSkipped += result.skipped;
            for (const r of result.results) {
                if (r.status !== 'inserted') {
                    skipReasons[r.reason] = (skipReasons[r.reason] || 0) + 1;
                }
            }
            console.log(
                `  Batch ${i + 1}/${batches.length}: inserted=${result.inserted} skipped=${result.skipped}`
            );
        } catch (err) {
            console.error(`  Batch ${i + 1}/${batches.length} FAILED: ${err.message}`);
        }
    }

    console.log('---');
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total skipped: ${totalSkipped}`);
    if (Object.keys(skipReasons).length) {
        console.log('Skip reasons:', skipReasons);
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
});
