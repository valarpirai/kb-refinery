import { checkOllama } from "../src/lib/pipeline/ollama";
import { initTracing } from "../src/lib/agent/tracing";
import { startWorker } from "../src/lib/pipeline/jobs";

async function main() {
  const problem = await checkOllama();
  if (problem) console.warn(`[worker] warning: ${problem}`);
  initTracing();
  await startWorker();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
