import { checkOllama } from "../src/lib/pipeline/ollama";
import { startWorker } from "../src/lib/pipeline/jobs";

async function main() {
  const problem = await checkOllama();
  if (problem) console.warn(`[worker] warning: ${problem}`);
  await startWorker();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
