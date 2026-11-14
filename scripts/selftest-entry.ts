import { Kernel } from '../src/harmos/kernel';
import { AGENTS, SEED_FILES } from '../src/harmos/agents';
import { makeExecutor, runSelfTests } from '../src/harmos/runtime';

export async function runAll() {
  const k = new Kernel({ agents: AGENTS, files: SEED_FILES });
  k.setExecutor(makeExecutor());
  return runSelfTests(k);
}
